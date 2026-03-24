import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import {
  closurePeriods,
  holidaySources,
  plannerActionLog,
  projectDependencies,
  projects,
  teams,
} from "@/db/schema";
import { seedPlannerDatabase } from "@/lib/planner/persistence";
import { initialPlannerState } from "@/lib/planner/sample-data";

const tempDir = mkdtempSync(path.join(tmpdir(), "app-calendar-mika-seed-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("planner persistence seed", () => {
  test("resets current planner data and seeds the french roofing dataset", async () => {
    const client = new PGlite(tempDir);
    const db = drizzle({ client });

    try {
      await client.waitReady;
      await migrate(db, {
        migrationsFolder: path.join(process.cwd(), "drizzle"),
      });

      await db.insert(teams).values({
        id: "deadbeef-dead-4eef-8ead-deadbeef0001",
        slug: "old-team",
        nameFr: "Ancienne equipe",
        displayOrder: 99,
        accentColor: "#111111",
        softColor: "#eeeeee",
        isActive: true,
      });
      await db.insert(holidaySources).values({
        id: "deadbeef-dead-4eef-8ead-deadbeef0002",
        code: "OLD",
        labelFr: "Ancienne source",
        enabled: false,
      });
      await db.insert(plannerActionLog).values({
        id: "deadbeef-dead-4eef-8ead-deadbeef0003",
        sessionId: "seed-test",
        actionType: "dummy",
        payload: {},
        beforeSnapshot: {},
        afterSnapshot: {},
      });

      await db.transaction(async (tx) => {
        await seedPlannerDatabase(tx, initialPlannerState);
      });

      const [teamCount] = await db.select({ count: sql<number>`count(*)` }).from(teams);
      const [holidaySourceCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(holidaySources);
      const [projectCount] = await db.select({ count: sql<number>`count(*)` }).from(projects);
      const [dependencyCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(projectDependencies);
      const [closureCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(closurePeriods);
      const [actionLogCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(plannerActionLog);

      expect(Number(teamCount?.count ?? 0)).toBe(initialPlannerState.teams.length);
      expect(Number(holidaySourceCount?.count ?? 0)).toBe(
        initialPlannerState.holidaySources.length
      );
      expect(Number(projectCount?.count ?? 0)).toBe(initialPlannerState.projects.length);
      expect(Number(dependencyCount?.count ?? 0)).toBe(
        initialPlannerState.dependencies.length
      );
      expect(Number(closureCount?.count ?? 0)).toBe(
        initialPlannerState.customClosures.length
      );
      expect(Number(actionLogCount?.count ?? 0)).toBe(0);

      const oldTeam = await db
        .select()
        .from(teams)
        .where(eq(teams.slug, "old-team"));
      expect(oldTeam).toHaveLength(0);

      const knownTeam = await db
        .select()
        .from(teams)
        .where(eq(teams.slug, "couverture"));
      expect(knownTeam[0]?.nameFr).toBe("Equipe Couverture");

      const knownProject = await db
        .select()
        .from(projects)
        .where(eq(projects.title, "Demoussage villa Martin"));
      expect(knownProject[0]?.status).toBe("scheduled");

      const knownDependency = await db
        .select()
        .from(projectDependencies)
        .where(eq(projectDependencies.id, "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1"));
      expect(knownDependency).toHaveLength(1);

      const knownClosure = await db
        .select()
        .from(closurePeriods)
        .where(eq(closurePeriods.title, "Pluie continue secteur nord"));
      expect(knownClosure[0]?.impact).toBe("advisory");
      expect(knownClosure[0]?.repeatsAnnually).toBe(false);
    } finally {
      await client.close();
    }
  });
});
