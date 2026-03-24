import { addDays, format } from "date-fns";

import type { HolidaySource, PlannerState, Team } from "@/lib/planner/types";
import { makeSlotKey } from "@/lib/planner/calendar";

const today = new Date("2026-03-24T08:00:00Z");

export const seedTeams: Team[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "equipe-a",
    nameFr: "Equipe A",
    displayOrder: 0,
    accentColor: "oklch(0.58 0.11 205)",
    softColor: "oklch(0.95 0.03 205)",
    isActive: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "equipe-b",
    nameFr: "Equipe B",
    displayOrder: 1,
    accentColor: "oklch(0.68 0.13 55)",
    softColor: "oklch(0.96 0.04 55)",
    isActive: true,
  },
];

export const seedHolidaySources: HolidaySource[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    code: "FR",
    labelFr: "Jours feries France",
    enabled: true,
  },
];

export const initialPlannerState: PlannerState = {
  teams: seedTeams,
  holidaySources: seedHolidaySources,
  projects: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Atelier de cadrage",
      status: "scheduled",
      plannedTeam: seedTeams[0].id,
      estimatedDurationHalfDays: 4,
      scheduledTeam: seedTeams[0].id,
      scheduledStartSlot: makeSlotKey(format(addDays(today, 1), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 4,
      sequenceOrder: 0,
      targetDateHint: format(addDays(today, 4), "yyyy-MM-dd"),
      notes: "Lancement client et collecte des hypotheses de travail.",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      title: "Dossier de specification",
      status: "scheduled",
      plannedTeam: seedTeams[0].id,
      estimatedDurationHalfDays: 5,
      scheduledTeam: seedTeams[0].id,
      scheduledStartSlot: makeSlotKey(format(addDays(today, 4), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 5,
      sequenceOrder: 1,
      targetDateHint: format(addDays(today, 8), "yyyy-MM-dd"),
      notes: "Formalisation du planning et des dependances.",
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      title: "Production et revue",
      status: "scheduled",
      plannedTeam: seedTeams[1].id,
      estimatedDurationHalfDays: 8,
      scheduledTeam: seedTeams[1].id,
      scheduledStartSlot: makeSlotKey(format(addDays(today, 9), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 8,
      sequenceOrder: 0,
      targetDateHint: format(addDays(today, 18), "yyyy-MM-dd"),
      notes: "Realisation apres validation de l'Equipe A.",
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      title: "Passation client",
      status: "scheduled",
      plannedTeam: seedTeams[1].id,
      estimatedDurationHalfDays: 2,
      scheduledTeam: seedTeams[1].id,
      scheduledStartSlot: makeSlotKey(format(addDays(today, 16), "yyyy-MM-dd"), "AM"),
      scheduledDurationHalfDays: 2,
      sequenceOrder: 1,
      targetDateHint: format(addDays(today, 20), "yyyy-MM-dd"),
      notes: "Validation finale et remise du livrable.",
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      title: "Refonte identite",
      status: "draft",
      plannedTeam: seedTeams[0].id,
      estimatedDurationHalfDays: 6,
      targetDateHint: format(addDays(today, 28), "yyyy-MM-dd"),
      notes: "Brouillon en attente d'un slot valide.",
    },
    {
      id: "99999999-9999-4999-8999-999999999999",
      title: "Concept packaging",
      status: "draft",
      plannedTeam: seedTeams[1].id,
      estimatedDurationHalfDays: 3,
      targetDateHint: format(addDays(today, 35), "yyyy-MM-dd"),
      notes: "Peut commencer apres degagement de la file Equipe B.",
    },
  ],
  dependencies: [
    {
      id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      predecessorProjectId: "55555555-5555-4555-8555-555555555555",
      successorProjectId: "66666666-6666-4666-8666-666666666666",
      lagHalfDays: 0,
    },
    {
      id: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      predecessorProjectId: "66666666-6666-4666-8666-666666666666",
      successorProjectId: "77777777-7777-4777-8777-777777777777",
      lagHalfDays: 0,
    },
  ],
  closures: [
    {
      id: "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      title: "Fermeture interne",
      type: "company_closure",
      startDate: "2026-04-07",
      endDate: "2026-04-07",
      source: "custom",
      editable: true,
    },
  ],
  history: {
    canUndo: false,
    canRedo: false,
  },
};
