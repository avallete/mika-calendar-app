"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
} from "react";

import {
  createClosureAction,
  createTeamAction,
  deleteClosureAction,
  deleteProjectAction,
  deleteTeamAction,
  loadPlannerSnapshotAction,
  placeProjectAction,
  placeProjectsAction,
  redoPlannerActionAction,
  resetDemoDataAction,
  saveProjectAction,
  setHolidaySourceEnabledAction,
  undoPlannerActionAction,
  unscheduleProjectAction,
  updateTeamAction,
} from "@/lib/planner/actions";
import { buildPlannerMetrics } from "@/lib/planner/scheduler";
import type {
  ClosureFormState,
  PlannerState,
  ProjectDeleteMode,
  ProjectEditorState,
  ProjectPlacement,
  ProjectPlacementOptions,
  ProjectPlacementRequest,
  TeamEditorState,
} from "@/lib/planner/types";

const SESSION_STORAGE_KEY = "planner-session-id";

function getOrCreateSessionId() {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextSessionId = window.crypto.randomUUID();
  window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
  return nextSessionId;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, [contenteditable='true'], [contenteditable='']")
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Une erreur inattendue est survenue.";
}

type PlannerContextValue = {
  state: PlannerState;
  metrics: ReturnType<typeof buildPlannerMetrics>;
  isPending: boolean;
  upsertProject: (values: ProjectEditorState, projectId?: string) => void;
  placeProject: (
    projectId: string,
    placement: ProjectPlacement,
    options?: ProjectPlacementOptions
  ) => void;
  placeProjects: (
    placements: ProjectPlacementRequest[],
    options?: ProjectPlacementOptions
  ) => void;
  unscheduleProject: (projectId: string) => void;
  deleteProject: (projectId: string, mode?: ProjectDeleteMode) => void;
  addClosure: (values: ClosureFormState) => void;
  removeClosure: (closureId: string) => void;
  createTeam: (values: TeamEditorState) => void;
  updateTeam: (teamId: string, values: TeamEditorState) => void;
  deleteTeam: (teamId: string) => void;
  setHolidaySourceEnabled: (sourceCode: string, enabled: boolean) => void;
  resetDemoData: () => void;
  undo: () => void;
  redo: () => void;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState: PlannerState;
}) {
  const [state, setState] = useState(initialState);
  const [sessionId] = useState<string | null>(() => getOrCreateSessionId());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    startTransition(() => {
      void loadPlannerSnapshotAction(sessionId)
        .then((snapshot) => {
          setState(snapshot);
        })
        .catch((error) => {
          window.alert(getErrorMessage(error));
        });
    });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = event.ctrlKey || event.metaKey;
      if (!modifierPressed || event.altKey || event.key.toLowerCase() !== "z") {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        startTransition(() => {
          void redoPlannerActionAction(sessionId)
            .then((snapshot) => setState(snapshot))
            .catch((error) => {
              window.alert(getErrorMessage(error));
            });
        });
        return;
      }

      startTransition(() => {
        void undoPlannerActionAction(sessionId)
          .then((snapshot) => setState(snapshot))
          .catch((error) => {
            window.alert(getErrorMessage(error));
          });
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sessionId]);

  const runMutation = (mutator: (session: string) => Promise<PlannerState>) => {
    if (!sessionId) {
      return;
    }

    startTransition(() => {
      void mutator(sessionId)
        .then((snapshot) => {
          setState(snapshot);
        })
        .catch((error) => {
          window.alert(getErrorMessage(error));
        });
    });
  };

  const value: PlannerContextValue = {
    state,
    metrics: buildPlannerMetrics(state),
    isPending,
    upsertProject(values, projectId) {
      runMutation((session) => saveProjectAction(session, values, projectId));
    },
    placeProject(projectId, placement, options) {
      runMutation((session) =>
        placeProjectAction(session, projectId, placement, options)
      );
    },
    placeProjects(placements, options) {
      runMutation((session) => placeProjectsAction(session, placements, options));
    },
    unscheduleProject(projectId) {
      runMutation((session) => unscheduleProjectAction(session, projectId));
    },
    deleteProject(projectId, mode) {
      runMutation((session) => deleteProjectAction(session, projectId, mode));
    },
    addClosure(values) {
      runMutation((session) => createClosureAction(session, values));
    },
    removeClosure(closureId) {
      runMutation((session) => deleteClosureAction(session, closureId));
    },
    createTeam(values) {
      runMutation((session) => createTeamAction(session, values));
    },
    updateTeam(teamId, values) {
      runMutation((session) => updateTeamAction(session, teamId, values));
    },
    deleteTeam(teamId) {
      runMutation((session) => deleteTeamAction(session, teamId));
    },
    setHolidaySourceEnabled(sourceCode, enabled) {
      runMutation((session) =>
        setHolidaySourceEnabledAction(session, sourceCode, enabled)
      );
    },
    resetDemoData() {
      runMutation((session) => resetDemoDataAction(session));
    },
    undo() {
      runMutation((session) => undoPlannerActionAction(session));
    },
    redo() {
      runMutation((session) => redoPlannerActionAction(session));
    },
  };

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner() {
  const context = useContext(PlannerContext);
  if (!context) {
    throw new Error("usePlanner must be used inside PlannerProvider.");
  }

  return context;
}
