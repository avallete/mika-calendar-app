import { ArrowRightLeft, Archive, FolderKanban, PauseOctagon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { fr } from "@/lib/i18n/fr";
import type { ProjectMetrics } from "@/lib/planner/types";

const metricMeta = [
  {
    key: "scheduledCount",
    label: fr.metrics.scheduled,
    icon: FolderKanban,
    tint: "oklch(0.95 0.03 205)",
  },
  {
    key: "draftCount",
    label: fr.metrics.drafts,
    icon: Archive,
    tint: "oklch(0.96 0.04 55)",
  },
  {
    key: "blockedCount",
    label: fr.metrics.blocked,
    icon: ArrowRightLeft,
    tint: "oklch(0.95 0.05 77)",
  },
  {
    key: "closureCount",
    label: fr.metrics.closures,
    icon: PauseOctagon,
    tint: "oklch(0.94 0.03 20)",
  },
] as const;

export function MetricBar({ metrics }: { metrics: ProjectMetrics }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metricMeta.map((item) => {
        const Icon = item.icon;
        const value = metrics[item.key];

        return (
          <Card
            key={item.key}
            className="border-border/60 bg-card/90 shadow-[0_14px_40px_-34px_rgba(32,32,32,0.5)]"
          >
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                  {value}
                </p>
              </div>
              <div
                className="flex size-11 items-center justify-center rounded-2xl"
                style={{ background: item.tint }}
              >
                <Icon className="size-5 text-foreground" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
