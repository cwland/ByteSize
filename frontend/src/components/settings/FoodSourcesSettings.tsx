import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../api";
import { lookupsText } from "../log/RestaurantsView";
import { Card } from "../ui/Card";
import { KeyField } from "../ui/KeyField";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

type Source = "usda" | "spoonacular" | "fatsecret";
type Summary = Record<Source, { hasKey: boolean }>;
// pick: which part of GET /api/admin/food-sources/:source/key this box holds
type KeyBox = { name: string; label: string; pick: "key" | "clientId" | "clientSecret" };

const link = (href: string, text: string) => (
  <a className="text-link underline" href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

// One source's key(s): typed in and saved. The summary only says whether they're saved; each box's eye and
// copy buttons fetch the saved one when pressed. Several boxes (FatSecret's client ID + secret) are saved
// together; Remove clears them all.
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
  onSaved: (s: Summary) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
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
    <section aria-label={title} className="mt-4 border-t border-line pt-4 first:mt-0 first:border-0 first:pt-0">
      <h3 className="font-bold">{title}</h3>
      <p className="mt-1 text-sm text-subtle">{about}</p>
      {hasKey !== null && <p className="mt-1 text-sm text-subtle">{hasKey ? saved : none}</p>}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (filled) void save(false);
        }}
      >
        {fields.map((f) => (
          <KeyField
            key={f.name}
            label={f.label}
            keyName={fields.length > 1 ? f.label : `${title} key`}
            value={values[f.name] ?? ""}
            onChange={(v) => setValues((vs) => ({ ...vs, [f.name]: v }))}
            saved={!!hasKey}
            fetchSaved={async () => (await api<Record<string, string>>("GET", `/api/admin/food-sources/${source}/key`))[f.pick]}
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
    </section>
  );
}

// The summary of which keys are saved (admins only), shared by the two sections below
function useSourceKeys() {
  const [keys, setKeys] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    api<Summary>("GET", "/api/admin/food-sources")
      .then(setKeys)
      .catch((e) => setMsg(errorMsg(e)));
  }, []);
  const has = (s: Source) => (keys ? (keys[s]?.hasKey ?? false) : null);
  return { has, setKeys, msg };
}

// Settings › Integrations › Food databases (admin): Open Food Facts needs nothing; USDA needs a free key
export function FoodDatabasesSettings() {
  const { has, setKeys, msg } = useSourceKeys();
  return (
    <Card title="Food databases" description="Where food searches look, beside your own foods.">
      <section aria-label="Open Food Facts" className="mb-4 border-b border-line pb-4">
        <h3 className="font-bold">Open Food Facts</h3>
        <p className="mt-1 text-sm text-subtle">Packaged foods and barcodes from {link("https://world.openfoodfacts.org", "openfoodfacts.org")}. No key needed — it's always on.</p>
      </section>
      <KeyBlock
        source="usda"
        title="USDA"
        noun="key"
        fields={[{ name: "usdaApiKey", label: "USDA API key", pick: "key" }]}
        hasKey={has("usda")}
        about={<>FoodData Central adds whole foods and more branded items. Get a key at {link("https://fdc.nal.usda.gov/api-key-signup", "fdc.nal.usda.gov")}.</>}
        saved="A USDA key is saved. Searches include USDA."
        none="No USDA key yet. Searches use your foods and Open Food Facts."
        onSaved={setKeys}
      />
      <Notice msg={msg} />
    </Card>
  );
}

// Settings › Integrations › Restaurant menus (admin): the Restaurants tab needs Spoonacular's key and/or
// FatSecret's credentials
export function RestaurantMenusSettings() {
  const { has, setKeys, msg } = useSourceKeys();
  return (
    <Card title="Restaurant menus" description="Chain restaurants' menus for the Log › Restaurants tab. Each source needs a free key of your own.">
      <KeyBlock
        source="spoonacular"
        title="Spoonacular"
        noun="key"
        fields={[{ name: "spoonacularApiKey", label: "Spoonacular API key", pick: "key" }]}
        hasKey={has("spoonacular")}
        about={<>Big chains' menus for the Restaurants tab (free plan: about 22 lookups a day). Get a key at {link("https://spoonacular.com/food-api/console", "spoonacular.com")}.</>}
        saved="A Spoonacular key is saved. The Restaurants tab tries it first."
        none="No Spoonacular key yet."
        testable
        testNote="(uses 1 lookup)"
        onSaved={setKeys}
      />
      <KeyBlock
        source="fatsecret"
        title="FatSecret"
        noun="credentials"
        fields={[
          { name: "fatsecretClientId", label: "FatSecret client ID", pick: "clientId" },
          { name: "fatsecretClientSecret", label: "FatSecret client secret", pick: "clientSecret" },
        ]}
        hasKey={has("fatsecret")}
        about={<>Restaurants fallback when Spoonacular has no key, runs out or finds nothing. Get a client ID and secret at {link("https://platform.fatsecret.com", "platform.fatsecret.com")}, and allow this server's IP address there.</>}
        saved="FatSecret credentials are saved."
        none="No FatSecret credentials yet."
        testable
        onSaved={setKeys}
      />
      <p className="mt-4 border-t border-line pt-4 text-xs text-muted">
        Credits shown in the Restaurants tab for the sources in use: “Restaurant data from spoonacular.com” and “Powered by FatSecret”.
      </p>
      <Notice msg={msg} />
    </Card>
  );
}
