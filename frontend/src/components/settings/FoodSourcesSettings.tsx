import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { lookupsText } from "../log/RestaurantsView";
import { IntegrationCard } from "./IntegrationCard";
import { KeyField } from "../ui/KeyField";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

type Source = "usda" | "spoonacular" | "fatsecret";
// As GET /api/admin/food-sources sends it: each source's switch, and whether its key is saved
type Summary = { off: { enabled: boolean } } & Record<Source, { hasKey: boolean; enabled: boolean }>;
// pick: which part of GET /api/admin/food-sources/:source/key this box holds
type KeyBox = { name: string; label: string; pick: "key" | "clientId" | "clientSecret" };

const link = (href: string, text: string) => (
  <a className="text-link underline" href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

// One source's key(s): typed in and saved. The summary only says whether they're saved; each box's eye and
// copy buttons fetch the saved one when pressed. Several boxes (FatSecret's client ID + secret) are saved
// together; Remove clears them all. focus: the first box takes the focus (the card was just switched on
// with nothing set up).
function KeyBlock({
  source,
  title,
  noun,
  fields,
  hasKey,
  about,
  saved,
  none,
  testable,
  testNote,
  focus,
  onSaved,
}: {
  source: Source;
  title: string;
  noun: "key" | "credentials";
  fields: KeyBox[];
  hasKey: boolean | null;
  about: ReactNode;
  saved: string;
  none: string;
  testable?: boolean;
  testNote?: string; // what a Test costs
  focus?: boolean;
  onSaved: (s: Summary) => void;
}) {
  const firstBox = useId();
  useEffect(() => {
    if (focus) document.getElementById(firstBox)?.focus();
  }, [focus, firstBox]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  // The saved key(s) as fetched for the eye and copy buttons. FatSecret's ID and secret come in one answer
  // (one activity-log line), so it is kept while either is shown, or for a minute after a copy, and dropped
  // when both are hidden again, on a save (the boxes start afresh: generation) and when the card goes away.
  const fetched = useRef<{ answer: Promise<Record<string, string>>; at: number } | null>(null);
  const shownBoxes = useRef(new Set<string>());
  const [generation, setGeneration] = useState(0);
  const savedPart = (pick: KeyBox["pick"]) => {
    const f = fetched.current;
    if (!f || (shownBoxes.current.size === 0 && Date.now() - f.at > 60_000)) {
      const answer = api<Record<string, string>>("GET", `/api/admin/food-sources/${source}/key`);
      fetched.current = { answer, at: Date.now() };
      answer.catch(() => (fetched.current = null)); // a failed fetch is tried again next time
    }
    return fetched.current!.answer.then((r) => r[pick]);
  };
  const revealChanged = (name: string, shown: boolean) => {
    if (shown) shownBoxes.current.add(name);
    else if (shownBoxes.current.delete(name) && shownBoxes.current.size === 0) fetched.current = null;
  };
  const what = `${title} ${noun}`;
  const filled = fields.every((f) => values[f.name]?.trim());

  const save = async (remove: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const body = Object.fromEntries(fields.map((f) => [f.name, remove ? null : values[f.name].trim()]));
      const r = await api<Summary>("PUT", "/api/admin/food-sources", body);
      onSaved(r);
      setValues({});
      fetched.current = null;
      shownBoxes.current.clear();
      setGeneration((g) => g + 1);
      setMsg({ ok: true, text: `${what} ${r[source].hasKey ? "saved" : "removed"}` });
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; error?: string; lookupsLeft?: number }>("POST", "/api/admin/food-sources/test", { source });
      setMsg(r.ok ? { ok: true, text: `${title} works.${typeof r.lookupsLeft === "number" ? ` ${lookupsText(r.lookupsLeft)}.` : ""}` } : { ok: false, text: r.error ?? `${title} didn't answer` });
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm text-subtle">{about}</p>
      {hasKey !== null && <p className="mt-1 text-sm text-subtle">{hasKey ? saved : none}</p>}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (filled) void save(false);
        }}
      >
        {fields.map((f, i) => (
          <KeyField
            key={`${f.name}-${generation}`}
            id={i === 0 ? firstBox : undefined}
            label={f.label}
            keyName={fields.length > 1 ? f.label : `${title} key`}
            value={values[f.name] ?? ""}
            onChange={(v) => setValues((vs) => ({ ...vs, [f.name]: v }))}
            saved={!!hasKey}
            fetchSaved={() => savedPart(f.pick)}
            onRevealChange={(shown) => revealChanged(f.name, shown)}
            placeholder={hasKey ? "Enter a new one to replace it" : "Paste it here"}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="submit" aria-label={`Save ${what}`} className={primaryButton} disabled={busy || !filled}>
            Save {noun}
          </button>
          {hasKey && testable && (
            <button type="button" aria-label={`Test ${title}`} className={secondaryButton} disabled={busy} onClick={() => void test()}>
              Test
            </button>
          )}
          {hasKey && testable && testNote && <span className="self-center text-sm text-subtle">{testNote}</span>}
          {hasKey && (
            <button type="button" aria-label={`Remove ${what}`} className={secondaryButton} disabled={busy} onClick={() => void save(true)}>
              Remove {noun}
            </button>
          )}
        </div>
      </form>
      <Notice msg={msg} />
    </>
  );
}

// The food-source summary (admins only): each source's switch and whether its key is saved.
// IntegrationsSettings fetches it once for the four cards.
export type SourceKeys = ReturnType<typeof useSourceKeys>;
export function useSourceKeys() {
  const [keys, setKeys] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    api<Summary>("GET", "/api/admin/food-sources")
      .then(setKeys)
      .catch((e) => setMsg(errorMsg(e)));
  }, []);
  const has = (s: Source) => (keys ? (keys[s]?.hasKey ?? false) : null);
  const on = (s: Source | "off") => (keys ? (keys[s]?.enabled ?? false) : null);
  // A switch alone: only { enabled: { <source>: on } } is sent, the keys stay as they are
  const setOn = async (s: Source | "off", enabled: boolean) => setKeys(await api<Summary>("PUT", "/api/admin/food-sources", { enabled: { [s]: enabled } }));
  return { has, on, setOn, setKeys, msg };
}

