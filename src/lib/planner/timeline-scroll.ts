export const TIMELINE_SCROLL_OFFSET_PX = 180;

export function getTimelineScrollTop(
  currentScrollY: number,
  anchorViewportTop: number,
  offsetPx = TIMELINE_SCROLL_OFFSET_PX
) {
  return Math.max(Math.round(currentScrollY + anchorViewportTop - offsetPx), 0);
}
