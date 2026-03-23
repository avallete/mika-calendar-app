import { describe, expect, test } from "bun:test";

import { makeSlotKey } from "@/lib/planner/calendar";
import {
  rescheduleProjects,
  updateProjectPlacement,
  wouldCreateDependencyCycle,
} from "@/lib/planner/scheduler";
import type { PlannerState } from "@/lib/planner/types";

function baseState(): PlannerState {
  return {
    projects: [
      {
        id: "a-1",
        title: "Team A discovery",
        status: "scheduled",
        plannedTeam: "team-a",
        estimatedDurationHalfDays: 4,
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-23", "AM"),
        scheduledDurationHalfDays: 4,
        sequenceOrder: 0,
      },
      {
        id: "a-2",
        title: "Team A follow-up",
        status: "scheduled",
        plannedTeam: "team-a",
        estimatedDurationHalfDays: 2,
        scheduledTeam: "team-a",
        scheduledStartSlot: makeSlotKey("2026-03-25", "AM"),
        scheduledDurationHalfDays: 2,
        sequenceOrder: 1,
      },
      {
        id: "b-1",
        title: "Team B hand-off",
        status: "scheduled",
        plannedTeam: "team-b",
        estimatedDurationHalfDays: 2,
        scheduledTeam: "team-b",
        scheduledStartSlot: makeSlotKey("2026-03-25", "AM"),
        scheduledDurationHalfDays: 2,
        sequenceOrder: 0,
      },
    ],
    dependencies: [
      {
        id: "dep-a1-b1",
        predecessorProjectId: "a-1",
        successorProjectId: "b-1",
        lagHalfDays: 0,
      },
    ],
    closures: [],
  };
}

describe("scheduler", () => {
  test("pushes later same-team work forward when an earlier item is extended", () => {
    const nextState = updateProjectPlacement(baseState(), "a-1", {
      teamId: "team-a",
      startSlot: makeSlotKey("2026-03-23", "AM"),
      durationHalfDays: 6,
    });

    const secondProject = nextState.projects.find((project) => project.id === "a-2");
    expect(secondProject?.scheduledStartSlot).toBe(makeSlotKey("2026-03-26", "AM"));
  });

  test("does not move Team B when the Team A-only delay is unrelated to Team B blockers", () => {
    const nextState = updateProjectPlacement(baseState(), "a-2", {
      teamId: "team-a",
      startSlot: makeSlotKey("2026-03-27", "AM"),
      durationHalfDays: 4,
    });

    const downstream = nextState.projects.find((project) => project.id === "b-1");
    expect(downstream?.scheduledStartSlot).toBe(makeSlotKey("2026-03-25", "AM"));
  });

  test("moves Team B when its blocking Team A predecessor moves", () => {
    const nextState = updateProjectPlacement(baseState(), "a-1", {
      teamId: "team-a",
      startSlot: makeSlotKey("2026-03-24", "AM"),
      durationHalfDays: 6,
    });

    const downstream = nextState.projects.find((project) => project.id === "b-1");
    expect(downstream?.scheduledStartSlot).toBe(makeSlotKey("2026-03-27", "AM"));
  });

  test("skips closure dates when recalculating project finishes", () => {
    const nextState = rescheduleProjects({
      ...baseState(),
      closures: [
        {
          id: "closure",
          title: "Company closure",
          type: "company_closure",
          startDate: "2026-03-25",
          endDate: "2026-03-26",
        },
      ],
    });

    const downstream = nextState.projects.find((project) => project.id === "a-2");
    expect(downstream?.scheduledStartSlot).toBe(makeSlotKey("2026-03-27", "AM"));
  });

  test("recalculates both lane sequences when moving a project between teams", () => {
    const nextState = updateProjectPlacement(baseState(), "a-2", {
      teamId: "team-b",
      startSlot: makeSlotKey("2026-03-25", "PM"),
      durationHalfDays: 2,
    });

    const moved = nextState.projects.find((project) => project.id === "a-2");
    const remainingTeamA = nextState.projects.find((project) => project.id === "a-1");
    const teamB = nextState.projects
      .filter((project) => project.scheduledTeam === "team-b")
      .sort((left, right) => (left.sequenceOrder ?? 0) - (right.sequenceOrder ?? 0));

    expect(moved?.scheduledTeam).toBe("team-b");
    expect(remainingTeamA?.sequenceOrder).toBe(0);
    expect(teamB.map((project) => project.sequenceOrder)).toEqual([0, 1]);
  });

  test("rejects circular dependencies", () => {
    const result = wouldCreateDependencyCycle(baseState().dependencies, "b-1", "a-1");
    expect(result).toBe(true);
  });
});
