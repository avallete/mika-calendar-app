"use client";

import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Settings2, Sparkles } from "lucide-react";

import { DraftSidebar } from "@/components/planner/draft-sidebar";
import { MetricBar } from "@/components/planner/metric-bar";
import { usePlanner } from "@/components/planner/planner-provider";
import { ProjectEditorSheet } from "@/components/planner/project-editor-sheet";
import { TimelineCanvas } from "@/components/planner/timeline-canvas";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { fr } from "@/lib/i18n/fr";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  advanceWorkingDuration,
  compareSlotKeys,
  countWorkingHalfDays,
  countWorkingSlotDistance,
  isNonWorkingDate,
  makeSlotKey,
  nextCalendarSlot,
  normalizeToWorkingSlot,
  parseSlotKey,
  shiftWorkingSlot,
} from "@/lib/planner/calendar";
import {
  getClosureImpactLabelFr,
  getClosureTone,
  getClosureTypeLabelFr,
} from "@/lib/planner/day-markers";
import {
  buildFranceHolidayStripSummary,
  getNextCustomClosureOccurrence,
  resolveCustomClosureFocusTarget,
  shouldShowCustomClosureInStrip,
} from "@/lib/planner/calendar-strip";
import {
  detectDependencyConflicts,
  getEarlierShiftPrompt,
  getTouchingProjectChain,
  setSchedulerTraceEnabled,
  updateProjectPlacement,
  updateProjectPlacements,
} from "@/lib/planner/scheduler";
import { getTodayDateString } from "@/lib/planner/timeline-range";
import type {
  CalendarBucket,
  ClosurePeriod,
  CustomClosure,
  DependencyConflictPromptState,
  DragProjectMeta,
  EarlierShiftPromptState,
  Project,
  ProjectPlacementRequest,
  ProjectPlacement,
  QuickPlacementState,
  SlotKey,
  TeamId,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

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

function stringifyTracePayload(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
}

function tracePlannerUi(enabled: boolean, label: string, payload: unknown) {
  if (!enabled || typeof console === "undefined") {
    return;
  }

  console.log(`[planner ui trace] ${label} ${stringifyTracePayload(payload)}`);
}

function normalizePlacementRequest(
  request: ProjectPlacementRequest,
  closures: ClosurePeriod[]
): ProjectPlacementRequest {
  return {
    ...request,
    placement: {
      ...request.placement,
      startSlot: normalizeToWorkingSlot(request.placement.startSlot, closures),
      durationHalfDays: Math.max(1, request.placement.durationHalfDays),
    },
  };
}

function shiftPlacementRequests(
  placementRequests: ProjectPlacementRequest[],
  offsetHalfDays: number,
  closures: ClosurePeriod[]
) {
  if (offsetHalfDays === 0) {
    return placementRequests;
  }

  return placementRequests.map((request) => ({
    ...request,
    placement: {
      ...request.placement,
      startSlot: shiftWorkingSlot(request.placement.startSlot, offsetHalfDays, closures),
    },
  }));
}

function summarizePlacementBlock(
  placementRequests: ProjectPlacementRequest[],
  closures: ClosurePeriod[]
) {
  const orderedRequests = [...placementRequests].sort((left, right) =>
    compareSlotKeys(left.placement.startSlot, right.placement.startSlot)
  );
  const startSlot = orderedRequests[0]?.placement.startSlot;
  const readySlot = orderedRequests.reduce<SlotKey | null>((latest, request) => {
    const computed = advanceWorkingDuration(
      request.placement.startSlot,
      request.placement.durationHalfDays,
      closures
    );

    if (!latest || compareSlotKeys(computed.readySlot, latest) > 0) {
      return computed.readySlot;
    }

    return latest;
  }, null);

  if (!startSlot || !readySlot) {
    return null;
  }

  return {
    startSlot,
    readySlot,
    spanHalfDays: countWorkingSlotDistance(startSlot, readySlot, closures),
  };
}

function snapMovePlacementRequests(
  stateProjects: Project[],
  placementRequests: ProjectPlacementRequest[],
  selectedProjectIds: string[],
  teamId: TeamId,
  closures: ClosurePeriod[]
) {
  const block = summarizePlacementBlock(placementRequests, closures);
  if (!block) {
    return {
      placementRequests,
      snapTarget: null as null | {
        kind: "after" | "before";
        projectId: string;
        distanceHalfDays: number;
        targetStartSlot: SlotKey;
      },
    };
  }

  const selectedProjectIdSet = new Set(selectedProjectIds);
  const snapCandidates = stateProjects
    .filter(isScheduledProject)
    .filter(
      (project) =>
        project.scheduledTeam === teamId && !selectedProjectIdSet.has(project.id)
    )
    .flatMap((project) => {
      const readySlot = advanceWorkingDuration(
        project.scheduledStartSlot,
        project.scheduledDurationHalfDays,
        closures
      ).readySlot;

      return [
        {
          kind: "after" as const,
          projectId: project.id,
          targetStartSlot: readySlot,
          distanceHalfDays: Math.abs(
            countWorkingSlotDistance(block.startSlot, readySlot, closures)
          ),
        },
        {
          kind: "before" as const,
          projectId: project.id,
          targetStartSlot: shiftWorkingSlot(
            project.scheduledStartSlot,
            -block.spanHalfDays,
            closures
          ),
          distanceHalfDays: Math.abs(
            countWorkingSlotDistance(
              block.startSlot,
              shiftWorkingSlot(project.scheduledStartSlot, -block.spanHalfDays, closures),
              closures
            )
          ),
        },
      ];
    })
    .filter((candidate) => candidate.distanceHalfDays <= 2)
    .sort((left, right) => {
      if (left.distanceHalfDays !== right.distanceHalfDays) {
        return left.distanceHalfDays - right.distanceHalfDays;
      }

      return compareSlotKeys(left.targetStartSlot, right.targetStartSlot);
    });

  const snapTarget = snapCandidates[0] ?? null;
  if (!snapTarget) {
    return {
      placementRequests,
      snapTarget: null,
    };
  }

  return {
    placementRequests: shiftPlacementRequests(
      placementRequests,
      countWorkingSlotDistance(block.startSlot, snapTarget.targetStartSlot, closures),
      closures
    ),
    snapTarget,
  };
}

function arePlacementRequestsNoop(
  projects: Project[],
  placementRequests: ProjectPlacementRequest[],
  closures: ClosurePeriod[]
) {
  const projectsById = new Map(projects.map((project) => [project.id, project] as const));

  return placementRequests.every((request) => {
    const current = projectsById.get(request.projectId);
    if (!current || !isScheduledProject(current)) {
      return false;
    }

    const normalized = normalizePlacementRequest(request, closures);
    return (
      current.scheduledTeam === normalized.placement.teamId &&
      current.scheduledStartSlot === normalized.placement.startSlot &&
      current.scheduledDurationHalfDays === normalized.placement.durationHalfDays
    );
  });
}

function getDragLabel(activeDrag: DragProjectMeta | null) {
  if (!activeDrag) {
    return null;
  }

  if (activeDrag.type === "draft") {
    return activeDrag.title;
  }

  if (activeDrag.intent === "resize-start") {
    return `Debut : ${activeDrag.title}`;
  }

  if (activeDrag.intent === "resize-end") {
    return `Fin : ${activeDrag.title}`;
  }

  if (activeDrag.selectionProjectIds && activeDrag.selectionProjectIds.length > 1) {
    return `${activeDrag.title} + ${activeDrag.selectionProjectIds.length - 1} autres`;
  }

  return activeDrag.title;
}

function getClosureChipClasses(closure: ClosurePeriod) {
  const tone = getClosureTone(closure);

  switch (tone) {
    case "custom-blocking":
      return "border-red-200/70 bg-[linear-gradient(145deg,rgba(255,244,241,0.96),rgba(255,235,228,0.94))] hover:border-red-300/80 hover:shadow-[0_14px_28px_-24px_rgba(220,38,38,0.45)]";
    case "public-holiday":
      return "border-amber-200/70 bg-[linear-gradient(145deg,rgba(255,249,233,0.96),rgba(255,241,206,0.94))] hover:border-amber-300/80 hover:shadow-[0_14px_28px_-24px_rgba(217,119,6,0.45)]";
    case "advisory":
      return "border-sky-200/70 bg-[linear-gradient(145deg,rgba(240,250,255,0.96),rgba(226,244,255,0.94))] hover:border-sky-300/80 hover:shadow-[0_14px_28px_-24px_rgba(2,132,199,0.4)]";
    default:
      return "border-border/70 bg-card/95 hover:border-border";
  }
}

function renderClosureSourceLabel(closure: ClosurePeriod) {
  if (closure.source === "fr-public-holiday") {
    return fr.schedule.sourceFrance;
  }

  return closure.impact === "advisory" ? fr.schedule.sourceAdvisory : fr.schedule.sourceCustom;
}

function asDisplayClosure(closure: CustomClosure): ClosurePeriod {
  return {
    ...closure,
    source: "custom",
    editable: true,
  };
}

function getLatestAllowedResizeStartSlot(
  calendarEndSlot: SlotKey,
  closures: ClosurePeriod[]
) {
  return shiftWorkingSlot(calendarEndSlot, -1, closures);
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
    const requestedStart = normalizeToWorkingSlot(bucket.startSlot, closures);
    const startSlot =
      compareSlotKeys(requestedStart, latestAllowedStart) > 0
        ? latestAllowedStart
        : requestedStart;

    return {
      teamId: active.teamId,
      startSlot,
      durationHalfDays: Math.max(
        1,
        countWorkingHalfDays(startSlot, active.calendarEndSlot, closures)
      ),
    };
  }

  const { date } = parseSlotKey(bucket.startSlot);
  const endSlotExclusive = isNonWorkingDate(date, closures)
    ? nextCalendarSlot(shiftWorkingSlot(makeSlotKey(date, "AM"), -1, closures))
    : nextCalendarSlot(bucket.startSlot);

  return {
    teamId: active.teamId,
    startSlot: active.startSlot,
    durationHalfDays: Math.max(
      1,
      countWorkingHalfDays(active.startSlot, endSlotExclusive, closures)
    ),
  };
}

