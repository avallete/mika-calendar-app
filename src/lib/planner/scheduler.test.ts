import { describe, expect, test } from "bun:test";

import { makeSlotKey } from "@/lib/planner/calendar";
import {
  createPlannerTraceContext,
} from "@/lib/planner/planner-trace";
import {
  detectDependencyConflicts,
  deleteProjectFromState,
  getEarlierShiftPrompt,
  getTouchingProjectChain,
  previewProjectPlacements,
  rescheduleProjects,
  setSchedulerTraceEnabled,
  updateProjectPlacement,
  updateProjectPlacements,
  wouldCreateDependencyCycle,
} from "@/lib/planner/scheduler";
import type { PlannerState } from "@/lib/planner/types";

const baseTeams = [
  {
    id: "team-a",
    slug: "team-a",
    nameFr: "Equipe A",
    displayOrder: 0,
    accentColor: "oklch(0.58 0.11 205)",
    softColor: "oklch(0.95 0.03 205)",
    isActive: true,
  },
  {
    id: "team-b",
    slug: "team-b",
    nameFr: "Equipe B",
    displayOrder: 1,
    accentColor: "oklch(0.68 0.13 55)",
    softColor: "oklch(0.96 0.04 55)",
    isActive: true,
  },
] as const;

const baseHolidaySources = [
  {
    id: "holiday-fr",
    code: "FR",
    labelFr: "Jours feries France",
    enabled: true,
  },
] as const;

function withPlannerShape(
  state: Pick<PlannerState, "projects" | "dependencies" | "closures"> &
    Partial<Pick<PlannerState, "customClosures">>
): PlannerState {
  return {
    teams: [...baseTeams],
    holidaySources: [...baseHolidaySources],
    customClosures: state.customClosures ?? [],
    history: {
      canUndo: false,
      canRedo: false,
    },
    ...state,
  };
}

function baseState(): PlannerState {
  return withPlannerShape({
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
  });
}

