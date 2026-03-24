"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, GripVertical, Link2, NotebookPen } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fr } from "@/lib/i18n/fr";
import type { Project, ProjectDependency, Team } from "@/lib/planner/types";
import { getTeamById } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

function DraggableDraftCard({
  project,
  dependencyCount,
  teams,
}: {
  project: Project;
  dependencyCount: number;
  teams: Team[];
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `draft:${project.id}`,
    data: {
      type: "draft",
      projectId: project.id,
      durationHalfDays: project.estimatedDurationHalfDays,
      title: project.title,
    },
  });
  const team = getTeamById(teams, project.plannedTeam);

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "border-border/70 bg-card/95 shadow-[0_18px_45px_-38px_rgba(14,18,32,0.6)] transition-shadow",
        isDragging && "opacity-50 shadow-lg"
      )}
      style={{
        transform: CSS.Translate.toString(transform),
      }}
      {...attributes}
      {...listeners}
    >
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{project.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {team ? `Equipe cible : ${team.nameFr}` : "Equipe non resolue"}
            </p>
          </div>
          <GripVertical className="mt-0.5 size-4 text-muted-foreground" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            <CalendarClock className="size-3.5" />
            {project.estimatedDurationHalfDays / 2} {fr.schedule.daysSuffix}
          </Badge>
          <Badge variant="outline">
            <Link2 className="size-3.5" />
            {dependencyCount} deps
          </Badge>
        </div>

        {project.notes ? (
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            {project.notes}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DraftSidebar({
  drafts,
  dependencies,
  teams,
}: {
  drafts: Project[];
  dependencies: ProjectDependency[];
  teams: Team[];
}) {
  return (
    <Sidebar className="border-r border-sidebar-border/70" collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border/70 px-4 py-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sidebar-foreground/60">
            {fr.sidebar.eyebrow}
          </p>
          <h2 className="font-heading text-lg font-semibold text-sidebar-foreground">
            {fr.sidebar.title}
          </h2>
        </div>
        <div className="rounded-2xl border border-sidebar-border/70 bg-background/70 px-3 py-2 text-xs leading-5 text-sidebar-foreground/70">
          {fr.sidebar.prototypeNote}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-3 py-3">
          <SidebarGroupLabel>{fr.sidebar.unscheduledProjects}</SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <ScrollArea className="h-[calc(100svh-16rem)] pr-2">
              <div className="space-y-3 pb-6">
                {drafts.map((project) => (
                  <DraggableDraftCard
                    key={project.id}
                    project={project}
                    teams={teams}
                    dependencyCount={
                      dependencies.filter(
                        (dependency) => dependency.successorProjectId === project.id
                      ).length
                    }
                  />
                ))}
              </div>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="gap-3 px-4 py-4">
        <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/60 p-3 text-sm text-sidebar-foreground/80">
          <div className="flex items-center gap-2 font-medium text-sidebar-foreground">
            <NotebookPen className="size-4" />
            {fr.sidebar.rulesTitle}
          </div>
          <p className="mt-2 text-xs leading-5">{fr.sidebar.rulesBody}</p>
        </div>
        <Button variant="outline" className="w-full justify-start">
          {drafts.length} {fr.sidebar.readyToPlace}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
