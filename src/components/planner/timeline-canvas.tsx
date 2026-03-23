"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { addDays, eachDayOfInterval, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import {
  ArrowRightLeft,
  CalendarClock,
  GripVertical,
  MoveHorizontal,
  StretchHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  advanceWorkingDuration,
  compareSlotKeys,
  isNonWorkingDate,
  makeSlotKey,
  parseSlotKey,
} from "@/lib/planner/calendar";
import type {
  CalendarBucket,
  ClosurePeriod,
  Project,
  ProjectDependency,
  ProjectPlacement,
  QuickPlacementState,
  SlotKey,
  TeamId,
  YearMonthSection,
} from "@/lib/planner/types";
import { isScheduledProject, teamOptions } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

function makeBucketId(teamId: TeamId, startSlot: SlotKey) {
  return `bucket:${teamId}:${startSlot}`;
}

function getAnchorYear(projects: Project[], closures: ClosurePeriod[]) {
  const datedValues = projects
    .flatMap((project) => {
      const values: string[] = [];
      if (project.targetDateHint) {
        values.push(project.targetDateHint);
      }
      if (isScheduledProject(project)) {
        values.push(project.scheduledStartSlot.slice(0, 10));
      }
      return values;
    })
    .concat(closures.flatMap((closure) => [closure.startDate, closure.endDate]))
    .filter(Boolean)
    .sort();

  return parseISO(datedValues[0] ?? "2026-03-23").getFullYear();
}

function buildYearSections(anchorYear: number): YearMonthSection[] {
  return Array.from({ length: 12 }, (_, index) => {
    const monthStart = startOfMonth(new Date(anchorYear, index, 1));
    const monthEnd = endOfMonth(monthStart);

    return {
      id: `${anchorYear}-${String(index + 1).padStart(2, "0")}`,
      label: format(monthStart, "MMMM yyyy"),
      startDate: format(monthStart, "yyyy-MM-dd"),
      endDate: format(monthEnd, "yyyy-MM-dd"),
      dayCount: monthEnd.getDate(),
    };
  });
}

function getMonthSegmentBounds(
  startSlot: SlotKey,
  endSlotExclusive: SlotKey,
  section: YearMonthSection
) {
  const monthStartSlot = makeSlotKey(section.startDate, "AM");
  const monthEndExclusive = makeSlotKey(
    format(addDays(parseISO(section.endDate), 1), "yyyy-MM-dd"),
    "AM"
  );

  const boundedStart =
    compareSlotKeys(startSlot, monthStartSlot) < 0 ? monthStartSlot : startSlot;
  const boundedEnd =
    compareSlotKeys(endSlotExclusive, monthEndExclusive) > 0
      ? monthEndExclusive
      : endSlotExclusive;

  if (compareSlotKeys(boundedEnd, boundedStart) <= 0) {
    return null;
  }

  const toOffset = (slotKey: SlotKey) => {
    const { date, part } = parseSlotKey(slotKey);
    const dayOffset =
      (parseISO(date).getTime() - parseISO(section.startDate).getTime()) / (1000 * 60 * 60 * 24);
    return dayOffset + (part === "PM" ? 0.5 : 0);
  };

  return {
    startOffset: toOffset(boundedStart),
    endOffset: toOffset(boundedEnd),
  };
}

