import { slotKeyFromIndex } from "@/lib/planner/calendar";
import type { CalendarBucket, CalendarRowSurface } from "@/lib/planner/types";

export function makeCalendarRowSurfaceId(sectionId: string, teamId: string) {
  return `surface:${sectionId}:${teamId}`;
}

export function buildCalendarBucketFromRowSurfacePointer(args: {
  surface: CalendarRowSurface;
  pointerX: number;
  rectLeft: number;
  rectWidth: number;
}): CalendarBucket | null {
  const { surface, pointerX, rectLeft, rectWidth } = args;

  if (rectWidth <= 0 || !Number.isFinite(pointerX)) {
    return null;
  }

  const maxOffset = Math.max(rectWidth - 1, 0);
  const clampedX = Math.min(Math.max(pointerX - rectLeft, 0), maxOffset);
  const slotCount = surface.dayCount * 2;
  const slotWidth = rectWidth / slotCount;
  const slotIndex = Math.min(Math.floor(clampedX / slotWidth), slotCount - 1);
  const startSlot = slotKeyFromIndex(surface.startDate, slotIndex);

  return {
    bucketId: `bucket:${surface.teamId}:${startSlot}`,
    teamId: surface.teamId,
    startSlot,
    granularity: "slot",
  };
}
