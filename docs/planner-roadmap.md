# Planner Roadmap

Updated: 2026-03-25

## Purpose

This file is the working reference for improving the planner. It documents the current state of the app, the known bugs and missing features, the larger future bets, and the validation scenarios that should be checked before closing work.

Use this file as the source of truth for roadmap progress:

- `[ ]` not started
- `[x]` implemented and verified
- `P0` critical correctness or UX issue
- `P1` important workflow or data improvement
- `P2` later-phase capability
- `Explore` needs design work before implementation

## Current State Snapshot

- The main planner surfaces are:
  - `/` for the scheduling workbench and timeline
  - `/drafts` for list-based draft creation and editing
  - `/settings` for teams, holiday sources, and custom closures
- Planner state is loaded as a full snapshot. The root layout loads the planner through `loadPlannerSnapshot()`, and the client provider then mutates the same snapshot shape through server actions.
- Drafts are visible in two places today:
  - the `/drafts` table view
  - the scheduler sidebar on `/`
- Neither draft surface is searchable today.
- The timeline currently renders one row per team. The current rendering model groups scheduled work by section and team, then draws a dedicated row surface for each team.
- A project currently supports exactly one scheduled placement through:
  - `scheduledTeam`
  - `scheduledStartSlot`
  - `scheduledDurationHalfDays`
  - `sequenceOrder`
- Weather exists today only as calendar-level closure data and markers. There is no project-level field describing whether a task is inside, outside, or mixed.
- Undo/redo UI already exists, and planner actions are logged by session, but the current persistence flow replaces the whole state and clears `planner_action_log` during normal writes. In practice, that prevents reliable multi-step undo/redo across a session.
- Team styling currently stores two values in persistence:
  - `accentColor`
  - `softColor`
- Test baseline as of 2026-03-25:
  - `bun run typecheck` passes
  - `bun test` fails because Bun also collects the Playwright spec under `e2e/`, even though planner unit tests pass

## Roadmap

### P0 Correctness And UX Fixes

- [ ] **P0: Fix unexpected scroll jumps while dragging on the calendar.**
  - Acceptance criteria:
    - Dragging a task must never scroll the page upward or otherwise move the viewport unexpectedly.
    - The viewport should remain stable unless the user explicitly scrolls.
    - Any redraw, focus, or event-listener side effect that currently changes scroll position during drag is removed or contained.
  - Notes:
    - The current behavior suggests a scroll side effect caused by drag-time rerendering, focus management, or a listener reacting to calendar updates.

- [ ] **P0: Fix the earlier-shift prompt so it appears only when later same-team projects would actually move earlier.**
  - Acceptance criteria:
    - Moving a project earlier still prompts when later same-team work would also shift earlier.
    - Resize-start changes that only lengthen the selected project do not trigger the prompt unless follow-up work would actually be pulled earlier.
    - The false positive currently seen during resize-start or project extension is no longer reproducible.
  - Notes:
    - The current prompt logic only checks whether the edited project starts earlier, not whether the queue behind it is truly affected.

- [ ] **P0: Fix the earlier-shift modal overflow.**
  - Acceptance criteria:
    - Dialog text wraps within the modal bounds.
    - Footer actions remain visible and aligned on standard desktop widths.
    - The dialog remains readable for long project titles and long date labels.

- [ ] **P0: Make undo/redo support the full session history in both directions.**
  - Acceptance criteria:
    - The user can undo multiple actions from the same session, not just the last one.
    - The user can redo multiple undone actions in order.
    - Performing a new action after undo invalidates only the redo stack, not the undo history that should remain valid before that new action.
  - Notes:
    - This requires preserving planner action-log entries across normal mutations and across undo/redo operations.

- [ ] **P0: Fix rendering for very small-duration cards.**
  - Acceptance criteria:
    - Cards rendered below the minimum readable width hide or simplify text and controls instead of overflowing.
    - Tiny tasks still remain selectable and draggable.
    - The timeline no longer looks broken for small durations.

