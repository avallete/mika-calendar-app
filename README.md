# AppCalendar Mika

Single-user scheduling cockpit for dynamic team planning, built with Bun, Next.js, shadcn/ui, drag-and-drop scheduling, and a PostgreSQL-compatible Drizzle schema. Local development uses a persistent PGlite database by default, while external PostgreSQL remains supported through `DATABASE_URL`.

## Stack

- Bun runtime and package manager
- Next.js App Router + React 19 + TypeScript
- shadcn/ui + Tailwind CSS
- `@dnd-kit/*` for drag and drop
- `@tanstack/react-virtual` for the timeline viewport
- PostgreSQL schema via Drizzle ORM + Drizzle Kit
- `@electric-sql/pglite` for local dev persistence without installing PostgreSQL

## Scripts

```bash
bun run dev
bun run build
bun run lint
bun test
bun run db:migrate
bun run db:generate
```

## Environment

Copy `.env.example` to `.env.local`.

```bash
PGLITE_DATA_DIR=.pglite
```

By default, the app uses a persistent local PGlite database stored in `.pglite/`. The server runtime will initialize that database and apply checked-in migrations automatically on first boot.

If you want to point the app at a full PostgreSQL server instead, set `DATABASE_URL`:

```bash
DATABASE_URL=postgres://planner:planner@localhost:5432/app_calendar_mika
```

For external PostgreSQL, run `bun run db:migrate` yourself before starting the app.

## Main Routes

- `/` scheduler workbench with draft sidebar, dynamic team lanes, drag/drop, zoom levels, and generated/company closures
- `/drafts` list-based draft input view with dependency editing
- `/settings` French settings surface for team management and custom global closure management

## Scheduling Rules

- Half-day planning granularity (`AM` / `PM`)
- Weekends and company closures pause progress
- Same-team edits preserve order and push later work forward
- Cross-team tasks move only when their explicit blocker changes
