"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDate,
  getDay,
  parseISO,
  startOfMonth,
} from "date-fns";
import { ArrowRightLeft, CalendarClock, GripVertical, MoveHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  advanceWorkingDuration,
  compareSlotKeys,
  formatSlotLabel,
  isNonWorkingDate,
  makeSlotKey,
  parseSlotKey,
  slotIndexFromDate,
  slotKeyFromIndex,
} from "@/lib/planner/calendar";
import { buildTimelineWindow } from "@/lib/planner/scheduler";
import {
  type CalendarBucket,
  type ClosurePeriod,
  type Project,
  type ProjectDependency,
  type ProjectPlacement,
  type QuickPlacementState,
  type SlotKey,
  type TeamId,
  type YearMonthSection,
  type ZoomLevel,
  isScheduledProject,
  teamOptions,
} from "@/lib/planner/types";

const slotWidths: Record<Exclude<ZoomLevel, "year">, number> = {
  "half-day": 68,
  day: 36,
  week: 16,
  month: 8,
};

function makeBucketId(teamId: TeamId, startSlot: SlotKey) {
  return `bucket:${teamId}:${startSlot}`;
}

function getHeaderBoundary(slotKey: SlotKey, zoom: Exclude<ZoomLevel, "year">) {
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

  return part === "AM" && getDate(parsedDate) === 1;
}

function getAnchorYear(projects: Project[], closures: ClosurePeriod[]) {
  const datedValues = [
    ...projects.flatMap((project) => {
      const values: string[] = [];
      if (project.targetDateHint) {
        values.push(project.targetDateHint);
      }
      if (isScheduledProject(project)) {
        values.push(project.scheduledStartSlot.slice(0, 10));
      }
      return values;
    }),
    ...closures.flatMap((closure) => [closure.startDate, closure.endDate]),
  ].sort();

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
      dayCount: getDate(monthEnd),
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
    return (
      differenceInCalendarDays(parseISO(date), parseISO(section.startDate)) +
      (part === "PM" ? 0.5 : 0)
    );
  };

  return {
    startOffset: toOffset(boundedStart),
    endOffset: toOffset(boundedEnd),
  };
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
  left: number | string;
  width: number | string;
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
    },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        "absolute top-4 flex h-[84px] flex-col justify-between rounded-2xl border border-black/10 p-3 text-left shadow-[0_18px_36px_-24px_rgba(0,0,0,0.42)] transition-shadow hover:shadow-[0_22px_40px_-22px_rgba(0,0,0,0.48)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

