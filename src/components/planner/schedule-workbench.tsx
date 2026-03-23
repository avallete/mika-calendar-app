"use client";

import { addDays, format, parseISO } from "date-fns";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CalendarPlus2, Sparkles, X } from "lucide-react";

import { ClosureSheet } from "@/components/planner/closure-sheet";
import { DraftSidebar } from "@/components/planner/draft-sidebar";
import { MetricBar } from "@/components/planner/metric-bar";
import { usePlanner } from "@/components/planner/planner-provider";
import { ProjectEditorSheet } from "@/components/planner/project-editor-sheet";
import { TimelineCanvas } from "@/components/planner/timeline-canvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  compareSlotKeys,
  countWorkingHalfDays,
  makeSlotKey,
  nextCalendarSlot,
  parseSlotKey,
  previousWorkingDate,
} from "@/lib/planner/calendar";
import {
  getEarlierShiftPrompt,
  setSchedulerTraceEnabled,
} from "@/lib/planner/scheduler";
import type {
  CalendarBucket,
  ClosurePeriod,
  DragProjectMeta,
  EarlierShiftPromptState,
  ProjectPlacement,
  QuickPlacementState,
  SlotKey,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

const TRACE_STORAGE_KEY = "planner-trace-enabled";
const TRACE_STORAGE_EVENT = "planner-trace-storage";

function subscribeToTracePreference(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => callback();
  window.addEventListener("storage", handleChange);
  window.addEventListener(TRACE_STORAGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(TRACE_STORAGE_EVENT, handleChange);
  };
}

function getTracePreferenceSnapshot() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(TRACE_STORAGE_KEY) === "true";
}

function getDragLabel(activeDrag: DragProjectMeta | null) {
  if (!activeDrag) {
    return null;
  }

  if (activeDrag.type === "draft") {
    return activeDrag.title;
  }

  if (activeDrag.intent === "resize-start") {
    return `Resize start: ${activeDrag.title}`;
  }

  if (activeDrag.intent === "resize-end") {
    return `Resize end: ${activeDrag.title}`;
  }

  return activeDrag.title;
}

function getLatestAllowedResizeStartSlot(
  calendarEndSlot: SlotKey,
  closures: ClosurePeriod[]
) {
  const { date, part } = parseSlotKey(calendarEndSlot);
  const inclusiveEndDate =
    part === "AM"
      ? format(addDays(parseISO(date), -1), "yyyy-MM-dd")
      : previousWorkingDate(date, closures);

  return makeSlotKey(previousWorkingDate(inclusiveEndDate, closures), "AM");
}

function buildScheduledPlacement(
  active: Extract<DragProjectMeta, { type: "scheduled" }>,
  bucket: CalendarBucket,
  closures: ClosurePeriod[]
): ProjectPlacement | null {
  if (active.intent === "move") {
    return {
      teamId: bucket.teamId,
      startSlot: bucket.startSlot,
      durationHalfDays: active.durationHalfDays,
    };
  }

  if (bucket.teamId !== active.teamId) {
    return null;
  }

  if (active.intent === "resize-start") {
    const latestAllowedStart = getLatestAllowedResizeStartSlot(active.calendarEndSlot, closures);
    const startSlot =
      compareSlotKeys(bucket.startSlot, latestAllowedStart) > 0
        ? latestAllowedStart
        : bucket.startSlot;

    return {
      teamId: active.teamId,
      startSlot,
      durationHalfDays: Math.max(
        2,
        countWorkingHalfDays(startSlot, active.calendarEndSlot, closures)
      ),
    };
  }

  const targetDate = previousWorkingDate(bucket.startSlot.slice(0, 10), closures);
  const endSlotExclusive = nextCalendarSlot(makeSlotKey(targetDate, "PM"));

  return {
    teamId: active.teamId,
    startSlot: active.startSlot,
    durationHalfDays: Math.max(
      2,
      countWorkingHalfDays(active.startSlot, endSlotExclusive, closures)
    ),
  };
}

