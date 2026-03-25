import { addBusinessDays, addDays, format, startOfDay } from "date-fns";

import { makeSlotKey } from "@/lib/planner/calendar";
import { buildEffectiveClosures } from "@/lib/planner/closure-materialization";
import { rescheduleProjects } from "@/lib/planner/scheduler";
import type {
  CustomClosure,
  HolidaySource,
  PlannerState,
  Project,
  ProjectDependency,
  SlotPart,
  Team,
} from "@/lib/planner/types";

type TeamSeedDefinition = Team & {
  scheduledCount: number;
  draftCount: number;
  startOffsetBusinessDays: number;
  workTypes: string[];
  noteFocus: string[];
};

type BundleSeed = {
  id: number;
  reference: string;
  client: string;
  town: string;
  siteKind: string;
  siteLabel: string;
  noteLabel: string;
};

type GeneratedProject = {
  bundleId: number;
  teamSlug: string;
  teamId: string;
  ordinal: number;
  project: Project;
};

const BUNDLE_COUNT = 100;
const DURATION_PATTERN = [1, 2, 3, 4, 6, 3, 2, 8, 4, 10, 6, 14, 2, 20, 4] as const;
const GAP_PATTERN = [0, 1, 0, 2, 1, 0, 1] as const;
const SLOT_PATTERN: SlotPart[] = ["AM", "AM", "PM", "AM", "PM"];
const TARGET_DATE_JITTER = [1, 2, 3, 4, 5, 2, 3] as const;
const DRAFT_SPACING = [1, 2, 2, 3, 4, 1, 2, 3] as const;
const VARIANT_LABELS = [
  "zone nord",
  "tranche cour",
  "lot principal",
  "batiment A",
  "batiment B",
  "acces jardin",
] as const;
const MATERIAL_HINTS = [
  "Prevoir nacelle legere et controle des points d'ancrage",
  "Verifier la livraison des accessoires et la disponibilite depot",
  "Confirmer les teintes et references materiaux avant intervention",
  "Caler la protection des abords et l'acces echafaudage",
] as const;
const TOWNS = [
  "Reims",
  "Tinqueux",
  "Bezannes",
  "Cormontreuil",
  "Epernay",
  "Chalons",
  "Ay",
  "Fismes",
  "Muizon",
  "Dormans",
] as const;
const CLIENTS = [
  "Martin",
  "Bernard",
  "Dubois",
  "Morel",
  "Leroux",
  "Lemoine",
  "Garnier",
  "Petit",
  "Mercier",
  "Renaud",
] as const;
const SITE_KINDS = [
  "villa",
  "residence",
  "atelier",
  "ecole",
  "mairie annexe",
  "immeuble",
  "entrepot",
  "pavillon",
  "commerce",
  "lotissement",
] as const;

