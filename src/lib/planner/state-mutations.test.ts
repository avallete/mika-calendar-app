import { describe, expect, test } from "bun:test";

import {
  addClosureInState,
  deleteTeamInState,
  resetPlannerDemoDataInState,
  updateTeamInState,
} from "@/lib/planner/state-mutations";
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

  test("stores impact and details for custom markers", () => {
    const nextState = addClosureInState(initialPlannerState, {
      title: "Averse continue",
      type: "weather",
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      impact: "advisory",
      details: "Prevoir baches et temps de pose reduit.",
    });

    expect(nextState.closures.find((closure) => closure.title === "Averse continue")).toEqual(
      expect.objectContaining({
        type: "weather",
        impact: "advisory",
        details: "Prevoir baches et temps de pose reduit.",
      })
    );
  });

  test("resets planner state back to the roofing demo data", () => {
    const mutated = updateTeamInState(initialPlannerState, initialPlannerState.teams[0].id, {
      nameFr: "Equipe Mutation",
      slug: "mutation",
      accentColor: "#111111",
      softColor: "#EEEEEE",
      displayOrder: 8,
    });

    const reset = resetPlannerDemoDataInState(mutated);

    expect(reset.teams).toEqual(initialPlannerState.teams);
    expect(reset.projects).toEqual(initialPlannerState.projects);
    expect(reset.dependencies).toEqual(initialPlannerState.dependencies);
    expect(reset.closures).toEqual(initialPlannerState.closures);
    expect(reset.holidaySources).toEqual(initialPlannerState.holidaySources);
  });
});
