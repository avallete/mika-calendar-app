import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { Pool } from "pg";

export type PlannerDb =
  | NodePgDatabase<Record<string, unknown>>
  | PgliteDatabase<Record<string, unknown>>;

type PlannerDbState = {
  db: PlannerDb;
  ready: Promise<void>;
  dispose: () => Promise<void>;
};

const globalForPlannerDb = globalThis as typeof globalThis & {
  __plannerDbState?: PlannerDbState;
};

function getProjectPath(...segments: string[]) {
  return path.join(/* turbopackIgnore: true */ process.cwd(), ...segments);
}

function getPgliteDataDir() {
  const configuredDataDir = process.env.PGLITE_DATA_DIR;

  if (!configuredDataDir) {
    return getProjectPath(".pglite");
  }

  return path.isAbsolute(configuredDataDir)
    ? configuredDataDir
    : getProjectPath(configuredDataDir);
}

function createDbState(): PlannerDbState {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    const pool = new Pool({
      connectionString,
    });

    return {
      db: drizzleNodePg({ client: pool }),
      ready: Promise.resolve(),
      dispose: () => pool.end(),
    };
  }

  const client = new PGlite(getPgliteDataDir());
  const db = drizzlePglite({ client });

  return {
    db,
    ready: client.waitReady.then(() =>
      migratePglite(db, {
        migrationsFolder: getProjectPath("drizzle"),
      })
    ),
    dispose: () => client.close(),
  };
}

function getDbState() {
  const existingState = globalForPlannerDb.__plannerDbState;
  if (existingState) {
    return existingState;
  }

  const state = createDbState();
  globalForPlannerDb.__plannerDbState = state;
  return state;
}

export function getDb() {
  return getDbState().db;
}

export async function ensureDbReady() {
  await getDbState().ready;
}

export async function closeDb() {
  const state = globalForPlannerDb.__plannerDbState;
  if (!state) {
    return;
  }

  delete globalForPlannerDb.__plannerDbState;
  await state.dispose();
}