describe("scheduler", () => {
  test("previewProjectPlacements matches full reschedule for cross-team moves", () => {
    const state = baseState();
    const placement = {
      teamId: "team-b" as const,
      startSlot: makeSlotKey("2026-03-25", "PM"),
      durationHalfDays: 2,
    };
    const fullReschedule = rescheduleProjects({
      ...state,
      projects: state.projects.map((project) =>
        project.id === "a-2"
          ? {
              ...project,
              status: "scheduled" as const,
              scheduledTeam: placement.teamId,
              scheduledStartSlot: placement.startSlot,
              scheduledDurationHalfDays: placement.durationHalfDays,
              sequenceOrder:
                typeof project.sequenceOrder === "number" ? project.sequenceOrder : 0,
            }
          : { ...project }
      ),
    });

    const preview = previewProjectPlacements(
      state,
      [
        {
          projectId: "a-2",
          placement,
        },
      ],
      {
        dependencyResolution: "preserve-dependencies",
      }
    );

    expect(preview.nextState).toEqual(fullReschedule);
    expect(preview.changedSectionIds).toEqual(["2026-03"]);
  });

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
    const nextState = rescheduleProjects(
      withPlannerShape({
        ...baseState(),
        customClosures: [
          {
            id: "closure",
            title: "Company closure",
            type: "company_closure",
            startDate: "2026-03-25",
            endDate: "2026-03-26",
            impact: "blocking",
            repeatsAnnually: false,
          },
        ],
        closures: [],
      })
    );

    const downstream = nextState.projects.find((project) => project.id === "a-2");
    expect(downstream?.scheduledStartSlot).toBe(makeSlotKey("2026-03-27", "AM"));
  });

  test("ignores advisory markers when recalculating project finishes", () => {
    const nextState = rescheduleProjects(
      withPlannerShape({
        ...baseState(),
        customClosures: [
          {
            id: "weather",
            title: "Rain advisory",
            type: "weather",
            startDate: "2026-03-25",
            endDate: "2026-03-25",
            impact: "advisory",
            details: "Conditions humides mais chantier maintenu.",
            repeatsAnnually: false,
          },
        ],
        closures: [],
      })
    );

    const downstream = nextState.projects.find((project) => project.id === "a-2");
    expect(downstream?.scheduledStartSlot).toBe(makeSlotKey("2026-03-25", "AM"));
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

  test("deleting a draft removes its dependency edges", () => {
    const nextState = deleteProjectFromState(
      {
        ...baseState(),
        projects: [
          ...baseState().projects,
          {
            id: "draft-1",
            title: "Draft",
            status: "draft",
            plannedTeam: "team-a",
            estimatedDurationHalfDays: 2,
          },
        ],
        dependencies: [
          ...baseState().dependencies,
          {
            id: "dep-draft",
            predecessorProjectId: "a-2",
            successorProjectId: "draft-1",
            lagHalfDays: 0,
          },
        ],
      },
      "draft-1"
    );

    expect(nextState.projects.find((project) => project.id === "draft-1")).toBeUndefined();
    expect(nextState.dependencies.find((dependency) => dependency.id === "dep-draft")).toBeUndefined();
  });

  test("deleting a scheduled project with preserve dates keeps later work on current dates", () => {
    const nextState = deleteProjectFromState(baseState(), "a-1", "preserve-dates");

    const teamA = nextState.projects.find((project) => project.id === "a-2");
    const teamB = nextState.projects.find((project) => project.id === "b-1");

    expect(teamA?.scheduledStartSlot).toBe(makeSlotKey("2026-03-25", "AM"));
    expect(teamB?.scheduledStartSlot).toBe(makeSlotKey("2026-03-25", "AM"));
  });

  test("deleting a scheduled project with compact schedule pulls later work earlier", () => {
    const nextState = deleteProjectFromState(baseState(), "a-1", "compact-schedule");

    const teamA = nextState.projects.find((project) => project.id === "a-2");
    const teamB = nextState.projects.find((project) => project.id === "b-1");

    expect(teamA?.scheduledStartSlot).toBe(makeSlotKey("2026-03-23", "AM"));
    expect(teamB?.scheduledStartSlot).toBe(makeSlotKey("2026-03-23", "AM"));
  });

  test("normalizes weekend moves to the next working start slot", () => {
    const nextState = updateProjectPlacement(baseState(), "a-2", {
      teamId: "team-a",
      startSlot: makeSlotKey("2026-03-28", "AM"),
      durationHalfDays: 2,
    });

    const movedProject = nextState.projects.find((project) => project.id === "a-2");
    expect(movedProject?.scheduledStartSlot).toBe(makeSlotKey("2026-03-30", "AM"));
  });

  test("supports half-day moves and durations", () => {
    const nextState = updateProjectPlacement(baseState(), "a-2", {
      teamId: "team-a",
      startSlot: makeSlotKey("2026-03-25", "PM"),
      durationHalfDays: 1,
    });

    const movedProject = nextState.projects.find((project) => project.id === "a-2");
    expect(movedProject?.scheduledStartSlot).toBe(makeSlotKey("2026-03-25", "PM"));
    expect(movedProject?.scheduledDurationHalfDays).toBe(1);
  });

  test("suggests an earlier-shift prompt only when the earlier gap is empty", () => {
    const prompt = getEarlierShiftPrompt(
      {
        ...baseState(),
        projects: baseState().projects.map((project) =>
          project.id === "a-2"
            ? {
                ...project,
                scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
              }
            : project
        ),
      },
      "a-2",
      {
        teamId: "team-a",
        startSlot: makeSlotKey("2026-03-26", "AM"),
        durationHalfDays: 2,
      },
      "move"
    );

    const blockedPrompt = getEarlierShiftPrompt(
      baseState(),
      "a-2",
      {
        teamId: "team-a",
        startSlot: makeSlotKey("2026-03-24", "AM"),
        durationHalfDays: 2,
      },
      "move"
    );

    expect(prompt?.placement.startSlot).toBe(makeSlotKey("2026-03-26", "AM"));
    expect(blockedPrompt).toBeNull();
  });

  test("compacts later same-team work when an earlier move requests queue compaction", () => {
    const state = baseState();
    const movedProject = state.projects.find((project) => project.id === "a-2");
    if (!movedProject) {
      throw new Error("Expected Team A follow-up in base state.");
    }

    const nextState = updateProjectPlacement(
      {
        ...state,
        projects: [
          ...state.projects.filter((project) => project.id !== "a-2"),
          {
            id: "a-3",
            title: "Team A final",
            status: "scheduled" as const,
            plannedTeam: "team-a" as const,
            estimatedDurationHalfDays: 2,
            scheduledTeam: "team-a" as const,
            scheduledStartSlot: makeSlotKey("2026-04-03", "AM"),
            scheduledDurationHalfDays: 2,
            sequenceOrder: 2,
          },
          {
            ...movedProject,
            scheduledStartSlot: makeSlotKey("2026-03-31", "AM"),
          },
        ],
      },
      "a-2",
      {
        teamId: "team-a",
        startSlot: makeSlotKey("2026-03-26", "AM"),
        durationHalfDays: 2,
      },
      {
        strategy: "compact-same-team",
        source: "test",
      }
    );

    const followingProject = nextState.projects.find((project) => project.id === "a-3");
    expect(followingProject?.scheduledStartSlot).toBe(makeSlotKey("2026-03-27", "AM"));
  });

  test("emits trace logs when scheduler tracing is enabled", () => {
    const originalGroupCollapsed = console.groupCollapsed;
    const originalLog = console.log;
    const originalGroupEnd = console.groupEnd;
    const calls: string[] = [];

    console.groupCollapsed = ((...args: unknown[]) => {
      calls.push(`group:${String(args[0])}`);
    }) as typeof console.groupCollapsed;
    console.log = ((...args: unknown[]) => {
      calls.push(`log:${String(args[0])}`);
    }) as typeof console.log;
    console.groupEnd = (() => {
      calls.push("end");
    }) as typeof console.groupEnd;

    try {
      setSchedulerTraceEnabled(true);
      updateProjectPlacement(
        baseState(),
        "a-2",
        {
          teamId: "team-a",
          startSlot: makeSlotKey("2026-03-27", "AM"),
          durationHalfDays: 2,
        },
        {
          source: "trace-test",
        }
      );
    } finally {
      setSchedulerTraceEnabled(false);
      console.groupCollapsed = originalGroupCollapsed;
      console.log = originalLog;
      console.groupEnd = originalGroupEnd;
    }

    expect(calls.some((entry) => entry.includes("updateProjectPlacement"))).toBe(true);
    expect(calls.some((entry) => entry.includes("queues.before"))).toBe(true);
    expect(calls.some((entry) => entry === "end")).toBe(true);
  });

  test("keeps preview tracing summary-only when scheduler tracing is enabled", () => {
    const originalGroupCollapsed = console.groupCollapsed;
    const originalLog = console.log;
    const originalGroupEnd = console.groupEnd;
    const calls: string[] = [];

    console.groupCollapsed = ((...args: unknown[]) => {
      calls.push(`group:${String(args[0])}`);
    }) as typeof console.groupCollapsed;
    console.log = ((...args: unknown[]) => {
      calls.push(`log:${String(args[0])}`);
    }) as typeof console.log;
    console.groupEnd = (() => {
      calls.push("end");
    }) as typeof console.groupEnd;

    try {
      setSchedulerTraceEnabled(true);
      updateProjectPlacement(
        baseState(),
        "a-2",
        {
          teamId: "team-a",
          startSlot: makeSlotKey("2026-03-27", "AM"),
          durationHalfDays: 2,
        },
        {
          source: "preview",
        }
      );
    } finally {
      setSchedulerTraceEnabled(false);
      console.groupCollapsed = originalGroupCollapsed;
      console.log = originalLog;
      console.groupEnd = originalGroupEnd;
    }

    expect(calls.some((entry) => entry.includes("updateProjectPlacement"))).toBe(true);
    expect(calls.some((entry) => entry.includes("summary"))).toBe(true);
    expect(calls.some((entry) => entry.includes("queues.before"))).toBe(false);
    expect(calls.some((entry) => entry.includes("changes"))).toBe(false);
    expect(calls.some((entry) => entry === "end")).toBe(true);
  });

  test("keeps server commit scheduler traces summary-only when the verbose toggle is off", () => {
    const originalGroupCollapsed = console.groupCollapsed;
    const originalLog = console.log;
    const originalGroupEnd = console.groupEnd;
    const calls: string[] = [];

    console.groupCollapsed = ((...args: unknown[]) => {
      calls.push(`group:${String(args[0])}`);
    }) as typeof console.groupCollapsed;
    console.log = ((...args: unknown[]) => {
      calls.push(`log:${String(args[0])}`);
    }) as typeof console.log;
    console.groupEnd = (() => {
      calls.push("end");
    }) as typeof console.groupEnd;

    try {
      updateProjectPlacement(
        baseState(),
        "a-2",
        {
          teamId: "team-a",
          startSlot: makeSlotKey("2026-03-27", "AM"),
          durationHalfDays: 2,
        },
        {
          source: "sheet-edit",
        },
        createPlannerTraceContext({
          source: "sheet-edit",
          enabled: true,
          traceId: "server-commit-trace",
          runtime: "server",
          phase: "store",
        })
      );
    } finally {
      console.groupCollapsed = originalGroupCollapsed;
      console.log = originalLog;
      console.groupEnd = originalGroupEnd;
    }

    expect(calls.some((entry) => entry.includes("updateProjectPlacement.server-commit"))).toBe(true);
    expect(calls.some((entry) => entry.includes("summary"))).toBe(true);
    expect(calls.some((entry) => entry.includes("queues.before"))).toBe(false);
    expect(calls.some((entry) => entry.includes("changes"))).toBe(false);
    expect(calls.some((entry) => entry.includes("iteration.1."))).toBe(false);
    expect(calls.some((entry) => entry === "end")).toBe(true);
  });

  test("returns changed project ids for exact preview scheduling", () => {
    const result = previewProjectPlacements(
      baseState(),
      [
        {
          projectId: "a-1",
          placement: {
            teamId: "team-a",
            startSlot: makeSlotKey("2026-03-24", "AM"),
            durationHalfDays: 6,
          },
        },
      ],
      {
        dependencyResolution: "preserve-dependencies",
      }
    );

    expect(result.changedProjectIds.sort()).toEqual(["a-1", "a-2", "b-1"]);
    expect(
      result.nextState.projects.find((project) => project.id === "b-1")?.scheduledStartSlot
    ).toBe(makeSlotKey("2026-03-27", "AM"));
  });

  test("detects dependency conflicts when a successor is dragged before its predecessor", () => {
    const state = withPlannerShape({
      projects: [
        {
          id: "build",
          title: "Build",
          status: "scheduled",
          plannedTeam: "team-b",
          estimatedDurationHalfDays: 4,
          scheduledTeam: "team-b",
          scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
          scheduledDurationHalfDays: 4,
          sequenceOrder: 0,
        },
        {
          id: "handover",
          title: "Handover",
          status: "scheduled",
          plannedTeam: "team-b",
          estimatedDurationHalfDays: 2,
          scheduledTeam: "team-b",
          scheduledStartSlot: makeSlotKey("2026-04-01", "AM"),
          scheduledDurationHalfDays: 2,
          sequenceOrder: 1,
        },
      ],
      dependencies: [
        {
          id: "dep-build-handover",
          predecessorProjectId: "build",
          successorProjectId: "handover",
          lagHalfDays: 0,
        },
      ],
      closures: [],
    });

    const conflicts = detectDependencyConflicts(state, [
      {
        projectId: "handover",
        placement: {
          teamId: "team-b",
          startSlot: makeSlotKey("2026-03-27", "AM"),
          durationHalfDays: 2,
        },
      },
    ]);

    expect(conflicts.map((conflict) => conflict.id)).toEqual(["dep-build-handover"]);
  });

  test("breaking conflicting links keeps the dragged placement exact", () => {
    const state = withPlannerShape({
      projects: [
        {
          id: "build",
          title: "Build",
          status: "scheduled",
          plannedTeam: "team-b",
          estimatedDurationHalfDays: 4,
          scheduledTeam: "team-b",
          scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
          scheduledDurationHalfDays: 4,
          sequenceOrder: 0,
        },
        {
          id: "handover",
          title: "Handover",
          status: "scheduled",
          plannedTeam: "team-b",
          estimatedDurationHalfDays: 2,
          scheduledTeam: "team-b",
          scheduledStartSlot: makeSlotKey("2026-04-01", "AM"),
          scheduledDurationHalfDays: 2,
          sequenceOrder: 1,
        },
      ],
      dependencies: [
        {
          id: "dep-build-handover",
          predecessorProjectId: "build",
          successorProjectId: "handover",
          lagHalfDays: 0,
        },
      ],
      closures: [],
    });

    const nextState = updateProjectPlacements(
      state,
      [
        {
          projectId: "handover",
          placement: {
            teamId: "team-b",
            startSlot: makeSlotKey("2026-03-27", "AM"),
            durationHalfDays: 2,
          },
        },
      ],
      {
        dependencyResolution: "break-conflicting-links",
        removeDependencyIds: ["dep-build-handover"],
      }
    );

    expect(nextState.dependencies).toHaveLength(0);
    expect(
      nextState.projects.find((project) => project.id === "handover" && project.status === "scheduled")
        ?.scheduledStartSlot
    ).toBe(makeSlotKey("2026-03-27", "AM"));
  });

  test("preserving dependencies keeps a successor behind its predecessor without runaway drift", () => {
    const state = withPlannerShape({
      projects: [
        {
          id: "build",
          title: "Build",
          status: "scheduled",
          plannedTeam: "team-b",
          estimatedDurationHalfDays: 4,
          scheduledTeam: "team-b",
          scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
          scheduledDurationHalfDays: 4,
          sequenceOrder: 0,
        },
        {
          id: "handover",
          title: "Handover",
          status: "scheduled",
          plannedTeam: "team-b",
          estimatedDurationHalfDays: 2,
          scheduledTeam: "team-b",
          scheduledStartSlot: makeSlotKey("2026-04-01", "AM"),
          scheduledDurationHalfDays: 2,
          sequenceOrder: 1,
        },
      ],
      dependencies: [
        {
          id: "dep-build-handover",
          predecessorProjectId: "build",
          successorProjectId: "handover",
          lagHalfDays: 0,
        },
      ],
      closures: [],
    });

    const nextState = updateProjectPlacements(state, [
      {
        projectId: "handover",
        placement: {
          teamId: "team-b",
          startSlot: makeSlotKey("2026-03-27", "AM"),
          durationHalfDays: 2,
        },
      },
    ]);

    const build = nextState.projects.find(
      (project) => project.id === "build" && project.status === "scheduled"
    );
    const handover = nextState.projects.find(
      (project) => project.id === "handover" && project.status === "scheduled"
    );

    expect(build?.scheduledStartSlot).toBe(makeSlotKey("2026-03-30", "AM"));
    expect(handover?.scheduledStartSlot).toBe(makeSlotKey("2026-04-01", "AM"));
  });

  test("finds touching chains across a weekend gap with no working-time break", () => {
    const state = withPlannerShape({
      projects: [
        {
          id: "a-1",
          title: "Friday block",
          status: "scheduled",
          plannedTeam: "team-a",
          estimatedDurationHalfDays: 2,
          scheduledTeam: "team-a",
          scheduledStartSlot: makeSlotKey("2026-03-27", "AM"),
          scheduledDurationHalfDays: 2,
          sequenceOrder: 0,
        },
        {
          id: "a-2",
          title: "Monday block",
          status: "scheduled",
          plannedTeam: "team-a",
          estimatedDurationHalfDays: 2,
          scheduledTeam: "team-a",
          scheduledStartSlot: makeSlotKey("2026-03-30", "AM"),
          scheduledDurationHalfDays: 2,
          sequenceOrder: 1,
        },
        {
          id: "a-3",
          title: "Later block",
          status: "scheduled",
          plannedTeam: "team-a",
          estimatedDurationHalfDays: 2,
          scheduledTeam: "team-a",
          scheduledStartSlot: makeSlotKey("2026-04-01", "AM"),
          scheduledDurationHalfDays: 2,
          sequenceOrder: 2,
        },
      ],
      dependencies: [],
      closures: [],
    });

    expect(getTouchingProjectChain(state, "a-1")).toEqual(["a-1", "a-2"]);
    expect(getTouchingProjectChain(state, "a-2")).toEqual(["a-1", "a-2"]);
  });
});
