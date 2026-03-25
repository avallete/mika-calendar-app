import { addDays, format, parseISO } from "date-fns";

import { advanceWorkingDuration, compareSlotKeys, parseSlotKey } from "@/lib/planner/calendar";
import { makeCalendarRowSurfaceId } from "@/lib/planner/timeline-hover";
import { getTimelineSectionIdsForScheduledProject } from "@/lib/planner/timeline-preview";
import type {
  CalendarBucket,
  CalendarRowSurface,
  ClosurePeriod,
  ProjectDependency,
  QuickPlacementState,
  ScheduledTimelineProject,
  SlotKey,
  Team,
  TeamId,
  YearMonthSection,
} from "@/lib/planner/types";

export type SectionTeamProjectMap = Map<string, Map<TeamId, ScheduledTimelineProject[]>>;

export type TimelineBounds = {
  left: string;
  width: string;
};

export type TimelineScheduledCardView = {
  project: ScheduledTimelineProject;
  calendarEndSlot: SlotKey;
  bounds: TimelineBounds;
  dependencyCount: number;
  selected: boolean;
};

export type TimelinePreviewCardView = {
  project: ScheduledTimelineProject;
  bounds: TimelineBounds;
  primary: boolean;
};

export type TimelineTeamRowView = {
  team: Team;
  surface: CalendarRowSurface;
  scheduledCount: number;
  scheduledCards: TimelineScheduledCardView[];
};

export type TimelineDimmedCardView = {
  projectId: string;
  bounds: TimelineBounds;
};

export type TimelineTeamOverlayView = {
  team: Team;
  hoveredBucket: CalendarBucket | null;
  hoveredBounds: TimelineBounds | null;
  pendingBucket: { bucketId: string; startSlot: SlotKey } | null;
  pendingBounds: TimelineBounds | null;
  dimmedCards: TimelineDimmedCardView[];
  previewCards: TimelinePreviewCardView[];
};

export const EMPTY_SCHEDULED_PROJECTS: ScheduledTimelineProject[] = [];
export const EMPTY_SECTION_TEAM_PROJECTS: SectionTeamProjectMap = new Map();
export const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();

export function buildSectionTeamProjectMap(
  projects: ScheduledTimelineProject[],
  closures: ClosurePeriod[]
): SectionTeamProjectMap {
  const projectsBySection = new Map<string, Map<TeamId, ScheduledTimelineProject[]>>();

  for (const project of projects) {
    for (const sectionId of getTimelineSectionIdsForScheduledProject(project, closures)) {
      const sectionProjects =
        projectsBySection.get(sectionId) ?? new Map<TeamId, ScheduledTimelineProject[]>();
      const teamProjects = sectionProjects.get(project.scheduledTeam) ?? [];
      teamProjects.push(project);
      sectionProjects.set(project.scheduledTeam, teamProjects);
      projectsBySection.set(sectionId, sectionProjects);
    }
  }

  for (const sectionProjects of projectsBySection.values()) {
    for (const teamProjects of sectionProjects.values()) {
      teamProjects.sort((left, right) => {
        const startComparison = compareSlotKeys(
          left.scheduledStartSlot,
          right.scheduledStartSlot
        );

        if (startComparison !== 0) {
          return startComparison;
        }

        if (left.sequenceOrder !== right.sequenceOrder) {
          return left.sequenceOrder - right.sequenceOrder;
        }

        return left.id.localeCompare(right.id);
      });
    }
  }

  return projectsBySection;
}

export function buildDependencyCountByProjectId(dependencies: ProjectDependency[]) {
  const counts = new Map<string, number>();

  for (const dependency of dependencies) {
    counts.set(
      dependency.successorProjectId,
      (counts.get(dependency.successorProjectId) ?? 0) + 1
    );
  }

  return counts;
}

export function getSectionTeamProjects(
  projectsBySection: SectionTeamProjectMap,
  sectionId: string,
  teamId: TeamId
) {
  return projectsBySection.get(sectionId)?.get(teamId) ?? EMPTY_SCHEDULED_PROJECTS;
}

