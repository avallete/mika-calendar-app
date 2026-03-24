"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { addDays, endOfMonth, eachDayOfInterval, format, getDate, getMonth, parseISO } from "date-fns";
import { fr as localeFr } from "date-fns/locale";
import {
  ArrowRightLeft,
  CalendarClock,
  GripVertical,
  MoveHorizontal,
  Sparkles,
  StretchHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  advanceWorkingDuration,
  compareSlotKeys,
  makeSlotKey,
  parseSlotKey,
} from "@/lib/planner/calendar";
import {
  buildCalendarDayState,
  getClosureImpactLabelFr,
  getClosureTypeLabelFr,
} from "@/lib/planner/day-markers";
import { fr } from "@/lib/i18n/fr";
import {
  buildTimelineYearSummaries,
  getTimelineMonthId,
  shiftTimelineDate,
} from "@/lib/planner/timeline-folding";
import { getTimelineScrollTop } from "@/lib/planner/timeline-scroll";
import {
  buildTimelineSections,
  buildTimelineYearRange,
  getTodayDateString,
} from "@/lib/planner/timeline-range";
import type {
  CalendarBucket,
  CalendarDayMarkerTone,
  CalendarDayState,
  ClosurePeriod,
  CustomClosure,
  Project,
  ProjectDependency,
  ProjectPlacement,
  QuickPlacementState,
  SlotKey,
  Team,
  TeamId,
  TimelineViewMode,
  YearMonthSection,
} from "@/lib/planner/types";
import { getSortedTeams, getTeamById, isScheduledProject } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

type CalendarFocusEvent = {
  id: string;
  startDate: string;
  endDate: string;
} | null;

function makeBucketId(teamId: TeamId, startSlot: SlotKey) {
  return `bucket:${teamId}:${startSlot}`;
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

function formatFocusRange(startDate: string, endDate: string) {
  if (startDate === endDate) {
    return format(parseISO(startDate), "EEEE d MMMM yyyy", { locale: localeFr });
  }

  return `${format(parseISO(startDate), "d MMM", { locale: localeFr })} -> ${format(
    parseISO(endDate),
    "d MMM yyyy",
    { locale: localeFr }
  )}`;
}

function isDateWithinFocus(date: string, focus: CalendarFocusEvent) {
  if (!focus) {
    return false;
  }

  return date >= focus.startDate && date <= focus.endDate;
}

function scrollElementWithOffset(
  anchor: HTMLElement,
  behavior: ScrollBehavior
) {
  const top = getTimelineScrollTop(window.scrollY, anchor.getBoundingClientRect().top);
  window.scrollTo({
    top,
    behavior,
  });
}

function scrollToTimelineDate(date: string, behavior: ScrollBehavior) {
  const anchor = document.querySelector<HTMLElement>(`[data-focus-anchor="${date}"]`);
  if (!anchor) {
    return false;
  }

  scrollElementWithOffset(anchor, behavior);
  return true;
}

function scrollToTimelineYear(year: number, behavior: ScrollBehavior) {
  const anchor = document.querySelector<HTMLElement>(`[data-year-anchor="${year}"]`);
  if (!anchor) {
    return false;
  }

  scrollElementWithOffset(anchor, behavior);
  return true;
}

function scrollToTimelineSection(sectionId: string, behavior: ScrollBehavior) {
  const anchor = document.querySelector<HTMLElement>(`[data-section-anchor="${sectionId}"]`);
  if (!anchor) {
    return false;
  }

  scrollElementWithOffset(anchor, behavior);
  return true;
}

function replaceYearInDate(date: string, year: number) {
  const parsed = parseISO(date);
  const month = getMonth(parsed);
  const day = getDate(parsed);
  const maxDay = getDate(endOfMonth(new Date(year, month, 1)));
  return format(new Date(year, month, Math.min(day, maxDay)), "yyyy-MM-dd");
}

function toneClasses(tone: CalendarDayMarkerTone) {
  switch (tone) {
    case "custom-blocking":
      return {
        header: "border-red-200/70 bg-[linear-gradient(160deg,rgba(255,243,240,0.98),rgba(255,233,226,0.95))]",
        cell: "bg-[linear-gradient(160deg,rgba(255,246,243,0.92),rgba(255,230,223,0.84))] border-red-200/45",
      };
    case "public-holiday":
      return {
        header: "border-amber-200/70 bg-[linear-gradient(160deg,rgba(255,249,232,0.98),rgba(255,240,201,0.95))]",
        cell: "bg-[linear-gradient(160deg,rgba(255,251,237,0.9),rgba(255,242,214,0.82))] border-amber-200/50",
      };
    case "weekend":
      return {
        header: "border-stone-200/70 bg-[linear-gradient(160deg,rgba(247,245,241,0.96),rgba(239,235,228,0.92))]",
        cell: "bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.10),rgba(148,163,184,0.10)_8px,rgba(255,255,255,0.0)_8px,rgba(255,255,255,0.0)_16px)] border-stone-200/50",
      };
    case "advisory":
      return {
        header: "border-sky-200/70 bg-[linear-gradient(160deg,rgba(239,250,255,0.98),rgba(226,244,255,0.95))]",
        cell: "bg-[linear-gradient(160deg,rgba(244,252,255,0.9),rgba(227,244,255,0.82))] border-sky-200/50",
      };
    default:
      return {
        header: "border-border/60 bg-[linear-gradient(160deg,rgba(255,255,255,0.95),rgba(247,243,237,0.88))]",
        cell: "bg-white/60 border-border/40",
      };
  }
}

function ScheduledProjectCard({
  project,
  calendarEndSlot,
  left,
  width,
  dependencyCount,
  team,
  selected,
  dimmed,
  onSelect,
  onPointerDown,
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
  team: Team | null;
  selected: boolean;
  dimmed: boolean;
  onSelect: (projectId: string, shiftKey: boolean) => void;
  onPointerDown: (projectId: string, shiftKey: boolean) => void;
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
        "absolute top-3 h-[92px] rounded-2xl border border-black/10 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.42)] transition-all duration-200",
        selected && "border-primary/60 ring-2 ring-primary/35",
        isDragging && "opacity-40 shadow-lg",
        dimmed && !isDragging && "opacity-25 saturate-50"
      )}
      style={{
        left,
        width,
        transform: CSS.Translate.toString(moveTransform),
        background: `linear-gradient(150deg, ${team?.softColor ?? "rgba(255,255,255,0.96)"}, rgba(255,255,255,0.98))`,
      }}
    >
      <button
        type="button"
        className="flex h-full w-full flex-col justify-between rounded-2xl px-5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDownCapture={(event) => onPointerDown(project.id, event.shiftKey)}
        onClick={(event) => onSelect(project.id, event.shiftKey)}
        {...moveAttributes}
        {...moveListeners}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="line-clamp-1 text-sm font-semibold text-foreground">{project.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {project.scheduledDurationHalfDays / 2} {fr.schedule.daysSuffix}
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
            {fr.schedule.move}
          </Badge>
          {selected ? (
            <Badge variant="outline" className="rounded-full bg-background/70">
              {fr.schedule.selected}
            </Badge>
          ) : null}
        </div>
      </button>

      <button
        ref={setResizeStartNodeRef}
        type="button"
        className="absolute inset-y-2 left-1 z-10 flex w-3 cursor-ew-resize items-center justify-center rounded-full bg-background/75 text-muted-foreground shadow-sm"
        aria-label={`Redimensionner le debut de ${project.title}`}
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
        aria-label={`Redimensionner la fin de ${project.title}`}
        onClick={(event) => event.stopPropagation()}
        {...resizeEndAttributes}
        {...resizeEndListeners}
      >
        <StretchHorizontal className="size-3 rotate-90" />
      </button>
    </div>
  );
}