function buildMovePlacementRequests(
  active: Extract<DragProjectMeta, { type: "scheduled" }>,
  bucket: CalendarBucket,
  projects: Project[],
  closures: ClosurePeriod[]
) {
  const selectionProjectIds =
    active.selectionProjectIds && active.selectionProjectIds.length
      ? active.selectionProjectIds
      : [active.projectId];

  if (selectionProjectIds.length > 1 && bucket.teamId !== active.teamId) {
    return null;
  }

  const rawRequests = selectionProjectIds
    .map((projectId) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project || !isScheduledProject(project)) {
        return null;
      }

      const relativeOffset = countWorkingSlotDistance(
        active.startSlot,
        project.scheduledStartSlot,
        closures
      );

      return {
        projectId,
        placement: {
          teamId: bucket.teamId,
          startSlot: shiftWorkingSlot(bucket.startSlot, relativeOffset, closures),
          durationHalfDays: project.scheduledDurationHalfDays,
        },
      } satisfies ProjectPlacementRequest;
    })
    .filter(Boolean) as ProjectPlacementRequest[];

  const normalizedRequests = rawRequests.map((request) =>
    normalizePlacementRequest(request, closures)
  );
  const snapped =
    bucket.teamId === active.teamId
      ? snapMovePlacementRequests(
          projects,
          normalizedRequests,
          selectionProjectIds,
          bucket.teamId,
          closures
        )
      : { placementRequests: normalizedRequests, snapTarget: null };

  return {
    projectIds: selectionProjectIds,
    rawRequests,
    normalizedRequests,
    snappedRequests: snapped.placementRequests,
    snapTarget: snapped.snapTarget,
  };
}

