export const TIMELINE_SCROLL_OFFSET_PX = 180;

export type TimelineScrollIntent =
  | "initial"
  | "navigate-previous"
  | "navigate-next"
  | "jump-to-today"
  | "jump-to-year"
  | "open-month"
  | "open-year"
  | "focus"
  | "range-clamp"
  | null;

export function getTimelineScrollTop(
  currentScrollY: number,
  anchorViewportTop: number,
  offsetPx = TIMELINE_SCROLL_OFFSET_PX
) {
  return Math.max(Math.round(currentScrollY + anchorViewportTop - offsetPx), 0);
}

export function shouldTriggerTimelineScroll(args: {
  initialScrollDone: boolean;
  intent: TimelineScrollIntent;
  pendingFocusDate: string | null;
}) {
  const { initialScrollDone, intent, pendingFocusDate } = args;

  if (!initialScrollDone) {
    return true;
  }

  if (pendingFocusDate) {
    return true;
  }

  return intent !== null;
}