/**
 * A food source's card with its switch. Switched on with no key saved, it opens with the key box focused.
 */
function SourceCard({ source, title, sources, children }: { source: Source | "off"; title: string; sources: SourceKeys; children: (focus: boolean) => ReactNode }) {
  const [focus, setFocus] = useState(false);
  const onSwitch = async (next: boolean) => {
    await sources.setOn(source, next);
    setFocus(next && source !== "off" && !sources.has(source));
  };
  return (
    <IntegrationCard title={title} on={sources.on(source)} onSwitch={onSwitch} loading={sources.msg ? <Notice msg={sources.msg} /> : <p className="text-muted">Loading…</p>}>
      {children(focus)}
    </IntegrationCard>
  );
}

const credits = (text: string) => <p className="mt-4 border-t border-line pt-4 text-xs text-muted">Credit shown in the Restaurants tab: “{text}”.</p>;

// Settings › Integrations › Open Food Facts (admin): needs no key
export function OpenFoodFactsSettings({ sources }: { sources: SourceKeys }) {
  return (
    <SourceCard source="off" title="Open Food Facts" sources={sources}>
      {() => <p className="text-sm text-subtle">Packaged foods and barcodes from {link("https://world.openfoodfacts.org", "openfoodfacts.org")}, in food searches beside your own foods. No key needed.</p>}
    </SourceCard>
  );
}

// Settings › Integrations › USDA (admin): needs a free key
export function UsdaSettings({ sources }: { sources: SourceKeys }) {
  return (
    <SourceCard source="usda" title="USDA" sources={sources}>
      {(focus) => (
        <KeyBlock
          source="usda"
          title="USDA"
          noun="key"
          fields={[{ name: "usdaApiKey", label: "USDA API key", pick: "key" }]}
          hasKey={sources.has("usda")}
          about={<>FoodData Central adds whole foods and more branded items to food searches. Get a key at {link("https://fdc.nal.usda.gov/api-key-signup", "fdc.nal.usda.gov")}.</>}
          saved="A USDA key is saved. Searches include USDA."
          none="No USDA key yet — USDA isn't used until one is saved."
          focus={focus}
          onSaved={sources.setKeys}
        />
      )}
    </SourceCard>
  );
}

// Settings › Integrations › FatSecret (admin): the Restaurants tab's fallback, a client ID and secret
export function FatSecretSettings({ sources }: { sources: SourceKeys }) {
  return (
    <SourceCard source="fatsecret" title="FatSecret" sources={sources}>
      {(focus) => (
        <>
          <KeyBlock
            source="fatsecret"
            title="FatSecret"
            noun="credentials"
            fields={[
              { name: "fatsecretClientId", label: "FatSecret client ID", pick: "clientId" },
              { name: "fatsecretClientSecret", label: "FatSecret client secret", pick: "clientSecret" },
            ]}
            hasKey={sources.has("fatsecret")}
            about={<>Restaurant menus, used when Spoonacular is off, has no key, runs out or finds nothing. Get a client ID and secret at {link("https://platform.fatsecret.com", "platform.fatsecret.com")}, and allow this server's IP address there.</>}
            saved="FatSecret credentials are saved."
            none="No FatSecret credentials yet — FatSecret isn't used until they're saved."
            testable
            focus={focus}
            onSaved={sources.setKeys}
          />
          {credits("Powered by FatSecret")}
        </>
      )}
    </SourceCard>
  );
}

// Settings › Integrations › Spoonacular (admin): big chains' menus for the Restaurants tab, tried first
export function SpoonacularSettings({ sources }: { sources: SourceKeys }) {
  return (
    <SourceCard source="spoonacular" title="Spoonacular" sources={sources}>
      {(focus) => (
        <>
          <KeyBlock
            source="spoonacular"
            title="Spoonacular"
            noun="key"
            fields={[{ name: "spoonacularApiKey", label: "Spoonacular API key", pick: "key" }]}
            hasKey={sources.has("spoonacular")}
            about={<>Big chains' menus for the Restaurants tab (free plan: about 22 lookups a day). Get a key at {link("https://spoonacular.com/food-api/console", "spoonacular.com")}.</>}
            saved="A Spoonacular key is saved. The Restaurants tab tries it first."
            none="No Spoonacular key yet — Spoonacular isn't used until one is saved."
            testable
            testNote="(uses 1 lookup)"
            focus={focus}
            onSaved={sources.setKeys}
          />
          {credits("Restaurant data from spoonacular.com")}
        </>
      )}
    </SourceCard>
  );
}
