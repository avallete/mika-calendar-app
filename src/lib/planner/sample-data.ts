import { addDays, format } from "date-fns";

import { makeSlotKey } from "@/lib/planner/calendar";
import { rescheduleProjects } from "@/lib/planner/scheduler";
import type { PlannerState } from "@/lib/planner/types";

const today = new Date("2026-03-23T08:00:00Z");

export const initialPlannerState: PlannerState = rescheduleProjects({
  projects: [
    {
      id: "project-kickoff",
      title: "Concept workshop",
      status: "scheduled",
      plannedTeam: "team-a",
      estimatedDurationHalfDays: 4,
      scheduledTeam: "team-a",
      scheduledStartSlot: makeSlotKey(format(addDays(today, 1), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 4,
      sequenceOrder: 0,
      targetDateHint: format(addDays(today, 4), "yyyy-MM-dd"),
      notes: "Initial workshop with the client and internal kickoff package.",
    },
    {
      id: "project-spec",
      title: "Specification draft",
      status: "scheduled",
      plannedTeam: "team-a",
      estimatedDurationHalfDays: 5,
      scheduledTeam: "team-a",
      scheduledStartSlot: makeSlotKey(format(addDays(today, 4), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 5,
      sequenceOrder: 1,
      targetDateHint: format(addDays(today, 8), "yyyy-MM-dd"),
      notes: "Formal planning package and dependency capture.",
    },
    {
      id: "project-build",
      title: "Build & review",
      status: "scheduled",
      plannedTeam: "team-b",
      estimatedDurationHalfDays: 8,
      scheduledTeam: "team-b",
      scheduledStartSlot: makeSlotKey(format(addDays(today, 9), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 8,
      sequenceOrder: 0,
      targetDateHint: format(addDays(today, 18), "yyyy-MM-dd"),
      notes: "Implementation workstream after Team A sign-off.",
    },
    {
      id: "project-handover",
      title: "Client handover",
      status: "scheduled",
      plannedTeam: "team-b",
      estimatedDurationHalfDays: 2,
      scheduledTeam: "team-b",
      scheduledStartSlot: makeSlotKey(format(addDays(today, 16), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 2,
      sequenceOrder: 1,
      targetDateHint: format(addDays(today, 20), "yyyy-MM-dd"),
      notes: "Final review and handover meeting.",
    },
    {
      id: "draft-identity",
      title: "Identity refresh",
      status: "draft",
      plannedTeam: "team-a",
      estimatedDurationHalfDays: 6,
      targetDateHint: format(addDays(today, 28), "yyyy-MM-dd"),
      notes: "Draft project waiting for an approved slot.",
    },
    {
      id: "draft-packaging",
      title: "Packaging concept",
      status: "draft",
      plannedTeam: "team-b",
      estimatedDurationHalfDays: 3,
      targetDateHint: format(addDays(today, 35), "yyyy-MM-dd"),
      notes: "Can start after the current Team B queue clears.",
    },
  ],
  dependencies: [
    {
      id: "dep-spec-build",
      predecessorProjectId: "project-spec",
      successorProjectId: "project-build",
      lagHalfDays: 0,
    },
    {
      id: "dep-build-handover",
      predecessorProjectId: "project-build",
      successorProjectId: "project-handover",
      lagHalfDays: 0,
    },
  ],
  closures: [
    {
      id: "closure-easter",
      title: "Easter closure",
      type: "company_closure",
      startDate: "2026-04-06",
      endDate: "2026-04-07",
    },
    {
      id: "holiday-labour",
      title: "Labour Day",
      type: "holiday",
      startDate: "2026-05-01",
      endDate: "2026-05-01",
    },
  ],
});
