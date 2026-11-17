import type { ReactNode } from "react";

// A titled section of a page (Settings uses one per topic)
export function Card({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-line bg-container p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-subtle">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
