import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { asAdminActor, adminWriteGuard, readIdParam } from '@/lib/admin-api';
import { setCategoryActive } from '@/lib/admin-catalog';
import { adminCategoryStatusSchema } from '@/lib/validation';

/**
 * PATCH /api/admin/categories/:id
 *
 * Activates or deactivates one official category.
 *
 * ONLY `isActive` IS WRITABLE. `name`, `code` and `position` are the
 * authoritative official catalogue identity and are absent from the schema, so
 * `.strict()` rejects any attempt to post them. Nothing is ever renamed,
 * merged, invented or removed - deactivation hides a category from the customer
 * site without deleting it, preserving every booking reference.
 *
 * The target id comes from the URL path, never from the body, so a body cannot
 * redirect the mutation at a different record.
 */
export const PATCH = apiHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const id = await readIdParam(context.params);
  const body = await parseJson(request, adminCategoryStatusSchema);

  const category = await setCategoryActive(id, body.isActive, asAdminActor(guard.user));
  return jsonOk({ category });
});
