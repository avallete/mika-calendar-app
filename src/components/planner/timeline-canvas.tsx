"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { CSS } from "@dnd-kit/utilities";
import { endOfMonth, format, getDate, getMonth, parseISO } from "date-fns";
import { fr as localeFr } from "date-fns/locale";
import {
  ArrowRightLeft,
  CalendarDays,
  CalendarClock,
  GripVertical,
  MoveHorizontal,
  Sparkles,
  StretchHorizontal,
} from "lucide-react";
import {
  memo,
  Profiler,
  useEffect,
  useLayoutEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ProfilerOnRenderCallback,
} from "react";

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
  parseSlotKey,
} from "@/lib/planner/calendar";
import {
  getClosureImpactLabelFr,
  getClosureTypeLabelFr,
} from "@/lib/planner/day-markers";
import { usePlannerRowDragPreview } from "@/lib/planner/drag-preview-store";
import {
  measurePlannerPerformance,
  recordPlannerProfilerRender,
} from "@/lib/planner/drag-performance";
import { fr } from "@/lib/i18n/fr";
import {
  buildDependencyCountByProjectId,
  buildSectionTeamProjectMap,
  buildTimelineSectionOverlayViews,
  buildTimelineSectionRowViews,
  EMPTY_SECTION_TEAM_PROJECTS,
  EMPTY_STRING_SET,
  type SectionTeamProjectMap,
  type TimelineTeamOverlayView,
  type TimelineTeamRowView,
} from "@/lib/planner/timeline-render";
import {
  buildTimelineYearSummaries,
  getTimelineMonthId,
  shiftTimelineDate,
} from "@/lib/planner/timeline-folding";
import {
  getTimelineScrollTop,
  shouldTriggerTimelineScroll,
  type TimelineScrollIntent,
} from "@/lib/planner/timeline-scroll";
import {
  buildTimelineSections,
  buildTimelineYearRange,
  getTodayDateString,
} from "@/lib/planner/timeline-range";
import {
  buildYearSectionRenderCacheKey,
  resolveYearSectionRenderCache,
  type YearSectionRenderCache,
  getDayHeaderTooltipState,
  getVirtualizedMonthTranslateY,
} from "@/lib/planner/timeline-year-view";
import type {
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

const handlePlannerProfilerRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration
) => {
  recordPlannerProfilerRender(id, phase, actualDuration, baseDuration);
};

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
  dimmed = false,
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
  dimmed?: boolean;
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
        "absolute top-3 z-10 h-[92px] rounded-2xl border border-black/10 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.42)] transition-all duration-200",
        selected && "border-primary/60 ring-2 ring-primary/35",
        isDragging && "pointer-events-none opacity-0 shadow-none",
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
        "pointer-events-none absolute top-4 z-20 h-[84px] rounded-2xl border border-dashed shadow-[0_18px_40px_-30px_rgba(23,37,84,0.5)] backdrop-blur-sm transition-all duration-200",
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
  todayDate,
  focused,
  dragActive = false,
  focusAnchor = false,
}: {
  date: string;
  dayState: CalendarDayState;
  todayDate: string;
  focused: boolean;
  dragActive?: boolean;
  focusAnchor?: boolean;
}) {
  const tone = toneClasses(dayState.tone);
  const isToday = date === todayDate;
  const tooltipDayState = getDayHeaderTooltipState(dayState, dragActive);
  const headerCell = (
    <div
      data-focus-anchor={focusAnchor ? date : undefined}
      className={cn(
        "rounded-xl border p-2 transition-all duration-200",
        tone.header,
        isToday &&
          "border-primary/60 bg-[linear-gradient(160deg,rgba(236,253,245,0.98),rgba(220,252,231,0.92))] shadow-[0_12px_24px_-20px_rgba(5,150,105,0.65)]",
        focused && "ring-2 ring-[oklch(0.65_0.18_30)] shadow-[0_10px_24px_-20px_rgba(234,88,12,0.8)]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {format(parseISO(date), "dd", { locale: localeFr })}
          </p>
          {isToday ? (
            <Badge className="rounded-full border-0 bg-primary/12 px-2 py-0.5 text-[10px] text-primary shadow-none">
              {fr.schedule.containsToday}
            </Badge>
          ) : null}
        </div>
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

  if (!tooltipDayState) {
    return headerCell;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={headerCell} />
      <TooltipContent className="w-80 max-w-[22rem] rounded-2xl bg-foreground p-3 text-background">
        <DayTooltipContent dayState={tooltipDayState} />
      </TooltipContent>
    </Tooltip>
  );
}

const YEAR_MONTH_ESTIMATE_BASE_PX = 180;
const YEAR_ROW_ESTIMATE_PX = 132;

type TimelineScrollRequest = {
  token: number;
  intent: TimelineScrollIntent;
  targetDate: string;
};

function stringifyTracePayload(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
}

function traceTimelineUi(enabled: boolean, label: string, payload: unknown) {
  if (!enabled || typeof console === "undefined") {
    return;
  }

  console.log(`[planner ui trace] ${label} ${stringifyTracePayload(payload)}`);
}

const SharedMonthHeader = memo(function SharedMonthHeader({
  section,
  days,
  dayStates,
  todayDate,
  focusedRange,
  dragActive,
  focusAnchorsEnabled,
}: {
  section: YearMonthSection;
  days: string[];
  dayStates: Record<string, CalendarDayState>;
  todayDate: string;
  focusedRange: CalendarFocusEvent;
  dragActive: boolean;
  focusAnchorsEnabled: boolean;
}) {
  return (
    <div
      data-shared-day-strip="true"
      className="grid gap-1 border-b border-border/50 bg-background/70 p-2"
      style={{ gridTemplateColumns: `repeat(${section.dayCount}, minmax(0, 1fr))` }}
    >
      {days.map((date) => (
        <DayHeaderCell
          key={`header-${section.id}-${date}`}
          date={date}
          dayState={dayStates[date]}
          todayDate={todayDate}
          focused={isDateWithinFocus(date, focusedRange)}
          dragActive={dragActive}
          focusAnchor={focusAnchorsEnabled}
        />
      ))}
    </div>
  );
});

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

const SharedExpandedMonthSection = memo(function SharedExpandedMonthSection({
  section,
  days,
  dayStates,
  teams,
  committedProjectsBySection,
  dependencyCountByProjectId,
  closures,
  pendingPlacement,
  dragActive,
  todayDate,
  focusedRange,
  selectedProjectIdSet,
  onSelectProject,
  onProjectPointerDown,
}: {
  section: YearMonthSection;
  days: string[];
  dayStates: Record<string, CalendarDayState>;
  teams: Team[];
  committedProjectsBySection: SectionTeamProjectMap;
  dependencyCountByProjectId: Map<string, number>;
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  dragActive: boolean;
  todayDate: string;
  focusedRange: CalendarFocusEvent;
  selectedProjectIdSet: ReadonlySet<string>;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  const rowViews = useMemo(
    () =>
      measurePlannerPerformance("timeline.static.render", () =>
        buildTimelineSectionRowViews({
          teams,
          section,
          closures,
          committedProjectsBySection,
          dependencyCountByProjectId,
          selectedProjectIdSet,
        })
      ),
    [
      closures,
      committedProjectsBySection,
      dependencyCountByProjectId,
      section,
      selectedProjectIdSet,
      teams,
    ]
  );

  return (
    <Profiler
      id={`SharedExpandedMonthSection:${section.id}`}
      onRender={handlePlannerProfilerRender}
    >
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

        <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card/70">
          <SharedMonthHeader
            section={section}
            days={days}
            dayStates={dayStates}
            todayDate={todayDate}
            focusedRange={focusedRange}
            dragActive={dragActive}
            focusAnchorsEnabled
          />

          <div className="space-y-4 p-3">
            {rowViews.map((rowView) => (
              <SharedTimelineTeamRow
                key={`${section.id}-${rowView.team.id}`}
                rowView={rowView}
                section={section}
                days={days}
                dayStates={dayStates}
                closures={closures}
                pendingPlacement={pendingPlacement}
                focusedRange={focusedRange}
                onSelectProject={onSelectProject}
                onProjectPointerDown={onProjectPointerDown}
              />
            ))}
          </div>
        </div>
      </section>
    </Profiler>
  );
});

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
  sectionRenderDataById,
  committedProjectsBySection,
  dependencyCountByProjectId,
  closures,
  pendingPlacement,
  dragActive,
  todayDate,
  focusedRange,
  selectedProjectIdSet,
  teams,
  onOpenMonth,
  onOpenYear,
  onSelectProject,
  onProjectPointerDown,
}: {
  summaries: ReturnType<typeof buildTimelineYearSummaries>;
  sectionRenderDataById: YearSectionRenderCache["dataBySectionId"];
  committedProjectsBySection: SectionTeamProjectMap;
  dependencyCountByProjectId: Map<string, number>;
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  dragActive: boolean;
  todayDate: string;
  focusedRange: CalendarFocusEvent;
  selectedProjectIdSet: ReadonlySet<string>;
  teams: Team[];
  onOpenMonth: (date: string) => void;
  onOpenYear: (year: number) => void;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  return (
    <Profiler id="MonthModeView" onRender={handlePlannerProfilerRender}>
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
                {yearSummary.months.map((monthSummary) => {
                  if (!monthSummary.isActive) {
                    return (
                      <FoldedMonthCard
                        key={monthSummary.section.id}
                        summary={monthSummary}
                        onOpen={() => onOpenMonth(monthSummary.section.startDate)}
                      />
                    );
                  }

                  const sectionData = sectionRenderDataById.get(monthSummary.section.id);
                  if (!sectionData) {
                    return null;
                  }

                  return (
                    <SharedExpandedMonthSection
                      key={monthSummary.section.id}
                      section={sectionData.section}
                      days={sectionData.days}
                      dayStates={sectionData.dayStates}
                      teams={teams}
                      committedProjectsBySection={committedProjectsBySection}
                      dependencyCountByProjectId={dependencyCountByProjectId}
                      closures={closures}
                      pendingPlacement={pendingPlacement}
                      dragActive={dragActive}
                      todayDate={todayDate}
                      focusedRange={focusedRange}
                      selectedProjectIdSet={selectedProjectIdSet}
                      onSelectProject={onSelectProject}
                      onProjectPointerDown={onProjectPointerDown}
                    />
                  );
                })}
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
    </Profiler>
  );
}

const SharedTimelineTeamRow = memo(function SharedTimelineTeamRow({
  rowView,
  section,
  days,
  dayStates,
  closures,
  pendingPlacement,
  focusedRange,
  onSelectProject,
  onProjectPointerDown,
}: {
  rowView: TimelineTeamRowView;
  section: YearMonthSection;
  days: string[];
  dayStates: Record<string, CalendarDayState>;
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  focusedRange: CalendarFocusEvent;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: rowView.surface.surfaceId,
    data: rowView.surface,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{rowView.team.nameFr}</p>
        <Badge
          className="rounded-full border-0 px-3 py-1 text-xs text-foreground"
          style={{ background: rowView.team.softColor ?? "rgba(255,255,255,0.8)" }}
        >
          {rowView.scheduledCount} {fr.schedule.scheduledCountSuffix}
        </Badge>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70">
        <div
          ref={setNodeRef}
          data-timeline-row-surface={rowView.surface.surfaceId}
          className="relative h-[104px]"
        >
          <div
            className="pointer-events-none absolute inset-0 grid gap-px bg-border/15"
            style={{ gridTemplateColumns: `repeat(${section.dayCount}, minmax(0, 1fr))` }}
          >
            {days.map((date) => {
              const tone = toneClasses(dayStates[date].tone);

              return (
                <div
                  key={`${rowView.surface.surfaceId}-${date}`}
                  className={cn(
                    "relative min-w-0 border-r border-border/35 last:border-r-0",
                    tone.cell,
                    isDateWithinFocus(date, focusedRange) &&
                      "ring-1 ring-inset ring-[oklch(0.65_0.18_30)]"
                  )}
                >
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border/40" />
                </div>
              );
            })}
          </div>

          {rowView.scheduledCards.map((card) => (
            <ScheduledProjectCard
              key={`${section.id}-${card.project.id}`}
              project={card.project}
              calendarEndSlot={card.calendarEndSlot}
              left={card.bounds.left}
              width={card.bounds.width}
              dependencyCount={card.dependencyCount}
              team={rowView.team}
              selected={card.selected}
              onSelect={onSelectProject}
              onPointerDown={onProjectPointerDown}
            />
          ))}
          <TimelineTeamRowOverlay
            rowView={rowView}
            section={section}
            closures={closures}
            pendingPlacement={pendingPlacement}
          />
        </div>
      </div>
    </div>
  );
});

const TimelineTeamRowOverlay = memo(function TimelineTeamRowOverlay({
  rowView,
  section,
  closures,
  pendingPlacement,
}: {
  rowView: TimelineTeamRowView;
  section: YearMonthSection;
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
}) {
  const rowDragPreview = usePlannerRowDragPreview(section.id, rowView.team.id);
  const pendingInSection =
    pendingPlacement &&
    pendingPlacement.placement.teamId === rowView.team.id &&
    pendingPlacement.placement.startSlot.slice(0, 7) === section.id;
  const overlayView = useMemo<TimelineTeamOverlayView | null>(() => {
    if (!rowDragPreview.hoveredBucket && !pendingInSection && !rowDragPreview.preview) {
      return null;
    }

    return (
      measurePlannerPerformance(
        "timeline.overlay.render",
        () =>
          buildTimelineSectionOverlayViews({
            rowViews: [rowView],
            section,
            closures,
            previewProjectsBySection:
              rowDragPreview.preview?.projectsBySection ?? EMPTY_SECTION_TEAM_PROJECTS,
            previewChangedProjectIdSet:
              rowDragPreview.preview?.changedProjectIdSet ?? EMPTY_STRING_SET,
            previewPrimaryProjectId:
              rowDragPreview.preview?.delta.primaryProjectId ?? null,
            pendingPlacement,
            hoveredBucket: rowDragPreview.hoveredBucket,
          })[0] ?? null,
        {
          sectionId: section.id,
          teamId: rowView.team.id,
        }
      ) ?? null
    );
  }, [
    closures,
    pendingInSection,
    pendingPlacement,
    rowView,
    rowDragPreview.hoveredBucket,
    rowDragPreview.preview,
    section,
  ]);

  if (!overlayView) {
    return null;
  }

  return (
    <Profiler
      id={`TimelineOverlay:${section.id}:${rowView.team.id}`}
      onRender={handlePlannerProfilerRender}
    >
      <>
        {overlayView.hoveredBounds ? (
          <div
            id={overlayView.hoveredBucket?.bucketId}
            className="pointer-events-none absolute inset-y-0 z-[5] rounded-lg bg-primary/12 ring-1 ring-inset ring-primary/35"
            style={overlayView.hoveredBounds}
          />
        ) : null}

        {overlayView.pendingBounds ? (
          <PopoverTrigger
            id={overlayView.pendingBucket?.bucketId ?? undefined}
            nativeButton={false}
            render={<div />}
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none absolute inset-y-0 z-[6] rounded-lg bg-primary/10 ring-2 ring-inset ring-primary/55 shadow-[0_0_0_1px_rgba(37,99,235,0.16)]"
            style={overlayView.pendingBounds}
          />
        ) : null}

        {overlayView.dimmedCards.map((card) => (
          <div
            key={`dimmed-${section.id}-${card.projectId}`}
            className="pointer-events-none absolute top-3 z-[12] h-[92px] rounded-2xl bg-white/55 saturate-50 backdrop-blur-[1px]"
            style={{
              left: card.bounds.left,
              width: card.bounds.width,
            }}
          />
        ))}

        {overlayView.previewCards.map((card) => (
          <PreviewProjectCard
            key={`preview-${section.id}-${card.project.id}`}
            project={card.project}
            left={card.bounds.left}
            width={card.bounds.width}
            team={rowView.team}
            primary={card.primary}
          />
        ))}
      </>
    </Profiler>
  );
});

const VirtualizedYearSection = memo(function VirtualizedYearSection({
  yearSummary,
  sectionRenderDataById,
  teams,
  closures,
  committedProjectsBySection,
  dependencyCountByProjectId,
  pendingPlacement,
  dragActive,
  todayDate,
  focusedRange,
  selectedProjectIdSet,
  scrollTargetSectionId,
  scrollRequestToken,
  scrollBehavior,
  onSelectProject,
  onProjectPointerDown,
}: {
  yearSummary: ReturnType<typeof buildTimelineYearSummaries>[number];
  sectionRenderDataById: YearSectionRenderCache["dataBySectionId"];
  teams: Team[];
  closures: ClosurePeriod[];
  committedProjectsBySection: SectionTeamProjectMap;
  dependencyCountByProjectId: Map<string, number>;
  pendingPlacement: QuickPlacementState | null;
  dragActive: boolean;
  todayDate: string;
  focusedRange: CalendarFocusEvent;
  selectedProjectIdSet: ReadonlySet<string>;
  scrollTargetSectionId: string;
  scrollRequestToken: number;
  scrollBehavior: ScrollBehavior;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  const yearRef = useRef<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const virtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: yearSummary.months.length,
    estimateSize: () => YEAR_MONTH_ESTIMATE_BASE_PX + teams.length * YEAR_ROW_ESTIMATE_PX,
    overscan: 2,
    getItemKey: (index) => yearSummary.months[index]?.section.id ?? index,
    scrollMargin: scrollMargin ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const updateScrollMargin = () => {
      setScrollMargin(yearRef.current?.offsetTop ?? 0);
    };

    updateScrollMargin();
    window.addEventListener("resize", updateScrollMargin);
    return () => window.removeEventListener("resize", updateScrollMargin);
  }, [yearSummary.year]);

  useEffect(() => {
    if (scrollMargin === null) {
      return;
    }

    const targetIndex = yearSummary.months.findIndex(
      (month) => month.section.id === scrollTargetSectionId
    );

    if (targetIndex >= 0) {
      virtualizer.scrollToIndex(targetIndex, {
        align: "start",
        behavior: scrollBehavior,
      });
    }
  }, [
    scrollBehavior,
    scrollMargin,
    scrollRequestToken,
    scrollTargetSectionId,
    virtualizer,
    yearSummary.months,
  ]);

  return (
    <section
      ref={yearRef}
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

      <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualItem) => {
          const sectionId = yearSummary.months[virtualItem.index]?.section.id ?? null;
          const sectionData = sectionId ? sectionRenderDataById.get(sectionId) : null;
          if (!sectionData) {
            return null;
          }

          const { section, days, dayStates } = sectionData;

          return (
            <div
              key={section.id}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${getVirtualizedMonthTranslateY(
                  virtualItem.start,
                  scrollMargin ?? 0
                )}px)`,
              }}
            >
              <SharedExpandedMonthSection
                section={section}
                days={days}
                dayStates={dayStates}
                teams={teams}
                committedProjectsBySection={committedProjectsBySection}
                dependencyCountByProjectId={dependencyCountByProjectId}
                closures={closures}
                pendingPlacement={pendingPlacement}
                dragActive={dragActive}
                todayDate={todayDate}
                focusedRange={focusedRange}
                selectedProjectIdSet={selectedProjectIdSet}
                onSelectProject={onSelectProject}
                onProjectPointerDown={onProjectPointerDown}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
});

function YearModeView({
  summaries,
  sectionRenderDataById,
  teams,
  closures,
  committedProjectsBySection,
  dependencyCountByProjectId,
  pendingPlacement,
  dragActive,
  todayDate,
  focusedRange,
  selectedProjectIdSet,
  scrollTargetSectionId,
  scrollRequestToken,
  scrollBehavior,
  onOpenYear,
  onSelectProject,
  onProjectPointerDown,
}: {
  summaries: ReturnType<typeof buildTimelineYearSummaries>;
  sectionRenderDataById: YearSectionRenderCache["dataBySectionId"];
  teams: Team[];
  closures: ClosurePeriod[];
  committedProjectsBySection: SectionTeamProjectMap;
  dependencyCountByProjectId: Map<string, number>;
  pendingPlacement: QuickPlacementState | null;
  dragActive: boolean;
  todayDate: string;
  focusedRange: CalendarFocusEvent;
  selectedProjectIdSet: ReadonlySet<string>;
  scrollTargetSectionId: string;
  scrollRequestToken: number;
  scrollBehavior: ScrollBehavior;
  onOpenYear: (year: number) => void;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  return (
    <Profiler id="YearModeView" onRender={handlePlannerProfilerRender}>
      <div className="space-y-8">
        {summaries.map((yearSummary) =>
          yearSummary.isActive ? (
            <VirtualizedYearSection
              key={yearSummary.year}
              yearSummary={yearSummary}
              sectionRenderDataById={sectionRenderDataById}
              teams={teams}
              closures={closures}
              committedProjectsBySection={committedProjectsBySection}
              dependencyCountByProjectId={dependencyCountByProjectId}
              pendingPlacement={pendingPlacement}
              dragActive={dragActive}
              todayDate={todayDate}
              focusedRange={focusedRange}
              selectedProjectIdSet={selectedProjectIdSet}
              scrollTargetSectionId={scrollTargetSectionId}
              scrollRequestToken={scrollRequestToken}
              scrollBehavior={scrollBehavior}
              onSelectProject={onSelectProject}
              onProjectPointerDown={onProjectPointerDown}
            />
          ) : (
            <FoldedYearCard
              key={yearSummary.year}
              summary={yearSummary}
              onOpen={() => onOpenYear(yearSummary.year)}
            />
          )
        )}
      </div>
    </Profiler>
  );
}

export function TimelineCanvas({
  projects,
  dependencies,
  customClosures,
  closures,
  pendingPlacement,
  selectedProjectIds,
  traceEnabled,
  activeDate,
  viewMode,
  teams,
  focusEvent,
  dragActive = false,
  onActiveDateChange,
  onViewModeChange,
  onTraceEnabledChange,
  onPendingPlacementChange,
  onQuickPlacementCommit,
  onSelectProject,
  onProjectPointerDown,
}: {
  projects: Project[];
  dependencies: ProjectDependency[];
  customClosures: CustomClosure[];
  closures: ClosurePeriod[];
  pendingPlacement: QuickPlacementState | null;
  selectedProjectIds: string[];
  traceEnabled: boolean;
  activeDate: string;
  viewMode: TimelineViewMode;
  teams: Team[];
  focusEvent: CalendarFocusEvent;
  dragActive?: boolean;
  onActiveDateChange: (date: string) => void;
  onViewModeChange: (viewMode: TimelineViewMode) => void;
  onTraceEnabledChange: (enabled: boolean) => void;
  onPendingPlacementChange: (placement: QuickPlacementState | null) => void;
  onQuickPlacementCommit: (projectId: string, placement: ProjectPlacement) => void;
  onSelectProject: (projectId: string, shiftKey: boolean) => void;
  onProjectPointerDown: (projectId: string, shiftKey: boolean) => void;
}) {
  const initialScrollDoneRef = useRef(false);
  const handledScrollRequestTokenRef = useRef<number | null>(null);
  const scrollRequestSequenceRef = useRef(0);
  const [isNavigating, startNavigationTransition] = useTransition();
  const timelineNow = useMemo(() => new Date(), []);
  const todayDate = useMemo(() => getTodayDateString(timelineNow), [timelineNow]);
  const [scrollRequest, setScrollRequest] = useState<TimelineScrollRequest | null>(null);

  useEffect(() => {
    if (!pendingPlacement) {
      return;
    }

    traceTimelineUi(traceEnabled, "quickPlacement.open", {
      projectId: pendingPlacement.projectId,
      triggerId: pendingPlacement.triggerId,
      teamId: pendingPlacement.placement.teamId,
      startSlot: pendingPlacement.placement.startSlot,
      durationHalfDays: pendingPlacement.placement.durationHalfDays,
    });
  }, [pendingPlacement, traceEnabled]);

  const emitActiveDateChange = useEffectEvent((date: string) => {
    onActiveDateChange(date);
  });
  const selectedProjectIdSet = useMemo(
    () => (selectedProjectIds.length ? new Set(selectedProjectIds) : EMPTY_STRING_SET),
    [selectedProjectIds]
  );
  const sortedTeams = useMemo(() => getSortedTeams(teams), [teams]);
  const scrollBehavior: ScrollBehavior =
    scrollRequest?.intent === "initial" ? "auto" : "smooth";
  const sections = useMemo(
    () => buildTimelineSections(projects, customClosures, timelineNow),
    [customClosures, projects, timelineNow]
  );
  const sectionRenderCacheKey = useMemo(
    () => buildYearSectionRenderCacheKey(sections, closures),
    [closures, sections]
  );
  /* eslint-disable react-hooks/exhaustive-deps */
  const sectionRenderCache = useMemo(
    () =>
      measurePlannerPerformance("timeline.monthRenderData", () =>
        resolveYearSectionRenderCache(null, sections, closures)
      ),
    [sectionRenderCacheKey]
  );
  /* eslint-enable react-hooks/exhaustive-deps */
  const sectionRenderDataById = sectionRenderCache.dataBySectionId;
  const committedScheduledProjects = useMemo(
    () => projects.filter(isScheduledProject),
    [projects]
  );
  const committedProjectsBySection = useMemo(
    () => buildSectionTeamProjectMap(committedScheduledProjects, closures),
    [closures, committedScheduledProjects]
  );
  const dependencyCountByProjectId = useMemo(
    () => buildDependencyCountByProjectId(dependencies),
    [dependencies]
  );
  const { years } = useMemo(
    () => buildTimelineYearRange(projects, customClosures, timelineNow),
    [customClosures, projects, timelineNow]
  );
  const summaries = useMemo(
    () =>
      buildTimelineYearSummaries({
        sections,
        projects,
        closures,
        activeDate,
        todayDate,
        focusDate: focusEvent?.startDate ?? null,
        viewMode,
      }),
    [activeDate, closures, focusEvent, projects, sections, todayDate, viewMode]
  );
  const activeYear = parseISO(activeDate).getFullYear();

  useEffect(() => {
    if (!sections.length || scrollRequest || initialScrollDoneRef.current) {
      return;
    }

    setScrollRequest({
      token: (scrollRequestSequenceRef.current += 1),
      intent: "initial",
      targetDate: activeDate,
    });
  }, [activeDate, sections.length, scrollRequest]);

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
    const nextDate = todaySection?.startDate ?? sections[0].startDate;

    startNavigationTransition(() => {
      emitActiveDateChange(nextDate);
      setScrollRequest({
        token: (scrollRequestSequenceRef.current += 1),
        intent: "range-clamp",
        targetDate: nextDate,
      });
    });
  }, [activeDate, sections, startNavigationTransition, todayDate]);

  useEffect(() => {
    if (!focusEvent) {
      return;
    }

    startNavigationTransition(() => {
      emitActiveDateChange(focusEvent.startDate);
      setScrollRequest({
        token: (scrollRequestSequenceRef.current += 1),
        intent: "focus",
        targetDate: focusEvent.startDate,
      });
    });
  }, [focusEvent, startNavigationTransition]);

  useEffect(() => {
    if (!sections.length) {
      return;
    }

    const pendingFocusDate =
      scrollRequest?.intent === "focus" ? scrollRequest.targetDate : null;
    const shouldScroll = shouldTriggerTimelineScroll({
      initialScrollDone: initialScrollDoneRef.current,
      intent: scrollRequest?.intent ?? null,
      pendingFocusDate,
    });

    if (!shouldScroll) {
      return;
    }

    if (
      scrollRequest &&
      handledScrollRequestTokenRef.current === scrollRequest.token
    ) {
      return;
    }

    if (viewMode === "month") {
      if (pendingFocusDate) {
        const focusYear = parseISO(pendingFocusDate).getFullYear();
        const didScrollToFocus =
          scrollToTimelineDate(pendingFocusDate, scrollBehavior) ||
          scrollToTimelineSection(getTimelineMonthId(pendingFocusDate), scrollBehavior) ||
          scrollToTimelineYear(focusYear, scrollBehavior);

        if (!didScrollToFocus && years[0]) {
          scrollToTimelineYear(years[0], scrollBehavior);
        }
      } else {
        const didScroll = scrollToTimelineSection(
          getTimelineMonthId(scrollRequest?.targetDate ?? activeDate),
          scrollBehavior
        );

        if (!didScroll && years[0]) {
          const scrolledToActiveYear = scrollToTimelineYear(activeYear, scrollBehavior);
          if (!scrolledToActiveYear) {
            scrollToTimelineYear(years[0], scrollBehavior);
          }
        }
      }
    }

    initialScrollDoneRef.current = true;
    if (scrollRequest) {
      handledScrollRequestTokenRef.current = scrollRequest.token;
    }
  }, [activeDate, activeYear, scrollBehavior, scrollRequest, sections, viewMode, years]);

  const navigate = (direction: -1 | 1) => {
    if (!sections.length || !years.length) {
      return;
    }

    let nextDate = activeDate;
    const intent: TimelineScrollIntent =
      direction < 0 ? "navigate-previous" : "navigate-next";

    if (viewMode === "month") {
      const shifted = shiftTimelineDate(activeDate, viewMode, direction);
      const shiftedMonthId = getTimelineMonthId(shifted);
      const targetSection = sections.find((section) => section.id === shiftedMonthId);
      nextDate = targetSection
        ? shifted
        : direction < 0
          ? sections[0].startDate
          : sections.at(-1)?.startDate ?? activeDate;
    } else {
      const shifted = shiftTimelineDate(activeDate, viewMode, direction);
      const shiftedYear = parseISO(shifted).getFullYear();
      nextDate = years.includes(shiftedYear)
        ? shifted
        : replaceYearInDate(activeDate, direction < 0 ? years[0] : years.at(-1)!);
    }

    startNavigationTransition(() => {
      onActiveDateChange(nextDate);
      setScrollRequest({
        token: (scrollRequestSequenceRef.current += 1),
        intent,
        targetDate: nextDate,
      });
    });
  };

  const jumpToYear = (year: number) => {
    const nextDate = replaceYearInDate(activeDate, year);

    startNavigationTransition(() => {
      onActiveDateChange(nextDate);
      setScrollRequest({
        token: (scrollRequestSequenceRef.current += 1),
        intent: "jump-to-year",
        targetDate: nextDate,
      });
    });
  };

  const jumpToToday = () => {
    startNavigationTransition(() => {
      onActiveDateChange(todayDate);
      setScrollRequest({
        token: (scrollRequestSequenceRef.current += 1),
        intent: "jump-to-today",
        targetDate: todayDate,
      });
    });
  };

  return (
    <Profiler id="TimelineCanvas" onRender={handlePlannerProfilerRender}>
      <Popover
        open={Boolean(pendingPlacement)}
        triggerId={pendingPlacement?.triggerId ?? null}
        onOpenChange={(open, details) => {
          if (!open) {
            traceTimelineUi(traceEnabled, "quickPlacement.close", {
              projectId: pendingPlacement?.projectId ?? null,
              triggerId: pendingPlacement?.triggerId ?? null,
              reason: details.reason,
            });
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
                        onViewModeChange(mode);
                        setScrollRequest({
                          token: (scrollRequestSequenceRef.current += 1),
                          intent: mode === "month" ? "open-month" : "open-year",
                          targetDate: activeDate,
                        });
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
              <Button size="sm" variant="outline" onClick={jumpToToday} disabled={isNavigating}>
                <CalendarDays className="size-4" />
                {fr.schedule.containsToday}
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
                sectionRenderDataById={sectionRenderDataById}
                committedProjectsBySection={committedProjectsBySection}
                dependencyCountByProjectId={dependencyCountByProjectId}
                closures={closures}
                pendingPlacement={pendingPlacement}
                dragActive={dragActive}
                todayDate={todayDate}
                focusedRange={focusEvent}
                selectedProjectIdSet={selectedProjectIdSet}
                teams={sortedTeams}
                onOpenMonth={(date) =>
                  startNavigationTransition(() => {
                    onActiveDateChange(date);
                    setScrollRequest({
                      token: (scrollRequestSequenceRef.current += 1),
                      intent: "open-month",
                      targetDate: date,
                    });
                  })
                }
                onOpenYear={(year) =>
                  startNavigationTransition(() => {
                    const nextDate = replaceYearInDate(activeDate, year);
                    onActiveDateChange(nextDate);
                    setScrollRequest({
                      token: (scrollRequestSequenceRef.current += 1),
                      intent: "open-year",
                      targetDate: nextDate,
                    });
                  })
                }
                onSelectProject={onSelectProject}
                onProjectPointerDown={onProjectPointerDown}
              />
            ) : (
              <YearModeView
                summaries={summaries}
                sectionRenderDataById={sectionRenderDataById}
                teams={sortedTeams}
                closures={closures}
                committedProjectsBySection={committedProjectsBySection}
                dependencyCountByProjectId={dependencyCountByProjectId}
                pendingPlacement={pendingPlacement}
                dragActive={dragActive}
                todayDate={todayDate}
                focusedRange={focusEvent}
                selectedProjectIdSet={selectedProjectIdSet}
                scrollTargetSectionId={getTimelineMonthId(
                  scrollRequest?.targetDate ?? activeDate
                )}
                scrollRequestToken={scrollRequest?.token ?? 0}
                scrollBehavior={scrollBehavior}
                onOpenYear={(year) =>
                  startNavigationTransition(() => {
                    const nextDate = replaceYearInDate(activeDate, year);
                    onActiveDateChange(nextDate);
                    setScrollRequest({
                      token: (scrollRequestSequenceRef.current += 1),
                      intent: "open-year",
                      targetDate: nextDate,
                    });
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
    </Profiler>
  );
}
