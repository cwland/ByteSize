import { useState, type ReactNode } from "react";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";

export const OFF_STATUS = "Off — not used";

// One integration in Settings › Integrations: its title and on/off switch in one row. On, the card is open
// (description and body); off, only the title row and "Off — not used". on null: not loaded yet (no switch,
// only `loading`: "Loading…" or why it couldn't be loaded).
// The switch saves at once (onSwitch); if that fails it goes back and the card says why.
export function IntegrationCard({
  title,
  on,
  onSwitch,
  description,
  loading,
  children,
}: {
  title: string;
  on: boolean | null;
  onSwitch: (on: boolean) => Promise<void>;
  description?: ReactNode;
  loading?: ReactNode;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const flip = async (next: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await onSwitch(next);
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={title} className="rounded-2xl bg-container p-5">
      <div className="flex items-center gap-3">
        <h2 className="mr-auto text-lg font-bold">{title}</h2>
        {on !== null && <Toggle label={`${title} on`} checked={on} disabled={busy} onChange={(v) => void flip(v)} />}
      </div>
      {on === false && <p className="mt-1 text-sm text-subtle">{OFF_STATUS}</p>}
      {on && (
        <>
          {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
          <div className="mt-4">{children}</div>
        </>
      )}
      {on === null && loading && <div className="mt-4">{loading}</div>}
      <Notice msg={msg} />
    </section>
  );
}
