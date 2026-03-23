export const teamOptions = [
  { id: "team-a", label: "Team A", accent: "var(--team-a)" },
  { id: "team-b", label: "Team B", accent: "var(--team-b)" },
] as const;

export const zoomLevels = [
  "half-day",
  "day",
  "week",
  "month",
  "year",
] as const;

export const closureTypeOptions = [
  { id: "holiday", label: "Holiday" },
  { id: "company_closure", label: "Company closure" },
  { id: "custom_time_off", label: "Time off" },
] as const;

export type TeamId = (typeof teamOptions)[number]["id"];
export type ZoomLevel = (typeof zoomLevels)[number];
export type ClosureType = (typeof closureTypeOptions)[number]["id"];
export type ProjectStatus = "draft" | "scheduled";
export type SlotPart = "AM" | "PM";
export type SlotKey = `${string}-${SlotPart}`;

export type Project = {
  id: string;
  title: string;
  status: ProjectStatus;
  plannedTeam: TeamId;
  estimatedDurationHalfDays: number;
  scheduledTeam?: TeamId;
  scheduledStartSlot?: SlotKey;
  scheduledDurationHalfDays?: number;
  sequenceOrder?: number;
  targetDateHint?: string;
  notes?: string;
};

export type ProjectDependency = {
  id: string;
  predecessorProjectId: string;
  successorProjectId: string;
  lagHalfDays: number;
};

export type ClosurePeriod = {
  id: string;
  title: string;
  type: ClosureType;
  startDate: string;
  endDate: string;
};

export type PlannerState = {
  projects: Project[];
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
};

export type ProjectPlacement = {
  teamId: TeamId;
  startSlot: SlotKey;
  durationHalfDays: number;
};

export type ProjectEditorState = {
  title: string;
  plannedTeam: TeamId;
  estimatedDurationHalfDays: number;
  targetDateHint: string;
  notes: string;
  dependencyIds: string[];
};

export type ClosureFormState = {
  title: string;
  type: ClosureType;
  startDate: string;
  endDate: string;
};

export type ProjectMetrics = {
  scheduledCount: number;
  draftCount: number;
  blockedCount: number;
  closureCount: number;
};

export function isScheduledProject(project: Project): project is Project & {
  scheduledTeam: TeamId;
  scheduledStartSlot: SlotKey;
  scheduledDurationHalfDays: number;
  sequenceOrder: number;
} {
  return (
    project.status === "scheduled" &&
    Boolean(project.scheduledTeam) &&
    Boolean(project.scheduledStartSlot) &&
    typeof project.scheduledDurationHalfDays === "number" &&
    typeof project.sequenceOrder === "number"
  );
}