- [ ] **P0: Fix the broken drag/overlay visual for narrow cards.**
  - Acceptance criteria:
    - Dragging narrow cards does not produce a distorted preview that looks like a half-day fragment.
    - Preview/overlay visuals remain consistent with the underlying task size and intent.
    - Small-card dragging remains readable in both committed and preview states.

- [ ] **P0: Fix hover/drop detection when placing a task after a small already-placed task.**
  - Acceptance criteria:
    - A task can still be dropped immediately after a small scheduled task, including tasks around 4 half-days in length.
    - Hover detection is not blocked by resize handles, drag bars, or card controls layered above the row surface.
    - The user can place work reliably regardless of the width of the neighboring scheduled task.
  - Notes:
    - The current failure likely comes from interactive controls intercepting pointer/hover behavior in narrow cards.

- [ ] **P0: Add inline editor validation when a manually entered start date conflicts with existing scheduled work.**
  - Acceptance criteria:
    - The project editor form detects a same-team placement conflict before save.
    - The form clearly identifies the conflicting task or tasks.
    - The user cannot submit a placement that will be silently changed away from the entered start date without being warned.
    - Validation messaging is visible directly in the form instead of only being inferred after save.
  - Notes:
    - The current editor can accept a conflicting start date even though the scheduler later moves the task because of the queue.

- [ ] **P0: Rework the planning page information hierarchy so the calendar is the first actionable surface.**
  - Acceptance criteria:
    - The planning/calendar surface is visible immediately on page load without forcing the user to scan past secondary cards and descriptive sections.
    - Metrics, helper text, informational cards, and secondary panels are reduced, collapsed, hidden by default, or moved below the main planning interaction.
    - Any non-essential content can still be opened on demand when the user wants more context.
    - The layout clearly communicates that the primary action of the page is scheduling work on the calendar.
  - Notes:
    - The current page places several summary and informational blocks above the calendar, which weakens focus on the main scheduling interaction.

### P1 Workflow And Data Improvements

- [ ] **P1: Add a dedicated task index route with a planned-default list view.**
  - Acceptance criteria:
    - The app gains a dedicated route for task browsing, assumed to be `/tasks`.
    - The default filter shows planned projects, satisfying the original request for a searchable planned-projects list.
    - Filters exist for `planned`, `draft`, and `all`.
    - The list view shows project title, status, team, dates, duration, and estimated duration.
  - Notes:
    - This route should become the home for searchable list and map access instead of adding more density to the scheduler workbench.

- [ ] **P1: Add keyword search to the draft sidebar.**
  - Acceptance criteria:
    - Users can filter draft cards by keyword.
    - Filtering works on title and any other agreed searchable text fields.
    - Drag-and-drop still works correctly from the filtered list.

- [ ] **P1: Add a month-level "fit everything together" action.**
  - Acceptance criteria:
    - The user can trigger compaction for a chosen month.
    - The scheduler packs work as tightly as allowed by dependencies and closures.
    - The action does not violate ordering or dependency rules.
  - Notes:
    - The intended behavior is controlled compaction, not arbitrary rescheduling.

- [ ] **P1: Rework month and year views to focus on one active period at a time.**
  - Acceptance criteria:
    - Month view renders only one month at a time instead of showing the broader stacked/folded structure.
    - Year view renders only one year at a time instead of stacking multiple years.
    - Both views provide previous and next navigation for the active period.
    - The user can directly enter or choose a date and the UI opens the month or year containing that date.
    - The rework reduces UI overhead by limiting rendering to the active period.
  - Notes:
    - The target interaction is closer to calendar tools such as Google Calendar, with one focused period and explicit navigation.

- [ ] **P1: Simplify team color configuration to one persisted accent color.**
  - Acceptance criteria:
    - Team editing persists only the accent color as the source of truth.
    - Soft color becomes a derived value computed in UI/helpers.
    - Existing team visuals keep a readable derived soft tone after the change.
  - Notes:
    - Persistence, settings UI, seed data, and tests all need to be updated together.

