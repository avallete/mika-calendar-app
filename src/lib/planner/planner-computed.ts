import { addDays, format, parseISO } from "date-fns";

import {
  getWorkingCalendarIndex,
  type WorkingCalendarIndex,
  type WorkingCalendarSpan,
} from "@/lib/planner/calendar";
import { recordPlannerPerfProbeCount } from "@/lib/planner/planner-perf";
import type { PlannerState, Project } from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";

export type ProjectScheduleSpan = WorkingCalendarSpan;

export type PlannerComputedSnapshot = {
  snapshot: PlannerState;
  calendarIndex: WorkingCalendarIndex;
  projectSpanById: Map<string, ProjectScheduleSpan>;
};

const plannerComputedSnapshotCache = new WeakMap<PlannerState, PlannerComputedSnapshot>();

function shiftDate(date: string, dayOffset: number) {
  return format(addDays(parseISO(date), dayOffset), "yyyy-MM-dd");
}

function haveSameScheduledPlacement(left: Project | undefined, right: Project | undefined) {
  if (!left || !right || !isScheduledProject(left) || !isScheduledProject(right)) {
    return false;
  }

  return (
    left.scheduledStartSlot === right.scheduledStartSlot &&
    left.scheduledDurationHalfDays === right.scheduledDurationHalfDays
  );
}

function getPlannerRelevantDateRange(snapshot: PlannerState) {
  const dates: string[] = [];

  for (const project of snapshot.projects) {
    if (isScheduledProject(project)) {
      dates.push(project.scheduledStartSlot.slice(0, 10));
      continue;
    }

    if (project.targetDateHint) {
      dates.push(project.targetDateHint);
    }
  }

  for (const closure of snapshot.closures) {
    dates.push(closure.startDate, closure.endDate);
  }

  if (!dates.length) {
    const today = format(new Date(), "yyyy-MM-dd");
    return {
      startDate: shiftDate(today, -180),
      endDate: shiftDate(today, 180),
    };
  }

  const startDate = [...dates].sort()[0];
  const endDate = [...dates].sort().at(-1) ?? startDate;
  return {
    startDate: shiftDate(startDate, -180),
    endDate: shiftDate(endDate, 180),
  };
}

function buildProjectSpanById(args: {
  snapshot: PlannerState;
  calendarIndex: WorkingCalendarIndex;
  previousSnapshot?: PlannerState | null;
  previousProjectSpanById?: ReadonlyMap<string, ProjectScheduleSpan> | null;
}) {
  const previousById = new Map(
    (args.previousSnapshot?.projects ?? []).map((project) => [project.id, project] as const)
  );
  const projectSpanById = new Map<string, ProjectScheduleSpan>();

  for (const project of args.snapshot.projects) {
    if (!isScheduledProject(project)) {
      continue;
    }

    const previousProject = previousById.get(project.id);
    const previousSpan = args.previousProjectSpanById?.get(project.id) ?? null;
    if (previousSpan && haveSameScheduledPlacement(previousProject, project)) {
      projectSpanById.set(project.id, previousSpan);
      recordPlannerPerfProbeCount("reusedSpanCount");
      continue;
    }

    projectSpanById.set(
      project.id,
      args.calendarIndex.computeSpan(
        project.scheduledStartSlot,
        project.scheduledDurationHalfDays
      )
    );
  }

  return projectSpanById;
}

export function buildPlannerComputedSnapshot(
  snapshot: PlannerState,
  previousSnapshot?: PlannerState | null
): PlannerComputedSnapshot {
  const previousComputed =
    previousSnapshot ? plannerComputedSnapshotCache.get(previousSnapshot) ?? null : null;
  const relevantRange = getPlannerRelevantDateRange(snapshot);
  const calendarIndex = getWorkingCalendarIndex(snapshot.closures, relevantRange);
  const projectSpanById = buildProjectSpanById({
    snapshot,
    calendarIndex,
    previousSnapshot,
    previousProjectSpanById: previousComputed?.projectSpanById,
  });

  return {
    snapshot,
    calendarIndex,
    projectSpanById,
  };
}

export function primePlannerComputedSnapshot(
  snapshot: PlannerState,
  previousSnapshot?: PlannerState | null
) {
  const existing = plannerComputedSnapshotCache.get(snapshot);
  if (existing) {
    return existing;
  }

  const computed = buildPlannerComputedSnapshot(snapshot, previousSnapshot);
  plannerComputedSnapshotCache.set(snapshot, computed);
  return computed;
}

export function registerPlannerComputedSnapshot(
  snapshot: PlannerState,
  computed: PlannerComputedSnapshot
) {
  plannerComputedSnapshotCache.set(snapshot, computed);
  return computed;
}

export function getPlannerComputedSnapshot(snapshot: PlannerState) {
  return plannerComputedSnapshotCache.get(snapshot) ?? primePlannerComputedSnapshot(snapshot);
}

export function getProjectScheduleSpan(
  snapshot: PlannerState,
  projectId: string
) {
  return getPlannerComputedSnapshot(snapshot).projectSpanById.get(projectId) ?? null;
}

export function buildProjectSpanByIdFromProjects(args: {
  snapshot: PlannerState;
  projects: Project[];
}) {
  const relevantRange = getPlannerRelevantDateRange({
    ...args.snapshot,
    projects: args.projects,
  });
  const calendarIndex = getWorkingCalendarIndex(args.snapshot.closures, relevantRange);
  const projectSpanById = new Map<string, ProjectScheduleSpan>();

  for (const project of args.projects) {
    if (!isScheduledProject(project)) {
      continue;
    }

    projectSpanById.set(
      project.id,
      calendarIndex.computeSpan(
        project.scheduledStartSlot,
        project.scheduledDurationHalfDays
      )
    );
  }

  return projectSpanById;
}
