"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, PenSquare, Plus, Rows3, Trash2 } from "lucide-react";

import { usePlanner } from "@/components/planner/planner-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fr } from "@/lib/i18n/fr";
import type { ProjectEditorState, Team } from "@/lib/planner/types";
import { getSortedTeams, getTeamById } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

function createEmptyForm(teams: Team[]): ProjectEditorState {
  const firstTeam = getSortedTeams(teams)[0];

  return {
    title: "",
    plannedTeam: firstTeam?.id ?? "",
    estimatedDurationHalfDays: 2,
    targetDateHint: "",
    notes: "",
    dependencyIds: [],
  };
}

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
                {fr.draftsBoard.tableEyebrow}
              </p>
              <CardTitle className="mt-1 font-heading text-2xl">
                {fr.draftsBoard.tableTitle}
              </CardTitle>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedProjectId(null);
              }}
            >
              <Plus className="size-4" />
              {fr.draftsBoard.newDraft}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{fr.draftsBoard.columns.project}</TableHead>
                <TableHead>{fr.draftsBoard.columns.team}</TableHead>
                <TableHead>{fr.draftsBoard.columns.duration}</TableHead>
                <TableHead>{fr.draftsBoard.columns.target}</TableHead>
                <TableHead>{fr.draftsBoard.columns.dependencies}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((project) => {
                const dependencyCount = state.dependencies.filter(
                  (dependency) => dependency.successorProjectId === project.id
                ).length;
                const team = getTeamById(state.teams, project.plannedTeam);

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
                          {project.notes || fr.draftsBoard.readyForScheduling}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{team?.nameFr ?? "Equipe"}</Badge>
                    </TableCell>
                    <TableCell>{project.estimatedDurationHalfDays / 2} j</TableCell>
                    <TableCell>{project.targetDateHint || fr.draftsBoard.noHint}</TableCell>
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
          selectedProject={selectedProject}
          onSave={(values) => upsertProject(values, selectedProjectId ?? undefined)}
          onDelete={() => {
            if (!selectedProjectId) {
              return;
            }

            if (window.confirm(fr.draftsBoard.deleteConfirm)) {
              deleteProject(selectedProjectId);
              setSelectedProjectId(null);
            }
          }}
        />

        <Card className="border-border/60 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(240,234,226,0.92))] shadow-[0_24px_52px_-42px_rgba(18,25,38,0.55)]">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Rows3 className="size-4 text-[oklch(0.58_0.11_205)]" />
              {fr.draftsBoard.sideTitle}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {fr.draftsBoard.sideDescription}
            </p>
            <Link
              href="/"
              className="inline-flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              {fr.draftsBoard.openScheduler}
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DraftEditorPanel({
  selectedProject,
  onSave,
  onDelete,
}: {
  selectedProject: ReturnType<typeof usePlanner>["state"]["projects"][number] | null;
  onSave: (values: ProjectEditorState) => void;
  onDelete: () => void;
}) {
  const { state } = usePlanner();
  const sortedTeams = getSortedTeams(state.teams);
  const [form, setForm] = useState<ProjectEditorState>(() => {
    if (!selectedProject) {
      return createEmptyForm(state.teams);
    }

    return {
      title: selectedProject.title,
      plannedTeam: selectedProject.plannedTeam,
      estimatedDurationHalfDays: selectedProject.estimatedDurationHalfDays,
      targetDateHint: selectedProject.targetDateHint ?? "",
      notes: selectedProject.notes ?? "",
      dependencyIds: state.dependencies
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
              {fr.draftsBoard.editorEyebrow}
            </p>
            <CardTitle className="mt-1 font-heading text-2xl">
              {selectedProject ? fr.draftsBoard.editTitle : fr.draftsBoard.createTitle}
            </CardTitle>
          </div>
          <PenSquare className="size-5 text-muted-foreground" />
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {fr.draftsBoard.fields.title}
          </p>
          <Input
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Lancement toolkit"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {fr.draftsBoard.fields.plannedTeam}
            </p>
            <div className="grid gap-2">
              {sortedTeams.map((team) => (
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
                  {team.nameFr}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {fr.draftsBoard.fields.duration}
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
            <p className="text-xs text-muted-foreground">{fr.draftsBoard.durationHint}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {fr.draftsBoard.fields.targetDate}
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
            {fr.draftsBoard.fields.notes}
          </p>
          <Textarea
            rows={4}
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {selectedProject ? (
            <Button variant="destructive" className="sm:flex-1" onClick={onDelete}>
              <Trash2 className="size-4" />
              {fr.draftsBoard.delete}
            </Button>
          ) : null}
          <Button className="sm:flex-1" onClick={() => onSave(form)}>
            {fr.draftsBoard.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
