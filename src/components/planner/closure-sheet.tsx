"use client";

import { useState } from "react";

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
import type { ClosureFormState } from "@/lib/planner/types";

export function ClosureSheet({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: ClosureFormState) => void;
}) {
  const [title, setTitle] = useState("Company closure");
  const [type, setType] = useState<ClosureFormState["type"]>("company_closure");
  const [startDate, setStartDate] = useState("2026-04-20");
  const [endDate, setEndDate] = useState("2026-04-21");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b border-border/60 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Company calendar
          </p>
          <SheetTitle className="mt-2 text-2xl">Add a closure</SheetTitle>
          <SheetDescription>
            Closures block all progress and force dependent work to move forward.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Label
            </p>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Type
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ["holiday", "Holiday"],
                ["company_closure", "Closure"],
                ["custom_time_off", "Time off"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    type === value
                      ? "rounded-2xl border border-transparent bg-foreground px-3 py-3 text-sm text-background"
                      : "rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground"
                  }
                  onClick={() => setType(value as ClosureFormState["type"])}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Start date
              </p>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                End date
              </p>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>
        </div>

        <SheetFooter className="border-t border-border/60">
          <Button
            onClick={() => {
              onSave({ title, type, startDate, endDate });
              onOpenChange(false);
            }}
          >
            Save closure
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
