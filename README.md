# AppCalendar Mika

Single-user scheduling cockpit for Team A / Team B planning, built with Bun, Next.js, shadcn/ui, drag-and-drop scheduling, and a PostgreSQL + Drizzle schema.

## Stack

- Bun runtime and package manager
- Next.js App Router + React 19 + TypeScript
- shadcn/ui + Tailwind CSS
- `@dnd-kit/*` for drag and drop
- `@tanstack/react-virtual` for the timeline viewport
- PostgreSQL schema via Drizzle ORM + Drizzle Kit

## Scripts

```bash
bun run dev
bun run build
bun run lint
bun test
bun run db:generate
```

## Environment

Copy `.env.example` to `.env.local` and set a PostgreSQL connection string:

```bash
DATABASE_URL=postgres://planner:planner@localhost:5432/app_calendar_mika
```

The current UI runs against seeded demo data in memory so the app can boot without a live database, but the Drizzle schema and initial migration are already included.

## Main Routes

- `/` scheduler workbench with draft sidebar, team lanes, drag/drop, zoom levels, and closure management
- `/drafts` list-based draft input view with dependency editing

## Scheduling Rules

- Half-day planning granularity (`AM` / `PM`)
- Weekends and company closures pause progress
- Same-team edits preserve order and push later work forward
- Cross-team tasks move only when their explicit blocker changes
