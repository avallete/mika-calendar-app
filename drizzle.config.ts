import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  verbose: true,
  strict: true,
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://planner:planner@localhost:5432/app_calendar_mika",
  },
});
