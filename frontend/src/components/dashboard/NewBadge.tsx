import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../../api";
import { useSession } from "../../session";
import { badgeInfo } from "../goals/Badges";
import { linkButton } from "../ui/styles";
import { IconButton } from "../ui/IconButton";

// Dashboard: a small celebration for badges earned since the last visit. Shown once: they are marked
// seen as soon as the card shows. Quiet when badges can't be loaded (the Dashboard still works).
export default function NewBadge() {
  const { user } = useSession();
  const [ids, setIds] = useState<string[]>([]);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    api<{ new: string[] }>("GET", "/api/badges")
      .then((r) => {
        if (!r.new?.length) return;
        setIds(r.new);
        api("POST", "/api/badges/seen", { ids: r.new }).catch(() => {});
      })
      .catch(() => {});
  }, []);

  if (!ids.length) return null;
  const title = ids.length === 1 ? "New badge" : "New badges";
  const names = ids.map((id) => badgeInfo(id, user.units).name).join(", ");
  return (
    <section aria-label={title} className="flex items-start gap-3 rounded-2xl bg-brand-subtle px-4 py-3">
      <span aria-hidden="true" className="text-2xl leading-none">
        {badgeInfo(ids[0], user.units).icon}
      </span>
      <div className="flex-1">
        <p className="font-semibold">{`${title}: ${names} 🎉`}</p>
        <a href="#/goals" className={`${linkButton} text-sm`}>
          See your badges
        </a>
      </div>
      <IconButton label="Dismiss" onClick={() => setIds([])} className="rounded-full p-1.5 text-subtle hover:bg-pressed">
        <X className="size-4" aria-hidden="true" />
      </IconButton>
    </section>
  );
}
