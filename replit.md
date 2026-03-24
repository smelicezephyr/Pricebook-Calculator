# PricebookCalc

## Overview

PricebookCalc is a web application designed for HVAC and contractor businesses to accurately calculate system and repair prices. It integrates various financial factors like materials, equipment, labor, taxes, commissions, and financing fees to ensure target profit margins are met. The application allows users to save these calculations as quotes and offers robust tools for managing pricing settings and pushing calculated prices to external pricebook systems like ServiceTitan. Its primary purpose is to streamline the pricing process, enhance accuracy, and improve profitability for contractors.

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
- **Core Schemas**: `settings` (calculator configuration), `quotes` (saved calculations), `tenants` (ServiceTitan credentials), `locations` (sales tax reference).

### Key Design Decisions
- **Shared Route Definitions**: Type-safe API calls between client and server via shared Zod schemas.
- **Settings Management**: A singleton `settings` table provides global calculator configuration, with local storage overrides for user-specific defaults.
- **Quote Snapshots**: Quotes capture calculation results at the time of creation, preserving historical data.
- **ServiceTitan Integration**: Supports multi-tenant push of M&E calculations to ServiceTitan pricebooks, handling authentication, rate limiting, and mapping complex pricing logic (e.g., `price`, `cost`, `hours`, GL accounts, images) to ServiceTitan APIs. Includes functionality for updating existing services and creating new system or repair tasks.
- **Location-Based Sales Tax**: Manages sales tax rates tied to specific locations, assignable to tenants, influencing repair calculations.
- **Flexible Labor & Commission Calculation**: Offers different modes for labor (flat rate vs. percentage of job) and standardizes commission as a percentage of the total job.
- **Reverse Calculator**: Allows users to input a target selling price and work backward to understand cost breakdowns and margins.
- **Push Queue & Progress Monitoring**: Implements a robust queue for ServiceTitan pushes with rate limiting, exponential backoff, and real-time progress updates via Server-Sent Events (SSE).
- **Version Check**: Notifies users of new application versions and prompts for refresh.
- **Error Handling**: Enhanced retry logic for transient API errors and expandable error messages in push history.

## External Dependencies

### Database
- PostgreSQL
- Drizzle Kit (for schema migrations)

### UI Libraries
- Radix UI
- Recharts
- date-fns
- html-to-image

### Development Tools
- Vite
- Replit-specific plugins

### Key Environment Variables
- `DATABASE_URL`
- `NODE_ENV`