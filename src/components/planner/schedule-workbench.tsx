"use client";

import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { fr as localeFr } from "date-fns/locale";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragMoveEvent,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useRef, useState } from "react";
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
  normalizeToWorkingSlot,
  parseSlotKey,
} from "@/lib/planner/calendar";
import {
  getClosureImpactLabelFr,
  getClosureTone,
  getClosureTypeLabelFr,
} from "@/lib/planner/day-markers";
import {
  arePlacementRequestsNoop,
  buildMovePlacementRequests,
  buildScheduledPlacement,
  normalizePlacementRequest,
} from "@/lib/planner/drag-placements";
import {
  extractPlannerHoveredBucket,
  resolvePlannerDraftDropBucket,
  shouldEnablePlannerDragAutoScroll,
  type PlannerPointerCoordinates,
} from "@/lib/planner/drag-session";
import { buildCalendarBucketFromRowSurfacePointer } from "@/lib/planner/timeline-hover";
import { buildTimelinePreviewDelta } from "@/lib/planner/timeline-preview";
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
  QuickPlacementState,
  SlotKey,
} from "@/lib/planner/types";
import {
  isCalendarBucket,
  isCalendarRowSurface,
  isScheduledProject,
} from "@/lib/planner/types";
import {
  arePlannerViewportPreferencesEqual,
  readPlannerViewportPreferencesFromLocalStorage,
  type PlannerViewportPreferences,
  writePlannerViewportPreferences,
} from "@/lib/planner/viewport-preferences";
import { cn } from "@/lib/utils";

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

function getClosureChipSpanClasses(closure: ClosurePeriod) {
  const spanDays =
    differenceInCalendarDays(parseISO(closure.endDate), parseISO(closure.startDate)) + 1;

  if (spanDays >= 7) {
    return "md:col-span-2 xl:col-span-4";
  }

  if (spanDays >= 4) {
    return "md:col-span-2 xl:col-span-3";
  }

  if (spanDays >= 2) {
    return "xl:col-span-2";
  }

  return "";
}

function formatPlannerDate(date: string) {
  return format(parseISO(date), "EEE d MMM", { locale: localeFr });
}

function formatPlannerSlot(slotKey: SlotKey) {
  const { date, part } = parseSlotKey(slotKey);
  return `${formatPlannerDate(date)} ${part}`;
}

function buildDependencyConflictDescription(
  state: ReturnType<typeof usePlanner>["state"],
  prompt: DependencyConflictPromptState | null
) {
  if (!prompt) {
    return "";
  }

  const teamLabel =
    prompt.placements.length === 1
      ? state.teams.find((team) => team.id === prompt.placements[0].placement.teamId)?.nameFr
      : null;

  return `${prompt.primaryTitle} touche ${prompt.conflicts.length} dependance${
    prompt.conflicts.length > 1 ? "s" : ""
  }${teamLabel ? ` sur ${teamLabel}` : ""}. Choisissez entre recalculer avec les liens ou garder ce placement exact.`;
}

function buildEarlierShiftDescription(
  state: ReturnType<typeof usePlanner>["state"],
  prompt: EarlierShiftPromptState | null
) {
  if (!prompt) {
    return "";
  }

  const teamName =
    state.teams.find((team) => team.id === prompt.placement.teamId)?.nameFr ?? "l'equipe";

  return `${prompt.title} peut avancer sur ${teamName}. Position actuelle : ${formatPlannerSlot(
    prompt.previousStartSlot
  )}. Nouvelle position : ${formatPlannerSlot(prompt.placement.startSlot)}.`;
}

function asDisplayClosure(closure: CustomClosure): ClosurePeriod {
  return {
    ...closure,
    source: "custom",
    editable: true,
  };
}

