import { describe, expect, test } from "bun:test";

import { buildPlannerDemoState } from "@/lib/planner/sample-data";
import { buildTimelineYearRange } from "@/lib/planner/timeline-range";
import { isScheduledProject } from "@/lib/planner/types";

function hasDependencyCycle(projectIds: string[], edges: Array<{ predecessorProjectId: string; successorProjectId: string }>) {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const projectId of projectIds) {
    adjacency.set(projectId, []);
    indegree.set(projectId, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.predecessorProjectId)?.push(edge.successorProjectId);
    indegree.set(edge.successorProjectId, (indegree.get(edge.successorProjectId) ?? 0) + 1);
  }

  const queue = [...projectIds.filter((projectId) => (indegree.get(projectId) ?? 0) === 0)];
  let visited = 0;

  while (queue.length) {
    const current = queue.shift()!;
    visited += 1;

    for (const successor of adjacency.get(current) ?? []) {
      const nextIndegree = (indegree.get(successor) ?? 0) - 1;
      indegree.set(successor, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(successor);
      }
    }
  }

  return visited !== projectIds.length;
}

describe("planner sample data", () => {
  test("builds the heavy-load demo dataset with the expected variety", () => {
    const fixedNow = new Date(2026, 2, 25, 12);
    const snapshot = buildPlannerDemoState(fixedNow);
    const scheduledProjects = snapshot.projects.filter(isScheduledProject);
    const draftProjects = snapshot.projects.filter((project) => project.status === "draft");
    const projectIds = new Set(snapshot.projects.map((project) => project.id));
    const scheduledTeamIds = new Set(scheduledProjects.map((project) => project.scheduledTeam));
    const plannedTeamIds = new Set(snapshot.projects.map((project) => project.plannedTeam));
    const durations = new Set(snapshot.projects.map((project) => project.estimatedDurationHalfDays));
    const lagValues = new Set(snapshot.dependencies.map((dependency) => dependency.lagHalfDays));
    const yearRange = buildTimelineYearRange(
      snapshot.projects,
      snapshot.customClosures,
      fixedNow
    );

    expect(snapshot.teams).toHaveLength(5);
    expect(scheduledProjects).toHaveLength(200);
    expect(draftProjects).toHaveLength(500);
    expect(snapshot.dependencies).toHaveLength(120);
    expect(snapshot.customClosures).toHaveLength(12);
    expect(snapshot.customClosures.filter((closure) => closure.type === "company_closure")).toHaveLength(4);
    expect(snapshot.customClosures.filter((closure) => closure.type === "custom_time_off")).toHaveLength(4);
    expect(snapshot.customClosures.filter((closure) => closure.type === "weather")).toHaveLength(4);
    expect(new Set(snapshot.projects.map((project) => project.id)).size).toBe(snapshot.projects.length);
    expect(new Set(snapshot.dependencies.map((dependency) => dependency.id)).size).toBe(
      snapshot.dependencies.length
    );
    expect(plannedTeamIds.size).toBe(5);
    expect(scheduledTeamIds.size).toBe(5);
    expect(durations.size).toBeGreaterThanOrEqual(6);
    expect(lagValues.size).toBeGreaterThan(1);
    expect(snapshot.dependencies.some((dependency) => dependency.lagHalfDays > 0)).toBe(true);

    for (const project of scheduledProjects) {
      expect(project.scheduledTeam).toBeDefined();
      expect(project.scheduledStartSlot).toBeDefined();
      expect(project.scheduledDurationHalfDays).toBeGreaterThan(0);
      expect(project.sequenceOrder).toBeGreaterThanOrEqual(0);
    }

    for (const project of draftProjects) {
      expect(project.scheduledTeam).toBeUndefined();
      expect(project.scheduledStartSlot).toBeUndefined();
      expect(project.scheduledDurationHalfDays).toBeUndefined();
      expect(project.sequenceOrder).toBeUndefined();
    }

    for (const dependency of snapshot.dependencies) {
      expect(dependency.predecessorProjectId).not.toBe(dependency.successorProjectId);
      expect(projectIds.has(dependency.predecessorProjectId)).toBe(true);
      expect(projectIds.has(dependency.successorProjectId)).toBe(true);
    }

    expect(
      hasDependencyCycle(
        snapshot.projects.map((project) => project.id),
        snapshot.dependencies
      )
    ).toBe(false);
    expect(yearRange.years.length).toBeGreaterThanOrEqual(4);
    expect(yearRange.startYear).toBeLessThanOrEqual(2025);
    expect(yearRange.endYear).toBeGreaterThanOrEqual(2028);
  });
});
