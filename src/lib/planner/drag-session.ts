import type { CalendarBucket, DragProjectMeta } from "@/lib/planner/types";
import { isCalendarBucket } from "@/lib/planner/types";

type PlannerDragCollision = {
  data?: {
    bucket?: unknown;
  } | null;
};

type PlannerDragEventLike = {
  collisions?: PlannerDragCollision[] | null;
  over?: {
    data?: {
      current?: unknown;
    } | null;
  } | null;
};

export type PlannerPointerCoordinates = {
  x: number;
  y: number;
};

type PlannerElementLike = {
  closest?: (selector: string) => unknown;
};

type PlannerDocumentLike = {
  elementFromPoint: (x: number, y: number) => PlannerElementLike | null;
  elementsFromPoint?: (x: number, y: number) => PlannerElementLike[];
};

export type PlannerDraftDropTargetSource =
  | "current-hover"
  | "event-collision"
  | "last-valid-fallback"
  | "no-target";

export function extractPlannerHoveredBucket(
  event: PlannerDragEventLike
): CalendarBucket | null {
  for (const collision of event.collisions ?? []) {
    const bucket = collision.data?.bucket;
    if (isCalendarBucket(bucket)) {
      return bucket;
    }
  }

  const overData = event.over?.data?.current;
  return isCalendarBucket(overData) ? overData : null;
}

export function shouldEnablePlannerDragAutoScroll(activeDrag: DragProjectMeta | null) {
  return activeDrag?.type !== "draft";
}

export function isPointerWithinPlannerTimelineSurface(args: {
  documentLike: PlannerDocumentLike | null | undefined;
  pointerCoordinates: PlannerPointerCoordinates | null;
}) {
  const { documentLike, pointerCoordinates } = args;
  if (!documentLike || !pointerCoordinates) {
    return false;
  }

  const elements =
    typeof documentLike.elementsFromPoint === "function"
      ? documentLike.elementsFromPoint(pointerCoordinates.x, pointerCoordinates.y)
      : [documentLike.elementFromPoint(pointerCoordinates.x, pointerCoordinates.y)].filter(
          (element): element is PlannerElementLike => element !== null
        );

  return elements.some(
    (element) =>
      typeof element.closest === "function" &&
      Boolean(element.closest("[data-timeline-row-surface]"))
  );
}

export function resolvePlannerDraftDropBucket(args: {
  currentHoveredBucket: CalendarBucket | null;
  eventBucket: CalendarBucket | null;
  lastValidBucket: CalendarBucket | null;
  documentLike: PlannerDocumentLike | null | undefined;
  pointerCoordinates: PlannerPointerCoordinates | null;
}): {
  bucket: CalendarBucket | null;
  source: PlannerDraftDropTargetSource;
} {
  const {
    currentHoveredBucket,
    eventBucket,
    lastValidBucket,
    documentLike,
    pointerCoordinates,
  } = args;

  if (currentHoveredBucket) {
    return {
      bucket: currentHoveredBucket,
      source: "current-hover",
    };
  }

  if (eventBucket) {
    return {
      bucket: eventBucket,
      source: "event-collision",
    };
  }

  if (
    lastValidBucket &&
    isPointerWithinPlannerTimelineSurface({
      documentLike,
      pointerCoordinates,
    })
  ) {
    return {
      bucket: lastValidBucket,
      source: "last-valid-fallback",
    };
  }

  return {
    bucket: null,
    source: "no-target",
  };
}