function TimelineBucketCell({
  bucket,
  left,
  width,
  part,
  nonWorking,
  active,
}: {
  bucket: CalendarBucket;
  left: number;
  width: number;
  part: "AM" | "PM";
  nonWorking: boolean;
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
          aria-label={`Place project on ${bucket.startSlot}`}
          className={cn(
            "absolute inset-y-0 border-r border-border/40 transition-colors",
            nonWorking &&
              "bg-[repeating-linear-gradient(135deg,rgba(136,58,43,0.06),rgba(136,58,43,0.06)_8px,rgba(255,255,255,0)_8px,rgba(255,255,255,0)_16px)]",
            part === "AM" ? "bg-white/50" : "bg-muted/20",
            isOver && "bg-primary/12",
            active && "ring-2 ring-inset ring-primary/60"
          )
          }
          style={{ left, width }}
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
  pendingPlacement,
  onSelectProject,
}: {
  teamId: TeamId;
  title: string;
  virtualItems: ReturnType<ReturnType<typeof useVirtualizer>["getVirtualItems"]>;
  totalWidth: number;
  startDate: string;
  zoom: Exclude<ZoomLevel, "year">;
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
            teamId === "team-a"
              ? "bg-[var(--team-a-soft)] text-foreground"
              : "bg-[var(--team-b-soft)] text-foreground"
          )}
        >
          {projects.length} scheduled
        </Badge>
      </div>

      <div className="relative h-[130px] overflow-hidden">
        <div className="absolute inset-0" style={{ width: totalWidth }}>
          {virtualItems.map((item) => {
            const slotKey = slotKeyFromIndex(startDate, item.index);
            const date = slotKey.slice(0, 10);
            const { part } = parseSlotKey(slotKey);
            const bucketId = makeBucketId(teamId, slotKey);

            return (
              <TimelineBucketCell
                key={`${teamId}-slot-${item.key}`}
                bucket={{
                  bucketId,
                  teamId,
                  startSlot: slotKey,
                  granularity: "slot",
                }}
                left={item.start}
                width={item.size}
                part={part}
                nonWorking={isNonWorkingDate(date, closures)}
                active={pendingPlacement?.triggerId === bucketId}
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
          className="grid h-9 border-b border-border/50 bg-background/70"
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

        <div className="relative h-24">
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
              active={
                pendingPlacement?.triggerId === makeBucketId(teamId, makeSlotKey(date, "AM"))
              }
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
                left={`${(bounds.startOffset / section.dayCount) * 100}%`}
                width={`${(Math.max(bounds.endOffset - bounds.startOffset, 0.5) / section.dayCount) * 100}%`}
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
  zoom,
  pendingPlacement,
  onZoomChange,
  onPendingPlacementChange,
  onQuickPlacementCommit,
  onSelectProject,
}: {
  projects: Project[];
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  zoom: ZoomLevel;
  pendingPlacement: QuickPlacementState | null;
  onZoomChange: (zoom: ZoomLevel) => void;
  onPendingPlacementChange: (placement: QuickPlacementState | null) => void;
  onQuickPlacementCommit: (projectId: string, placement: ProjectPlacement) => void;
  onSelectProject: (projectId: string) => void;
}) {
  const window = useMemo(() => buildTimelineWindow(projects, closures), [projects, closures]);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const timelineZoom = zoom === "year" ? "month" : zoom;
  const dayCount = useMemo(
    () => differenceInCalendarDays(parseISO(window.endDate), parseISO(window.startDate)) + 1,
    [window.endDate, window.startDate]
  );
  const slotWidth = slotWidths[timelineZoom];
  const slotCount = dayCount * 2;
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
    if (zoom === "year") {
      return;
    }

    const todaySlot = makeSlotKey("2026-03-23", "AM");
    const slotIndex = Math.max(0, slotIndexFromDate(window.startDate, todaySlot));
    horizontal.scrollToOffset(Math.max(slotIndex * slotWidth - 240, 0), {
      align: "start",
    });
  }, [horizontal, slotWidth, window.startDate, zoom]);

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

          {zoom === "year" ? (
            <YearView
              projects={projects}
              dependencies={dependencies}
              closures={closures}
              pendingPlacement={pendingPlacement}
              onSelectProject={onSelectProject}
            />
          ) : (
            <div
              ref={scrollParentRef}
              className="relative overflow-x-auto rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.84),rgba(244,241,235,0.92))]"
            >
              <div className="sticky left-0 top-0 z-10 border-b border-border/60 bg-background/85 backdrop-blur">
                <div className="relative h-16" style={{ width: totalWidth }}>
                  {virtualItems.map((item) => {
                    const slotKey = slotKeyFromIndex(window.startDate, item.index);
                    const boundary = getHeaderBoundary(slotKey, timelineZoom);
                    return (
                      <div
                        key={`header-${item.key}`}
                        className={cn(
                          "absolute inset-y-0 border-r border-border/40 px-2 py-3 text-[11px] font-medium text-muted-foreground",
                          boundary ? "bg-white/70" : "bg-transparent"
                        )}
                        style={{ left: item.start, width: item.size }}
                      >
                        {boundary ? formatSlotLabel(slotKey, timelineZoom) : null}
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
                    zoom={timelineZoom}
                    closures={closures}
                    projects={scheduledProjects.filter((project) => project.scheduledTeam === team.id)}
                    dependencies={dependencies}
                    pendingPlacement={pendingPlacement}
                    onSelectProject={onSelectProject}
                  />
                ))}
              </div>
            </div>
          )}
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
