import { closeDb, ensureDbReady, getDb } from "@/db/client";
import { seedPlannerDatabase } from "@/lib/planner/persistence";
import { initialPlannerState } from "@/lib/planner/sample-data";

async function main() {
  const backend = process.env.DATABASE_URL ? "postgres" : "pglite";
  const target = process.env.DATABASE_URL ?? process.env.PGLITE_DATA_DIR ?? ".pglite";

  try {
    await ensureDbReady();
    const db = getDb();

    await db.transaction(async (tx) => {
      await seedPlannerDatabase(tx, initialPlannerState);
    });

    console.log(`Seeded french roofing dataset into ${backend} (${target}).`);
    const scheduledCount = initialPlannerState.projects.filter(
      (project) => project.status === "scheduled"
    ).length;
    const draftCount = initialPlannerState.projects.filter(
      (project) => project.status === "draft"
    ).length;
    const customClosureCount = initialPlannerState.closures.filter(
      (closure) => closure.source === "custom"
    ).length;
    console.log(
      [
        `teams=${initialPlannerState.teams.length}`,
        `holidaySources=${initialPlannerState.holidaySources.length}`,
        `scheduled=${scheduledCount}`,
        `drafts=${draftCount}`,
        `projects=${initialPlannerState.projects.length}`,
        `dependencies=${initialPlannerState.dependencies.length}`,
        `customClosures=${customClosureCount}`,
      ].join(" ")
    );
  } finally {
    await closeDb();
  }
}

await main();
