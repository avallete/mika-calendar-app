import { DraftsBoard } from "@/components/planner/drafts-board";

export default function DraftsPage() {
  return (
    <section className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Planning input
        </p>
        <h2 className="font-heading text-3xl font-semibold text-foreground">
          Draft project list and dependency intake
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Capture new work here first. The schedule page then exposes the same drafts in the
          sidebar for drag-and-drop placement.
        </p>
      </div>

      <DraftsBoard />
    </section>
  );
}