const TEAM_SEED_DEFINITIONS: TeamSeedDefinition[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "couverture",
    nameFr: "Equipe Couverture",
    displayOrder: 0,
    accentColor: "oklch(0.6 0.11 212)",
    softColor: "oklch(0.95 0.03 212)",
    isActive: true,
    scheduledCount: 56,
    draftCount: 150,
    startOffsetBusinessDays: -20,
    workTypes: [
      "Demoussage toiture",
      "Remplacement tuiles",
      "Reprise faitage",
      "Nettoyage ardoises",
      "Refection liteaux",
      "Pose ecran sous-toiture",
      "SAV infiltration",
      "Reprise rive",
    ],
    noteFocus: [
      "controle des tuiles et reprise des fixations",
      "verification du litonnage avant remise en eau",
      "coordination couverture avec finitions de rive",
      "preparation du nettoyage et evacuation des debris",
    ],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "zinguerie",
    nameFr: "Equipe Zinguerie",
    displayOrder: 1,
    accentColor: "oklch(0.69 0.13 58)",
    softColor: "oklch(0.96 0.04 58)",
    isActive: true,
    scheduledCount: 44,
    draftCount: 120,
    startOffsetBusinessDays: -14,
    workTypes: [
      "Solin cheminee",
      "Reprise noue zinc",
      "Habillage bandeau",
      "Pose gouttiere zinc",
      "Reprise descente EP",
      "Cheneau encaisse",
      "Couvertines zinc",
      "Raccord rive metallique",
    ],
    noteFocus: [
      "controle des raccords et des pentes d'evacuation",
      "validation des longueurs et coupes atelier",
      "ajustement des bavettes et points singuliers",
      "calage de la pose apres ouverture complete du support",
    ],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "maconnerie",
    nameFr: "Equipe Maconnerie",
    displayOrder: 2,
    accentColor: "oklch(0.64 0.12 25)",
    softColor: "oklch(0.95 0.03 25)",
    isActive: true,
    scheduledCount: 34,
    draftCount: 90,
    startOffsetBusinessDays: -10,
    workTypes: [
      "Reprise acrotere",
      "Scellement rive",
      "Reparation corniche",
      "Reprise souche",
      "Consolidation muret",
      "Reprise appui de cheneau",
      "Purge fissures",
      "Maconnerie rive",
    ],
    noteFocus: [
      "purge des supports avant retour des corps d'etat toiture",
      "temps de prise a anticiper avant intervention suivante",
      "controle des fissures et des zones de reprise",
      "validation des appuis avant pose des finitions",
    ],
  },
  {
    id: "44444444-4444-4444-8444-555555555555",
    slug: "charpente",
    nameFr: "Equipe Charpente",
    displayOrder: 3,
    accentColor: "oklch(0.67 0.11 145)",
    softColor: "oklch(0.95 0.03 145)",
    isActive: true,
    scheduledCount: 32,
    draftCount: 70,
    startOffsetBusinessDays: -8,
    workTypes: [
      "Renfort chevrons",
      "Remplacement pannes",
      "Traitement charpente",
      "Reprise volige",
      "Confortement fermette",
      "Reprise sabliere",
      "Depose element bois",
      "Mise a niveau support bois",
    ],
    noteFocus: [
      "controle humidite et sections avant renfort",
      "prevoir manutention bois et tri des departs atelier",
      "calage avec reprise couverture sur la meme zone",
      "verification des appuis et points de levage",
    ],
  },
  {
    id: "55555555-5555-4555-8555-666666666666",
    slug: "etancheite",
    nameFr: "Equipe Etancheite",
    displayOrder: 4,
    accentColor: "oklch(0.58 0.12 285)",
    softColor: "oklch(0.95 0.03 285)",
    isActive: true,
    scheduledCount: 34,
    draftCount: 70,
    startOffsetBusinessDays: -6,
    workTypes: [
      "Etancheite terrasse",
      "Reprise membrane EPDM",
      "Releve d'etancheite",
      "Pare-vapeur toiture",
      "Reprise joint de debord",
      "Etancheite noue plate",
      "Membrane autocollante",
      "Reprise couvertine etanche",
    ],
    noteFocus: [
      "controle des supports et degagement des points singuliers",
      "verification des releves et des remontees en acrotere",
      "coordination avec zinguerie pour les finitions visibles",
      "preparation des accessoires de terminaison et essais d'arrosage",
    ],
  },
];

export const seedTeams: Team[] = TEAM_SEED_DEFINITIONS.map(
  ({
    scheduledCount: _scheduledCount,
    draftCount: _draftCount,
    startOffsetBusinessDays: _startOffsetBusinessDays,
    workTypes: _workTypes,
    noteFocus: _noteFocus,
    ...team
  }) => ({ ...team })
);

export const seedHolidaySources: HolidaySource[] = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    code: "FR",
    labelFr: "Jours feries France",
    enabled: true,
  },
];

function makeDeterministicUuid(prefix: number, index: number) {
  const leading = prefix.toString(16).padStart(8, "0");
  const trailing = index.toString(16).padStart(12, "0");
  return `${leading}-0000-4000-8000-${trailing}`;
}

function toDateString(value: Date) {
  return format(value, "yyyy-MM-dd");
}

