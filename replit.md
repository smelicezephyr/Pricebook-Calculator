# PricebookCalc

## Overview

PricebookCalc is a pricing calculator application for HVAC/contractor businesses. It helps calculate complete system prices by factoring in materials, equipment, labor, taxes, commissions, and financing fees to achieve target profit margins. Users can save calculations as quotes and manage their pricing settings.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom theme configuration
- **Charts**: Recharts for visualizing cost breakdowns
- **Forms**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript (ESM modules)
- **API Pattern**: REST endpoints defined in shared routes file with Zod schemas
- **Build**: Custom build script using esbuild for server, Vite for client

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema**: Main tables:
  - `settings` - Calculator configuration (singleton pattern)
  - `quotes` - Saved calculation snapshots
  - `tenants` - ServiceTitan API credentials for multi-tenant support (with locationId FK)
  - `locations` - Location-to-sales-tax reference library

### Project Structure
```
client/           # React frontend
  src/
    components/   # UI components
    hooks/        # Custom React hooks
    pages/        # Route pages
    lib/          # Utilities
server/           # Express backend
  routes.ts       # API route handlers
  storage.ts      # Database operations
  db.ts           # Database connection
shared/           # Shared code between client/server
  schema.ts       # Drizzle database schema
  routes.ts       # API route definitions with Zod
```

### Key Design Decisions

1. **Shared Route Definitions**: API routes are defined once in `shared/routes.ts` with Zod schemas, enabling type-safe API calls on both client and server.

2. **Settings Singleton Pattern**: The settings table stores a single row of calculator configuration, automatically created with defaults if missing.

3. **Quote Snapshots**: Saved quotes store calculated results at time of creation, preserving history even if settings change later.

4. **Path Aliases**: TypeScript paths configured for clean imports (`@/` for client, `@shared/` for shared code).

5. **ServiceTitan Integration**: Multi-tenant support for pushing M&E calculations to ServiceTitan pricebooks.
   - **API Reference**: https://developer.servicetitan.io/apis/ (Pricebook v2 API)
   - Tenants store encrypted OAuth credentials (clientId, clientSecret, appKey)
   - Credentials are masked in API responses (never exposed to frontend)
   - OAuth tokens cached for 15 minutes per tenant
   - Push endpoint calculates price = (meCost + tax) / (targetMePercent / 100) for each service
   - **API Field Mapping**:
     - `price` → Static Price (updatable via API)
     - `cost` → Estimated Labor Cost (READ-ONLY - calculated by ServiceTitan from Hours × internal labor rate)
     - `hours` → Hours field (updatable)
   - Services are fetched by category, materials/equipment loaded globally for cost lookup
   - Materials/equipment are linked to services via `serviceMaterials[].skuId` and `serviceEquipment[].skuId`

## External Dependencies

### Database
- PostgreSQL database (connection via `DATABASE_URL` environment variable)
- Drizzle Kit for schema migrations (`npm run db:push`)

### UI Libraries
- Radix UI primitives for accessible components
- Recharts for data visualization
- date-fns for date formatting
- html-to-image for exporting results

### Development Tools
- Vite dev server with HMR
- Replit-specific plugins for development (cartographer, dev-banner, error overlay)

### Key Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (required)
- `NODE_ENV`: development/production mode

## Recent Changes

### Push Queue and Rate Limiting (January 2026)
- Increased parallel service updates from 5 to 20 per push (within ServiceTitan's 60 req/sec limit)
- Limited concurrent pushes to 3 tenants simultaneously (20 × 3 = 60 max requests/sec)
- Implemented exponential backoff retry logic for 429 (rate limit) errors
- Queue status endpoint: GET /api/servicetitan/push-queue/status
- Frontend handles queued state with user-friendly messaging

### ServiceTitan Multi-Tenant Integration (January 2026)
- Added tenant management for multiple ServiceTitan accounts
- Created Push to ServiceTitan page with category selection
- Implemented M&E percentage calculation push functionality
- Security: Tenant credentials masked in all API responses

### Repair Calculator (February 2026)
- Added standalone Repair Calculator page for HVAC repair job pricing
- Inputs: Materials cost, Labor rate, Labor hours, Sales tax %, Commission %
- Calculation: Materials + Tax + Labor + Commission = Total Price
- Shows gross margin percentage with color-coded health indicators
- Renamed "Calculator" to "System Calculator" in navigation

### Push to ServiceTitan Restructure (February 2026)
- Restructured Push to ServiceTitan page with three tabs:
  - **Update Pricebook**: Updates existing services with calculated M&E pricing
  - **New System Task**: Creates new system installation services with M&E pricing
  - **New Repair Task**: Creates new repair services with labor/commission pricing
- New System Task includes:
  - Price calculator with Materials/Equipment cost inputs
  - Form fields: Code, Name, Description, Warranty Description
  - Checkboxes: Taxable, Allow Discount Codes, Allow Membership Discounts
  - Hours field, GL Account dropdown (searchable), Category selection
  - Image upload support
- New Repair Task includes:
  - Repair price calculator with Materials, Labor Rate, Labor Hours, Tax %, Commission %
  - Same form fields as System Task (Code, Name, Description, etc.)
  - Real-time price breakdown with gross margin indicator
- New API endpoints:
  - GET /api/servicetitan/:tenantId/gl-accounts - Fetch GL accounts
  - POST /api/servicetitan/:tenantId/services - Create new service
  - POST /api/servicetitan/:tenantId/services/:serviceId/image - Upload image
### PSI Mode Toggle (February 2026)
- Added PSI Mode toggle to both New System Task and New Repair Task forms
- **New System Task PSI Mode**: Switches GL Account from "Revenue" (default) to "Sales"
- **New Repair Task PSI Mode** (enabled):
  - Material Markup: 40%
  - Labor Rate: $600
  - Sales Tax: 7.4%
  - GL Account: "Sales"
- **New Repair Task Defaults** (PSI off):
  - Material Markup: 200%
  - Labor Rate: $175
  - Sales Tax: from tenant's assigned location (fallback 6.35%)
  - GL Account: "Revenue"
  - Financing Fee: 4%

### Location-Based Sales Tax Management (February 2026)
- Added `locations` table as a reference library mapping location names to sales tax percentages
- Seeded 6 initial locations: Gaithersburg MD (6%), Hartford CT (6.35%), Gypsum CO (7.4%), Jupiter FL (7%), Denver CO (9.15%), Houston TX (8.25%)
- Admin section includes Locations management page (CRUD operations)
- Tenants can be assigned a location via dropdown in tenant configuration
- When a tenant is selected on Push to ServiceTitan page, the repair tab's sales tax auto-populates from the tenant's assigned location
- PSI mode toggle off restores location-based tax; fallback is 6.35% if no location assigned
- API endpoints: GET/POST/PUT/DELETE /api/locations
- Location displayed in tenant cards on Tenants page

### Per-Device Settings Cache (February 2026)
- Settings are saved to browser localStorage (`pricebookcalc_settings` key) when user saves
- Each device/browser retains its own saved settings independently
- On load, localStorage values override database defaults
- Settings are also saved to the database as a shared fallback
- If no local settings exist, database settings are used as defaults