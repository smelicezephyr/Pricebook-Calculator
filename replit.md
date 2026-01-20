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
- **Schema**: Two main tables - `settings` (calculator configuration) and `quotes` (saved calculations)

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