import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const projectStatusEnum = pgEnum("project_status", ["draft", "scheduled"]);
export const closureTypeEnum = pgEnum("closure_type", [
  "holiday",
  "company_closure",
  "custom_time_off",
  "weather",
  "annotation",
]);
export const closureImpactEnum = pgEnum("closure_impact", ["blocking", "advisory"]);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    nameFr: varchar("name_fr", { length: 160 }).notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    accentColor: varchar("accent_color", { length: 40 }).notNull(),
    softColor: varchar("soft_color", { length: 40 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("teams_slug_unique").on(table.slug)]
);

export const holidaySources = pgTable(
  "holiday_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    labelFr: varchar("label_fr", { length: 160 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("holiday_sources_code_unique").on(table.code)]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 180 }).notNull(),
    status: projectStatusEnum("status").notNull().default("draft"),
    plannedTeamId: uuid("planned_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    estimatedDurationHalfDays: integer("estimated_duration_half_days")
      .notNull()
      .default(2),
    scheduledTeamId: uuid("scheduled_team_id").references(() => teams.id, {
      onDelete: "restrict",
    }),
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
        AND ${table.scheduledTeamId} IS NULL
        AND ${table.scheduledStartSlot} IS NULL
        AND ${table.scheduledDurationHalfDays} IS NULL
        AND ${table.sequenceOrder} IS NULL
      ) OR (
        ${table.status} = 'scheduled'
        AND ${table.scheduledTeamId} IS NOT NULL
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
    impact: closureImpactEnum("impact").notNull().default("blocking"),
    startDate: timestamp("start_date", { withTimezone: true, mode: "date" })
      .notNull(),
    endDate: timestamp("end_date", { withTimezone: true, mode: "date" })
      .notNull(),
    details: text("details"),
    repeatsAnnually: boolean("repeats_annually").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("closure_periods_valid_range", sql`${table.endDate} >= ${table.startDate}`),
  ]
);

export const plannerActionLog = pgTable("planner_action_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: varchar("session_id", { length: 120 }).notNull(),
  actionType: varchar("action_type", { length: 80 }).notNull(),
  payload: jsonb("payload").notNull(),
  beforeSnapshot: jsonb("before_snapshot").notNull(),
  afterSnapshot: jsonb("after_snapshot").notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true, mode: "date" }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export type TeamRow = typeof teams.$inferSelect;
export type NewTeamRow = typeof teams.$inferInsert;
export type HolidaySourceRow = typeof holidaySources.$inferSelect;
export type NewHolidaySourceRow = typeof holidaySources.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectDependencyRow = typeof projectDependencies.$inferSelect;
export type NewProjectDependencyRow = typeof projectDependencies.$inferInsert;
export type ClosurePeriodRow = typeof closurePeriods.$inferSelect;
export type NewClosurePeriodRow = typeof closurePeriods.$inferInsert;
export type PlannerActionLogRow = typeof plannerActionLog.$inferSelect;
