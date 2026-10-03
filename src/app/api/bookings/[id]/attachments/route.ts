import { audit } from '@/lib/audit';
import { assertCsrf, assertSameOrigin, requireUser } from '@/lib/auth';
import { ApiError, apiHandler, jsonOk, tooManyRequests } from '@/lib/api';
import { READ_POLICY, UPLOAD_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { loadBookingForActor } from '@/lib/access';
import { storeValidatedUpload } from '@/lib/uploads';
import { prisma } from '@/lib/prisma';

/** Attachments may only be added while work has not yet been performed. */
const ATTACHABLE_STATUSES = new Set([
  'REQUESTED',
  'CONFIRMED',
  'TECHNICIAN_ASSIGNED',
  'TECHNICIAN_ON_THE_WAY',
  'ARRIVED',
]);

/**
 * GET /api/bookings/:id/attachments
 *
 * Lists attachment metadata for a booking the actor is allowed to see.
 * Storage keys are returned (they are random server-generated names) but no
 * filesystem path is ever exposed.
 */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();

    const limit = await rateLimitByUser(READ_POLICY, user.id);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const { id } = await context.params;

    // Ownership-scoped read. Someone else's booking is simply not found.
    const booking = await loadBookingForActor(id, user);
    if (!booking) throw new ApiError('NOT_FOUND', 'Booking not found', 404);

    const attachments = await prisma.attachment.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });

    return jsonOk({ attachments });
  },
);

/**
 * POST /api/bookings/:id/attachments
 *
 * Accepts ONE multipart image and stores it through the validated upload path.
 *
 * SECURITY LAYERS (all enforced in `uploads.ts`):
 *   size cap, MIME allowlist, extension agreement, magic-number verification
 *   against the real bytes, server-generated filename, and path containment.
 *
 * The booking is resolved through `loadBookingForActor`, so an attacker cannot
 * attach a file to another customer's booking by supplying their id.
 */
export const POST = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(request);

    const user = await requireUser();
    await assertCsrf(request);

    const limit = await rateLimitByUser(UPLOAD_POLICY, user.id);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const { id } = await context.params;

    const booking = await loadBookingForActor(id, user);
    if (!booking) throw new ApiError('NOT_FOUND', 'Booking not found', 404);

    if (!ATTACHABLE_STATUSES.has(booking.status)) {
      throw new ApiError(
        'ATTACHMENTS_CLOSED',
        'Attachments cannot be added once the service has been carried out',
        409,
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError('INVALID_UPLOAD', 'Expected multipart/form-data', 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ApiError('INVALID_UPLOAD', 'No file was provided', 400);
    }

    const stored = await storeValidatedUpload(file);

    const attachment = await prisma.attachment.create({
      data: {
        bookingId: booking.id,
        storageKey: stored.storageKey,
        // Stored for display only; never used to build a filesystem path.
        originalName: (file.name || '').slice(0, 160) || null,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });

    await audit({
      action: 'ATTACHMENT_UPLOADED',
      entityType: 'Attachment',
      entityId: attachment.id,
      actorId: user.id,
      actorRole: user.role,
      metadata: { bookingId: booking.id, sizeBytes: stored.sizeBytes },
    });

    return jsonOk({ attachment }, { status: 201 });
  },
);
