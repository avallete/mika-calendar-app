import path from "node:path";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
const pgliteDataDir = path.resolve(
  process.cwd(),
  process.env.PGLITE_DATA_DIR ?? ".pglite"
);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  verbose: true,
  strict: true,
  ...(databaseUrl
    ? {
        dbCredentials: {
          url: databaseUrl,
        },
      }
    : {
        driver: "pglite" as const,
        dbCredentials: {
          url: pgliteDataDir,
        },
      }),
});
