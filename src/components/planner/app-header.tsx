"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, ClipboardList, DatabaseZap } from "lucide-react";

import { usePlanner } from "@/components/planner/planner-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Schedule", icon: CalendarRange },
  { href: "/drafts", label: "Drafts", icon: ClipboardList },
];

export function AppHeader() {
  const pathname = usePathname();
  const { resetDemoData } = usePlanner();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl border border-black/10 bg-[linear-gradient(140deg,var(--team-a),var(--team-b))] text-white shadow-[0_10px_35px_-18px_rgba(0,0,0,0.4)]">
            <CalendarRange className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Calendar / Project Control
            </p>
            <h1 className="font-heading text-lg font-semibold text-foreground">
              AppCalendar Mika
            </h1>
          </div>
        </div>

        <nav className="flex items-center gap-2 rounded-full border border-border/70 bg-card/90 p-1 shadow-sm">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Button variant="outline" size="sm" onClick={resetDemoData}>
          <DatabaseZap className="size-4" />
          Reset demo state
        </Button>
      </div>
    </header>
  );
}
