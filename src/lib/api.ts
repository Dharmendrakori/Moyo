import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { AuthError } from './auth';
import { env } from './env';

/**
 * SECURE API RESPONSE HELPERS
 *
 * Every API route returns through here so that:
 * - Error messages are generic in production. Stack traces, SQL errors and
 *   Prisma messages are NEVER serialized to the client.
 * - Validation failures return only field names and safe messages.
 * - Successful responses are explicitly non-cacheable where they are per-user.
 */

export type ApiErrorShape = {
  error: { code: string; message: string; fields?: Record<string, string> };
};

/** Maps a ZodError to `{ field: message }`, taking the first issue per field. */
export function zodFields(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { 'Cache-Control': 'private, no-store', ...(init?.headers ?? {}) },
  });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  fields?: Record<string, string>,
) {
  const body: ApiErrorShape = { error: { code, message } };
  if (fields) body.error.fields = fields;
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

/**
 * Wraps a route handler so that:
 * - expected errors map to correct HTTP codes,
 * - unexpected errors are logged server-side and returned as a generic 500.
 *
 * The client never receives a stack trace, database message, or SQL fragment.
 */
export function apiHandler<A extends unknown[]>(
  handler: (request: Request, ...args: A) => Promise<Response>,
) {
  return async (request: Request, ...args: A): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (err) {
      if (err instanceof AuthError) {
        return jsonError(err.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN', err.message, err.status);
      }
      if (err instanceof ZodError) {
        return jsonError('VALIDATION_ERROR', 'Please correct the highlighted fields', 422, zodFields(err));
      }
      if (err instanceof ApiError) {
        return jsonError(err.code, err.message, err.status);
      }

      // Unknown error: log full detail server-side only.
      console.error('[api] unhandled error', {
        path: new URL(request.url).pathname,
        message: err instanceof Error ? err.message : 'unknown',
        stack: env().NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined,
      });

      return jsonError('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
    }
  };
}

/** Explicit, intentional API errors. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what = 'Resource') => new ApiError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (msg = 'You do not have access to this resource') =>
  new ApiError('FORBIDDEN', msg, 403);
export const unauthorized = (msg = 'Authentication required') =>
  new ApiError('UNAUTHENTICATED', msg, 401);
export const conflict = (msg: string) => new ApiError('CONFLICT', msg, 409);
export const badRequest = (msg: string) => new ApiError('BAD_REQUEST', msg, 400);

/**
 * Parses and validates a JSON body, enforcing a maximum serialized size so a
 * malicious client cannot send a multi-megabyte payload to exhaust memory.
 */
export async function parseJson<T>(request: Request, schema: ZodSchema<T>, maxBytes = 64 * 1024): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw badRequest('Expected application/json');
  }

  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 'Request body is too large', 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest('Request body is not valid JSON');
  }

  return schema.parse(parsed);
}

/**
 * Serves generated PDF bytes as a download.
 *
 * The filename is derived from a SERVER-generated invoice number and sanitised
 * anyway, so a stored value can never inject a path or a header. Every response
 * is `no-store` because the document is per-user financial data, and
 * `nosniff` keeps a browser from reinterpreting the body.
 */
export function pdfResponse(filenameBase: string, bytes: Uint8Array) {
  const safe = filenameBase.replace(/[^A-Za-z0-9-]/g, '') || 'invoice';
  // A Blob is accepted as a BodyInit by both the Fetch and Next typings, and it
  // wraps the exact byte range rather than the whole backing buffer.
  const body = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safe}.pdf"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** 429 response with Retry-After, used by rate limiting. */
export function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' } },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'Cache-Control': 'private, no-store',
      },
    },
  );
}