function PreviewProjectCard({
  project,
  left,
  width,
  team,
  primary,
}: {
  project: Project & {
    scheduledTeam: TeamId;
    scheduledStartSlot: SlotKey;
    scheduledDurationHalfDays: number;
  };
  left: string;
  width: string;
  team: Team | null;
  primary: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-4 h-[84px] rounded-2xl border border-dashed shadow-[0_18px_40px_-30px_rgba(23,37,84,0.5)] backdrop-blur-sm transition-all duration-200",
        primary
          ? "border-primary/65 bg-white/88 ring-2 ring-primary/20"
          : "border-foreground/20 bg-white/55 opacity-80"
      )}
      style={{
        left,
        width,
        background: primary
          ? `linear-gradient(160deg, ${team?.softColor ?? "rgba(255,255,255,0.92)"}, rgba(255,255,255,0.9))`
          : "linear-gradient(160deg, rgba(255,255,255,0.85), rgba(255,255,255,0.68))",
      }}
    >
      <div className="flex h-full flex-col justify-between px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="line-clamp-1 text-sm font-semibold text-foreground">{project.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {project.scheduledDurationHalfDays / 2} {fr.schedule.daysSuffix}
            </p>
          </div>
          <Badge variant={primary ? "default" : "outline"} className="rounded-full">
            {primary ? fr.schedule.preview : <Sparkles className="size-3" />}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {parseSlotKey(project.scheduledStartSlot).date} {parseSlotKey(project.scheduledStartSlot).part}
        </p>
      </div>
    </div>
  );
}