export function slotBelongsToSection(slotKey: SlotKey, section: YearMonthSection) {
  const { date } = parseSlotKey(slotKey);
  return date >= section.startDate && date <= section.endDate;
}

export function getSlotBoundsInSection(
  slotKey: SlotKey,
  section: YearMonthSection
): TimelineBounds | null {
  if (!slotBelongsToSection(slotKey, section)) {
    return null;
  }

  const { date, part } = parseSlotKey(slotKey);
  const dayOffset =
    (parseISO(date).getTime() - parseISO(section.startDate).getTime()) /
      (1000 * 60 * 60 * 24) +
    (part === "PM" ? 0.5 : 0);

  return {
    left: `${(dayOffset / section.dayCount) * 100}%`,
    width: `${(0.5 / section.dayCount) * 100}%`,
  };
}

export function getMonthSegmentBounds(
  startSlot: SlotKey,
  endSlotExclusive: SlotKey,
  section: YearMonthSection
): { startOffset: number; endOffset: number } | null {
  const monthStartSlot = `${section.startDate}-AM` as SlotKey;
  const monthEndExclusive = `${format(
    addDays(parseISO(section.endDate), 1),
    "yyyy-MM-dd"
  )}-AM` as SlotKey;

  const boundedStart =
    compareSlotKeys(startSlot, monthStartSlot) < 0 ? monthStartSlot : startSlot;
  const boundedEnd =
    compareSlotKeys(endSlotExclusive, monthEndExclusive) > 0
      ? monthEndExclusive
      : endSlotExclusive;

  if (compareSlotKeys(boundedEnd, boundedStart) <= 0) {
    return null;
  }

  const toOffset = (slotKey: SlotKey) => {
    const { date, part } = parseSlotKey(slotKey);
    const dayOffset =
      (parseISO(date).getTime() - parseISO(section.startDate).getTime()) /
      (1000 * 60 * 60 * 24);
    return dayOffset + (part === "PM" ? 0.5 : 0);
  };

  return {
    startOffset: toOffset(boundedStart),
    endOffset: toOffset(boundedEnd),
  };
}

export function scopeSectionPreviewState(args: {
  section: YearMonthSection;
  previewTouchedSectionIdSet: ReadonlySet<string>;
  previewProjectsBySection: SectionTeamProjectMap;
  previewChangedProjectIdSet: ReadonlySet<string>;
  previewPrimaryProjectId: string | null;
  hoveredBucket: CalendarBucket | null;
}) {
  const {
    section,
    previewTouchedSectionIdSet,
    previewProjectsBySection,
    previewChangedProjectIdSet,
    previewPrimaryProjectId,
    hoveredBucket,
  } = args;

  const sectionTouched = previewTouchedSectionIdSet.has(section.id);

  return {
    previewProjectsBySection: sectionTouched
      ? previewProjectsBySection
      : EMPTY_SECTION_TEAM_PROJECTS,
    previewChangedProjectIdSet: sectionTouched
      ? previewChangedProjectIdSet
      : EMPTY_STRING_SET,
    previewPrimaryProjectId: sectionTouched ? previewPrimaryProjectId : null,
    hoveredBucket:
      hoveredBucket && slotBelongsToSection(hoveredBucket.startSlot, section)
        ? hoveredBucket
        : null,
  };
}