export function ScheduleWorkbench({
  initialViewportPreferences,
}: {
  initialViewportPreferences: PlannerViewportPreferences;
}) {
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
  const [hoveredBucket, setHoveredBucket] = useState<CalendarBucket | null>(null);
  const [viewportPreferences, setViewportPreferences] =
    useState<PlannerViewportPreferences>(() =>
      readPlannerViewportPreferencesFromLocalStorage(initialViewportPreferences)
    );
  const timelineActiveDate = viewportPreferences.activeDate;
  const traceEnabled = viewportPreferences.traceEnabled;
  const [calendarFocus, setCalendarFocus] = useState<{
    id: string;
    startDate: string;
    endDate: string;
  } | null>(null);
  const handledDragIdRef = useRef<string | null>(null);
  const hoveredBucketIdRef = useRef<string | null>(null);
  const hoveredBucketRef = useRef<CalendarBucket | null>(null);
  const lastValidTimelineBucketRef = useRef<CalendarBucket | null>(null);
  const lastPointerCoordinatesRef = useRef<PlannerPointerCoordinates | null>(null);
  const dragSessionRef = useRef<{ dragId: string; startedAt: number } | null>(null);
  const previewTraceRef = useRef<{ bucketId: string | null; startedAt: number } | null>(null);
  const todayDate = useMemo(() => getTodayDateString(), []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const previewState = useMemo(() => {
    if (!activeDrag || !hoveredBucket) {
      return null;
    }

    const toPreviewState = (previewProjects: Project[], primaryProjectId: string) => {
      const previewDelta = buildTimelinePreviewDelta({
        currentProjects: state.projects,
        previewProjects,
        closures: state.closures,
        primaryProjectId,
      });

      return {
        previewDelta,
        traceSummary: {
          dragType: activeDrag.type,
          intent: activeDrag.type === "draft" ? "draft" : activeDrag.intent,
          hoveredBucketId: hoveredBucket.bucketId,
          hoveredStartSlot: hoveredBucket.startSlot,
          normalizedStartSlot: normalizeToWorkingSlot(
            hoveredBucket.startSlot,
            state.closures
          ),
          containsPrimaryProjectPreview: previewDelta.changedProjectIds.includes(
            primaryProjectId
          ),
        },
      };
    };

    if (activeDrag.type === "draft") {
      const preview = updateProjectPlacement(
        state,
        activeDrag.projectId,
        {
          teamId: hoveredBucket.teamId,
          startSlot: hoveredBucket.startSlot,
          durationHalfDays: activeDrag.durationHalfDays,
        },
        {
          source: "preview",
          dependencyResolution: "preserve-dependencies",
        }
      );

      return toPreviewState(preview.projects, activeDrag.projectId);
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
        hoveredBucket,
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

      return toPreviewState(preview.projects, activeDrag.projectId);
    }

    const nextPlacement = buildScheduledPlacement(
      activeWithSelection,
      hoveredBucket,
      state.closures
    );
    if (!nextPlacement) {
      return null;
    }

    const preview = updateProjectPlacement(state, activeDrag.projectId, nextPlacement, {
      source: "preview",
      dependencyResolution: "preserve-dependencies",
    });

    return toPreviewState(preview.projects, activeDrag.projectId);
  }, [activeDrag, hoveredBucket, selectedProjectIds, state]);

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
    franceHolidayStripSummary && viewportPreferences.holidayListExpanded
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

  useEffect(() => {
    writePlannerViewportPreferences(viewportPreferences);
  }, [viewportPreferences]);

  useEffect(() => {
    setSchedulerTraceEnabled(traceEnabled);
  }, [traceEnabled]);

  useEffect(() => {
    if (!traceEnabled || !activeDrag) {
      return;
    }

    if (!hoveredBucket) {
      tracePlannerUi(traceEnabled, "preview.skip", {
        reason: "no-hovered-bucket",
        dragType: activeDrag.type,
        intent: activeDrag.type === "draft" ? "draft" : activeDrag.intent,
      });
      return;
    }

    if (!previewState) {
      tracePlannerUi(traceEnabled, "preview.skip", {
        reason: "no-preview-state",
        dragType: activeDrag.type,
        intent: activeDrag.type === "draft" ? "draft" : activeDrag.intent,
        hoveredBucketId: hoveredBucket.bucketId,
        hoveredStartSlot: hoveredBucket.startSlot,
      });
      return;
    }

    tracePlannerUi(traceEnabled, "preview.compute", {
      ...previewState.traceSummary,
      durationMs:
        previewTraceRef.current &&
        previewTraceRef.current.bucketId === hoveredBucket.bucketId &&
        typeof performance !== "undefined"
          ? performance.now() - previewTraceRef.current.startedAt
          : null,
      changedProjectCount: previewState.previewDelta.changedProjectIds.length,
      touchedSectionCount: previewState.previewDelta.touchedSectionIds.length,
      touchedTeamCount: previewState.previewDelta.touchedTeamIds.length,
    });
  }, [activeDrag, hoveredBucket, previewState, traceEnabled]);

  useEffect(() => {
    if (!calendarFocus) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCalendarFocus((current) => (current?.id === calendarFocus.id ? null : current));
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [calendarFocus]);

  const updateViewportPreferences = (
    updater: (current: PlannerViewportPreferences) => PlannerViewportPreferences
  ) => {
    setViewportPreferences((current) => {
      const next = updater(current);
      return arePlannerViewportPreferencesEqual(current, next) ? current : next;
    });
  };

  const updateTraceEnabled = (enabled: boolean) => {
    updateViewportPreferences((current) => ({
      ...current,
      traceEnabled: enabled,
    }));
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
    const dragId = String(event.active.id);
    handledDragIdRef.current = null;
    hoveredBucketIdRef.current = null;
    dragSessionRef.current = {
      dragId,
      startedAt: typeof performance === "undefined" ? 0 : performance.now(),
    };
    previewTraceRef.current = null;
    hoveredBucketRef.current = null;
    lastValidTimelineBucketRef.current = null;
    lastPointerCoordinatesRef.current = null;
    setHoveredBucket(null);

    const tracePayload = {
      dragId,
      dragType: data?.type ?? null,
      intent: data?.type === "scheduled" ? data.intent : "draft",
      projectId: data?.projectId ?? null,
      selectionSize:
        data?.type === "scheduled" &&
        data.intent === "move" &&
        selectedProjectIds.includes(data.projectId)
          ? selectedProjectIds.length
          : 1,
      startSlot: data?.type === "scheduled" ? data.startSlot : null,
    };

    if (
      data?.type === "scheduled" &&
      data.intent === "move" &&
      selectedProjectIds.includes(data.projectId)
    ) {
      tracePlannerUi(traceEnabled, "drag.start", tracePayload);
      setActiveDrag({
        ...data,
        selectionProjectIds: selectedProjectIds,
      });
      return;
    }

    tracePlannerUi(traceEnabled, "drag.start", tracePayload);
    setActiveDrag(data ?? null);
  };

  const updateHoveredTarget = (bucket: CalendarBucket | null) => {
    const nextBucketId = bucket?.bucketId ?? null;

    if (hoveredBucketIdRef.current === nextBucketId) {
      return;
    }

    hoveredBucketIdRef.current = nextBucketId;
    hoveredBucketRef.current = bucket;
    if (bucket) {
      lastValidTimelineBucketRef.current = bucket;
    }
    previewTraceRef.current = {
      bucketId: nextBucketId,
      startedAt: typeof performance === "undefined" ? 0 : performance.now(),
    };
    setHoveredBucket(bucket);

    tracePlannerUi(traceEnabled, "drag.over.bucketChanged", {
      bucketId: nextBucketId,
      hoveredStartSlot: bucket?.startSlot ?? null,
      normalizedStartSlot: bucket
        ? normalizeToWorkingSlot(bucket.startSlot, state.closures)
        : null,
      teamId: bucket?.teamId ?? null,
    });
  };

  const handleDragMove = (event: DragMoveEvent) => {
    updateHoveredTarget(extractPlannerHoveredBucket(event));
  };

  const handleDragOver = (event: DragOverEvent) => {
    updateHoveredTarget(extractPlannerHoveredBucket(event));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current as DragProjectMeta | undefined;
    const currentHoveredBucket = hoveredBucketRef.current;
    const eventBucket = extractPlannerHoveredBucket(event);
    const resolvedDraftDrop =
      active?.type === "draft"
        ? resolvePlannerDraftDropBucket({
            currentHoveredBucket,
            eventBucket,
            lastValidBucket: lastValidTimelineBucketRef.current,
            documentLike: typeof document === "undefined" ? null : document,
            pointerCoordinates: lastPointerCoordinatesRef.current,
          })
        : null;
    const bucket =
      active?.type === "draft"
        ? (resolvedDraftDrop?.bucket ?? null)
        : currentHoveredBucket ?? eventBucket;
    const dragId = String(event.active.id);
    const dragDurationMs = dragSessionRef.current
      ? (typeof performance === "undefined" ? 0 : performance.now() - dragSessionRef.current.startedAt)
      : 0;

    setActiveDrag(null);
    setHoveredBucket(null);
    hoveredBucketIdRef.current = null;
    hoveredBucketRef.current = null;
    lastValidTimelineBucketRef.current = null;
    lastPointerCoordinatesRef.current = null;
    dragSessionRef.current = null;
    previewTraceRef.current = null;

    if (handledDragIdRef.current === dragId) {
      tracePlannerUi(traceEnabled, "drag.end", {
        dragId,
        outcome: "ignored-duplicate",
        durationMs: dragDurationMs,
      });
      return;
    }

    handledDragIdRef.current = dragId;

    if (!active || !bucket) {
      tracePlannerUi(traceEnabled, "drag.end", {
        dragId,
        outcome: "no-target",
        durationMs: dragDurationMs,
        targetResolution: resolvedDraftDrop?.source ?? "no-target",
      });
      return;
    }

    if (active.type === "draft") {
      tracePlannerUi(traceEnabled, "drag.end", {
        dragId,
        outcome: "draft-pending-placement",
        durationMs: dragDurationMs,
        hoveredStartSlot: bucket.startSlot,
        normalizedStartSlot: normalizeToWorkingSlot(bucket.startSlot, state.closures),
        targetResolution: resolvedDraftDrop?.source ?? "no-target",
      });
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
        tracePlannerUi(traceEnabled, "drag.end", {
          dragId,
          outcome: "no-move-plan",
          durationMs: dragDurationMs,
          hoveredStartSlot: bucket.startSlot,
        });
        return;
      }

      if (arePlacementRequestsNoop(state.projects, movePlan.snappedRequests, state.closures)) {
        tracePlannerUi(traceEnabled, "drag.end", {
          dragId,
          outcome: "noop",
          durationMs: dragDurationMs,
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
        tracePlannerUi(traceEnabled, "drag.end", {
          dragId,
          outcome: "dependency-conflict",
          durationMs: dragDurationMs,
          projectIds: movePlan.projectIds,
        });
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
        tracePlannerUi(traceEnabled, "drag.end", {
          dragId,
          outcome: "earlier-shift-prompt",
          durationMs: dragDurationMs,
          projectIds: movePlan.projectIds,
        });
        setPendingEarlierShift(earliestShiftPrompt);
        return;
      }

      tracePlannerUi(traceEnabled, "drag.end", {
        dragId,
        outcome: "committed",
        durationMs: dragDurationMs,
        projectIds: movePlan.projectIds,
        normalizedPlacements: movePlan.normalizedRequests,
      });
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
      tracePlannerUi(traceEnabled, "drag.end", {
        dragId,
        outcome: "noop",
        durationMs: dragDurationMs,
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
      tracePlannerUi(traceEnabled, "drag.end", {
        dragId,
        outcome: "dependency-conflict",
        durationMs: dragDurationMs,
        projectIds: [active.projectId],
      });
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
        tracePlannerUi(traceEnabled, "drag.end", {
          dragId,
          outcome: "earlier-shift-prompt",
          durationMs: dragDurationMs,
          projectIds: [active.projectId],
        });
        setPendingEarlierShift(prompt);
        return;
      }
    }

    tracePlannerUi(traceEnabled, "drag.end", {
      dragId,
      outcome: "committed",
      durationMs: dragDurationMs,
      projectIds: [active.projectId],
      normalizedPlacements: [normalizedPlacementRequest],
    });
    placeProject(active.projectId, normalizedPlacementRequest.placement, {
      source: `drag-${active.intent}`,
      dependencyResolution: "preserve-dependencies",
      traceMetadata,
    });
    setPendingPlacement(null);
  };

  const plannerCollisionDetection = useMemo<CollisionDetection>(
    () => (args) => {
      if (args.pointerCoordinates) {
        lastPointerCoordinatesRef.current = args.pointerCoordinates;
      }

      const bucketContainers = args.droppableContainers.filter((container) =>
        isCalendarBucket(container.data.current)
      );
      const bucketCollisions = pointerWithin({
        ...args,
        droppableContainers: bucketContainers,
      });

      if (bucketCollisions.length) {
        return bucketCollisions;
      }

      const pointerCoordinates = args.pointerCoordinates;
      if (!pointerCoordinates) {
        return [];
      }

      const rowSurfaceContainers = args.droppableContainers.filter((container) =>
        isCalendarRowSurface(container.data.current)
      );
      const rowSurfaceCollisions = pointerWithin({
        ...args,
        droppableContainers: rowSurfaceContainers,
      });

      return rowSurfaceCollisions.flatMap((collision) => {
        const container = rowSurfaceContainers.find(
          (candidate) => candidate.id === collision.id
        );
        const surface = container?.data.current;
        const rect = args.droppableRects.get(collision.id);

        if (!surface || !rect || !isCalendarRowSurface(surface)) {
          return [];
        }

        const bucket = buildCalendarBucketFromRowSurfacePointer({
          surface,
          pointerX: pointerCoordinates.x,
          rectLeft: rect.left,
          rectWidth: rect.width,
        });

        if (!bucket) {
          return [];
        }

        return [
          {
            ...collision,
            data: {
              ...collision.data,
              bucket,
            },
          },
        ];
      });
    },
    []
  );

  return (
    <SidebarProvider>
      <DndContext
        id="planner-dnd"
        sensors={sensors}
        autoScroll={shouldEnablePlannerDragAutoScroll(activeDrag)}
        collisionDetection={plannerCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          handledDragIdRef.current = null;
          hoveredBucketIdRef.current = null;
          hoveredBucketRef.current = null;
          lastValidTimelineBucketRef.current = null;
          lastPointerCoordinatesRef.current = null;
          dragSessionRef.current = null;
          previewTraceRef.current = null;
          tracePlannerUi(traceEnabled, "drag.end", {
            dragId: null,
            outcome: "cancelled",
          });
          setActiveDrag(null);
          setHoveredBucket(null);
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
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  {franceHolidayStripSummary ? (
                    <div
                      className={cn(
                        "flex flex-col items-start gap-3 rounded-2xl border px-4 py-3 md:col-span-2 xl:col-span-3",
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
                            updateViewportPreferences((current) => ({
                              ...current,
                              holidayListExpanded: !current.holidayListExpanded,
                            }))
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
                          "group flex h-full flex-col items-start gap-2 rounded-2xl border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5",
                          getClosureChipSpanClasses(displayClosure),
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
              previewDelta={previewState?.previewDelta ?? null}
              hoveredBucket={hoveredBucket}
              dependencies={state.dependencies}
              customClosures={state.customClosures}
              closures={state.closures}
              pendingPlacement={pendingPlacement}
              selectedProjectIds={selectedProjectIds}
              traceEnabled={traceEnabled}
              activeDate={viewportPreferences.activeDate}
              viewMode={viewportPreferences.viewMode}
              teams={state.teams}
              focusEvent={calendarFocus}
              dragActive={Boolean(activeDrag)}
              onActiveDateChange={(activeDate) =>
                updateViewportPreferences((current) => ({
                  ...current,
                  activeDate,
                }))
              }
              onViewModeChange={(viewMode) =>
                updateViewportPreferences((current) => ({
                  ...current,
                  viewMode,
                }))
              }
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
            <div className="z-50 rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-2xl backdrop-blur">
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
              {buildDependencyConflictDescription(state, pendingDependencyConflict)}
            </DialogDescription>
          </DialogHeader>

          {pendingDependencyConflict ? (
            <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/35 p-3">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {pendingDependencyConflict.placements[0] ? (
                  <Badge variant="secondary" className="rounded-full">
                    {formatPlannerSlot(pendingDependencyConflict.placements[0].placement.startSlot)}
                  </Badge>
                ) : null}
              </div>
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
              {buildEarlierShiftDescription(state, pendingEarlierShift)}
            </DialogDescription>
          </DialogHeader>

          {pendingEarlierShift ? (
            <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/35 p-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full">
                  {formatPlannerSlot(pendingEarlierShift.previousStartSlot)}
                </Badge>
                <Badge variant="secondary" className="rounded-full">
                  {formatPlannerSlot(pendingEarlierShift.placement.startSlot)}
                </Badge>
              </div>
            </div>
          ) : null}

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
