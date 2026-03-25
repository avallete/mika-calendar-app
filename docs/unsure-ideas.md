- [ ] **Explore: Evaluate a single unified timeline row divided into team subsections.**
  - Open questions:
    - Does the layout actually save enough vertical space to justify higher density?
    - How are team boundaries, counts, and drag targets made obvious?
    - Does the interaction become harder once many tasks overlap visually?
  - Likely impact:
    - Timeline rendering, drag targets, hover logic, and preview logic would all need revision.
  - Risk:
    - This is a layout redesign, not a small styling tweak.


- [ ] **P1/P2: Introduce paginated or lazy-loaded list and queue reads.**
  - Acceptance criteria:
    - Task lists do not fetch the full project set when loading simple browse/search surfaces.
    - Draft queues and future task list surfaces can page or lazily request more data.
    - The new task index, draft sidebar, and future map view are designed around partial reads rather than full-snapshot hydration.
  - Notes:
    - This will likely require new read models and server queries instead of relying only on `loadPlannerSnapshot()`.

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
