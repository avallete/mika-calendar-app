export const teamOptions = [
  { id: "team-a", label: "Team A", accent: "var(--team-a)" },
  { id: "team-b", label: "Team B", accent: "var(--team-b)" },
] as const;

export const zoomLevels = [
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
export type ProjectDeleteMode = "preserve-dates" | "compact-schedule";
export type ProjectPlacementStrategy = "preserve" | "compact-same-team";
export type DependencyResolutionMode =
  | "preserve-dependencies"
  | "break-conflicting-links";
export type SlotPart = "AM" | "PM";
export type SlotKey = `${string}-${SlotPart}`;
export type ScheduledDragIntent = "move" | "resize-start" | "resize-end";

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

export type ProjectPlacementRequest = {
  projectId: string;
  placement: ProjectPlacement;
};

export type DependencyConflict = {
  id: string;
  predecessorProjectId: string;
  predecessorTitle: string;
  successorProjectId: string;
  successorTitle: string;
  lagHalfDays: number;
};

export type ProjectPlacementOptions = {
  strategy?: ProjectPlacementStrategy;
  source?: string;
  dependencyResolution?: DependencyResolutionMode;
  removeDependencyIds?: string[];
  traceMetadata?: Record<string, unknown>;
};

export type CalendarBucket = {
  bucketId: string;
  teamId: TeamId;
  startSlot: SlotKey;
  granularity: "slot" | "day";
};

export type DragProjectMeta =
  | {
      type: "draft";
      projectId: string;
      durationHalfDays: number;
      title: string;
    }
  | {
      type: "scheduled";
      intent: ScheduledDragIntent;
      projectId: string;
      teamId: TeamId;
      startSlot: SlotKey;
      durationHalfDays: number;
      calendarEndSlot: SlotKey;
      title: string;
      selectionProjectIds?: string[];
    };

export type QuickPlacementState = {
  projectId: string;
  title: string;
  triggerId: string;
  placement: ProjectPlacement;
};

export type EarlierShiftPromptState = {
  projectId: string;
  title: string;
  interaction: Extract<ScheduledDragIntent, "move" | "resize-start">;
  previousStartSlot: SlotKey;
  placement: ProjectPlacement;
};

export type DependencyConflictPromptState = {
  projectIds: string[];
  placements: ProjectPlacementRequest[];
  primaryProjectId: string;
  primaryTitle: string;
  conflicts: DependencyConflict[];
  source: string;
  traceMetadata?: Record<string, unknown>;
};

export type YearMonthSection = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  dayCount: number;
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
