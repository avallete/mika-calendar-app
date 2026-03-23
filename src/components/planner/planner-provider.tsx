"use client";

import { createContext, useContext, useMemo, useReducer } from "react";

import { initialPlannerState } from "@/lib/planner/sample-data";
import {
  buildPlannerMetrics,
  rescheduleProjects,
  updateProjectPlacement,
  wouldCreateDependencyCycle,
} from "@/lib/planner/scheduler";
import type {
  ClosureFormState,
  PlannerState,
  ProjectEditorState,
  ProjectPlacement,
} from "@/lib/planner/types";

type PlannerAction =
  | { type: "UPSERT_PROJECT"; projectId?: string; values: ProjectEditorState }
  | {
      type: "SET_DEPENDENCIES";
      projectId: string;
      dependencyIds: string[];
    }
  | {
      type: "PLACE_PROJECT";
      projectId: string;
      placement: ProjectPlacement;
    }
  | {
      type: "UNSCHEDULE_PROJECT";
      projectId: string;
    }
  | {
      type: "ADD_CLOSURE";
      values: ClosureFormState;
    }
  | {
      type: "REMOVE_CLOSURE";
      closureId: string;
    }
  | {
      type: "RESET";
    };

function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case "UPSERT_PROJECT": {
      const { projectId, values } = action;
      const nextProjects = state.projects.map((project) => ({ ...project }));
      const existing = nextProjects.find((project) => project.id === projectId);

      if (existing) {
        existing.title = values.title;
        existing.plannedTeam = values.plannedTeam;
        existing.estimatedDurationHalfDays = values.estimatedDurationHalfDays;
        existing.targetDateHint = values.targetDateHint || undefined;
        existing.notes = values.notes || undefined;
      } else {
        nextProjects.push({
          id: crypto.randomUUID(),
          title: values.title,
          status: "draft",
          plannedTeam: values.plannedTeam,
          estimatedDurationHalfDays: values.estimatedDurationHalfDays,
          targetDateHint: values.targetDateHint || undefined,
          notes: values.notes || undefined,
        });
      }

      return state.projects.some((project) => project.id === projectId)
        ? rescheduleProjects({ ...state, projects: nextProjects })
        : { ...state, projects: nextProjects };
    }
    case "SET_DEPENDENCIES": {
      const otherDependencies = state.dependencies.filter(
        (dependency) => dependency.successorProjectId !== action.projectId
      );
      const nextDependencies = [...otherDependencies];

      for (const predecessorProjectId of action.dependencyIds) {
        if (
          wouldCreateDependencyCycle(
            nextDependencies,
            predecessorProjectId,
            action.projectId
          )
        ) {
          continue;
        }

        nextDependencies.push({
          id: crypto.randomUUID(),
          predecessorProjectId,
          successorProjectId: action.projectId,
          lagHalfDays: 0,
        });
      }

      return rescheduleProjects({
        ...state,
        dependencies: nextDependencies,
      });
    }
    case "PLACE_PROJECT":
      return updateProjectPlacement(state, action.projectId, action.placement);
    case "UNSCHEDULE_PROJECT": {
      const nextProjects = state.projects.map((project) =>
        project.id === action.projectId
          ? {
              ...project,
              status: "draft" as const,
              scheduledTeam: undefined,
              scheduledStartSlot: undefined,
              scheduledDurationHalfDays: undefined,
              sequenceOrder: undefined,
            }
          : { ...project }
      );

      return rescheduleProjects({
        ...state,
        projects: nextProjects,
      });
    }
    case "ADD_CLOSURE":
      return rescheduleProjects({
        ...state,
        closures: [
          ...state.closures,
          {
            id: crypto.randomUUID(),
            title: action.values.title,
            type: action.values.type,
            startDate: action.values.startDate,
            endDate: action.values.endDate,
          },
        ],
      });
    case "REMOVE_CLOSURE":
      return rescheduleProjects({
        ...state,
        closures: state.closures.filter((closure) => closure.id !== action.closureId),
      });
    case "RESET":
      return initialPlannerState;
    default:
      return state;
  }
}

type PlannerContextValue = {
  state: PlannerState;
  metrics: ReturnType<typeof buildPlannerMetrics>;
  upsertProject: (values: ProjectEditorState, projectId?: string) => void;
  setDependencies: (projectId: string, dependencyIds: string[]) => void;
  placeProject: (projectId: string, placement: ProjectPlacement) => void;
  unscheduleProject: (projectId: string) => void;
  addClosure: (values: ClosureFormState) => void;
  removeClosure: (closureId: string) => void;
  resetDemoData: () => void;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(plannerReducer, initialPlannerState);

  const value = useMemo<PlannerContextValue>(
    () => ({
      state,
      metrics: buildPlannerMetrics(state),
      upsertProject(values, projectId) {
        dispatch({ type: "UPSERT_PROJECT", values, projectId });
        if (projectId) {
          dispatch({ type: "SET_DEPENDENCIES", projectId, dependencyIds: values.dependencyIds });
        }
      },
      setDependencies(projectId, dependencyIds) {
        dispatch({ type: "SET_DEPENDENCIES", projectId, dependencyIds });
      },
      placeProject(projectId, placement) {
        dispatch({ type: "PLACE_PROJECT", projectId, placement });
      },
      unscheduleProject(projectId) {
        dispatch({ type: "UNSCHEDULE_PROJECT", projectId });
      },
      addClosure(values) {
        dispatch({ type: "ADD_CLOSURE", values });
      },
      removeClosure(closureId) {
        dispatch({ type: "REMOVE_CLOSURE", closureId });
      },
      resetDemoData() {
        dispatch({ type: "RESET" });
      },
    }),
    [state]
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner() {
  const context = useContext(PlannerContext);
  if (!context) {
    throw new Error("usePlanner must be used inside PlannerProvider.");
  }

  return context;
}