function buildBundles() {
  return Array.from({ length: BUNDLE_COUNT }, (_, index) => {
    const town = TOWNS[index % TOWNS.length];
    const client = CLIENTS[Math.floor(index / TOWNS.length) % CLIENTS.length];
    const siteKind = SITE_KINDS[(index * 3) % SITE_KINDS.length];
    const reference = `CH${String(index + 1).padStart(3, "0")}`;

    return {
      id: index,
      reference,
      client,
      town,
      siteKind,
      siteLabel: `${siteKind} ${client} ${town}`,
      noteLabel: `${siteKind} de ${client} a ${town}`,
    } satisfies BundleSeed;
  });
}

function getDurationAt(index: number, teamIndex: number) {
  return DURATION_PATTERN[(index + teamIndex * 3) % DURATION_PATTERN.length];
}

function getEstimatedDuration(durationHalfDays: number, index: number, teamIndex: number) {
  const delta = [-1, 0, 1, 0][(index + teamIndex) % 4];
  return Math.max(1, durationHalfDays + delta);
}

function getVariantLabel(ordinal: number, teamIndex: number) {
  return VARIANT_LABELS[
    (Math.floor(ordinal / BUNDLE_COUNT) + teamIndex) % VARIANT_LABELS.length
  ];
}

function buildProjectTitle(
  teamDefinition: TeamSeedDefinition,
  bundle: BundleSeed,
  ordinal: number,
  teamIndex: number
) {
  const workType = teamDefinition.workTypes[(ordinal + bundle.id) % teamDefinition.workTypes.length];
  return `${workType} ${bundle.siteLabel} ${getVariantLabel(ordinal, teamIndex)}`;
}

function buildProjectNote(
  teamDefinition: TeamSeedDefinition,
  bundle: BundleSeed,
  ordinal: number,
  teamIndex: number,
  status: Project["status"]
) {
  if (status === "draft" && (ordinal + teamIndex) % 6 === 0) {
    return undefined;
  }

  const focus = teamDefinition.noteFocus[(ordinal + bundle.id) % teamDefinition.noteFocus.length];
  const materialHint = MATERIAL_HINTS[(ordinal + teamIndex) % MATERIAL_HINTS.length];
  const base = `${bundle.reference}: ${focus} sur ${bundle.noteLabel}. ${materialHint}.`;

  if ((ordinal + bundle.id + teamIndex) % 5 !== 0) {
    return base;
  }

  return `${base} Garder un passage QA pour confirmer la coordination avec les equipes voisines.`;
}

function getProjectChronology(project: Project) {
  return project.status === "scheduled"
    ? project.scheduledStartSlot!.slice(0, 10)
    : project.targetDateHint ?? "9999-12-31";
}

function compareProjectChronology(left: Project, right: Project) {
  const leftDate = getProjectChronology(left);
  const rightDate = getProjectChronology(right);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  if (left.status !== right.status) {
    return left.status === "scheduled" ? -1 : 1;
  }

  if (left.status === "scheduled" && right.status === "scheduled") {
    const leftOrder = left.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sequenceOrder ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
  }

  return left.id.localeCompare(right.id);
}

function buildScheduledProjects(now: Date, bundles: BundleSeed[]) {
  const generated: GeneratedProject[] = [];
  let projectIndex = 1;

  TEAM_SEED_DEFINITIONS.forEach((teamDefinition, teamIndex) => {
    let businessOffset = teamDefinition.startOffsetBusinessDays;

    for (let ordinal = 0; ordinal < teamDefinition.scheduledCount; ordinal += 1) {
      const bundle = bundles[(ordinal * 7 + teamIndex * 13) % bundles.length];
      const durationHalfDays = getDurationAt(ordinal, teamIndex);
      const estimatedDurationHalfDays = getEstimatedDuration(durationHalfDays, ordinal, teamIndex);
      const startDate = addBusinessDays(now, businessOffset);
      const startSlot = makeSlotKey(
        toDateString(startDate),
        SLOT_PATTERN[(ordinal + teamIndex) % SLOT_PATTERN.length]
      );
      const targetDate = addDays(
        startDate,
        Math.max(2, Math.ceil(durationHalfDays / 2) + TARGET_DATE_JITTER[(ordinal + teamIndex) % TARGET_DATE_JITTER.length])
      );

      generated.push({
        bundleId: bundle.id,
        teamId: teamDefinition.id,
        teamSlug: teamDefinition.slug,
        ordinal,
        project: {
          id: makeDeterministicUuid(0x51000000 + teamIndex, projectIndex),
          title: buildProjectTitle(teamDefinition, bundle, ordinal, teamIndex),
          status: "scheduled",
          plannedTeam: teamDefinition.id,
          estimatedDurationHalfDays,
          scheduledTeam: teamDefinition.id,
          scheduledStartSlot: startSlot,
          scheduledDurationHalfDays: durationHalfDays,
          sequenceOrder: ordinal,
          targetDateHint: toDateString(targetDate),
          notes: buildProjectNote(teamDefinition, bundle, ordinal, teamIndex, "scheduled"),
        },
      });

      businessOffset +=
        Math.max(1, Math.ceil(durationHalfDays / 2)) +
        GAP_PATTERN[(ordinal + teamIndex) % GAP_PATTERN.length];
      projectIndex += 1;
    }
  });

  return generated;
}

