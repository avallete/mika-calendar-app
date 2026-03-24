"use server";

import type {
  ClosureFormState,
  ProjectDeleteMode,
  ProjectEditorState,
  ProjectPlacement,
  ProjectPlacementOptions,
  ProjectPlacementRequest,
  TeamEditorState,
} from "@/lib/planner/types";
import {
  createClosure,
  createTeam,
  deleteClosure,
  deleteProject,
  deleteTeam,
  loadPlannerSnapshot,
  placeProject,
  placeProjects,
  redoPlannerAction,
  resetDemoData,
  saveProject,
  setHolidaySourceEnabled,
  undoPlannerAction,
  unscheduleProject,
  updateTeam,
} from "@/lib/planner/store";

export async function loadPlannerSnapshotAction(sessionId?: string) {
  return loadPlannerSnapshot(sessionId);
}

export async function saveProjectAction(
  sessionId: string,
  values: ProjectEditorState,
  projectId?: string
) {
  return saveProject(sessionId, values, projectId);
}

export async function placeProjectAction(
  sessionId: string,
  projectId: string,
  placement: ProjectPlacement,
  options?: ProjectPlacementOptions
) {
  return placeProject(sessionId, projectId, placement, options);
}

export async function placeProjectsAction(
  sessionId: string,
  placements: ProjectPlacementRequest[],
  options?: ProjectPlacementOptions
) {
  return placeProjects(sessionId, placements, options);
}

export async function unscheduleProjectAction(sessionId: string, projectId: string) {
  return unscheduleProject(sessionId, projectId);
}

export async function deleteProjectAction(
  sessionId: string,
  projectId: string,
  mode?: ProjectDeleteMode
) {
  return deleteProject(sessionId, projectId, mode);
}

export async function createClosureAction(sessionId: string, values: ClosureFormState) {
  return createClosure(sessionId, values);
}

export async function deleteClosureAction(sessionId: string, closureId: string) {
  return deleteClosure(sessionId, closureId);
}

export async function createTeamAction(sessionId: string, values: TeamEditorState) {
  return createTeam(sessionId, values);
}

export async function updateTeamAction(
  sessionId: string,
  teamId: string,
  values: TeamEditorState
) {
  return updateTeam(sessionId, teamId, values);
}

export async function deleteTeamAction(sessionId: string, teamId: string) {
  return deleteTeam(sessionId, teamId);
}

export async function setHolidaySourceEnabledAction(
  sessionId: string,
  sourceCode: string,
  enabled: boolean
) {
  return setHolidaySourceEnabled(sessionId, sourceCode, enabled);
}

export async function resetDemoDataAction(sessionId: string) {
  return resetDemoData(sessionId);
}

export async function undoPlannerActionAction(sessionId: string) {
  return undoPlannerAction(sessionId);
}

export async function redoPlannerActionAction(sessionId: string) {
  return redoPlannerAction(sessionId);
}
