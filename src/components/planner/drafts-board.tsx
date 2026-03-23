"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, PenSquare, Plus, Rows3, Trash2 } from "lucide-react";

import { usePlanner } from "@/components/planner/planner-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectEditorState } from "@/lib/planner/types";
import { teamOptions } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const emptyForm: ProjectEditorState = {
  title: "",
  plannedTeam: "team-a",
  estimatedDurationHalfDays: 2,
  targetDateHint: "",
  notes: "",
  dependencyIds: [],
};

export function DraftsBoard() {
  const { state, upsertProject, deleteProject } = usePlanner();
  const drafts = useMemo(
    () => state.projects.filter((project) => project.status === "draft"),
    [state.projects]
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(drafts[0]?.id ?? null);
  const selectedProject = state.projects.find((project) => project.id === selectedProjectId) ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_0.8fr]">
      <Card className="overflow-hidden border-border/60 bg-card/95 shadow-[0_24px_52px_-42px_rgba(18,25,38,0.55)]">
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Draft input view
              </p>
              <CardTitle className="mt-1 font-heading text-2xl">
                Unscheduled projects waiting for a slot
              </CardTitle>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedProjectId(null);
              }}
            >
              <Plus className="size-4" />
              New draft
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Dependencies</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((project) => {
                const dependencyCount = state.dependencies.filter(
                  (dependency) => dependency.successorProjectId === project.id
                ).length;

                return (
                  <TableRow
                    key={project.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/50",
                      selectedProjectId === project.id && "bg-muted/60"
                    )}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{project.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {project.notes || "Draft ready for scheduling"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {project.plannedTeam === "team-a" ? "Team A" : "Team B"}
                      </Badge>
                    </TableCell>
                    <TableCell>{project.estimatedDurationHalfDays / 2} days</TableCell>
                    <TableCell>{project.targetDateHint || "No hint"}</TableCell>
                    <TableCell>{dependencyCount}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-5">
        <DraftEditorPanel
          key={selectedProjectId ?? "new"}
          selectedProjectId={selectedProjectId}
          selectedProject={selectedProject}
          onSave={(values) => upsertProject(values, selectedProjectId ?? undefined)}
          onDelete={() => {
            if (!selectedProjectId) {
              return;
            }

            if (window.confirm("Delete this draft permanently?")) {
              deleteProject(selectedProjectId);
              setSelectedProjectId(null);
            }
          }}
          allProjects={state.projects}
          dependencies={state.dependencies}
        />

        <Card className="border-border/60 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(240,234,226,0.92))] shadow-[0_24px_52px_-42px_rgba(18,25,38,0.55)]">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Rows3 className="size-4 text-[var(--team-a)]" />
              Drafts stay visible in the scheduler sidebar
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              This list is the planning inbox. Once a draft is dragged onto the schedule,
              the same project record becomes scheduled and inherits dependency logic.
            </p>
            <Link
              href="/"
              className="inline-flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Open scheduler
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DraftEditorPanel({
  selectedProjectId,
  selectedProject,
  allProjects,
  dependencies,
  onSave,
  onDelete,
}: {
  selectedProjectId: string | null;
  selectedProject: (typeof allProjects)[number] | null;
  allProjects: ReturnType<typeof usePlanner>["state"]["projects"];
  dependencies: ReturnType<typeof usePlanner>["state"]["dependencies"];
  onSave: (values: ProjectEditorState) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState<ProjectEditorState>(() => {
    if (!selectedProject) {
      return emptyForm;
    }

    return {
      title: selectedProject.title,
      plannedTeam: selectedProject.plannedTeam,
      estimatedDurationHalfDays: selectedProject.estimatedDurationHalfDays,
      targetDateHint: selectedProject.targetDateHint ?? "",
      notes: selectedProject.notes ?? "",
      dependencyIds: dependencies
        .filter((dependency) => dependency.successorProjectId === selectedProject.id)
        .map((dependency) => dependency.predecessorProjectId),
    };
  });

  return (
    <Card className="border-border/60 bg-card/95 shadow-[0_24px_52px_-42px_rgba(18,25,38,0.55)]">
      <CardHeader className="border-b border-border/60">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Draft editor
            </p>
            <CardTitle className="mt-1 font-heading text-2xl">
              {selectedProject ? "Edit selected draft" : "Create a new draft"}
            </CardTitle>
          </div>
          <PenSquare className="size-5 text-muted-foreground" />
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Title
          </p>
          <Input
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Launch toolkit"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Planned team
            </p>
            <div className="grid gap-2">
              {teamOptions.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-left text-sm transition-colors",
                    form.plannedTeam === team.id
                      ? "border-transparent bg-foreground text-background"
                      : "border-border bg-card"
                  )}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      plannedTeam: team.id,
                    }))
                  }
                >
                  {team.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Duration (half-days)
            </p>
            <Input
              min={1}
              type="number"
              value={form.estimatedDurationHalfDays}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  estimatedDurationHalfDays: Math.max(1, Number(event.target.value)),
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              The scheduler will use this as the default duration on drop.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Target date hint
          </p>
          <Input
            type="date"
            value={form.targetDateHint}
            onChange={(event) =>
              setForm((current) => ({ ...current, targetDateHint: event.target.value }))
            }
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Notes
          </p>
          <Textarea
            rows={4}
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Dependencies
          </p>
          <ScrollArea className="h-44 rounded-2xl border border-border/60 bg-muted/20 p-3">
            <div className="flex flex-wrap gap-2">
              {allProjects
                .filter((project) => project.id !== selectedProjectId)
                .map((project) => {
                  const active = form.dependencyIds.includes(project.id);
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-2 text-sm transition-colors",
                        active
                          ? "border-transparent bg-foreground text-background"
                          : "border-border bg-card"
                      )}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          dependencyIds: active
                            ? current.dependencyIds.filter((id) => id !== project.id)
                            : [...current.dependencyIds, project.id],
                        }))
                      }
                    >
                      {project.title}
                    </button>
                  );
                })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {selectedProject ? (
            <Button variant="destructive" className="sm:flex-1" onClick={onDelete}>
              <Trash2 className="size-4" />
              Delete draft
            </Button>
          ) : null}
          <Button className="sm:flex-1" onClick={() => onSave(form)}>
            Save draft
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
