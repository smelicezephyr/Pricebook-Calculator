---
name: Role-scoped reporting pattern
description: How to add a restricted role that can view tenant-scoped aggregate data (dashboard/activity) without edit rights.
---

When adding a role that should see reporting/aggregate data for only the tenant(s) it's assigned to (e.g. via a many-to-many user-tenant access table):

- Do the scoping server-side inside the endpoint handler, not just by hiding UI. Derive the caller's allowed tenant IDs from the access table and reject/ignore any requested tenant ID outside that set (403, not silent passthrough).
- Reuse the existing per-tenant access-check helper (e.g. `canAccessTenant`) for any new endpoint that takes a `tenantId` query param, rather than writing new tenant-membership logic.
- For SQL aggregate queries built from dynamic WHERE-clause fragments + parallel param arrays, adding a new optional filter means threading it through every parallel query (main stats, per-entity breakdown, monthly/time-series, count queries) — it's easy to miss one and get inconsistent totals between cards.

**Why:** relying only on frontend nav/gating to restrict a role leaves the underlying data endpoints open to anyone who guesses the URL or tenant ID; the access check has to live in the route handler.
**How to apply:** any time a new role is granted partial/scoped visibility into otherwise admin-only aggregate endpoints.