function buildDraftProjects(now: Date, bundles: BundleSeed[]) {
  const generated: GeneratedProject[] = [];
  let projectIndex = 10001;

  TEAM_SEED_DEFINITIONS.forEach((teamDefinition, teamIndex) => {
    let calendarOffset = 5 + teamIndex * 4;

    for (let ordinal = 0; ordinal < teamDefinition.draftCount; ordinal += 1) {
      const bundle = bundles[(ordinal * 9 + teamIndex * 17 + 5) % bundles.length];
      const durationHalfDays = getDurationAt(ordinal + 2, teamIndex);
      const targetDate = addDays(now, calendarOffset);

      generated.push({
        bundleId: bundle.id,
        teamId: teamDefinition.id,
        teamSlug: teamDefinition.slug,
        ordinal,
        project: {
          id: makeDeterministicUuid(0x52000000 + teamIndex, projectIndex),
          title: buildProjectTitle(teamDefinition, bundle, ordinal + BUNDLE_COUNT, teamIndex),
          status: "draft",
          plannedTeam: teamDefinition.id,
          estimatedDurationHalfDays: getEstimatedDuration(durationHalfDays, ordinal + 3, teamIndex),
          targetDateHint: toDateString(targetDate),
          notes: buildProjectNote(teamDefinition, bundle, ordinal + BUNDLE_COUNT, teamIndex, "draft"),
        },
      });

      calendarOffset += DRAFT_SPACING[(ordinal + teamIndex) % DRAFT_SPACING.length];
      projectIndex += 1;
    }
  });

  return generated;
}

function groupProjectsByBundle(projects: GeneratedProject[]) {
  const byBundle = new Map<number, GeneratedProject[]>();

  for (const project of projects) {
    const bundleProjects = byBundle.get(project.bundleId) ?? [];
    bundleProjects.push(project);
    byBundle.set(project.bundleId, bundleProjects);
  }

  return byBundle;
}

function selectLaterProject(
  candidates: GeneratedProject[],
  predecessor: GeneratedProject
) {
  const sorted = [...candidates].sort((left, right) =>
    compareProjectChronology(left.project, right.project)
  );

  return (
    sorted.find(
      (candidate) =>
        compareProjectChronology(predecessor.project, candidate.project) < 0 &&
        candidate.project.id !== predecessor.project.id
    ) ?? null
  );
}

