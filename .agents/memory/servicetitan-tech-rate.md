---
name: ServiceTitan highest-tech-rate fetch
description: Confirmed working approach for fetching highest technician hourly rate from ServiceTitan API.
---

## Working endpoint
`GET /settings/v2/tenant/{tenantId}/technicians?pageSize=200&page=1`

- Requires the **Settings** module with **Technicians** scope enabled in the ST developer app (developer.servicetitan.io).
- Response shape: `{ page, pageSize, hasMore, totalCount, data: [...] }`
- Each record has `id`, `name`, `hourlyRate` (and many other fields). `hourlyRate` is embedded directly — no separate payroll-settings call needed.
- 78 technicians returned for tenant 434249000 in ~0.5s total.

## What does NOT work (tenant 434249000)
- `/payroll/v2/.../employees` — 404, payroll module has no list endpoint
- `/payroll/v2/.../technicians` — 404 same
- `/payroll/v2/.../technician-payrolls` — 404 (these are payroll-run records, different path)
- `/payroll/v2/.../payroll-jobs` — 404
- `/dispatch/v2/.../technicians` — 404, Dispatch module not enabled
- `/hrm/v2/.../employees` — 404, HRM module not enabled

## Per-tech payroll-settings (not needed if Settings returns hourlyRate)
`GET /payroll/v2/tenant/{tenantId}/technicians/{techId}/payroll-settings` → `{ hourlyRate }`
Requires Payroll module + Payroll Settings scope. Use only as fallback if `hourlyRate` is null on the technician list record.

**Why:** The Settings Technicians endpoint returns `hourlyRate` directly, eliminating 78+ extra API calls and cutting response time from ~4s to <1s.

**How to apply:** In `getHighestTechnicianRate()`, check if all records have `hourlyRate != null` and use the fast path. Only fall back to per-tech payroll-settings when the field is missing.
