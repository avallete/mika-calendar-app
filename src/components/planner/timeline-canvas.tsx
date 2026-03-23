"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { differenceInCalendarDays, format, getDate, getDay, getMonth, parseISO } from "date-fns";
import { ArrowRightLeft, GripVertical, MoveHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  advanceWorkingDuration,
  formatSlotLabel,
  isNonWorkingDate,
  makeSlotKey,
  parseSlotKey,
  slotIndexFromDate,
  slotKeyFromIndex,
} from "@/lib/planner/calendar";
import { buildTimelineWindow } from "@/lib/planner/scheduler";
import {
  type ClosurePeriod,
  type Project,
  type ProjectDependency,
  type ProjectPlacement,
  type SlotKey,
  type TeamId,
  type ZoomLevel,
  isScheduledProject,
  teamOptions,
} from "@/lib/planner/types";

const slotWidths: Record<ZoomLevel, number> = {
  "half-day": 68,
  day: 36,
  week: 16,
  month: 8,
  year: 4,
};

type DragMeta =
  | {
      type: "draft";
      projectId: string;
      durationHalfDays: number;
      title: string;
    }
  | {
      type: "scheduled";
      projectId: string;
      teamId: TeamId;
      startSlot: SlotKey;
      durationHalfDays: number;
      title: string;
    };

function getHeaderBoundary(slotKey: SlotKey, zoom: ZoomLevel) {
  const { date, part } = parseSlotKey(slotKey);
  const parsedDate = parseISO(date);

  if (zoom === "half-day") {
    return true;
  }

  if (zoom === "day") {
    return part === "AM";
  }

  if (zoom === "week") {
    return part === "AM" && getDay(parsedDate) === 1;
  }

  if (zoom === "month") {
    return part === "AM" && getDate(parsedDate) === 1;
  }

  return part === "AM" && getDate(parsedDate) === 1 && getMonth(parsedDate) === 0;
}

function ScheduledProjectCard({
  project,
  left,
  width,
  dependencyCount,
  onSelect,
}: {
  project: Project & {
    scheduledTeam: TeamId;
    scheduledStartSlot: SlotKey;
    scheduledDurationHalfDays: number;
  };
  left: number;
  width: number;
  dependencyCount: number;
  onSelect: (projectId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `scheduled:${project.id}`,
    data: {
      type: "scheduled",
      projectId: project.id,
      teamId: project.scheduledTeam,
      startSlot: project.scheduledStartSlot,
      durationHalfDays: project.scheduledDurationHalfDays,
      title: project.title,
    } satisfies DragMeta,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        "absolute top-5 flex h-[84px] flex-col justify-between rounded-2xl border border-black/10 p-3 text-left shadow-[0_18px_36px_-24px_rgba(0,0,0,0.42)] transition-shadow hover:shadow-[0_22px_40px_-22px_rgba(0,0,0,0.48)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        project.scheduledTeam === "team-a"
          ? "bg-[linear-gradient(150deg,rgba(41,123,138,0.18),rgba(255,255,255,0.92))]"
          : "bg-[linear-gradient(150deg,rgba(203,129,53,0.18),rgba(255,255,255,0.92))]",
        isDragging && "opacity-35"
      )}
      style={{
        left,
        width,
        transform: CSS.Translate.toString(transform),
      }}
      onClick={() => onSelect(project.id)}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="line-clamp-1 text-sm font-semibold text-foreground">{project.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {project.scheduledDurationHalfDays / 2} days
          </p>
        </div>
        <GripVertical className="size-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {dependencyCount ? (
          <Badge variant="outline" className="gap-1 rounded-full">
            <ArrowRightLeft className="size-3" />
            {dependencyCount}
          </Badge>
        ) : null}
        <Badge variant="secondary" className="rounded-full">
          <MoveHorizontal className="size-3" />
          Drag to move
        </Badge>
      </div>
    </button>
  );
}

