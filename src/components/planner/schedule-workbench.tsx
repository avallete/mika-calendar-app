"use client";

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
import { useMemo, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type {
  CalendarBucket,
  DragProjectMeta,
  QuickPlacementState,
  ZoomLevel,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

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
  const [zoom, setZoom] = useState<ZoomLevel>("week");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<QuickPlacementState | null>(null);
  const [closureSheetOpen, setClosureSheetOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragProjectMeta | null>(null);
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

    setPendingPlacement(null);
    placeProject(active.projectId, {
      teamId: bucket.teamId,
      startSlot: bucket.startSlot,
      durationHalfDays: active.durationHalfDays,
    });
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
                  Team A and Team B stay in sync without manual replanning
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  Drag draft projects from the left sidebar, adjust placement inline, and
                  let closures plus dependencies push the rest of the plan automatically.
                </p>
              </div>

              <Card className="border-border/60 bg-[linear-gradient(145deg,rgba(255,255,255,0.88),rgba(242,236,228,0.92))] shadow-[0_20px_44px_-30px_rgba(21,28,45,0.55)] xl:max-w-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="size-4 text-[var(--team-b)]" />
                    Push-forward scheduling rules are live
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Same-team order is preserved. Cross-team projects only move when their
                    incoming blockers actually change.
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
              zoom={zoom}
              pendingPlacement={pendingPlacement}
              onZoomChange={(nextZoom) => {
                setPendingPlacement(null);
                setZoom(nextZoom);
              }}
              onPendingPlacementChange={setPendingPlacement}
              onQuickPlacementCommit={(projectId, placement) => {
                placeProject(projectId, placement);
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
              placeProject(projectId, placement);
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
              {activeDrag.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </SidebarProvider>
  );
}