function summarizePreviewChanges(currentProjects: Project[], previewProjects: Project[]) {
  const currentById = new Map(currentProjects.map((project) => [project.id, project] as const));

  return previewProjects
    .filter(isScheduledProject)
    .filter((project) => {
      const current = currentById.get(project.id);
      if (!current || !isScheduledProject(current)) {
        return true;
      }

      return (
        current.scheduledTeam !== project.scheduledTeam ||
        current.scheduledStartSlot !== project.scheduledStartSlot ||
        current.scheduledDurationHalfDays !== project.scheduledDurationHalfDays ||
        current.sequenceOrder !== project.sequenceOrder
      );
    })
    .map((project) => project.id);
}

export function ScheduleWorkbench() {
  const {
    state,
    metrics,
    placeProject,
    placeProjects,
    unscheduleProject,
    deleteProject,
  } = usePlanner();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [pendingPlacement, setPendingPlacement] = useState<QuickPlacementState | null>(null);
  const [pendingEarlierShift, setPendingEarlierShift] =
    useState<EarlierShiftPromptState | null>(null);
  const [pendingDependencyConflict, setPendingDependencyConflict] =
    useState<DependencyConflictPromptState | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragProjectMeta | null>(null);
  const [hoveredBucketId, setHoveredBucketId] = useState<string | null>(null);
  const [hoveredBucket, setHoveredBucket] = useState<CalendarBucket | null>(null);
  const [isHolidayListExpanded, setHolidayListExpanded] = useState(false);
  const [timelineActiveDate, setTimelineActiveDate] = useState<string>(() =>
    getTodayDateString()
  );
  const [calendarFocus, setCalendarFocus] = useState<{
    id: string;
    startDate: string;
    endDate: string;
  } | null>(null);
  const handledDragIdRef = useRef<string | null>(null);
  const traceEnabled = useSyncExternalStore(
    subscribeToTracePreference,
    getTracePreferenceSnapshot,
    () => false
  );
  const deferredHoveredBucket = useDeferredValue(hoveredBucket);
  const todayDate = useMemo(() => getTodayDateString(), []);
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
  const franceHolidayStripSummary = useMemo(
    () =>
      buildFranceHolidayStripSummary({
        holidaySources: state.holidaySources,
        closures: state.closures,
        todayDate,
      }),
    [state.closures, state.holidaySources, todayDate]
  );
  const holidayListExpanded = Boolean(
    franceHolidayStripSummary && isHolidayListExpanded
  );
  const visibleCustomClosures = useMemo(
    () =>
      state.customClosures.filter((closure) =>
        shouldShowCustomClosureInStrip({
          closure,
          closures: state.closures,
          todayDate,
        })
      ),
    [state.closures, state.customClosures, todayDate]
  );
  const previewState = useMemo(() => {
    if (!activeDrag || !deferredHoveredBucket) {
      return null;
    }

    if (activeDrag.type === "draft") {
      const preview = updateProjectPlacement(state, activeDrag.projectId, {
        teamId: deferredHoveredBucket.teamId,
        startSlot: deferredHoveredBucket.startSlot,
        durationHalfDays: activeDrag.durationHalfDays,
      });

      return {
        projects: preview.projects,
        changedProjectIds: summarizePreviewChanges(state.projects, preview.projects),
        primaryProjectId: activeDrag.projectId,
      };
    }

    const activeSelectionProjectIds =
      activeDrag.intent === "move" && selectedProjectIds.includes(activeDrag.projectId)
        ? selectedProjectIds
        : [activeDrag.projectId];
    const activeWithSelection =
      activeDrag.intent === "move"
        ? {
            ...activeDrag,
            selectionProjectIds: activeSelectionProjectIds,
          }
        : activeDrag;

    if (activeDrag.intent === "move") {
      const movePlan = buildMovePlacementRequests(
        activeWithSelection,
        deferredHoveredBucket,
        state.projects,
        state.closures
      );

      if (!movePlan || !movePlan.snappedRequests.length) {
        return null;
      }

      const preview = updateProjectPlacements(state, movePlan.snappedRequests, {
        source: "preview",
        dependencyResolution: "preserve-dependencies",
      });

      return {
        projects: preview.projects,
        changedProjectIds: summarizePreviewChanges(state.projects, preview.projects),
        primaryProjectId: activeDrag.projectId,
      };
    }

    const nextPlacement = buildScheduledPlacement(
      activeWithSelection,
      deferredHoveredBucket,
      state.closures
    );
    if (!nextPlacement) {
      return null;
    }

    const preview = updateProjectPlacement(state, activeDrag.projectId, nextPlacement, {
      source: "preview",
      dependencyResolution: "preserve-dependencies",
    });

    return {
      projects: preview.projects,
      changedProjectIds: summarizePreviewChanges(state.projects, preview.projects),
      primaryProjectId: activeDrag.projectId,
    };
  }, [activeDrag, deferredHoveredBucket, selectedProjectIds, state]);

  useEffect(() => {
    setSchedulerTraceEnabled(traceEnabled);
  }, [traceEnabled]);

  useEffect(() => {
    if (!calendarFocus) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCalendarFocus((current) => (current?.id === calendarFocus.id ? null : current));
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [calendarFocus]);

  const updateTraceEnabled = (enabled: boolean) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(TRACE_STORAGE_KEY, String(enabled));
    window.dispatchEvent(new Event(TRACE_STORAGE_EVENT));
  };

  const setTouchingSelection = (projectId: string) => {
    const chainProjectIds = getTouchingProjectChain(state, projectId);
    setSelectedProjectIds(chainProjectIds);
    setSelectedProjectId(null);
    setPendingPlacement(null);

    tracePlannerUi(traceEnabled, "selection.chain", {
      projectId,
      selectedProjectIds: chainProjectIds,
    });
  };

  const commitPlacementRequests = (
    placementRequests: ProjectPlacementRequest[],
    options?: Parameters<typeof placeProjects>[1]
  ) => {
    if (placementRequests.length === 1) {
      placeProject(
        placementRequests[0].projectId,
        placementRequests[0].placement,
        options
      );
      return;
    }

    placeProjects(placementRequests, options);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragProjectMeta | undefined;
    handledDragIdRef.current = null;
    setHoveredBucket(null);
    setHoveredBucketId(null);

    if (
      data?.type === "scheduled" &&
      data.intent === "move" &&
      selectedProjectIds.includes(data.projectId)
    ) {
      setActiveDrag({
        ...data,
        selectionProjectIds: selectedProjectIds,
      });
      return;
    }

    setActiveDrag(data ?? null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const bucket = (event.over?.data.current as CalendarBucket | undefined) ?? null;
    setHoveredBucket(bucket);
    setHoveredBucketId(bucket?.bucketId ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current as DragProjectMeta | undefined;
    const bucket = event.over?.data.current as CalendarBucket | undefined;
    const dragId = String(event.active.id);

    setActiveDrag(null);
    setHoveredBucket(null);
    setHoveredBucketId(null);

    if (handledDragIdRef.current === dragId) {
      tracePlannerUi(traceEnabled, "dragEnd.ignoredDuplicate", {
        dragId,
      });
      return;
    }

    handledDragIdRef.current = dragId;

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

    const activeSelectionProjectIds =
      active.intent === "move" && selectedProjectIds.includes(active.projectId)
        ? selectedProjectIds
        : [active.projectId];
    const activeWithSelection =
      active.intent === "move"
        ? {
            ...active,
            selectionProjectIds: activeSelectionProjectIds,
          }
        : active;

    if (active.intent === "move") {
      const movePlan = buildMovePlacementRequests(
        activeWithSelection,
        bucket,
        state.projects,
        state.closures
      );

      if (!movePlan || !movePlan.snappedRequests.length) {
        return;
      }

      if (arePlacementRequestsNoop(state.projects, movePlan.snappedRequests, state.closures)) {
        tracePlannerUi(traceEnabled, "dragEnd.ignoredNoop", {
          dragId,
          projectIds: movePlan.projectIds,
          normalizedPlacements: movePlan.normalizedRequests,
          snappedPlacements: movePlan.snappedRequests,
        });
        return;
      }

      const conflicts = detectDependencyConflicts(state, movePlan.snappedRequests);
      const traceMetadata = {
        selectedProjectIds: movePlan.projectIds,
        rawPlacements: movePlan.rawRequests,
        normalizedPlacements: movePlan.normalizedRequests,
        snappedPlacements: movePlan.snappedRequests,
        snapTarget: movePlan.snapTarget,
        conflictingDependencies: conflicts,
      };

      if (conflicts.length) {
        tracePlannerUi(traceEnabled, "dependencyConflict.prompt", traceMetadata);
        setPendingDependencyConflict({
          projectIds: movePlan.projectIds,
          placements: movePlan.snappedRequests,
          primaryProjectId: active.projectId,
          primaryTitle: active.title,
          conflicts,
          source: `drag-${active.intent}`,
          traceMetadata,
        });
        return;
      }

      const earliestShiftPrompt =
        movePlan.projectIds.length === 1
          ? getEarlierShiftPrompt(
              state,
              active.projectId,
              movePlan.snappedRequests[0].placement,
              "move"
            )
          : null;

      if (earliestShiftPrompt) {
        setPendingEarlierShift(earliestShiftPrompt);
        return;
      }

      commitPlacementRequests(movePlan.snappedRequests, {
        source: "drag-move",
        dependencyResolution: "preserve-dependencies",
        traceMetadata,
      });
      setPendingPlacement(null);
      return;
    }

    const nextPlacement = buildScheduledPlacement(activeWithSelection, bucket, state.closures);
    if (!nextPlacement) {
      return;
    }

    const normalizedPlacementRequest = normalizePlacementRequest(
      {
        projectId: active.projectId,
        placement: nextPlacement,
      },
      state.closures
    );

    if (arePlacementRequestsNoop(state.projects, [normalizedPlacementRequest], state.closures)) {
      tracePlannerUi(traceEnabled, "dragEnd.ignoredNoop", {
        dragId,
        projectIds: [active.projectId],
        normalizedPlacements: [normalizedPlacementRequest],
      });
      return;
    }

    const conflicts = detectDependencyConflicts(state, [normalizedPlacementRequest]);
    const traceMetadata = {
      selectedProjectIds: [active.projectId],
      rawPlacements: [
        {
          projectId: active.projectId,
          placement: nextPlacement,
        },
      ],
      normalizedPlacements: [normalizedPlacementRequest],
      snappedPlacements: [normalizedPlacementRequest],
      conflictingDependencies: conflicts,
    };

    if (conflicts.length) {
      tracePlannerUi(traceEnabled, "dependencyConflict.prompt", traceMetadata);
      setPendingDependencyConflict({
        projectIds: [active.projectId],
        placements: [normalizedPlacementRequest],
        primaryProjectId: active.projectId,
        primaryTitle: active.title,
        conflicts,
        source: `drag-${active.intent}`,
        traceMetadata,
      });
      return;
    }

    if (active.intent === "resize-start") {
      const prompt = getEarlierShiftPrompt(
        state,
        active.projectId,
        normalizedPlacementRequest.placement,
        active.intent
      );

      if (prompt) {
        setPendingEarlierShift(prompt);
        return;
      }
    }

    placeProject(active.projectId, normalizedPlacementRequest.placement, {
      source: `drag-${active.intent}`,
      dependencyResolution: "preserve-dependencies",
      traceMetadata,
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
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          handledDragIdRef.current = null;
          setActiveDrag(null);
          setHoveredBucket(null);
          setHoveredBucketId(null);
        }}
      >
        <DraftSidebar
          drafts={drafts}
          dependencies={state.dependencies}
          teams={state.teams}
        />

        <SidebarInset className="bg-transparent">
          <div className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <SidebarTrigger className="md:hidden" />
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    {fr.schedule.eyebrow}
                  </p>
                </div>
                <h2 className="font-heading text-3xl font-semibold text-foreground">
                  {fr.schedule.title}
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {fr.schedule.description}
                </p>
              </div>

              <Card className="border-border/60 bg-[linear-gradient(145deg,rgba(255,255,255,0.88),rgba(242,236,228,0.92))] shadow-[0_20px_44px_-30px_rgba(21,28,45,0.55)] xl:max-w-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="size-4 text-[oklch(0.68_0.13_55)]" />
                    {fr.schedule.liveCardTitle}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {fr.schedule.liveCardBody}
                  </p>
                </CardContent>
              </Card>
            </div>

            <MetricBar metrics={metrics} />

            <div className="flex flex-col gap-4 rounded-[28px] border border-border/60 bg-card/80 p-4 shadow-[0_24px_50px_-42px_rgba(18,25,38,0.55)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    {fr.schedule.calendarEyebrow}
                  </p>
                  <h3 className="mt-1 font-heading text-xl font-semibold text-foreground">
                    {fr.schedule.calendarTitle}
                  </h3>
                </div>
                <Link
                  href="/settings"
                  className={buttonVariants({ variant: "default", size: "default" })}
                >
                  <Settings2 className="size-4" />
                  {fr.schedule.manageCalendar}
                </Link>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  {franceHolidayStripSummary ? (
                    <div
                      className={cn(
                        "flex min-w-[220px] flex-1 flex-col items-start gap-3 rounded-2xl border px-4 py-3",
                        getClosureChipClasses({
                          id: "france-holidays-summary",
                          title: franceHolidayStripSummary.labelFr,
                          type: "holiday",
                          startDate: `${franceHolidayStripSummary.startYear ?? Number(timelineActiveDate.slice(0, 4))}-01-01`,
                          endDate: `${franceHolidayStripSummary.endYear ?? Number(timelineActiveDate.slice(0, 4))}-12-31`,
                          impact: "blocking",
                          source: "fr-public-holiday",
                          editable: false,
                        })
                      )}
                    >
                      <div className="flex w-full flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">
                              {franceHolidayStripSummary.labelFr}
                            </span>
                            <Badge variant="secondary" className="rounded-full">
                              {fr.schedule.generatedSource}
                            </Badge>
                            <Badge variant="outline" className="rounded-full">
                              {fr.schedule.enabled}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span className="rounded-full bg-background/75 px-2 py-1 uppercase tracking-[0.14em]">
                              {fr.schedule.sourceFrance}
                            </span>
                            <span>
                              {franceHolidayStripSummary.closureCount}{" "}
                              {fr.schedule.generatedHolidayCount}
                            </span>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={() =>
                            setHolidayListExpanded((current) => !current)
                          }
                        >
                          {holidayListExpanded ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                          {holidayListExpanded
                            ? fr.schedule.hideUpcomingHolidays
                            : fr.schedule.showUpcomingHolidays}
                        </Button>
                      </div>

                      {franceHolidayStripSummary.startYear !== null &&
                      franceHolidayStripSummary.endYear !== null ? (
                        <p className="text-sm leading-5 text-muted-foreground">
                          {fr.schedule.visibleYears}: {franceHolidayStripSummary.startYear} {"->"}{" "}
                          {franceHolidayStripSummary.endYear}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {visibleCustomClosures.map((closure) => {
                    const displayClosure = asDisplayClosure(closure);
                    const nextOccurrence = closure.repeatsAnnually
                      ? getNextCustomClosureOccurrence({
                          closure,
                          closures: state.closures,
                          todayDate,
                        })
                      : null;
                    const isFocused =
                      calendarFocus?.id === closure.id ||
                      calendarFocus?.id?.startsWith(`${closure.id}::`) === true;

                    return (
                      <button
                        key={closure.id}
                        type="button"
                        className={cn(
                          "group flex min-w-[220px] flex-1 flex-col items-start gap-2 rounded-2xl border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5",
                          getClosureChipClasses(displayClosure),
                          isFocused && "ring-2 ring-primary/40"
                        )}
                        onClick={() => {
                          const focusTarget = resolveCustomClosureFocusTarget({
                            closure,
                            closures: state.closures,
                            activeDate: timelineActiveDate,
                            todayDate,
                          });
                          if (focusTarget) {
                            setCalendarFocus(focusTarget);
                          }
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{closure.title}</span>
                          <Badge variant="secondary" className="rounded-full">
                            {getClosureTypeLabelFr(closure.type)}
                          </Badge>
                          <Badge
                            variant={closure.impact === "blocking" ? "default" : "outline"}
                            className="rounded-full"
                          >
                            {getClosureImpactLabelFr(closure.impact)}
                          </Badge>
                          {closure.repeatsAnnually ? (
                            <Badge variant="outline" className="rounded-full">
                              {fr.schedule.repeatsAnnually}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full bg-background/75 px-2 py-1 uppercase tracking-[0.14em]">
                            {renderClosureSourceLabel(displayClosure)}
                          </span>
                          <span>
                            {closure.startDate} {"->"} {closure.endDate}
                          </span>
                        </div>
                        {nextOccurrence ? (
                          <p className="text-sm leading-5 text-muted-foreground">
                            {fr.schedule.nextOccurrence}: {nextOccurrence.startDate} {"->"}{" "}
                            {nextOccurrence.endDate}
                          </p>
                        ) : null}
                        {closure.repeatsAnnually ? (
                          <p className="text-sm leading-5 text-muted-foreground">
                            {fr.schedule.recurringFocusHint}
                          </p>
                        ) : null}
                        {closure.details ? (
                          <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                            {closure.details}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {franceHolidayStripSummary && holidayListExpanded ? (
                  <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">
                        {fr.schedule.upcomingHolidays}
                      </p>
                      <Badge variant="outline" className="rounded-full">
                        {franceHolidayStripSummary.closureCount}{" "}
                        {fr.schedule.generatedHolidayCount}
                      </Badge>
                    </div>

                    <div className="mt-4 space-y-4">
                      {franceHolidayStripSummary.upcomingYearGroups.length ? (
                        franceHolidayStripSummary.upcomingYearGroups.map((group) => (
                          <div key={group.year} className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              {group.year}
                            </p>
                            <div className="space-y-2">
                              {group.items.map((holiday) => (
                                <button
                                  key={holiday.id}
                                  type="button"
                                  className={cn(
                                    "flex w-full items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/85 px-4 py-3 text-left transition-colors hover:border-primary/40",
                                    calendarFocus?.id === holiday.id &&
                                      "ring-2 ring-primary/35"
                                  )}
                                  onClick={() =>
                                    setCalendarFocus({
                                      id: holiday.id,
                                      startDate: holiday.startDate,
                                      endDate: holiday.endDate,
                                    })
                                  }
                                >
                                  <div>
                                    <p className="font-medium text-foreground">
                                      {holiday.title}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {holiday.startDate} {"->"} {holiday.endDate}
                                    </p>
                                  </div>
                                  <Badge variant="secondary" className="rounded-full">
                                    {getClosureTypeLabelFr(holiday.type)}
                                  </Badge>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {fr.schedule.noUpcomingHolidays}
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <TimelineCanvas
              projects={state.projects}
              previewProjects={previewState?.projects ?? null}
              previewChangedProjectIds={previewState?.changedProjectIds ?? []}
              previewPrimaryProjectId={previewState?.primaryProjectId ?? null}
              hoveredBucketId={hoveredBucketId}
              dependencies={state.dependencies}
              customClosures={state.customClosures}
              closures={state.closures}
              pendingPlacement={pendingPlacement}
              selectedProjectIds={selectedProjectIds}
              traceEnabled={traceEnabled}
              teams={state.teams}
              focusEvent={calendarFocus}
              onActiveDateChange={setTimelineActiveDate}
              onTraceEnabledChange={updateTraceEnabled}
              onPendingPlacementChange={setPendingPlacement}
              onQuickPlacementCommit={(projectId, placement) => {
                placeProject(projectId, placement, {
                  source: "draft-drop",
                });
                setPendingPlacement(null);
              }}
              onProjectPointerDown={(projectId, shiftKey) => {
                if (shiftKey) {
                  setTouchingSelection(projectId);
                  return;
                }

                if (!selectedProjectIds.includes(projectId)) {
                  setSelectedProjectIds([]);
                }
              }}
              onSelectProject={(projectId, shiftKey) => {
                if (shiftKey) {
                  setTouchingSelection(projectId);
                  return;
                }

                setSelectedProjectIds([]);
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
                setSelectedProjectIds([]);
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
        </SidebarInset>

        <DragOverlay>
          {activeDrag ? (
            <div className="rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-2xl backdrop-blur">
              <p className="text-sm font-semibold text-foreground">{getDragLabel(activeDrag)}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="rounded-full">
                  {(activeDrag.durationHalfDays ?? 1) / 2} j
                </Badge>
                {activeDrag.type === "scheduled" ? (
                  <Badge variant="outline" className="rounded-full">
                    {activeDrag.startSlot}
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog
        open={Boolean(pendingDependencyConflict)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDependencyConflict(null);
          }
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{fr.schedule.dependencyConflictTitle}</DialogTitle>
            <DialogDescription>
              {pendingDependencyConflict
                ? `${pendingDependencyConflict.primaryTitle} entre en conflit avec les dependances actuelles. Vous pouvez conserver les liens et laisser le moteur recalculer, ou casser uniquement les liens en conflit pour garder ce placement exact.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {pendingDependencyConflict ? (
            <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/35 p-3">
              {pendingDependencyConflict.conflicts.map((conflict) => (
                <div key={conflict.id} className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {conflict.predecessorTitle}
                  </span>
                  {" -> "}
                  <span className="font-medium text-foreground">
                    {conflict.successorTitle}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                if (!pendingDependencyConflict) {
                  return;
                }

                commitPlacementRequests(pendingDependencyConflict.placements, {
                  source: `${pendingDependencyConflict.source}-keep-dependencies`,
                  dependencyResolution: "preserve-dependencies",
                  traceMetadata: {
                    ...pendingDependencyConflict.traceMetadata,
                    promptDecision: "preserve-dependencies",
                  },
                });
                setPendingDependencyConflict(null);
              }}
            >
              {fr.schedule.keepDependencies}
            </Button>
            <Button
              onClick={() => {
                if (!pendingDependencyConflict) {
                  return;
                }

                commitPlacementRequests(pendingDependencyConflict.placements, {
                  source: `${pendingDependencyConflict.source}-break-dependencies`,
                  dependencyResolution: "break-conflicting-links",
                  removeDependencyIds: pendingDependencyConflict.conflicts.map(
                    (conflict) => conflict.id
                  ),
                  traceMetadata: {
                    ...pendingDependencyConflict.traceMetadata,
                    promptDecision: "break-conflicting-links",
                    brokenDependencyIds: pendingDependencyConflict.conflicts.map(
                      (conflict) => conflict.id
                    ),
                  },
                });
                setPendingDependencyConflict(null);
              }}
            >
              {fr.schedule.breakDependencies}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <DialogTitle>{fr.schedule.earlierShiftTitle}</DialogTitle>
            <DialogDescription>
              {pendingEarlierShift
                ? `${pendingEarlierShift.title} est avance sur ${
                    state.teams.find((team) => team.id === pendingEarlierShift.placement.teamId)
                      ?.nameFr ?? "l'equipe"
                  }. L'intervalle entre ${pendingEarlierShift.previousStartSlot.slice(0, 10)} et la nouvelle date est libre, donc le reste de la file peut aussi etre compacte.`
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
              {fr.schedule.keepOnlyThisProject}
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
              {fr.schedule.pullSameTeamEarlier}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