function TeamLaneRow({
  teamId,
  title,
  virtualItems,
  totalWidth,
  startDate,
  zoom,
  closures,
  projects,
  dependencies,
  onSelectProject,
  registerLaneElement,
}: {
  teamId: TeamId;
  title: string;
  virtualItems: ReturnType<ReturnType<typeof useVirtualizer>["getVirtualItems"]>;
  totalWidth: number;
  startDate: string;
  zoom: ZoomLevel;
  closures: ClosurePeriod[];
  projects: (Project & {
    scheduledTeam: TeamId;
    scheduledStartSlot: SlotKey;
    scheduledDurationHalfDays: number;
  })[];
  dependencies: ProjectDependency[];
  onSelectProject: (projectId: string) => void;
  registerLaneElement: (teamId: TeamId, element: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${teamId}`,
    data: {
      teamId,
    },
  });

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-border/70 bg-card/90 shadow-[0_24px_50px_-42px_rgba(15,23,42,0.55)]">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Resource lane
          </p>
          <h3 className="mt-1 font-heading text-xl font-semibold text-foreground">{title}</h3>
        </div>
        <Badge
          className={cn(
            "rounded-full border-0 px-3 py-1 text-xs",
            teamId === "team-a" ? "bg-[var(--team-a-soft)] text-foreground" : "bg-[var(--team-b-soft)] text-foreground"
          )}
        >
          {projects.length} scheduled
        </Badge>
      </div>

      <div
        ref={(element) => {
          setNodeRef(element);
          registerLaneElement(teamId, element);
        }}
        className={cn("relative h-[130px] overflow-hidden", isOver && "bg-primary/5")}
      >
        <div className="absolute inset-0" style={{ width: totalWidth }}>
          {virtualItems.map((item) => {
            const slotKey = slotKeyFromIndex(startDate, item.index);
            const date = slotKey.slice(0, 10);
            const nonWorking = isNonWorkingDate(date, closures);
            const { part } = parseSlotKey(slotKey);

            return (
              <div
                key={`${teamId}-slot-${item.key}`}
                className={cn(
                  "absolute inset-y-0 border-r border-border/40",
                  nonWorking && "bg-[repeating-linear-gradient(135deg,rgba(136,58,43,0.06),rgba(136,58,43,0.06)_8px,rgba(255,255,255,0)_8px,rgba(255,255,255,0)_16px)]",
                  part === "AM" ? "bg-white/50" : "bg-muted/20"
                )}
                style={{
                  left: item.start,
                  width: item.size,
                }}
              />
            );
          })}

          {projects.map((project) => {
            const computed = advanceWorkingDuration(
              project.scheduledStartSlot,
              project.scheduledDurationHalfDays,
              closures
            );
            const startIndex = slotIndexFromDate(startDate, project.scheduledStartSlot);
            const endIndex = slotIndexFromDate(startDate, computed.calendarEndSlot);
            const dependencyCount = dependencies.filter(
              (dependency) => dependency.successorProjectId === project.id
            ).length;

            return (
              <ScheduledProjectCard
                key={project.id}
                project={project}
                left={startIndex * slotWidths[zoom]}
                width={Math.max((endIndex - startIndex) * slotWidths[zoom], slotWidths[zoom] * 1.5)}
                dependencyCount={dependencyCount}
                onSelect={onSelectProject}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function TimelineCanvas({
  projects,
  dependencies,
  closures,
  zoom,
  onZoomChange,
  onDraftDrop,
  onScheduledMove,
  onSelectProject,
}: {
  projects: Project[];
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  zoom: ZoomLevel;
  onZoomChange: (zoom: ZoomLevel) => void;
  onDraftDrop: (projectId: string, placement: ProjectPlacement) => void;
  onScheduledMove: (projectId: string, placement: ProjectPlacement) => void;
  onSelectProject: (projectId: string) => void;
}) {
  const window = useMemo(() => buildTimelineWindow(projects, closures), [projects, closures]);
  const dayCount = useMemo(
    () => differenceInCalendarDays(parseISO(window.endDate), parseISO(window.startDate)) + 1,
    [window.endDate, window.startDate]
  );
  const slotWidth = slotWidths[zoom];
  const slotCount = dayCount * 2;
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const laneElementsRef = useRef<Record<TeamId, HTMLDivElement | null>>({
    "team-a": null,
    "team-b": null,
  });
  const [activeDrag, setActiveDrag] = useState<DragMeta | null>(null);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));
  const scheduledProjects = projects.filter(isScheduledProject);

  const horizontal = useVirtualizer({
    horizontal: true,
    count: slotCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => slotWidth,
    overscan: 24,
  });

  const virtualItems = horizontal.getVirtualItems();
  const totalWidth = horizontal.getTotalSize();

  useEffect(() => {
    const todaySlot = makeSlotKey(format(new Date(), "yyyy-MM-dd"), "AM");
    const slotIndex = Math.max(0, slotIndexFromDate(window.startDate, todaySlot));
    horizontal.scrollToOffset(Math.max(slotIndex * slotWidth - 240, 0), {
      align: "start",
    });
  }, [horizontal, slotWidth, window.startDate]);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragMeta | undefined;
    setActiveDrag(data ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current as DragMeta | undefined;
    const teamId = (event.over?.data.current?.teamId as TeamId | undefined) ?? null;

    setActiveDrag(null);

    if (!data || !teamId) {
      return;
    }

    if (data.type === "draft") {
      const lane = laneElementsRef.current[teamId];
      const translated = event.active.rect.current.translated ?? event.active.rect.current.initial;
      const laneRect = lane?.getBoundingClientRect();
      const scrollLeft = scrollParentRef.current?.scrollLeft ?? 0;

      if (!laneRect || !translated) {
        return;
      }

      const centerX = translated.left + translated.width / 2 - laneRect.left + scrollLeft;
      const slotIndex = Math.max(0, Math.floor(centerX / slotWidth));

      onDraftDrop(data.projectId, {
        teamId,
        startSlot: slotKeyFromIndex(window.startDate, slotIndex),
        durationHalfDays: data.durationHalfDays,
      });

      return;
    }

    const originalIndex = slotIndexFromDate(window.startDate, data.startSlot);
    const deltaSlots = Math.round(event.delta.x / slotWidth);
    const slotIndex = Math.max(0, originalIndex + deltaSlots);

    onScheduledMove(data.projectId, {
      teamId,
      startSlot: slotKeyFromIndex(window.startDate, slotIndex),
      durationHalfDays: data.durationHalfDays,
    });
  };

  return (
    <Card className="overflow-hidden border-border/60 bg-card/95 shadow-[0_26px_55px_-44px_rgba(18,25,38,0.55)]">
      <CardContent className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Scheduler canvas
            </p>
            <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">
              One engine, five zoom levels
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["half-day", "day", "week", "month", "year"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={value === zoom ? "default" : "outline"}
                onClick={() => onZoomChange(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={scrollParentRef}
            className="relative overflow-x-auto rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.84),rgba(244,241,235,0.92))]"
          >
            <div className="sticky left-0 top-0 z-10 border-b border-border/60 bg-background/85 backdrop-blur">
              <div className="relative h-16" style={{ width: totalWidth }}>
                {virtualItems.map((item) => {
                  const slotKey = slotKeyFromIndex(window.startDate, item.index);
                  const boundary = getHeaderBoundary(slotKey, zoom);
                  return (
                    <div
                      key={`header-${item.key}`}
                      className={cn(
                        "absolute inset-y-0 border-r border-border/40 px-2 py-3 text-[11px] font-medium text-muted-foreground",
                        boundary ? "bg-white/70" : "bg-transparent"
                      )}
                      style={{ left: item.start, width: item.size }}
                    >
                      {boundary ? formatSlotLabel(slotKey, zoom) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 p-4">
              {teamOptions.map((team) => (
                <TeamLaneRow
                  key={team.id}
                  teamId={team.id}
                  title={team.label}
                  virtualItems={virtualItems}
                  totalWidth={totalWidth}
                  startDate={window.startDate}
                  zoom={zoom}
                  closures={closures}
                  projects={scheduledProjects.filter((project) => project.scheduledTeam === team.id)}
                  dependencies={dependencies}
                  onSelectProject={onSelectProject}
                  registerLaneElement={(teamId, element) => {
                    laneElementsRef.current[teamId] = element;
                  }}
                />
              ))}
            </div>
          </div>

          <DragOverlay>
            {activeDrag ? (
              <div className="rounded-2xl border border-border bg-background/95 px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur">
                {activeDrag.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </CardContent>
    </Card>
  );
}