- [ ] **P1: Add project work-environment tag metadata with `inside`, `outside`, and `mixed`.**
  - Acceptance criteria:
    - Each project can store multiples "tags" with some default ones (inside/outside/mixed)
    - The value is visible where scheduling decisions are made.
    - Weather-related planning can use this metadata to quickly identify at-risk work.

- [ ] **P1: Add a contextual menu for positioned tasks.**
  - Acceptance criteria:
    - Right-clicking a scheduled task opens a contextual menu.
    - The menu exposes shortcut actions for:
      - split
      - back to draft
      - delete and compact
      - delete and keep dates
    - The menu works without breaking existing click, drag, and selection behavior.
  - Notes:
    - "Split" remains dependent on the larger split-task exploration and should stay disabled, hidden, or explicitly marked as unavailable until the data model exists.

### P1/P2 Scale And Performance

- [x] **P1/P2: Expand the demo dataset to at least 200 scheduled projects and 500 drafts.**
  - Acceptance criteria:
    - Seed/demo data creates a realistic heavy-load dataset.
    - The seeded data includes multiple teams, durations, dependencies, and enough variety to stress list and timeline behavior.
    - The dataset remains usable for manual QA and performance checks.

- [ ] **P1/P2: Introduce paginated or lazy-loaded list and queue reads.**
  - Acceptance criteria:
    - Task lists do not fetch the full project set when loading simple browse/search surfaces.
    - Draft queues and future task list surfaces can page or lazily request more data.
    - The new task index, draft sidebar, and future map view are designed around partial reads rather than full-snapshot hydration.
  - Notes:
    - This will likely require new read models and server queries instead of relying only on `loadPlannerSnapshot()`.
    - The month/year navigation rework should also reduce UI overhead by limiting rendering to the active period.

### P2 Geography And Operations Features

- [ ] **P2: Add project location support with address plus optional map coordinates.**
  - Acceptance criteria:
    - A project can store a manual service address.
    - A project can optionally store map coordinates.
    - Address-only projects remain valid even before coordinates are assigned.

- [ ] **P2: Add a map mode to the task index page.**
  - Acceptance criteria:
    - The `/tasks` surface supports both list and map modes.
    - Planned, draft, and all-task filters also work in map mode.
    - Projects with coordinates appear on the map at their saved locations.

- [ ] **P2: Handle projects without coordinates through an unplaced workflow.**
  - Acceptance criteria:
    - Projects without map coordinates remain visible in an "unplaced" list.
    - The user can assign an approximate location by dragging or placing them on the map.
    - Map placement updates the project with coordinates while preserving its other fields.
  - Notes:
    - Implementation will require choosing a browser map and geocoding strategy.

- [ ] **P2: Tie work-environment metadata into weather planning.**
  - Acceptance criteria:
    - Outside and mixed projects can be identified quickly when weather issues are added to the calendar.
    - Users can distinguish weather-sensitive work from inside work when looking for replacements on blocked days.
    - The task model remains simple enough for list, map, and assistant workflows.

### P2 AI Assistant

- [ ] **P2: Add a planner chat assistant connected to an LLM.**
  - Acceptance criteria:
    - The roadmap assumes a chatbox available from the planning experience.
    - The assistant can retrieve current planning data and explain scheduling context in natural language.
    - The assistant can propose planner actions based on user instructions.

- [ ] **P2: Scope v1 as "suggest then confirm."**
  - Acceptance criteria:
    - The assistant never applies changes immediately without explicit confirmation.
    - Proposed actions are shown in a reviewable form before writes happen.
    - Confirmation behavior is consistent for project changes and calendar/weather annotations.

- [ ] **P2: Limit v1 assistant responsibilities to planner-native actions.**
  - Acceptance criteria:
    - v1 supports planning data retrieval.
    - v1 supports suggesting schedule changes.
    - v1 supports creating weather/calendar annotations from user-provided facts.
    - v1 supports looking for alternative inside or mixed work from drafts when outside work is blocked.
  - Notes:
    - Automatic weather ingestion and autonomous writes are explicitly deferred.

