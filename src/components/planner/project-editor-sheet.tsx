"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, CalendarDays, PauseCircle, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  Project,
  ProjectDependency,
  ProjectDeleteMode,
  ProjectPlacement,
  TeamId,
} from "@/lib/planner/types";
import { isScheduledProject } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const teamChoices: { id: TeamId; label: string }[] = [
  { id: "team-a", label: "Team A" },
  { id: "team-b", label: "Team B" },
];

export function ProjectEditorSheet({
  open,
  onOpenChange,
  project,
  dependencies,
  placementOverride,
  onSave,
  onUnschedule,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  dependencies: ProjectDependency[];
  placementOverride?: ProjectPlacement | null;
  onSave: (projectId: string, placement: ProjectPlacement) => void;
  onUnschedule?: (projectId: string) => void;
  onDelete?: (projectId: string, mode: ProjectDeleteMode) => void;
}) {
  const incomingDependencies = useMemo(
    () =>
      project
        ? dependencies.filter((dependency) => dependency.successorProjectId === project.id)
        : [],
    [dependencies, project]
  );

  if (!project) {
    return null;
  }

  const editorKey = [
    project.id,
    placementOverride?.teamId ?? "none",
    placementOverride?.startSlot ?? "none",
    placementOverride?.durationHalfDays ?? "none",
  ].join(":");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-xl overflow-y-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,244,238,0.96))] sm:max-w-xl">
        <SheetHeader className="border-b border-border/60 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Scheduler editor
          </p>
          <SheetTitle className="mt-2 text-2xl">{project.title}</SheetTitle>
          <SheetDescription>
            Adjust the assigned team, start slot, and duration before the schedule is
            recalculated.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              <CalendarDays className="size-3.5" />
              Estimated {project.estimatedDurationHalfDays / 2} days
            </Badge>
            <Badge variant="outline">
              <ArrowRightLeft className="size-3.5" />
              {incomingDependencies.length} blockers
            </Badge>
          </div>

          {project.notes ? (
            <div className="rounded-2xl border border-border/60 bg-card/80 p-4 text-sm leading-6 text-muted-foreground">
              {project.notes}
            </div>
          ) : null}

          <ProjectEditorForm
            key={editorKey}
            project={project}
            placementOverride={placementOverride}
            onSave={onSave}
            onOpenChange={onOpenChange}
          />
        </div>

        <SheetFooter className="border-t border-border/60">
          {isScheduledProject(project) && onUnschedule ? (
            <Button
              variant="outline"
              onClick={() => {
                onUnschedule(project.id);
                onOpenChange(false);
              }}
            >
              <PauseCircle className="size-4" />
              Return to draft queue
            </Button>
          ) : null}
          {isScheduledProject(project) && onDelete ? (
            <>
              <Button
                variant="destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this planned project and keep the remaining schedule dates as they are?"
                    )
                  ) {
                    onDelete(project.id, "preserve-dates");
                    onOpenChange(false);
                  }
                }}
              >
                <Trash2 className="size-4" />
                Delete and keep dates
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this planned project and compact later dates where dependencies allow?"
                    )
                  ) {
                    onDelete(project.id, "compact-schedule");
                    onOpenChange(false);
                  }
                }}
              >
                <Trash2 className="size-4" />
                Delete and compact
              </Button>
            </>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ProjectEditorForm({
  project,
  placementOverride,
  onSave,
  onOpenChange,
}: {
  project: Project;
  placementOverride?: ProjectPlacement | null;
  onSave: (projectId: string, placement: ProjectPlacement) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const initialPlacement = placementOverride
    ? placementOverride
    : {
        teamId: isScheduledProject(project) ? project.scheduledTeam : project.plannedTeam,
        startSlot: isScheduledProject(project)
          ? project.scheduledStartSlot
          : ((project.targetDateHint ? `${project.targetDateHint}-AM` : "2026-03-24-AM") as ProjectPlacement["startSlot"]),
        durationHalfDays: isScheduledProject(project)
          ? project.scheduledDurationHalfDays
          : project.estimatedDurationHalfDays,
      };

  const [teamId, setTeamId] = useState<TeamId>(initialPlacement.teamId);
  const [date, setDate] = useState(initialPlacement.startSlot.slice(0, 10));
  const [part, setPart] = useState<"AM" | "PM">(
    initialPlacement.startSlot.endsWith("-PM") ? "PM" : "AM"
  );
  const [durationHalfDays, setDurationHalfDays] = useState(
    initialPlacement.durationHalfDays
  );

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Assign to team
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {teamChoices.map((team) => (
              <button
                key={team.id}
                type="button"
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left text-sm transition-colors",
                  teamId === team.id
                    ? "border-transparent bg-foreground text-background"
                    : "border-border bg-card hover:bg-muted"
                )}
                onClick={() => setTeamId(team.id)}
              >
                {team.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Start date
            </p>
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Slot
            </p>
            <div className="flex rounded-xl border border-border bg-card p-1">
              {(["AM", "PM"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    part === value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setPart(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Duration (half-days)
          </p>
          <Input
            min={1}
            type="number"
            value={durationHalfDays}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              setDurationHalfDays(Number.isFinite(nextValue) ? Math.max(1, nextValue) : 1);
            }}
          />
        </div>
      </div>

      <Button
        onClick={() => {
          onSave(project.id, {
            teamId,
            startSlot: `${date}-${part}` as ProjectPlacement["startSlot"],
            durationHalfDays,
          });
          onOpenChange(false);
        }}
      >
        Save placement
      </Button>
    </>
  );
}