export function ScheduleWorkbench() {
  const {
    state,
    metrics,
    placeProject,
    addClosure,
    removeClosure,
    unscheduleProject,
    deleteProject,
  } = usePlanner();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<QuickPlacementState | null>(null);
  const [pendingEarlierShift, setPendingEarlierShift] =
    useState<EarlierShiftPromptState | null>(null);
  const [closureSheetOpen, setClosureSheetOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragProjectMeta | null>(null);
  const traceEnabled = useSyncExternalStore(
    subscribeToTracePreference,
    getTracePreferenceSnapshot,
    () => false
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const drafts = useMemo(
    () => state.projects.filter((project) => project.status === "draft"),
    [state.projects]
  );
  const selectedProject = useMemo(
    () => state.projects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, state.projects]
  );

  useEffect(() => {
    setSchedulerTraceEnabled(traceEnabled);
  }, [traceEnabled]);

  const updateTraceEnabled = (enabled: boolean) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(TRACE_STORAGE_KEY, String(enabled));
    window.dispatchEvent(new Event(TRACE_STORAGE_EVENT));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragProjectMeta | undefined;
    setActiveDrag(data ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current as DragProjectMeta | undefined;
    const bucket = event.over?.data.current as CalendarBucket | undefined;

    setActiveDrag(null);

    if (!active || !bucket) {
      return;
    }

    if (active.type === "draft") {
      setPendingPlacement({
        projectId: active.projectId,
        title: active.title,
        triggerId: bucket.bucketId,
        placement: {
          teamId: bucket.teamId,
          startSlot: bucket.startSlot,
          durationHalfDays: active.durationHalfDays,
        },
      });
      return;
    }

    const nextPlacement = buildScheduledPlacement(active, bucket, state.closures);
    if (!nextPlacement) {
      return;
    }

    if (active.intent === "move" || active.intent === "resize-start") {
      const prompt = getEarlierShiftPrompt(
        state,
        active.projectId,
        nextPlacement,
        active.intent
      );

      if (prompt) {
        setPendingEarlierShift(prompt);
        return;
      }
    }

    placeProject(active.projectId, nextPlacement, {
      source: `drag-${active.intent}`,
    });
    setPendingPlacement(null);
  };

  return (
    <SidebarProvider>
      <DndContext
        id="planner-dnd"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <DraftSidebar drafts={drafts} dependencies={state.dependencies} />

        <SidebarInset className="bg-transparent">
          <div className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <SidebarTrigger className="md:hidden" />
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Scheduling cockpit
                  </p>
                </div>
                <h2 className="font-heading text-3xl font-semibold text-foreground">
                  One stacked year view for the full delivery plan
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  Drag drafts into the year planner, resize live projects directly on the
                  timeline, and use the trace toggle when weekend or dependency behavior
                  needs debugging.
                </p>
              </div>

              <Card className="border-border/60 bg-[linear-gradient(145deg,rgba(255,255,255,0.88),rgba(242,236,228,0.92))] shadow-[0_20px_44px_-30px_rgba(21,28,45,0.55)] xl:max-w-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="size-4 text-[var(--team-b)]" />
                    Year planner controls are live
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Body drag moves, edge drag resizes, and same-team earlier shifts can
                    optionally compact the queue behind the moved project.
                  </p>
                </CardContent>
              </Card>
            </div>

            <MetricBar metrics={metrics} />

            <div className="flex flex-col gap-4 rounded-[28px] border border-border/60 bg-card/80 p-4 shadow-[0_24px_50px_-42px_rgba(18,25,38,0.55)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Company calendar
                  </p>
                  <h3 className="mt-1 font-heading text-xl font-semibold text-foreground">
                    Closures and holidays affecting every lane
                  </h3>
                </div>
                <Button onClick={() => setClosureSheetOpen(true)}>
                  <CalendarPlus2 className="size-4" />
                  Add closure
                </Button>
              </div>

              <Separator />

              <div className="flex flex-wrap gap-2">
                {state.closures.map((closure) => (
                  <Badge
                    key={closure.id}
                    variant="outline"
                    className="gap-2 rounded-full px-3 py-1.5 text-sm"
                  >
                    {closure.title}
                    <span className="text-muted-foreground">
                      {closure.startDate} {"->"} {closure.endDate}
                    </span>
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-muted"
                      onClick={() => removeClosure(closure.id)}
                    >
                      <X className="size-3" />
                      <span className="sr-only">Remove closure</span>
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            <TimelineCanvas
              projects={state.projects}
              dependencies={state.dependencies}
              closures={state.closures}
              pendingPlacement={pendingPlacement}
              traceEnabled={traceEnabled}
              onTraceEnabledChange={updateTraceEnabled}
              onPendingPlacementChange={setPendingPlacement}
              onQuickPlacementCommit={(projectId, placement) => {
                placeProject(projectId, placement, {
                  source: "draft-drop",
                });
                setPendingPlacement(null);
              }}
              onSelectProject={(projectId) => {
                setSelectedProjectId(projectId);
                setPendingPlacement(null);
              }}
            />
          </div>

          <ProjectEditorSheet
            open={Boolean(selectedProject)}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedProjectId(null);
                setPendingPlacement(null);
              }
            }}
            project={selectedProject}
            dependencies={state.dependencies}
            onSave={(projectId, placement) => {
              placeProject(projectId, placement, {
                source: "sheet-edit",
              });
            }}
            onUnschedule={(projectId) => {
              const project = state.projects.find((value) => value.id === projectId);
              if (project && isScheduledProject(project)) {
                unscheduleProject(projectId);
              }
            }}
            onDelete={(projectId, mode) => {
              deleteProject(projectId, mode);
            }}
          />

          <ClosureSheet
            open={closureSheetOpen}
            onOpenChange={setClosureSheetOpen}
            onSave={addClosure}
          />
        </SidebarInset>

        <DragOverlay>
          {activeDrag ? (
            <div className="rounded-2xl border border-border bg-background/95 px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur">
              {getDragLabel(activeDrag)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog
        open={Boolean(pendingEarlierShift)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingEarlierShift(null);
          }
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move later work earlier as well?</DialogTitle>
            <DialogDescription>
              {pendingEarlierShift
                ? `${pendingEarlierShift.title} is moving earlier on ${
                    pendingEarlierShift.placement.teamId === "team-a" ? "Team A" : "Team B"
                  }. The gap between ${pendingEarlierShift.previousStartSlot.slice(0, 10)} and the new start is empty, so the rest of that team queue can be compacted if you want.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                if (!pendingEarlierShift) {
                  return;
                }

                placeProject(pendingEarlierShift.projectId, pendingEarlierShift.placement, {
                  source: `prompt-${pendingEarlierShift.interaction}`,
                });
                setPendingEarlierShift(null);
              }}
            >
              Keep only this project earlier
            </Button>
            <Button
              onClick={() => {
                if (!pendingEarlierShift) {
                  return;
                }

                placeProject(pendingEarlierShift.projectId, pendingEarlierShift.placement, {
                  strategy: "compact-same-team",
                  source: `prompt-compact-${pendingEarlierShift.interaction}`,
                });
                setPendingEarlierShift(null);
              }}
            >
              Pull same-team queue earlier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
