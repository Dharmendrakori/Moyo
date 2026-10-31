import { adminReadGuard } from '@/lib/admin-api';
import { apiHandler } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { technicianExportIdsSchema } from '@/lib/validation';

/**
 * GET /api/admin/technicians/export?ids=cuid,cuid
 *
 * Exports the EXPLICITLY SELECTED profiles as CSV. There is no "export
 * everything" mode: the operator must name the records, and the list is capped,
 * so a single request cannot dump the roster.
 *
 * WHAT IS EXPORTED: the roster fields only - name, mobile, headline, skills,
 * service areas, active, available, portal state. Credentials are not selectable
 * from the database here in the first place (no `passwordHash`, no
 * `activationTokenHash`, no session data), and the projection is fixed in this
 * file so a future column cannot leak by accident.
 *
 * FORMULA INJECTION: a spreadsheet treats `=`, `+`, `-`, `@`, tab and CR at the
 * start of a cell as a formula. Every cell is quoted and any such leading
 * character is prefixed with an apostrophe, so imported text stays text.
 */

/** Quotes one CSV cell and neutralises formula triggers. */
function csvCell(value: string | null): string {
  const text = value ?? '';
  const neutralised = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = technicianExportIdsSchema.parse(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const rows = await prisma.technician.findMany({
    where: { id: { in: ids } },
    orderBy: { displayName: 'asc' },
    select: {
      displayName: true,
      phone: true,
      headline: true,
      skills: true,
      serviceAreas: true,
      isActive: true,
      isAvailable: true,
      user: { select: { isActive: true, activationExpiresAt: true } },
    },
  });

  const header = [
    'name',
    'mobile',
    'headline',
    'skills',
    'service_areas',
    'active',
    'available',
    'portal',
  ];

  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    const portal = !row.user
      ? 'no login'
      : row.user.activationExpiresAt !== null
        ? 'invitation pending'
        : row.user.isActive
          ? 'active login'
          : 'login disabled';

    lines.push(
      [
        row.displayName,
        row.phone,
        row.headline,
        row.skills,
        row.serviceAreas,
        row.isActive ? 'yes' : 'no',
        row.isAvailable ? 'yes' : 'no',
        portal,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  // A BOM keeps Excel from mis-reading the UTF-8 export.
  const body = `\uFEFF${lines.join('\r\n')}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="technicians-${stamp}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