function buildDependencyCandidates(projects: GeneratedProject[]) {
  const workflowPairs = [
    ["charpente", "couverture"],
    ["maconnerie", "couverture"],
    ["couverture", "zinguerie"],
    ["zinguerie", "etancheite"],
  ] as const;
  const bundleProjects = groupProjectsByBundle(projects);
  const sameTeamCandidates: Array<{
    predecessorProjectId: string;
    successorProjectId: string;
    lagHalfDays: number;
  }> = [];
  const crossTeamCandidates: Array<{
    predecessorProjectId: string;
    successorProjectId: string;
    lagHalfDays: number;
  }> = [];
  const fallbackCandidates: Array<{
    predecessorProjectId: string;
    successorProjectId: string;
    lagHalfDays: number;
  }> = [];

  for (const [bundleId, bundleEntries] of bundleProjects) {
    const sortedEntries = [...bundleEntries].sort((left, right) =>
      compareProjectChronology(left.project, right.project)
    );
    const byTeam = new Map<string, GeneratedProject[]>();

    for (const entry of sortedEntries) {
      const teamEntries = byTeam.get(entry.teamSlug) ?? [];
      teamEntries.push(entry);
      byTeam.set(entry.teamSlug, teamEntries);
    }

    for (const teamEntries of byTeam.values()) {
      if (teamEntries.length < 2) {
        continue;
      }

      const sortedTeamEntries = [...teamEntries].sort((left, right) =>
        compareProjectChronology(left.project, right.project)
      );
      for (let index = 0; index < sortedTeamEntries.length - 1; index += 1) {
        sameTeamCandidates.push({
          predecessorProjectId: sortedTeamEntries[index].project.id,
          successorProjectId: sortedTeamEntries[index + 1].project.id,
          lagHalfDays: (bundleId + index) % 5,
        });
      }
    }

    for (const [sourceTeam, targetTeam] of workflowPairs) {
      const sourceEntries = byTeam.get(sourceTeam) ?? [];
      const targetEntries = byTeam.get(targetTeam) ?? [];

      if (!sourceEntries.length || !targetEntries.length) {
        continue;
      }

      const predecessor = [...sourceEntries].sort((left, right) =>
        compareProjectChronology(left.project, right.project)
      )[0];
      const successor = selectLaterProject(targetEntries, predecessor);

      if (!predecessor || !successor) {
        continue;
      }

      crossTeamCandidates.push({
        predecessorProjectId: predecessor.project.id,
        successorProjectId: successor.project.id,
        lagHalfDays: (bundleId + sourceTeam.length + targetTeam.length) % 5,
      });
    }

    for (let index = 0; index < sortedEntries.length - 1; index += 1) {
      fallbackCandidates.push({
        predecessorProjectId: sortedEntries[index].project.id,
        successorProjectId: sortedEntries[index + 1].project.id,
        lagHalfDays: (bundleId + index + 1) % 5,
      });
    }
  }

  return [...crossTeamCandidates, ...sameTeamCandidates, ...fallbackCandidates];
}

function buildDependencies(projects: GeneratedProject[]) {
  const selected = new Map<string, ProjectDependency>();
  const candidates = buildDependencyCandidates(projects);
  let dependencyIndex = 1;

  for (const candidate of candidates) {
    if (selected.size >= 120) {
      break;
    }

    if (candidate.predecessorProjectId === candidate.successorProjectId) {
      continue;
    }

    const key = `${candidate.predecessorProjectId}:${candidate.successorProjectId}`;
    if (selected.has(key)) {
      continue;
    }

    selected.set(key, {
      id: makeDeterministicUuid(0x53000000, dependencyIndex),
      predecessorProjectId: candidate.predecessorProjectId,
      successorProjectId: candidate.successorProjectId,
      lagHalfDays: candidate.lagHalfDays,
    });
    dependencyIndex += 1;
  }

  if (selected.size !== 120) {
    throw new Error(`Expected 120 dependencies but generated ${selected.size}.`);
  }

  return [...selected.values()];
}

