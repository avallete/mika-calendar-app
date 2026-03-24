"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarRange,
  ClipboardList,
  RotateCcw,
  RotateCw,
  Settings2,
} from "lucide-react";

import { usePlanner } from "@/components/planner/planner-provider";
import { Button } from "@/components/ui/button";
import { fr } from "@/lib/i18n/fr";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: fr.nav.schedule, icon: CalendarRange },
  { href: "/drafts", label: fr.nav.drafts, icon: ClipboardList },
  { href: "/settings", label: fr.nav.settings, icon: Settings2 },
];

export function AppHeader() {
  const pathname = usePathname();
  const { state, isPending, undo, redo } = usePlanner();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl border border-black/10 bg-[linear-gradient(140deg,oklch(0.58_0.11_205),oklch(0.68_0.13_55))] text-white shadow-[0_10px_35px_-18px_rgba(0,0,0,0.4)]">
            <CalendarRange className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {fr.header.eyebrow}
            </p>
            <h1 className="font-heading text-lg font-semibold text-foreground">
              {fr.header.title}
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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={undo}
            disabled={!state.history.canUndo || isPending}
            title="Ctrl+Z"
          >
            <RotateCcw className="size-4" />
            {fr.header.undo}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={redo}
            disabled={!state.history.canRedo || isPending}
            title="Ctrl+Shift+Z"
          >
            <RotateCw className="size-4" />
            {fr.header.redo}
          </Button>
        </div>
      </div>
    </header>
  );
}
