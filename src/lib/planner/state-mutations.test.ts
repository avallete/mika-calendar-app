import { describe, expect, test } from "bun:test";

import { deleteTeamInState, updateTeamInState } from "@/lib/planner/state-mutations";
import { initialPlannerState } from "@/lib/planner/sample-data";

describe("planner state mutations", () => {
  test("blocks deleting a team that is still referenced by projects", () => {
    expect(() => deleteTeamInState(initialPlannerState, initialPlannerState.teams[0].id)).toThrow(
      "Impossible de supprimer une equipe encore referencee par des projets."
    );
  });

  test("updates team metadata in place", () => {
    const nextState = updateTeamInState(
      initialPlannerState,
      initialPlannerState.teams[0].id,
      {
        nameFr: "Equipe Produit",
        slug: "equipe-produit",
        accentColor: "oklch(0.62 0.1 210)",
        softColor: "oklch(0.95 0.02 210)",
        displayOrder: 4,
      }
    );

    expect(nextState.teams.find((team) => team.id === initialPlannerState.teams[0].id)).toEqual(
      expect.objectContaining({
        nameFr: "Equipe Produit",
        slug: "equipe-produit",
        accentColor: "oklch(0.62 0.1 210)",
        softColor: "oklch(0.95 0.02 210)",
        displayOrder: 4,
      })
    );
  });
});