function buildCustomClosures(now: Date): CustomClosure[] {
  const closures = [
    {
      title: "Fermeture inventaire depot principal",
      type: "company_closure",
      impact: "blocking",
      startOffsetDays: 28,
      durationDays: 1,
      repeatsAnnually: false,
      details:
        "Arret depot pour inventaire, controle des nacelles et reception materiaux.",
    },
    {
      title: "Pont maintenance atelier zinguerie",
      type: "company_closure",
      impact: "blocking",
      startOffsetDays: 92,
      durationDays: 2,
      repeatsAnnually: false,
      details: "Maintenance atelier et indisponibilite du parc pliage pendant deux jours.",
    },
    {
      title: "Fermeture semestrielle parc vehicules",
      type: "company_closure",
      impact: "blocking",
      startOffsetDays: 173,
      durationDays: 1,
      repeatsAnnually: true,
      details: "Controle flotte, outillage electrique et inventaire EPI.",
    },
    {
      title: "Releve securite fin d'annee",
      type: "company_closure",
      impact: "blocking",
      startOffsetDays: 301,
      durationDays: 2,
      repeatsAnnually: true,
      details: "Arret planning pour bilan securite et arbitrage stock.",
    },
    {
      title: "Formation harnais et lignes de vie",
      type: "custom_time_off",
      impact: "blocking",
      startOffsetDays: 35,
      durationDays: 1,
      repeatsAnnually: false,
      details: "Les equipes sont mobilisees en formation travail en hauteur.",
    },
    {
      title: "CACES nacelle mutualise",
      type: "custom_time_off",
      impact: "blocking",
      startOffsetDays: 126,
      durationDays: 1,
      repeatsAnnually: false,
      details: "Session CACES pour les chefs d'equipe et controle des habilitations.",
    },
    {
      title: "Audit qualite pose membrane",
      type: "custom_time_off",
      impact: "blocking",
      startOffsetDays: 214,
      durationDays: 1,
      repeatsAnnually: false,
      details: "Audit interne et reprise process etancheite sur une journee complete.",
    },
    {
      title: "Formation premiers secours chantier",
      type: "custom_time_off",
      impact: "blocking",
      startOffsetDays: 344,
      durationDays: 1,
      repeatsAnnually: true,
      details: "Rotation complete des equipes sur la session SST annuelle.",
    },
    {
      title: "Pluie continue secteur nord",
      type: "weather",
      impact: "advisory",
      startOffsetDays: 18,
      durationDays: 2,
      repeatsAnnually: false,
      details: "Cadence reduite a anticiper sur les chantiers ouverts.",
    },
    {
      title: "Rafales sur plateaux exposees",
      type: "weather",
      impact: "advisory",
      startOffsetDays: 148,
      durationDays: 1,
      repeatsAnnually: false,
      details: "Limiter les levages et preparer un repli materiel rapide.",
    },
    {
      title: "Episode gel matinal",
      type: "weather",
      impact: "advisory",
      startOffsetDays: 238,
      durationDays: 3,
      repeatsAnnually: true,
      details: "Demarrages differez et controles supports humides a prevoir.",
    },
    {
      title: "Orages fin de semaine",
      type: "weather",
      impact: "advisory",
      startOffsetDays: 376,
      durationDays: 2,
      repeatsAnnually: false,
      details: "Risque d'interruption en fin de journee et replis anticipes.",
    },
  ] as const;

  return closures.map((closure, index) => {
    const startDate = addDays(now, closure.startOffsetDays);
    const endDate = addDays(startDate, closure.durationDays - 1);

    return {
      id: makeDeterministicUuid(0x54000000, index + 1),
      title: closure.title,
      type: closure.type,
      startDate: toDateString(startDate),
      endDate: toDateString(endDate),
      impact: closure.impact,
      details: closure.details,
      repeatsAnnually: closure.repeatsAnnually,
    } satisfies CustomClosure;
  });
}

export function buildPlannerDemoState(now: Date = new Date()): PlannerState {
  const today = startOfDay(now);
  const bundles = buildBundles();
  const scheduledProjects = buildScheduledProjects(today, bundles);
  const draftProjects = buildDraftProjects(today, bundles);
  const generatedProjects = [...scheduledProjects, ...draftProjects];
  const projects = generatedProjects.map(({ project }) => ({ ...project }));
  const dependencies = buildDependencies(generatedProjects);
  const customClosures = buildCustomClosures(today);
  const rawState: PlannerState = {
    teams: seedTeams.map((team) => ({ ...team })),
    holidaySources: seedHolidaySources.map((source) => ({ ...source })),
    projects,
    dependencies,
    customClosures,
    closures: buildEffectiveClosures({
      projects,
      holidaySources: seedHolidaySources,
      customClosures,
      now: today,
    }),
    history: {
      canUndo: false,
      canRedo: false,
    },
  };
  const normalizedState = rescheduleProjects(rawState);

  return {
    ...normalizedState,
    history: {
      canUndo: false,
      canRedo: false,
    },
  };
}

export const initialPlannerState: PlannerState = buildPlannerDemoState();
