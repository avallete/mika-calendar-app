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
import type { Project, ProjectDependency } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

function DraggableDraftCard({
  project,
  dependencyCount,
}: {
  project: Project;
  dependencyCount: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `draft:${project.id}`,
    data: {
      type: "draft",
      projectId: project.id,
      durationHalfDays: project.estimatedDurationHalfDays,
    },
  });

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
              Planned for {project.plannedTeam === "team-a" ? "Team A" : "Team B"}
            </p>
          </div>
          <GripVertical className="mt-0.5 size-4 text-muted-foreground" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            <CalendarClock className="size-3.5" />
            {project.estimatedDurationHalfDays / 2} days
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
}: {
  drafts: Project[];
  dependencies: ProjectDependency[];
}) {
  return (
    <Sidebar className="border-r border-sidebar-border/70" collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border/70 px-4 py-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sidebar-foreground/60">
            Draft queue
          </p>
          <h2 className="font-heading text-lg font-semibold text-sidebar-foreground">
            Drag onto the calendar
          </h2>
        </div>
        <div className="rounded-2xl border border-sidebar-border/70 bg-background/70 px-3 py-2 text-xs leading-5 text-sidebar-foreground/70">
          Draft search is omitted in the current prototype to keep sidebar hydration
          deterministic across browser extensions.
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-3 py-3">
          <SidebarGroupLabel>Unscheduled projects</SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <ScrollArea className="h-[calc(100svh-16rem)] pr-2">
              <div className="space-y-3 pb-6">
                {drafts.map((project) => (
                  <DraggableDraftCard
                    key={project.id}
                    project={project}
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
            Scheduling rules
          </div>
          <p className="mt-2 text-xs leading-5">
            Weekends, holidays, and closures pause progress. Team order is preserved
            automatically after each placement.
          </p>
        </div>
        <Button variant="outline" className="w-full justify-start">
          {drafts.length} drafts ready to place
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
