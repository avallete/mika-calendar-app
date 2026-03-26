# Planner Bottleneck Capture

This runbook is for clean drag-and-drop bottleneck captures in `next dev`.

## Start the app

Use a fresh dev session with server tracing enabled:

```powershell
$env:PLANNER_TRACE_SERVER = "1"
bun run dev
```

## Before each capture

1. Hard reload the planner page.
2. Enable the planner trace toggle in the UI.
3. Clear the browser console.
4. Clear the server terminal.
5. Wait until the dev server is idle.

## Capture procedure

1. Perform exactly one drag/drop interaction on the seeded dataset.
2. Save the browser console output.
3. Save the server terminal output.
4. Correlate the two artifacts with `captureId`, then `traceId`.

## Expected lines

Browser:

- `planner.capture.start`
- `planner.capture.browser.summary`
- `planner.capture.end`

Server:

- `planner.capture.start`
- `planner.capture.server.summary`
- `planner.capture.end`

## Reject the capture if

- `[Fast Refresh]` appears between `planner.capture.start` and `planner.capture.end`
- a rebuild or unrelated dev-server error appears during the interaction window
- more than one user interaction happened before the capture closed

## What the summaries answer

Browser summary buckets:

- `preview.fast`
- `preview.exact`
- `optimistic.compute`
- `render.commit`
- `server.await`
- `reconcile`

Server summary buckets:

- `action.total`
- `store.transaction`
- `replacePersistentState`
- `actionLog.insert`
- delete row counts by table
- insert row counts by table
