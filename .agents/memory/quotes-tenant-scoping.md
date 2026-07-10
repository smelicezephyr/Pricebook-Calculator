---
name: Quotes tenant scoping
description: How Saved Quotes are associated with tenants, and the limitation for legacy rows.
---

Quotes gained a nullable `tenant_id` column (added via direct SQL, not `drizzle-kit push`,
because that tool wanted to drop the unrelated `session` table — always check the diff before
accepting a push, or apply narrow schema changes with raw SQL instead).

Each calculator (System GM, System M&E, Repair, Repair GM) already tracks `selectedTenantId`
via `TenantTaxSelector`; that value is now passed through to `createQuote` so new quotes carry
their tenant.

**Why:** the Saved Quotes filter needs a way to scope by tenant, and tenant access is already
role-scoped server-side via `GET /api/tenants` (admin sees all, user/manager see only their
`user_tenant_access` assignments) — reusing that endpoint for the filter dropdown avoids
duplicating role logic on the frontend.

**How to apply:** quotes saved before this change have `tenant_id = NULL` and cannot be
backfilled — the original per-quote settings/tenant context was never snapshotted. Any tenant
filter or report must treat `tenant_id IS NULL` as "unknown tenant," not silently exclude/include it.