function ScheduledProjectCard({
  project,
  calendarEndSlot,
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
  calendarEndSlot: SlotKey;
  left: string;
  width: string;
  dependencyCount: number;
  onSelect: (projectId: string) => void;
}) {
  const sharedData = {
    type: "scheduled" as const,
    projectId: project.id,
    teamId: project.scheduledTeam,
    startSlot: project.scheduledStartSlot,
    durationHalfDays: project.scheduledDurationHalfDays,
    calendarEndSlot,
    title: project.title,
  };
  const moveDrag = useDraggable({
    id: `scheduled:move:${project.id}`,
    data: {
      ...sharedData,
      intent: "move" as const,
    },
  });
  const {
    attributes: moveAttributes,
    listeners: moveListeners,
    setNodeRef: setMoveNodeRef,
    transform: moveTransform,
    isDragging: isMoveDragging,
  } = moveDrag;
  const resizeStartDrag = useDraggable({
    id: `scheduled:resize-start:${project.id}`,
    data: {
      ...sharedData,
      intent: "resize-start" as const,
    },
  });
  const {
    attributes: resizeStartAttributes,
    listeners: resizeStartListeners,
    setNodeRef: setResizeStartNodeRef,
    isDragging: isResizeStartDragging,
  } = resizeStartDrag;
  const resizeEndDrag = useDraggable({
    id: `scheduled:resize-end:${project.id}`,
    data: {
      ...sharedData,
      intent: "resize-end" as const,
    },
  });
  const {
    attributes: resizeEndAttributes,
    listeners: resizeEndListeners,
    setNodeRef: setResizeEndNodeRef,
    isDragging: isResizeEndDragging,
  } = resizeEndDrag;
  const isDragging = isMoveDragging || isResizeStartDragging || isResizeEndDragging;

  return (
    <div
      ref={setMoveNodeRef}
      className={cn(
        "absolute top-3 h-[92px] rounded-2xl border border-black/10 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.42)] transition-shadow",
        project.scheduledTeam === "team-a"
          ? "bg-[linear-gradient(150deg,rgba(41,123,138,0.18),rgba(255,255,255,0.96))]"
          : "bg-[linear-gradient(150deg,rgba(203,129,53,0.18),rgba(255,255,255,0.96))]",
        isDragging && "opacity-40 shadow-lg"
      )}
      style={{
        left,
        width,
        transform: CSS.Translate.toString(moveTransform),
      }}
    >
      <button
        type="button"
        className="flex h-full w-full flex-col justify-between rounded-2xl px-5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(project.id)}
        {...moveAttributes}
        {...moveListeners}
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
            <Badge variant="outline" className="gap-1 rounded-full bg-background/70">
              <ArrowRightLeft className="size-3" />
              {dependencyCount}
            </Badge>
          ) : null}
          <Badge variant="secondary" className="rounded-full">
            <MoveHorizontal className="size-3" />
            Move
          </Badge>
        </div>
      </button>

      <button
        ref={setResizeStartNodeRef}
        type="button"
        className="absolute inset-y-2 left-1 z-10 flex w-3 cursor-ew-resize items-center justify-center rounded-full bg-background/75 text-muted-foreground shadow-sm"
        aria-label={`Resize start for ${project.title}`}
        onClick={(event) => event.stopPropagation()}
        {...resizeStartAttributes}
        {...resizeStartListeners}
      >
        <StretchHorizontal className="size-3 rotate-90" />
      </button>

      <button
        ref={setResizeEndNodeRef}
        type="button"
        className="absolute inset-y-2 right-1 z-10 flex w-3 cursor-ew-resize items-center justify-center rounded-full bg-background/75 text-muted-foreground shadow-sm"
        aria-label={`Resize end for ${project.title}`}
        onClick={(event) => event.stopPropagation()}
        {...resizeEndAttributes}
        {...resizeEndListeners}
      >
        <StretchHorizontal className="size-3 rotate-90" />
      </button>
    </div>
  );
}

function YearBucketCell({
  bucket,
  date,
  dayIndex,
  dayCount,
  closures,
  active,
}: {
  bucket: CalendarBucket;
  date: string;
  dayIndex: number;
  dayCount: number;
  closures: ClosurePeriod[];
  active: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: bucket.bucketId,
    data: bucket,
  });

  return (
    <PopoverTrigger
      id={bucket.bucketId}
      render={
        <button
          ref={setNodeRef}
          type="button"
          aria-label={`Place project on ${date}`}
          className={cn(
            "absolute inset-y-0 border-r border-border/40 transition-colors last:border-r-0",
            isNonWorkingDate(date, closures) &&
              "bg-[repeating-linear-gradient(135deg,rgba(136,58,43,0.06),rgba(136,58,43,0.06)_8px,rgba(255,255,255,0)_8px,rgba(255,255,255,0)_16px)]",
            !isNonWorkingDate(date, closures) && "bg-white/45",
            isOver && "bg-primary/12",
            active && "ring-2 ring-inset ring-primary/60"
          )}
          style={{
            left: `${(dayIndex / dayCount) * 100}%`,
            width: `${100 / dayCount}%`,
          }}
        />
      }
    />
  );
}