### Explore

- [ ] **Explore: Evaluate a single unified timeline row divided into team subsections.**
  - Open questions:
    - Does the layout actually save enough vertical space to justify higher density?
    - How are team boundaries, counts, and drag targets made obvious?
    - Does the interaction become harder once many tasks overlap visually?
  - Likely impact:
    - Timeline rendering, drag targets, hover logic, and preview logic would all need revision.
  - Risk:
    - This is a layout redesign, not a small styling tweak.

- [ ] **Explore: Evaluate split-task scheduling through project segments.**
  - Open questions:
    - Should segments be first-class persisted entities or derived child records?
    - How are dependencies and sequence rules applied to a multi-segment project?
    - How should list, map, and editor surfaces display one logical project with multiple scheduled parts?
  - Likely impact:
    - This likely requires a `ProjectSegment`-style model or equivalent sub-assignment entity.
  - Risk:
    - This is not achievable by stretching the current single-placement project fields.

## Public Interfaces And Model Changes To Capture

- `Project` roadmap additions:
  - `workEnvironment`
  - `serviceAddress`
  - `locationLat`
  - `locationLng`
- `Team` roadmap simplification:
  - persist one accent color
  - derive soft color in UI/helpers
- New read/query surfaces:
  - paginated task list queries for `planned`, `draft`, and `all`
  - map-mode task read model with project id, title, status, team, address, and coordinates
- AI assistant action layer:
  - confirmable planner commands
  - not direct free-form mutation
- Split-task roadmap note:
  - requires a segment or sub-assignment model
  - should not be treated as a minor field extension

## Validation Matrix

- [ ] Dragging a task on the calendar never changes scroll position unless the user explicitly scrolls.
- [ ] Planned/default task list is searchable and shows scheduled projects with correct team and date data.
- [ ] Draft sidebar search filters without breaking drag-and-drop.
- [ ] A task can be dropped immediately after a small scheduled task without hover detection failing.
- [ ] Resize-start that lengthens a project but does not pull later work earlier does not trigger the earlier-shift prompt.
- [ ] Genuine earlier moves still trigger the earlier-shift prompt.
- [ ] Earlier-shift modal stays within bounds at typical desktop widths.
- [ ] The editor form blocks or warns on conflicting manual start dates and identifies the conflicting task.
- [ ] The planning page opens with the calendar as the primary visible interaction, while secondary content is minimized or collapsed by default.
- [ ] Full multi-step undo/redo works across a session.
- [ ] "Fit everything together" compacts work without breaking dependencies or closures.
- [ ] Month view renders only the active month and supports previous/next plus direct date jump.
- [ ] Year view renders only the active year and supports previous/next plus direct date jump.
- [ ] Large demo data remains usable because list and queue reads are paginated or lazy loaded.
- [ ] Small cards and drag previews no longer overflow or visually collapse.
- [ ] Right-clicking a scheduled task opens a contextual menu with the expected shortcut actions.
- [ ] Task index supports list and map modes with `planned`, `draft`, and `all` filters.
- [ ] Projects without coordinates can still be assigned on the map.
- [ ] Work-environment metadata is visible and usable for weather-related decisions.
- [ ] Team color derivation produces a consistent soft tone from the chosen accent color.
- [ ] AI assistant can propose planner/calendar updates from natural language, but requires confirmation before applying them.

## Assumptions And Defaults

- The roadmap file is written in English.
- The new searchable planned-project capability lives inside a broader task index route, defaulted to the planned filter.
- Project location is modeled as address plus optional coordinates.
- Work environment is modeled as `inside`, `outside`, `mixed`.
- AI assistant v1 is confirm-first, not autonomous.
- Single-row timeline layout and split-task scheduling remain exploration items until design work proves the implementation shape.
- Near-term work should prioritize correctness, usability, and scale before larger redesigns.