function DayTooltipContent({ dayState }: { dayState: CalendarDayState }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium text-background">
          {format(parseISO(dayState.date), "EEEE d MMMM yyyy", { locale: localeFr })}
        </p>
        <p className="text-[11px] uppercase tracking-[0.14em] text-background/70">
          {dayState.isBlocking ? fr.schedule.blockingDay : fr.schedule.advisoryDay}
        </p>
      </div>

      {dayState.markers.length ? (
        <div className="space-y-2">
          {dayState.markers.map((marker) => (
            <div key={marker.id} className="rounded-lg border border-white/10 bg-white/8 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-background">{marker.title}</span>
                <Badge variant="secondary" className="rounded-full">
                  {marker.type === "weekend" ? marker.shortLabelFr : getClosureTypeLabelFr(marker.type)}
                </Badge>
                <Badge variant="outline" className="rounded-full border-white/20 text-background">
                  {getClosureImpactLabelFr(marker.impact)}
                </Badge>
              </div>
              {marker.details ? (
                <p className="mt-2 text-xs leading-5 text-background/78">{marker.details}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-background/78">{fr.schedule.noMarker}</p>
      )}
    </div>
  );
}

function SlotBucketCell({
  bucket,
  date,
  slotIndex,
  slotCount,
  dayState,
  active,
  previewActive,
  focused,
  focusAnchor,
}: {
  bucket: CalendarBucket;
  date: string;
  slotIndex: number;
  slotCount: number;
  dayState: CalendarDayState;
  active: boolean;
  previewActive: boolean;
  focused: boolean;
  focusAnchor: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: bucket.bucketId,
    data: bucket,
  });
  const part = parseSlotKey(bucket.startSlot).part;
  const tone = toneClasses(dayState.tone);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PopoverTrigger
            id={bucket.bucketId}
            render={
              <button
                ref={setNodeRef}
                type="button"
                aria-label={`Placer un projet le ${date} ${part}`}
                data-focus-anchor={focusAnchor ? date : undefined}
                className={cn(
                  "absolute inset-y-0 border-r transition-all duration-200 last:border-r-0 hover:z-10 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-18px_rgba(15,23,42,0.4)]",
                  tone.cell,
                  part === "AM" ? "border-r-white/55" : "border-r-border/35",
                  isOver && "bg-primary/16 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.2)]",
                  previewActive && "bg-primary/10 ring-1 ring-inset ring-primary/35",
                  active && "ring-2 ring-inset ring-primary/60",
                  focused &&
                    "z-20 animate-[pulse_1.5s_ease-in-out_2] ring-2 ring-inset ring-[oklch(0.65_0.18_30)] shadow-[0_0_0_1px_rgba(255,120,80,0.25)]"
                )}
                style={{
                  left: `${(slotIndex / slotCount) * 100}%`,
                  width: `${100 / slotCount}%`,
                }}
              />
            }
          />
        }
      />
      <TooltipContent className="w-80 max-w-[22rem] rounded-2xl bg-foreground p-3 text-background">
        <DayTooltipContent dayState={dayState} />
      </TooltipContent>
    </Tooltip>
  );
}

function QuickPlacementForm({
  pendingPlacement,
  teams,
  onCommit,
  onCancel,
}: {
  pendingPlacement: QuickPlacementState;
  teams: Team[];
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
        <PopoverTitle>
          {fr.schedule.placeProject} : {pendingPlacement.title}
        </PopoverTitle>
        <PopoverDescription>{fr.schedule.confirmDrop}</PopoverDescription>
      </PopoverHeader>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          <CalendarClock className="size-3.5" />
          {getTeamById(teams, pendingPlacement.placement.teamId)?.nameFr ?? "Equipe"}
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {fr.schedule.startDate}
          </p>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {fr.schedule.slot}
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
            {fr.schedule.duration}
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
          {fr.schedule.cancel}
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
          {fr.schedule.placeProject}
        </Button>
      </div>
    </div>
  );
}

function DayHeaderCell({
  date,
  dayState,
  focused,
}: {
  date: string;
  dayState: CalendarDayState;
  focused: boolean;
}) {
  const tone = toneClasses(dayState.tone);

  return (
    <div
      className={cn(
        "rounded-xl border p-2 transition-all duration-200",
        tone.header,
        focused && "ring-2 ring-[oklch(0.65_0.18_30)] shadow-[0_10px_24px_-20px_rgba(234,88,12,0.8)]"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">
          {format(parseISO(date), "dd", { locale: localeFr })}
        </p>
        {dayState.markers[0] ? (
          <Badge variant="outline" className="rounded-full bg-background/80 text-[10px]">
            {dayState.markers[0].shortLabelFr}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {format(parseISO(date), "EEE", { locale: localeFr })}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="rounded-md bg-background/70 px-2 py-1 text-center">{fr.schedule.am}</span>
        <span className="rounded-md bg-background/70 px-2 py-1 text-center">{fr.schedule.pm}</span>
      </div>
    </div>
  );
}

function YearMonthRow({
  teamId,
  section,
  closures,
  projects,
  previewProjects,
  previewChangedProjectIds,
  previewPrimaryProjectId,
  dependencies,
  pendingPlacement,
  hoveredBucketId,
  focusedRange,
  selectedProjectIds,
  teams,
  isAnchorLane,
  onSelectProject,
  onProjectPointerDown,
}: {
  teamId: TeamId;
  section: YearMonthSection;
  closures: ClosurePeriod[];
  projects: (Project & {
    scheduledTeam: TeamId;
    scheduledStartSlot: SlotKey;
    scheduledDurationHalfDays: number;
  })[];
  previewProjects: (Project & {
    scheduledTeam: TeamId;
    scheduledStartSlot: SlotKey;
    scheduledDurationHalfDays: number;
  })[];
  previewChangedProjectIds: string[];
  previewPrimaryProjectId: string | null;
  dependencies: ProjectDependency[];
  pendingPlacement: QuickPlacementState | null;
  hoveredBucketId: string | null;
  focusedRange: CalendarFocusEvent;
  selectedProjectIds: string[];
  teams: Team[];
  isAnchorLane: boolean;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  const team = getTeamById(teams, teamId);
  const days = eachDayOfInterval({
    start: parseISO(section.startDate),
    end: parseISO(section.endDate),
  }).map((value) => format(value, "yyyy-MM-dd"));
  const slotCount = section.dayCount * 2;
  const dayStates = useMemo(
    () =>
      Object.fromEntries(days.map((date) => [date, buildCalendarDayState(date, closures)])),
    [days, closures]
  );
  const previewProjectsByTeam = previewProjects.filter((project) => project.scheduledTeam === teamId);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{team?.nameFr ?? "Equipe"}</p>
        <Badge
          className="rounded-full border-0 px-3 py-1 text-xs text-foreground"
          style={{ background: team?.softColor ?? "rgba(255,255,255,0.8)" }}
        >
          {projects.length} {fr.schedule.scheduledCountSuffix}
        </Badge>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70">
        <div
          className="grid gap-1 border-b border-border/50 bg-background/70 p-2"
          style={{ gridTemplateColumns: `repeat(${section.dayCount}, minmax(0, 1fr))` }}
        >
          {days.map((date) => (
            <DayHeaderCell
              key={`${teamId}-header-${date}`}
              date={date}
              dayState={dayStates[date]}
              focused={isDateWithinFocus(date, focusedRange)}
            />
          ))}
        </div>

        <div className="relative h-[104px]">
          {days.flatMap((date, dayIndex) =>
            (["AM", "PM"] as const).map((part, partIndex) => {
              const startSlot = makeSlotKey(date, part);
              const bucketId = makeBucketId(teamId, startSlot);

              return (
                <SlotBucketCell
                  key={`${teamId}-bucket-${startSlot}`}
                  bucket={{
                    bucketId,
                    teamId,
                    startSlot,
                    granularity: "slot",
                  }}
                  date={date}
                  slotIndex={dayIndex * 2 + partIndex}
                  slotCount={slotCount}
                  dayState={dayStates[date]}
                  active={pendingPlacement?.triggerId === bucketId}
                  previewActive={hoveredBucketId === bucketId}
                  focused={isDateWithinFocus(date, focusedRange)}
                  focusAnchor={isAnchorLane && part === "AM"}
                />
              );
            })
          )}

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
                width={`${(Math.max(bounds.endOffset - bounds.startOffset, 0.48) / section.dayCount) * 100}%`}
                dependencyCount={dependencyCount}
                team={team}
                selected={selectedProjectIds.includes(project.id)}
                dimmed={previewChangedProjectIds.includes(project.id)}
                onSelect={onSelectProject}
                onPointerDown={onProjectPointerDown}
              />
            );
          })}

          {previewProjectsByTeam
            .filter((project) => previewChangedProjectIds.includes(project.id))
            .map((project) => {
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

              return (
                <PreviewProjectCard
                  key={`preview-${section.id}-${project.id}`}
                  project={project}
                  left={`${(bounds.startOffset / section.dayCount) * 100}%`}
                  width={`${(Math.max(bounds.endOffset - bounds.startOffset, 0.48) / section.dayCount) * 100}%`}
                  team={team}
                  primary={project.id === previewPrimaryProjectId}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}

function YearJumpStrip({
  years,
  activeYear,
  onJumpToYear,
}: {
  years: number[];
  activeYear: number;
  onJumpToYear: (year: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {fr.schedule.jumpToYear}
      </span>
      {years.map((year) => (
        <Button
          key={year}
          size="sm"
          variant={year === activeYear ? "default" : "outline"}
          className="rounded-full"
          onClick={() => onJumpToYear(year)}
        >
          {year}
        </Button>
      ))}
    </div>
  );
}

function FoldedMonthCard({
  summary,
  onOpen,
}: {
  summary: ReturnType<typeof buildTimelineYearSummaries>[number]["months"][number];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full flex-col items-start gap-3 rounded-[24px] border border-border/70 bg-card/85 p-4 text-left shadow-[0_18px_40px_-34px_rgba(15,23,42,0.35)] transition-transform duration-150 hover:-translate-y-0.5",
        summary.containsFocus && "ring-2 ring-primary/25",
        summary.containsToday && "border-primary/40"
      )}
      onClick={onOpen}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {fr.schedule.foldedMonthTitle}
          </p>
          <h4 className="mt-1 font-heading text-lg font-semibold text-foreground">
            {summary.section.label}
          </h4>
        </div>
        <Badge variant="outline" className="rounded-full">
          {summary.section.dayCount} {fr.schedule.daysSuffix}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" className="rounded-full">
          {summary.projectCount} {fr.schedule.projectCount}
        </Badge>
        <Badge variant="outline" className="rounded-full">
          {summary.closureCount} {fr.schedule.closureCount}
        </Badge>
        {summary.containsToday ? (
          <Badge variant="outline" className="rounded-full">
            {fr.schedule.containsToday}
          </Badge>
        ) : null}
        {summary.containsFocus ? (
          <Badge variant="outline" className="rounded-full">
            {fr.schedule.containsFocus}
          </Badge>
        ) : null}
      </div>
    </button>
  );
}

function ExpandedMonthSection({
  section,
  projects,
  previewProjects,
  previewChangedProjectIds,
  previewPrimaryProjectId,
  dependencies,
  closures,
  pendingPlacement,
  hoveredBucketId,
  focusedRange,
  selectedProjectIds,
  teams,
  onSelectProject,
  onProjectPointerDown,
}: {
  section: YearMonthSection;
  projects: Project[];
  previewProjects: Project[] | null;
  previewChangedProjectIds: string[];
  previewPrimaryProjectId: string | null;
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  hoveredBucketId: string | null;
  focusedRange: CalendarFocusEvent;
  selectedProjectIds: string[];
  teams: Team[];
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  const sortedTeams = useMemo(() => getSortedTeams(teams), [teams]);
  const scheduledProjects = projects.filter(isScheduledProject);
  const previewScheduledProjects = (previewProjects ?? []).filter(isScheduledProject);

  return (
    <section
      data-section-anchor={section.id}
      className="rounded-[28px] border border-border/70 bg-card/95 p-4 shadow-[0_24px_50px_-42px_rgba(15,23,42,0.55)] [contain:layout_paint]"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {fr.schedule.monthOverview}
          </p>
          <h4 className="mt-1 font-heading text-xl font-semibold text-foreground">
            {section.label}
          </h4>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
          {section.dayCount} {fr.schedule.daysSuffix}
        </Badge>
      </div>

      <div className="mt-4 space-y-4">
        {sortedTeams.map((team, index) => (
          <YearMonthRow
            key={`${section.id}-${team.id}`}
            teamId={team.id}
            section={section}
            closures={closures}
            projects={scheduledProjects.filter((project) => project.scheduledTeam === team.id)}
            previewProjects={previewScheduledProjects}
            previewChangedProjectIds={previewChangedProjectIds}
            previewPrimaryProjectId={previewPrimaryProjectId}
            dependencies={dependencies}
            pendingPlacement={pendingPlacement}
            hoveredBucketId={hoveredBucketId}
            focusedRange={focusedRange}
            selectedProjectIds={selectedProjectIds}
            teams={teams}
            isAnchorLane={index === 0}
            onSelectProject={onSelectProject}
            onProjectPointerDown={onProjectPointerDown}
          />
        ))}
      </div>
    </section>
  );
}

function FoldedYearCard({
  summary,
  onOpen,
}: {
  summary: ReturnType<typeof buildTimelineYearSummaries>[number];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-year-anchor={summary.year}
      className={cn(
        "flex w-full flex-col items-start gap-3 rounded-[28px] border border-border/70 bg-card/90 p-5 text-left shadow-[0_20px_44px_-34px_rgba(15,23,42,0.4)] transition-transform duration-150 hover:-translate-y-0.5",
        summary.containsFocus && "ring-2 ring-primary/25",
        summary.containsToday && "border-primary/40"
      )}
      onClick={onOpen}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {fr.schedule.foldedYearTitle}
          </p>
          <h3 className="mt-1 font-heading text-2xl font-semibold text-foreground">
            {summary.year}
          </h3>
        </div>
        <Badge variant="outline" className="rounded-full">
          {summary.months.length} {fr.schedule.monthView.toLowerCase()}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" className="rounded-full">
          {summary.projectCount} {fr.schedule.projectCount}
        </Badge>
        <Badge variant="outline" className="rounded-full">
          {summary.closureCount} {fr.schedule.closureCount}
        </Badge>
        {summary.containsToday ? (
          <Badge variant="outline" className="rounded-full">
            {fr.schedule.containsToday}
          </Badge>
        ) : null}
        {summary.containsFocus ? (
          <Badge variant="outline" className="rounded-full">
            {fr.schedule.containsFocus}
          </Badge>
        ) : null}
      </div>
    </button>
  );
}

function MonthModeView({
  summaries,
  projects,
  previewProjects,
  previewChangedProjectIds,
  previewPrimaryProjectId,
  dependencies,
  closures,
  pendingPlacement,
  hoveredBucketId,
  focusedRange,
  selectedProjectIds,
  teams,
  onOpenMonth,
  onOpenYear,
  onSelectProject,
  onProjectPointerDown,
}: {
  summaries: ReturnType<typeof buildTimelineYearSummaries>;
  projects: Project[];
  previewProjects: Project[] | null;
  previewChangedProjectIds: string[];
  previewPrimaryProjectId: string | null;
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  hoveredBucketId: string | null;
  focusedRange: CalendarFocusEvent;
  selectedProjectIds: string[];
  teams: Team[];
  onOpenMonth: (date: string) => void;
  onOpenYear: (year: number) => void;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  return (
    <div className="space-y-8">
      {summaries.map((yearSummary) =>
        yearSummary.isActive ? (
          <section
            key={yearSummary.year}
            data-year-anchor={yearSummary.year}
            className="space-y-4 scroll-mt-6"
          >
            <div className="rounded-[24px] border border-border/70 bg-background/90 px-4 py-3 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.4)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {fr.schedule.yearOverview}
              </p>
              <h3 className="mt-1 font-heading text-2xl font-semibold text-foreground">
                {yearSummary.year}
              </h3>
            </div>

            <div className="space-y-4">
              {yearSummary.months.map((monthSummary) =>
                monthSummary.isActive ? (
                  <ExpandedMonthSection
                    key={monthSummary.section.id}
                    section={monthSummary.section}
                    projects={projects}
                    previewProjects={previewProjects}
                    previewChangedProjectIds={previewChangedProjectIds}
                    previewPrimaryProjectId={previewPrimaryProjectId}
                    dependencies={dependencies}
                    closures={closures}
                    pendingPlacement={pendingPlacement}
                    hoveredBucketId={hoveredBucketId}
                    focusedRange={focusedRange}
                    selectedProjectIds={selectedProjectIds}
                    teams={teams}
                    onSelectProject={onSelectProject}
                    onProjectPointerDown={onProjectPointerDown}
                  />
                ) : (
                  <FoldedMonthCard
                    key={monthSummary.section.id}
                    summary={monthSummary}
                    onOpen={() => onOpenMonth(monthSummary.section.startDate)}
                  />
                )
              )}
            </div>
          </section>
        ) : (
          <FoldedYearCard
            key={yearSummary.year}
            summary={yearSummary}
            onOpen={() => onOpenYear(yearSummary.year)}
          />
        )
      )}
    </div>
  );
}

function YearModeView({
  summaries,
  projects,
  previewProjects,
  previewChangedProjectIds,
  previewPrimaryProjectId,
  dependencies,
  closures,
  pendingPlacement,
  hoveredBucketId,
  focusedRange,
  selectedProjectIds,
  teams,
  onOpenYear,
  onSelectProject,
  onProjectPointerDown,
}: {
  summaries: ReturnType<typeof buildTimelineYearSummaries>;
  projects: Project[];
  previewProjects: Project[] | null;
  previewChangedProjectIds: string[];
  previewPrimaryProjectId: string | null;
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  hoveredBucketId: string | null;
  focusedRange: CalendarFocusEvent;
  selectedProjectIds: string[];
  teams: Team[];
  onOpenYear: (year: number) => void;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  return (
    <div className="space-y-8">
      {summaries.map((yearSummary) =>
        yearSummary.isActive ? (
          <section
            key={yearSummary.year}
            data-year-anchor={yearSummary.year}
            className="space-y-4 scroll-mt-6"
          >
            <div className="rounded-[24px] border border-border/70 bg-background/90 px-4 py-3 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {fr.schedule.yearOverview}
              </p>
              <h3 className="mt-1 font-heading text-2xl font-semibold text-foreground">
                {yearSummary.year}
              </h3>
            </div>

            <div className="space-y-4">
              {yearSummary.months.map((monthSummary) => (
                <ExpandedMonthSection
                  key={monthSummary.section.id}
                  section={monthSummary.section}
                  projects={projects}
                  previewProjects={previewProjects}
                  previewChangedProjectIds={previewChangedProjectIds}
                  previewPrimaryProjectId={previewPrimaryProjectId}
                  dependencies={dependencies}
                  closures={closures}
                  pendingPlacement={pendingPlacement}
                  hoveredBucketId={hoveredBucketId}
                  focusedRange={focusedRange}
                  selectedProjectIds={selectedProjectIds}
                  teams={teams}
                  onSelectProject={onSelectProject}
                  onProjectPointerDown={onProjectPointerDown}
                />
              ))}
            </div>
          </section>
        ) : (
          <FoldedYearCard
            key={yearSummary.year}
            summary={yearSummary}
            onOpen={() => onOpenYear(yearSummary.year)}
          />
        )
      )}
    </div>
  );
}

export function TimelineCanvas({
  projects,
  previewProjects,
  previewChangedProjectIds,
  previewPrimaryProjectId,
  hoveredBucketId,
  dependencies,
  customClosures,
  closures,
  pendingPlacement,
  selectedProjectIds,
  traceEnabled,
  teams,
  focusEvent,
  onActiveDateChange,
  onTraceEnabledChange,
  onPendingPlacementChange,
  onQuickPlacementCommit,
  onSelectProject,
  onProjectPointerDown,
}: {
  projects: Project[];
  previewProjects: Project[] | null;
  previewChangedProjectIds: string[];
  previewPrimaryProjectId: string | null;
  hoveredBucketId: string | null;
  dependencies: ProjectDependency[];
  customClosures: CustomClosure[];
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  selectedProjectIds: string[];
  traceEnabled: boolean;
  teams: Team[];
  focusEvent: CalendarFocusEvent;
  onActiveDateChange?: (date: string) => void;
  onTraceEnabledChange: (enabled: boolean) => void;
  onPendingPlacementChange: (placement: QuickPlacementState | null) => void;
  onQuickPlacementCommit: (projectId: string, placement: ProjectPlacement) => void;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  const visibleProjects = previewProjects ?? projects;
  const initialScrollDoneRef = useRef(false);
  const pendingFocusDateRef = useRef<string | null>(null);
  const [isNavigating, startNavigationTransition] = useTransition();
  const timelineNow = useMemo(() => new Date(), []);
  const todayDate = useMemo(() => getTodayDateString(timelineNow), [timelineNow]);
  const [viewMode, setViewMode] = useState<TimelineViewMode>("month");
  const [activeDate, setActiveDate] = useState(todayDate);
  const sections = useMemo(
    () => buildTimelineSections(visibleProjects, customClosures, timelineNow),
    [customClosures, timelineNow, visibleProjects]
  );
  const { years } = useMemo(
    () => buildTimelineYearRange(visibleProjects, customClosures, timelineNow),
    [customClosures, timelineNow, visibleProjects]
  );
  const summaries = useMemo(
    () =>
      buildTimelineYearSummaries({
        sections,
        projects: visibleProjects,
        closures,
        activeDate,
        todayDate,
        focusDate: focusEvent?.startDate ?? null,
        viewMode,
      }),
    [activeDate, closures, focusEvent, sections, todayDate, viewMode, visibleProjects]
  );
  const activeYear = parseISO(activeDate).getFullYear();

  useEffect(() => {
    onActiveDateChange?.(activeDate);
  }, [activeDate, onActiveDateChange]);

  useEffect(() => {
    if (!sections.length) {
      return;
    }

    const activeInRange = sections.some(
      (section) => activeDate >= section.startDate && activeDate <= section.endDate
    );
    if (activeInRange) {
      return;
    }

    const todaySection = sections.find(
      (section) => todayDate >= section.startDate && todayDate <= section.endDate
    );

    startNavigationTransition(() => {
      setActiveDate(todaySection?.startDate ?? sections[0].startDate);
    });
  }, [activeDate, sections, startNavigationTransition, todayDate]);

  useEffect(() => {
    if (!focusEvent) {
      return;
    }

    pendingFocusDateRef.current = focusEvent.startDate;
    startNavigationTransition(() => {
      setActiveDate(focusEvent.startDate);
    });
  }, [focusEvent, startNavigationTransition]);

  useEffect(() => {
    if (!sections.length) {
      return;
    }

    const behavior: ScrollBehavior = initialScrollDoneRef.current ? "smooth" : "auto";
    const pendingFocusDate = pendingFocusDateRef.current;

    if (pendingFocusDate) {
      const focusYear = parseISO(pendingFocusDate).getFullYear();
      const didScrollToFocus =
        scrollToTimelineDate(pendingFocusDate, behavior) ||
        scrollToTimelineSection(getTimelineMonthId(pendingFocusDate), behavior) ||
        scrollToTimelineYear(focusYear, behavior);

      if (didScrollToFocus) {
        initialScrollDoneRef.current = true;
        pendingFocusDateRef.current = null;
        return;
      }
    }

    const didScroll =
      viewMode === "month"
        ? scrollToTimelineSection(getTimelineMonthId(activeDate), behavior)
        : scrollToTimelineYear(activeYear, behavior);

    if (!didScroll && years[0]) {
      const scrolledToActiveYear = scrollToTimelineYear(activeYear, behavior);
      if (!scrolledToActiveYear) {
        scrollToTimelineYear(years[0], behavior);
      }
    }

    initialScrollDoneRef.current = true;
  }, [activeDate, activeYear, sections, viewMode, years]);

  const navigate = (direction: -1 | 1) => {
    if (!sections.length || !years.length) {
      return;
    }

    startNavigationTransition(() => {
      setActiveDate((current) => {
        const shifted = shiftTimelineDate(current, viewMode, direction);
        if (viewMode === "month") {
          const shiftedMonthId = getTimelineMonthId(shifted);
          const targetSection = sections.find((section) => section.id === shiftedMonthId);
          if (targetSection) {
            return shifted;
          }

          return direction < 0 ? sections[0].startDate : sections.at(-1)?.startDate ?? current;
        }

        const shiftedYear = parseISO(shifted).getFullYear();
        if (years.includes(shiftedYear)) {
          return shifted;
        }

        return replaceYearInDate(current, direction < 0 ? years[0] : years.at(-1)!);
      });
    });
  };

  const jumpToYear = (year: number) => {
    startNavigationTransition(() => {
      setActiveDate((current) => replaceYearInDate(current, year));
    });
  };

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
                {fr.schedule.canvasEyebrow}
              </p>
              <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">
                {fr.schedule.canvasTitle}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {fr.schedule.canvasHint}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1.5 text-xs">
                {fr.schedule.yearOnly} : {viewMode === "month" ? fr.schedule.monthView : fr.schedule.yearView}
              </Badge>
              <div className="flex rounded-full border border-border bg-background p-1">
                {(["month", "year"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm transition-colors",
                      viewMode === mode
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() =>
                      startNavigationTransition(() => {
                        setViewMode(mode);
                      })
                    }
                  >
                    {mode === "month" ? fr.schedule.monthView : fr.schedule.yearView}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate(-1)} disabled={isNavigating}>
                {fr.schedule.previousPeriod}
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate(1)} disabled={isNavigating}>
                {fr.schedule.nextPeriod}
              </Button>
              <YearJumpStrip years={years} activeYear={activeYear} onJumpToYear={jumpToYear} />
              {focusEvent ? (
                <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs">
                  {formatFocusRange(focusEvent.startDate, focusEvent.endDate)}
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant={traceEnabled ? "default" : "outline"}
                onClick={() => onTraceEnabledChange(!traceEnabled)}
              >
                {traceEnabled ? fr.schedule.traceOn : fr.schedule.traceOff}
              </Button>
            </div>
          </div>

          {viewMode === "month" ? (
            <MonthModeView
              summaries={summaries}
              projects={projects}
              previewProjects={previewProjects}
              previewChangedProjectIds={previewChangedProjectIds}
              previewPrimaryProjectId={previewPrimaryProjectId}
              dependencies={dependencies}
              closures={closures}
              pendingPlacement={pendingPlacement}
              hoveredBucketId={hoveredBucketId}
              focusedRange={focusEvent}
              selectedProjectIds={selectedProjectIds}
              teams={teams}
              onOpenMonth={(date) =>
                startNavigationTransition(() => {
                  setActiveDate(date);
                })
              }
              onOpenYear={(year) =>
                startNavigationTransition(() => {
                  setActiveDate((current) => replaceYearInDate(current, year));
                })
              }
              onSelectProject={onSelectProject}
              onProjectPointerDown={onProjectPointerDown}
            />
          ) : (
            <YearModeView
              summaries={summaries}
              projects={projects}
              previewProjects={previewProjects}
              previewChangedProjectIds={previewChangedProjectIds}
              previewPrimaryProjectId={previewPrimaryProjectId}
              dependencies={dependencies}
              closures={closures}
              pendingPlacement={pendingPlacement}
              hoveredBucketId={hoveredBucketId}
              focusedRange={focusEvent}
              selectedProjectIds={selectedProjectIds}
              teams={teams}
              onOpenYear={(year) =>
                startNavigationTransition(() => {
                  setActiveDate((current) => replaceYearInDate(current, year));
                })
              }
              onSelectProject={onSelectProject}
              onProjectPointerDown={onProjectPointerDown}
            />
          )}
        </CardContent>
      </Card>

      {pendingPlacement ? (
        <PopoverContent align="start" sideOffset={10} className="w-80">
          <QuickPlacementForm
            key={pendingPlacement.triggerId}
            pendingPlacement={pendingPlacement}
            teams={teams}
            onCancel={() => onPendingPlacementChange(null)}
            onCommit={onQuickPlacementCommit}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
