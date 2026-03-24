import { describe, expect, test } from "bun:test";

import {
  getTimelineScrollTop,
  shouldTriggerTimelineScroll,
  TIMELINE_SCROLL_OFFSET_PX,
} from "@/lib/planner/timeline-scroll";

describe("timeline scroll", () => {
  test("computes a top offset that keeps headers visible", () => {
    expect(getTimelineScrollTop(640, 220, 180)).toBe(680);
  });

  test("uses the shared default offset", () => {
    expect(getTimelineScrollTop(500, 160)).toBe(
      500 + 160 - TIMELINE_SCROLL_OFFSET_PX
    );
  });

  test("clamps scroll targets to the page start", () => {
    expect(getTimelineScrollTop(40, 50, 180)).toBe(0);
  });

  test("scrolls for explicit navigation once the initial mount is done", () => {
    expect(
      shouldTriggerTimelineScroll({
        initialScrollDone: true,
        intent: "jump-to-today",
        pendingFocusDate: null,
      })
    ).toBe(true);
  });

  test("scrolls for focus events even without an explicit navigation intent", () => {
    expect(
      shouldTriggerTimelineScroll({
        initialScrollDone: true,
        intent: null,
        pendingFocusDate: "2026-04-15",
      })
    ).toBe(true);
  });

  test("does not scroll for plain data updates once mounted", () => {
    expect(
      shouldTriggerTimelineScroll({
        initialScrollDone: true,
        intent: null,
        pendingFocusDate: null,
      })
    ).toBe(false);
  });
});
