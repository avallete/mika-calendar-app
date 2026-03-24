import { DraftsBoard } from "@/components/planner/drafts-board";
import { fr } from "@/lib/i18n/fr";

export default function DraftsPage() {
  return (
    <section className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          {fr.draftsPage.eyebrow}
        </p>
        <h2 className="font-heading text-3xl font-semibold text-foreground">
          {fr.draftsPage.title}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {fr.draftsPage.description}
        </p>
      </div>

      <DraftsBoard />
    </section>
  );
}
