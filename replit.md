# Hive App

## Overview
Progressive Web App for field agents to collect household/tenant data offline with automatic sync when online. Includes admin dashboard for oversight, reporting, agent management, and data export.

## Architecture
- **Backend**: Express.js with Passport.js session auth, Drizzle ORM
- **Frontend**: React + Vite + TanStack Query, wouter routing
- **Database**: PostgreSQL via Drizzle
- **Offline**: IndexedDB via Dexie for offline-first data collection
- **Charts**: Recharts for dashboard visualizations
- **Tables**: @tanstack/react-table for sortable/paginated data tables
- **Export**: exceljs for Excel export

## Key Files
- `shared/schema.ts` - Data models (users, records) with Zod schemas
- `shared/routes.ts` - API route definitions with type safety
- `server/routes.ts` - Express route handlers, seed data
- `server/storage.ts` - Database storage layer with filtering and stats
- `server/auth.ts` - Passport.js auth with password hashing
- `client/src/pages/Login.tsx` - Login page
- `client/src/pages/AgentHome.tsx` - Agent data collection form
- `client/src/pages/AdminDashboard.tsx` - 4-tab admin dashboard (Summary, Records, Agents, Sec. Admins)
- `client/src/hooks/use-secondary-admins.ts` - Secondary admin CRUD
- `client/src/hooks/use-records.ts` - Record CRUD with offline sync
- `client/src/hooks/use-auth.ts` - Auth state management
- `client/src/hooks/use-agents.ts` - Agent CRUD
- `client/src/hooks/use-stats.ts` - Dashboard statistics
- `client/src/hooks/use-update-record.ts` - Record update, delete, and admin create mutations
- `client/src/lib/db.ts` - Dexie IndexedDB setup
- `client/src/components/GpsToggle.tsx` - GPS location capture
- `client/src/components/SyncStatus.tsx` - Offline sync indicator

## Data Model
- **users**: id, username, password (hashed), plainPassword, fullName, role (admin/secondary_admin/agent), permissions (jsonb - PermissionsMap for secondary_admin), isActive
- **records**: id, collectedBy, accompanyingAgents (jsonb), recordTitle, personType (Landlord/Tenant), landlordName, tenantName, phoneNumber, town, area, section, houseNumber, latitude, longitude, gpsTimestamp, customFields (jsonb), isSynced, createdAt, updatedAt
- **custom_columns**: id, name, fieldType (text/number/select), isRequired, options (jsonb), isActive, createdAt

## Default Accounts
- Admin: username=admin, password=admin123
- Agent: username=agent1, password=password

## Features
- Offline-first with IndexedDB + auto background sync
- Checkbox-based accompanying agent selection
- Person type dropdown (Landlord/Tenant)
- Record title/category field
- GPS location capture toggle
- Admin dashboard with:
  - Summary tab: metric cards, bar charts (per agent, over time) with day/week/month toggle, performance table
  - Records tab: filterable/sortable table, inline edit dialog, add record dialog with agent assignment, delete with confirmation, Excel export
  - Agents tab: agent cards with stats, create agents, view/edit agent details (username, password, full name), approve/deactivate agents
- Dynamic custom data columns: admin can create text/number/dropdown fields that appear in all forms and tables
- Advanced filters: agent, date range, town, area, name search
- Secondary Admin role: system admin can create secondary admins with granular permissions (view/edit/delete records, manage agents, export, manage custom columns, view stats) toggleable via checkboxes
  - Permissions: viewRecords, editRecords, deleteRecords, addRecords, exportRecords, viewAgents, createAgents, editAgents, manageCustomColumns, viewStats
  - Backend enforces permissions on all routes; frontend hides/disables UI elements based on permissions
