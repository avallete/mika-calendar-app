export const zoomLevels = ["year"] as const;

export const closureTypeOptions = [
  { id: "holiday", labelFr: "Jour ferie" },
  { id: "company_closure", labelFr: "Fermeture" },
  { id: "custom_time_off", labelFr: "Indisponibilite" },
  { id: "weather", labelFr: "Meteo" },
  { id: "annotation", labelFr: "Annotation" },
] as const;

export type TeamId = string;
export type ZoomLevel = (typeof zoomLevels)[number];
export type ClosureType = (typeof closureTypeOptions)[number]["id"];
export type ClosureImpact = "blocking" | "advisory";
export type ClosureSource = "custom" | "fr-public-holiday";
export type ProjectStatus = "draft" | "scheduled";
export type ProjectDeleteMode = "preserve-dates" | "compact-schedule";
export type ProjectPlacementStrategy = "preserve" | "compact-same-team";
export type DependencyResolutionMode =
  | "preserve-dependencies"
  | "break-conflicting-links";
export type SlotPart = "AM" | "PM";
export type SlotKey = `${string}-${SlotPart}`;
export type ScheduledDragIntent = "move" | "resize-start" | "resize-end";

export type Team = {
  id: TeamId;
  slug: string;
  nameFr: string;
  displayOrder: number;
  accentColor: string;
  softColor: string;
  isActive: boolean;
};

export type HolidaySource = {
  id: string;
  code: string;
  labelFr: string;
  enabled: boolean;
};

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
  impact: ClosureImpact;
  details?: string;
  source: ClosureSource;
  editable: boolean;
};

export type CalendarDayMarkerTone =
  | "custom-blocking"
  | "public-holiday"
  | "weekend"
  | "advisory"
  | "working";

export type CalendarDayMarker = {
  id: string;
  title: string;
  shortLabelFr: string;
  type: ClosureType | "weekend";
  source: ClosureSource | "derived";
  impact: ClosureImpact;
  startDate: string;
  endDate: string;
  details?: string;
  tone: Exclude<CalendarDayMarkerTone, "working">;
};

export type CalendarDayState = {
  date: string;
  markers: CalendarDayMarker[];
  isBlocking: boolean;
  tone: CalendarDayMarkerTone;
};

export type PlannerHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
};

export type PlannerState = {
  teams: Team[];
  holidaySources: HolidaySource[];
  projects: Project[];
  dependencies: ProjectDependency[];
  closures: ClosurePeriod[];
  history: PlannerHistoryState;
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
  year: number;
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
  impact: ClosureImpact;
  details: string;
};

export type TeamEditorState = {
  nameFr: string;
  slug: string;
  accentColor: string;
  softColor: string;
  displayOrder: number;
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

export function getSortedTeams(teams: Team[]) {
  return [...teams]
    .filter((team) => team.isActive)
    .sort((left, right) => {
      if (left.displayOrder !== right.displayOrder) {
        return left.displayOrder - right.displayOrder;
      }

      return left.nameFr.localeCompare(right.nameFr, "fr");
    });
}

export function getTeamById(teams: Team[], teamId: TeamId | undefined) {
  if (!teamId) {
    return null;
  }

  return teams.find((team) => team.id === teamId) ?? null;
}
