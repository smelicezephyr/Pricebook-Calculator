# PricebookCalc

## Overview

PricebookCalc is a web application designed for HVAC and contractor businesses to accurately calculate system and repair prices. It integrates financial factors like materials, equipment, labor, taxes, commissions, and financing fees to ensure target profit margins are met. Users can save calculations as quotes and push calculated prices directly to ServiceTitan pricebooks. Its primary purpose is to streamline the pricing process, enhance accuracy, and improve profitability for contractors.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Forms**: React Hook Form with Zod validation

### Backend
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript (ESM modules)
- **API Pattern**: REST endpoints with Zod schemas for validation
- **Build**: esbuild (server), Vite (client)

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod
- **Core Tables**:
  - `users` — Google OAuth profiles, roles (`admin` / `user` / `everyone`), and per-user push permission
  - `settings` — Per-user calculator defaults: labor mode (`hours` / `percent`), hourly rate, burden %, commission %, target M&E %, sales tax %, and gross margin minimum
  - `quotes` — Saved calculation snapshots from the System and Repair calculators
  - `tenants` — ServiceTitan API credentials (API key, Client ID/Secret, app key) per business unit
  - `user_tenant_access` — Many-to-many: which users can see which tenants
  - `locations` — Regional sales tax rates, assignable to tenants
  - `push_history` — Full audit log of every ServiceTitan push (settings snapshot, processed/updated/skipped counts, original prices for revert, push type, `skipZeroEquipment` flag)
  - `login_events` — Audit log of user authentication activity

## Pages & Features

| Route | Page | Access |
|---|---|---|
| `/` | Complete System Calculator | `user`, `admin` |
| `/repair` | Repair Calculator | `user`, `admin` |
| `/reverse` | Reverse Calculator | `user`, `admin` |
| `/history` | Saved Quotes | `user`, `admin` |
| `/push` | Push to ServiceTitan | `user`, `admin` (with push permission) |
| `/push-history` | Push History & Revert | `user`, `admin` |
| `/tenants` | Tenant Management | `admin` |
| `/locations` | Location / Tax Management | `admin` |
| `/admin/dashboard` | Analytics Dashboard | `admin` |
| `/admin/users` | User Management | `admin` |

## Key Design Decisions

### Authentication & RBAC
- Google OAuth only (no passwords). Callback URL configured via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Three roles: `admin` (full access), `user` (calculators + push), `everyone` (limbo — no data access until promoted).
- Tenant access is scoped per user via `user_tenant_access`; admins see all tenants.
- Push permission is a separate flag on `users`: `reprice_and_add`, `add_new_only`, or `none`.

### Calculators
- **System Calculator**: Materials + equipment + labor + tax + commission + financing → target M&E % → selling price. Supports OEM and utility rebates. PNG export via `html-to-image`.
  - **Labor mode toggle** (Hourly / % of price): initializes from the user's saved Settings; overridable per session. Switching to hourly reveals `# of Technicians` and hours-per-tech inputs.
  - **Hourly labor formula**: `numTechs × hoursPerTech × hourlyRate × (1 + burdenPercent)` = burdened labor cost.
  - **Sales Tax %**: per-calculation override field (defaults to the value saved in Settings).
- **Repair Calculator**: Material markup + production pay (% of commission) or hourly labor → repair price. Supports a `# of Technicians` field in hourly mode.
- **Reverse Calculator**: Enter a target selling price → back-calculate gross margin and cost breakdown. The system section mirrors the System Calculator's labor mode toggle, `# of Technicians`, and sales tax fields. A "Copy from System Calculator" button syncs all those values across.
- **Hourly labor cost breakdown sub-rows**: When hourly mode is active, the "Burdened Labor" row in the cost breakdown expands to show:
  - `N techs × H hrs = T total hrs` (tech count line only shown when numTechs > 1)
  - `$rate/hr × T hrs` → direct labor amount
  - `Labor Burden (X%)` → burden amount
  - Implemented via an optional `laborBreakdown` prop on `ResultsCard` (System Calculator) and inline in the Reverse Calculator's system breakdown panel.
- Settings are per-user (stored in `settings` table with `user_id` FK); individual calculator fields override the saved defaults for the duration of the session.

### ServiceTitan Push Engine
- Fetches all services in selected pricebook categories, maps material/equipment costs from the ST catalog into in-memory lookup maps, calculates new prices against the configured M&E target %, and updates ServiceTitan via batch API calls.
- **Push types**: `update` (reprice existing), `new_system` (create new system task), `new_repair` (create new repair task).
- **Zero-equipment handling** (configurable per push, stored in `push_history.skip_zero_equipment`):
  - Toggle OFF (default): all services are priced normally.
  - Toggle ON: services with equipment cost = $0 are skipped — even if they have materials cost.
  - Sub-option "Set those services to $0 price": instead of skipping, actively pushes $0 as the static price to ServiceTitan for matching services.
- **Revert**: Every push stores original prices in `push_history.original_values` (JSON). A revert call restores them via the ST API.
- Transient per-push options (`skipZeroEquipment`, `zeroEquipmentSetZeroPrice`) are carried through the queue via an in-memory `pendingPushExtras` map (keyed by `historyId`) without requiring additional DB columns.

### Push Queue (`server/pushQueue.ts`)
- Global concurrency cap: `MAX_CONCURRENT_PUSHES = 3` active tenants at once.
- Per-tenant lanes: if a tenant already has an active push, additional pushes queue behind it and auto-start when the current one completes.
- Global queue: if the system-wide cap is hit, pushes for free tenants queue globally and promote when a slot opens.
- Real-time progress via Server-Sent Events (SSE) at `GET /api/push/progress/:tenantId`.

### Resilient API Communication
- `withRetry` utility (in `server/pushQueue.ts`) wraps ServiceTitan API calls with exponential backoff, handling 429 rate limits, 5xx gateway errors, connection timeouts, and Snapshot Isolation conflicts.

### Admin Dashboard
- Aggregates push history by type (update / new_system / new_repair) and status (completed / failed / cancelled).
- Shows recent login activity from `login_events`.

## External Dependencies

### Database
- PostgreSQL (connection via `DATABASE_URL`)
- Drizzle Kit for schema migrations (`npm run db:push`)

### UI Libraries
- Radix UI primitives (via shadcn/ui)
- Recharts (analytics charts)
- date-fns (date formatting)
- html-to-image (calculator PNG export)

### Development Tools
- Vite (frontend dev server and HMR)
- esbuild (server bundling)
- Replit-specific plugins

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | Google OAuth app client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth app client secret |
| `NODE_ENV` | `development` or `production` |

## Running Locally

The `Start application` workflow runs `npm run dev`, which starts Express (port 5000) with Vite middleware for the frontend. No separate frontend build step is needed in development.

To apply schema changes: `npm run db:push`