function QuickPlacementForm({
  pendingPlacement,
  onCommit,
  onCancel,
}: {
  pendingPlacement: QuickPlacementState;
  onCommit: (projectId: string, placement: ProjectPlacement) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(pendingPlacement.placement.startSlot.slice(0, 10));
  const [part, setPart] = useState<"AM" | "PM">(
    pendingPlacement.placement.startSlot.endsWith("-PM") ? "PM" : "AM"
  );
  const [durationHalfDays, setDurationHalfDays] = useState(
    pendingPlacement.placement.durationHalfDays
  );

  return (
    <div className="space-y-4">
      <PopoverHeader>
        <PopoverTitle>Place {pendingPlacement.title}</PopoverTitle>
        <PopoverDescription>
          Confirm the drop target before scheduling this draft.
        </PopoverDescription>
      </PopoverHeader>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          <CalendarClock className="size-3.5" />
          {pendingPlacement.placement.teamId === "team-a" ? "Team A" : "Team B"}
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Start date
          </p>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Slot
          </p>
          <div className="flex rounded-xl border border-border bg-card p-1">
            {(["AM", "PM"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  part === value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setPart(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Duration (half-days)
          </p>
          <Input
            min={1}
            type="number"
            value={durationHalfDays}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              setDurationHalfDays(Number.isFinite(nextValue) ? Math.max(1, nextValue) : 1);
            }}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          onClick={() =>
            onCommit(pendingPlacement.projectId, {
              teamId: pendingPlacement.placement.teamId,
              startSlot: `${date}-${part}` as SlotKey,
              durationHalfDays,
            })
          }
        >
          Place project
        </Button>
      </div>
    </div>
  );
}

function YearMonthRow({
  teamId,
  section,
  closures,
  projects,
  dependencies,
  pendingPlacement,
  onSelectProject,
}: {
  teamId: TeamId;
  section: YearMonthSection;
  closures: ClosurePeriod[];
  projects: (Project & {
    scheduledTeam: TeamId;
    scheduledStartSlot: SlotKey;
    scheduledDurationHalfDays: number;
  })[];
  dependencies: ProjectDependency[];
  pendingPlacement: QuickPlacementState | null;
  onSelectProject: (projectId: string) => void;
}) {
  const days = eachDayOfInterval({
    start: parseISO(section.startDate),
    end: parseISO(section.endDate),
  }).map((value) => format(value, "yyyy-MM-dd"));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          {teamId === "team-a" ? "Team A" : "Team B"}
        </p>
        <Badge
          className={cn(
            "rounded-full border-0 px-3 py-1 text-xs",
            teamId === "team-a"
              ? "bg-[var(--team-a-soft)] text-foreground"
              : "bg-[var(--team-b-soft)] text-foreground"
          )}
        >
          {projects.length} scheduled
        </Badge>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70">
        <div
          className="grid h-10 border-b border-border/50 bg-background/70"
          style={{ gridTemplateColumns: `repeat(${section.dayCount}, minmax(0, 1fr))` }}
        >
          {days.map((date) => (
            <div
              key={`${teamId}-header-${date}`}
              className="flex items-center justify-center border-r border-border/40 text-[11px] font-medium text-muted-foreground last:border-r-0"
            >
              {format(parseISO(date), "dd")}
            </div>
          ))}
        </div>

        <div className="relative h-[104px]">
          {days.map((date, index) => (
            <YearBucketCell
              key={`${teamId}-bucket-${date}`}
              bucket={{
                bucketId: makeBucketId(teamId, makeSlotKey(date, "AM")),
                teamId,
                startSlot: makeSlotKey(date, "AM"),
                granularity: "day",
              }}
              date={date}
              dayIndex={index}
              dayCount={section.dayCount}
              closures={closures}
              active={pendingPlacement?.triggerId === makeBucketId(teamId, makeSlotKey(date, "AM"))}
            />
          ))}

          {projects.map((project) => {
            const computed = advanceWorkingDuration(
              project.scheduledStartSlot,
              project.scheduledDurationHalfDays,
              closures
            );
            const bounds = getMonthSegmentBounds(
              project.scheduledStartSlot,
              computed.calendarEndSlot,
              section
            );

            if (!bounds) {
              return null;
            }

            const dependencyCount = dependencies.filter(
              (dependency) => dependency.successorProjectId === project.id
            ).length;

            return (
              <ScheduledProjectCard
                key={`${section.id}-${project.id}`}
                project={project}
                calendarEndSlot={computed.calendarEndSlot}
                left={`${(bounds.startOffset / section.dayCount) * 100}%`}
                width={`${(Math.max(bounds.endOffset - bounds.startOffset, 0.9) / section.dayCount) * 100}%`}
                dependencyCount={dependencyCount}
                onSelect={onSelectProject}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function YearView({
  projects,
  dependencies,
  closures,
  pendingPlacement,
  onSelectProject,
}: {
  projects: Project[];
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  onSelectProject: (projectId: string) => void;
}) {
  const sections = useMemo(
    () => buildYearSections(getAnchorYear(projects, closures)),
    [projects, closures]
  );
  const scheduledProjects = projects.filter(isScheduledProject);

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section
          key={section.id}
          className="rounded-[28px] border border-border/70 bg-card/90 p-4 shadow-[0_24px_50px_-42px_rgba(15,23,42,0.55)]"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Year overview
              </p>
              <h3 className="mt-1 font-heading text-xl font-semibold text-foreground">
                {section.label}
              </h3>
            </div>
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
              {section.dayCount} days
            </Badge>
          </div>

          <div className="mt-4 space-y-4">
            {teamOptions.map((team) => (
              <YearMonthRow
                key={`${section.id}-${team.id}`}
                teamId={team.id}
                section={section}
                closures={closures}
                projects={scheduledProjects.filter((project) => project.scheduledTeam === team.id)}
                dependencies={dependencies}
                pendingPlacement={pendingPlacement}
                onSelectProject={onSelectProject}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TimelineCanvas({
  projects,
  dependencies,
  closures,
  pendingPlacement,
  traceEnabled,
  onTraceEnabledChange,
  onPendingPlacementChange,
  onQuickPlacementCommit,
  onSelectProject,
}: {
  projects: Project[];
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  traceEnabled: boolean;
  onTraceEnabledChange: (enabled: boolean) => void;
  onPendingPlacementChange: (placement: QuickPlacementState | null) => void;
  onQuickPlacementCommit: (projectId: string, placement: ProjectPlacement) => void;
  onSelectProject: (projectId: string) => void;
}) {
  return (
    <Popover
      open={Boolean(pendingPlacement)}
      triggerId={pendingPlacement?.triggerId ?? null}
      onOpenChange={(open) => {
        if (!open) {
          onPendingPlacementChange(null);
        }
      }}
    >
      <Card className="overflow-hidden border-border/60 bg-card/95 shadow-[0_26px_55px_-44px_rgba(18,25,38,0.55)]">
        <CardContent className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Scheduler canvas
              </p>
              <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">
                Year view with direct move and resize controls
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1.5 text-xs">
                Year only
              </Badge>
              <Button
                size="sm"
                variant={traceEnabled ? "default" : "outline"}
                onClick={() => onTraceEnabledChange(!traceEnabled)}
              >
                {traceEnabled ? "Trace on" : "Trace off"}
              </Button>
            </div>
          </div>

          <YearView
            projects={projects}
            dependencies={dependencies}
            closures={closures}
            pendingPlacement={pendingPlacement}
            onSelectProject={onSelectProject}
          />
        </CardContent>
      </Card>

      {pendingPlacement ? (
        <PopoverContent align="start" sideOffset={10} className="w-80">
          <QuickPlacementForm
            key={pendingPlacement.triggerId}
            pendingPlacement={pendingPlacement}
            onCancel={() => onPendingPlacementChange(null)}
            onCommit={onQuickPlacementCommit}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
