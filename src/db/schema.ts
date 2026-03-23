import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const teamEnum = pgEnum("team", ["team-a", "team-b"]);
export const projectStatusEnum = pgEnum("project_status", ["draft", "scheduled"]);
export const closureTypeEnum = pgEnum("closure_type", [
  "holiday",
  "company_closure",
  "custom_time_off",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 180 }).notNull(),
    status: projectStatusEnum("status").notNull().default("draft"),
    plannedTeam: teamEnum("planned_team").notNull(),
    estimatedDurationHalfDays: integer("estimated_duration_half_days")
      .notNull()
      .default(2),
    scheduledTeam: teamEnum("scheduled_team"),
    scheduledStartSlot: varchar("scheduled_start_slot", { length: 20 }),
    scheduledDurationHalfDays: integer("scheduled_duration_half_days"),
    sequenceOrder: integer("sequence_order"),
    targetDateHint: timestamp("target_date_hint", {
      withTimezone: true,
      mode: "date",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "projects_estimated_duration_positive",
      sql`${table.estimatedDurationHalfDays} > 0`
    ),
    check(
      "projects_scheduled_duration_positive",
      sql`${table.scheduledDurationHalfDays} IS NULL OR ${table.scheduledDurationHalfDays} > 0`
    ),
    check(
      "projects_scheduled_fields_match_status",
      sql`(
        ${table.status} = 'draft'
        AND ${table.scheduledTeam} IS NULL
        AND ${table.scheduledStartSlot} IS NULL
        AND ${table.scheduledDurationHalfDays} IS NULL
        AND ${table.sequenceOrder} IS NULL
      ) OR (
        ${table.status} = 'scheduled'
        AND ${table.scheduledTeam} IS NOT NULL
        AND ${table.scheduledStartSlot} IS NOT NULL
        AND ${table.scheduledDurationHalfDays} IS NOT NULL
        AND ${table.sequenceOrder} IS NOT NULL
      )`
    ),
  ]
);

export const projectDependencies = pgTable(
  "project_dependencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    predecessorProjectId: uuid("predecessor_project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    successorProjectId: uuid("successor_project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    lagHalfDays: integer("lag_half_days").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_dependencies_unique_edge").on(
      table.predecessorProjectId,
      table.successorProjectId
    ),
    check(
      "project_dependencies_no_self_ref",
      sql`${table.predecessorProjectId} <> ${table.successorProjectId}`
    ),
    check(
      "project_dependencies_non_negative_lag",
      sql`${table.lagHalfDays} >= 0`
    ),
  ]
);

export const closurePeriods = pgTable(
  "closure_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 160 }).notNull(),
    type: closureTypeEnum("type").notNull(),
    startDate: timestamp("start_date", { withTimezone: true, mode: "date" })
      .notNull(),
    endDate: timestamp("end_date", { withTimezone: true, mode: "date" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("closure_periods_valid_range", sql`${table.endDate} >= ${table.startDate}`),
  ]
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectDependencyRow = typeof projectDependencies.$inferSelect;
export type NewProjectDependencyRow = typeof projectDependencies.$inferInsert;
export type ClosurePeriodRow = typeof closurePeriods.$inferSelect;
export type NewClosurePeriodRow = typeof closurePeriods.$inferInsert;
