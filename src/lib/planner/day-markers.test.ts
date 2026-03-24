import { describe, expect, test } from "bun:test";

import {
  buildCalendarDayState,
  collectCalendarDayMarkers,
} from "@/lib/planner/day-markers";
import type { ClosurePeriod } from "@/lib/planner/types";

const mixedClosures: ClosurePeriod[] = [
  {
    id: "fr-labour",
    title: "Fete du Travail",
    type: "holiday",
    startDate: "2026-05-01",
    endDate: "2026-05-01",
    impact: "blocking",
    source: "fr-public-holiday",
    editable: false,
  },
  {
    id: "custom-close",
    title: "Pont atelier",
    type: "company_closure",
    startDate: "2026-05-01",
    endDate: "2026-05-01",
    impact: "blocking",
    details: "Depot ferme pour inventaire de printemps.",
    source: "custom",
    editable: true,
  },
  {
    id: "weather-note",
    title: "Averse prevue",
    type: "weather",
    startDate: "2026-05-01",
    endDate: "2026-05-01",
    impact: "advisory",
    details: "Baches a prevoir sur les chantiers ouverts.",
    source: "custom",
    editable: true,
  },
];

describe("day markers", () => {
  test("merges generated and custom markers for a date", () => {
    const markers = collectCalendarDayMarkers("2026-05-01", mixedClosures);

    expect(markers.map((marker) => marker.id)).toEqual([
      "custom-close",
      "fr-labour",
      "weather-note",
    ]);
  });

  test("gives custom blocking markers visual precedence", () => {
    const dayState = buildCalendarDayState("2026-05-01", mixedClosures);

    expect(dayState.tone).toBe("custom-blocking");
    expect(dayState.isBlocking).toBe(true);
  });

  test("derives weekend markers without persisted records", () => {
    const dayState = buildCalendarDayState("2026-05-02", []);

    expect(dayState.tone).toBe("weekend");
    expect(dayState.markers[0]).toEqual(
      expect.objectContaining({
        type: "weekend",
        impact: "blocking",
      })
    );
  });

  test("keeps advisory details available for tooltip payloads", () => {
    const dayState = buildCalendarDayState("2026-05-01", mixedClosures);
    const advisoryMarker = dayState.markers.find((marker) => marker.id === "weather-note");

    expect(advisoryMarker?.details).toBe("Baches a prevoir sur les chantiers ouverts.");
    expect(advisoryMarker?.impact).toBe("advisory");
  });
});