export function buildTimelineSectionRowViews(args: {
  teams: Team[];
  section: YearMonthSection;
  closures: ClosurePeriod[];
  committedProjectsBySection: SectionTeamProjectMap;
  dependencyCountByProjectId: Map<string, number>;
  selectedProjectIdSet: ReadonlySet<string>;
}) {
  const {
    teams,
    section,
    closures,
    committedProjectsBySection,
    dependencyCountByProjectId,
    selectedProjectIdSet,
  } = args;

  return teams.map((team) => {
    const surface: CalendarRowSurface = {
      surfaceId: makeCalendarRowSurfaceId(section.id, team.id),
      sectionId: section.id,
      teamId: team.id,
      startDate: section.startDate,
      dayCount: section.dayCount,
      granularity: "row-surface",
    };

    const committedProjects = getSectionTeamProjects(
      committedProjectsBySection,
      section.id,
      team.id
    );
    const scheduledCards: TimelineScheduledCardView[] = [];

    for (const project of committedProjects) {
      const computed = advanceWorkingDuration(
        project.scheduledStartSlot,
        project.scheduledDurationHalfDays,
        closures
      );
      const bounds = getMonthSegmentBounds(
        project.scheduledStartSlot,
        computed.calendarEndSlot,
        section
      );

      if (!bounds) {
        continue;
      }

      scheduledCards.push({
        project,
        calendarEndSlot: computed.calendarEndSlot,
        bounds: {
          left: `${(bounds.startOffset / section.dayCount) * 100}%`,
          width: `${(Math.max(bounds.endOffset - bounds.startOffset, 0.48) / section.dayCount) * 100}%`,
        },
        dependencyCount: dependencyCountByProjectId.get(project.id) ?? 0,
        selected: selectedProjectIdSet.has(project.id),
      });
    }

    return {
      team,
      surface,
      scheduledCount: committedProjects.length,
      scheduledCards,
    } satisfies TimelineTeamRowView;
  });
}

export function buildTimelineSectionOverlayViews(args: {
  rowViews: TimelineTeamRowView[];
  section: YearMonthSection;
  closures: ClosurePeriod[];
  previewProjectsBySection: SectionTeamProjectMap;
  previewChangedProjectIdSet: ReadonlySet<string>;
  previewPrimaryProjectId: string | null;
  pendingPlacement: QuickPlacementState | null;
  hoveredBucket: CalendarBucket | null;
}) {
  const {
    rowViews,
    section,
    closures,
    previewProjectsBySection,
    previewChangedProjectIdSet,
    previewPrimaryProjectId,
    pendingPlacement,
    hoveredBucket,
  } = args;

  return rowViews.map((rowView) => {
    const previewProjects = getSectionTeamProjects(
      previewProjectsBySection,
      section.id,
      rowView.team.id
    );
    const hoveredBucketInRow =
      hoveredBucket &&
      hoveredBucket.teamId === rowView.team.id &&
      slotBelongsToSection(hoveredBucket.startSlot, section)
        ? hoveredBucket
        : null;
    const hoveredBounds = hoveredBucketInRow
      ? getSlotBoundsInSection(hoveredBucketInRow.startSlot, section)
      : null;
    const pendingBucket =
      pendingPlacement &&
      pendingPlacement.placement.teamId === rowView.team.id &&
      slotBelongsToSection(pendingPlacement.placement.startSlot, section)
        ? {
            bucketId: pendingPlacement.triggerId,
            startSlot: pendingPlacement.placement.startSlot,
          }
        : null;
    const pendingBounds = pendingBucket
      ? getSlotBoundsInSection(pendingBucket.startSlot, section)
      : null;
    const dimmedCards = rowView.scheduledCards
      .filter((card) => previewChangedProjectIdSet.has(card.project.id))
      .map((card) => ({
        projectId: card.project.id,
        bounds: card.bounds,
      }));
    const previewCards: TimelinePreviewCardView[] = [];

    for (const project of previewProjects) {
      if (!previewChangedProjectIdSet.has(project.id)) {
        continue;
      }

      const computed = advanceWorkingDuration(
        project.scheduledStartSlot,
        project.scheduledDurationHalfDays,
        closures
      );
      const bounds = getMonthSegmentBounds(
        project.scheduledStartSlot,
        computed.calendarEndSlot,
        section
      );

      if (!bounds) {
        continue;
      }

      previewCards.push({
        project,
        bounds: {
          left: `${(bounds.startOffset / section.dayCount) * 100}%`,
          width: `${(Math.max(bounds.endOffset - bounds.startOffset, 0.48) / section.dayCount) * 100}%`,
        },
        primary: project.id === previewPrimaryProjectId,
      });
    }

    return {
      team: rowView.team,
      hoveredBucket: hoveredBucketInRow,
      hoveredBounds,
      pendingBucket,
      pendingBounds,
      dimmedCards,
      previewCards,
    } satisfies TimelineTeamOverlayView;
  });
}
