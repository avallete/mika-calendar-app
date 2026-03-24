import { describe, expect, test } from "bun:test";

import {
  getTimelineScrollTop,
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
});
