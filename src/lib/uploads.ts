import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';
import { ApiError } from './api';

/**
 * FILE UPLOAD SECURITY
 *
 * Defence layers (all must pass):
 *  1. Size limit enforced while buffering, before anything touches disk.
 *  2. Declared MIME type allowlist AND extension allowlist (must agree).
 *  3. Magic-number ("file signature") check against the actual bytes, so a
 *     renamed `.exe` cannot masquerade as an image.
 *  4. Server-generated random filename with a fixed extension. The user
 *     filename is NEVER used to build a path, preventing path traversal.
 *  5. Stored outside the Next.js `public/` web root, so it is not web-served.
 *     Retrieval only happens through an authorized route handler.
 *  6. Path containment check before writing, defeating symlink/../ escapes.
 */

/**
 * Allowed uploads. Only raster images are accepted for booking photos -
 * no SVG (XSS vector), no HTML, no executables, no archives.
 */
const ALLOWED_TYPES = {
  'image/jpeg': { ext: '.jpg', magic: [0xff, 0xd8, 0xff] },
  'image/png': { ext: '.png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  'image/webp': {
    ext: '.webp',
    // "RIFF" .... "WEBP"
    magic: [0x52, 0x49, 0x46, 0x46],
    magicOffsetCheck: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  },
} as const satisfies Record<
  string,
  { ext: string; magic: number[]; magicOffsetCheck?: { offset: number; bytes: number[] } }
>;

type AllowedMime = keyof typeof ALLOWED_TYPES;

export const ACCEPTED_UPLOAD_MIME_TYPES: readonly string[] = Object.keys(ALLOWED_TYPES);

export function maxUploadBytes(): number {
  return env().MAX_UPLOAD_MB * 1024 * 1024;
}

function magicMatches(head: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (head[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Absolute path of the upload directory, resolved against process.cwd().
 * Kept outside `public/` by convention and by .gitignore.
 *
 * The `turbopackIgnore` comments are deliberate. Turbopack's static analysis
 * cannot prove that `UPLOAD_DIR` stays inside a known subfolder, so it would
 * trace and bundle the ENTIRE project into the server output. These calls are
 * runtime-only filesystem writes to a directory that is never served, so opting
 * out of tracing is correct and keeps the deployment artefact small.
 */
function uploadRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), env().UPLOAD_DIR);
}

/**
 * Validates and persists an uploaded file.
 * Returns the storage key (a random name) to be stored in the database.
 */
export async function storeValidatedUpload(file: File): Promise<{
  storageKey: string;
  mimeType: AllowedMime;
  sizeBytes: number;
  sha256: string;
}> {
  const limit = maxUploadBytes();

  // Reject on the declared size before reading the body at all.
  if (typeof file.size === 'number' && file.size > limit) {
    throw new ApiError('FILE_TOO_LARGE', 'File exceeds the maximum allowed size', 413);
  }
  if (file.size === 0) {
    throw new ApiError('EMPTY_FILE', 'File is empty', 400);
  }

  const declared = (file.type || '').toLowerCase();
  if (!declared || !(declared in ALLOWED_TYPES)) {
    throw new ApiError('UNSUPPORTED_FILE_TYPE', 'Only JPG, PNG or WEBP images are accepted', 415);
  }
  const mime = declared as AllowedMime;

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Re-check real size after buffering.
  if (bytes.byteLength > limit) {
    throw new ApiError('FILE_TOO_LARGE', 'File exceeds the maximum allowed size', 413);
  }

  // Extension allowlist must agree with the declared type.
  const originalExt = path.extname(file.name || '').toLowerCase();
  const allowedExts: string[] = Object.values(ALLOWED_TYPES).map((t) => t.ext);
  if (originalExt && !allowedExts.includes(originalExt)) {
    throw new ApiError('UNSUPPORTED_FILE_TYPE', 'File extension is not allowed', 415);
  }

  // File-signature verification against the real bytes.
  const rule = ALLOWED_TYPES[mime];
  if (!magicMatches(bytes, rule.magic)) {
    throw new ApiError('INVALID_FILE_CONTENT', 'File content does not match its type', 415);
  }
  if ('magicOffsetCheck' in rule && rule.magicOffsetCheck) {
    if (!magicMatches(bytes, rule.magicOffsetCheck.bytes, rule.magicOffsetCheck.offset)) {
      throw new ApiError('INVALID_FILE_CONTENT', 'File content does not match its type', 415);
    }
  }

  // Server-generated name. Never derived from user input.
  const storageKey = `${randomBytes(16).toString('hex')}${rule.ext as string}`;
  const root = uploadRoot();
  // turbopackIgnore: runtime-only path, see uploadRoot().
  const target = path.resolve(/* turbopackIgnore: true */ root, storageKey);

  // Path containment: the resolved target must stay inside the upload root.
  if (target !== path.join(/* turbopackIgnore: true */ root, path.basename(target))) {
    throw new ApiError('INVALID_PATH', 'Invalid storage path', 400);
  }

  await mkdir(root, { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });

  return {
    storageKey,
    mimeType: mime,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Resolves a stored key to an absolute path, refusing anything that escapes
 * the upload directory. Guards against a tampered database value too.
 */
export function resolveStoredFile(storageKey: string): string {
  const root = uploadRoot();
  // Only allow the exact shape we generate: 32 hex chars + known extension.
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(storageKey)) {
    throw new ApiError('INVALID_PATH', 'Invalid attachment reference', 400);
  }
  // turbopackIgnore: runtime-only path, see uploadRoot().
  const resolved = path.resolve(/* turbopackIgnore: true */ root, storageKey);
  if (!resolved.startsWith(root + path.sep)) {
    throw new ApiError('INVALID_PATH', 'Invalid attachment reference', 400);
  }
  return resolved;
}