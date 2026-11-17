import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../api";
import { lookupsText } from "../log/RestaurantsView";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

type Source = "usda" | "spoonacular" | "fatsecret";
type Summary = Record<Source, { hasKey: boolean }>;
type KeyField = { name: string; label: string; secret: boolean };

const link = (href: string, text: string) => (
  <a className="text-link underline" href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

// One source's key(s): typed in, saved, never shown again (the server only says whether they're saved).
// Several fields (FatSecret's client ID + secret) are saved together; Remove clears them all.
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
  onSaved,
}: {
  source: Source;
  title: string;
  noun: "key" | "credentials";
  fields: KeyField[];
  hasKey: boolean | null;
  about: ReactNode;
  saved: string;
  none: string;
  testable?: boolean;
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
          <Field
            key={f.name}
            label={f.label}
            type={f.secret ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
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

// Settings › Food sources (admin): Open Food Facts needs nothing; USDA needs a free key; the Restaurants tab
// needs Spoonacular's key and/or FatSecret's credentials. No key is ever sent back.
export default function FoodSourcesSettings() {
  const [keys, setKeys] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    api<Summary>("GET", "/api/admin/food-sources")
      .then(setKeys)
      .catch((e) => setMsg(errorMsg(e)));
  }, []);
  const has = (s: Source) => (keys ? (keys[s]?.hasKey ?? false) : null);

  return (
    <Card title="Food sources" description="Open Food Facts works without setup. The others need a free key of your own.">
      <KeyBlock
        source="usda"
        title="USDA"
        noun="key"
        fields={[{ name: "usdaApiKey", label: "USDA API key", secret: true }]}
        hasKey={has("usda")}
        about={<>FoodData Central adds whole foods and more branded items. Get a key at {link("https://fdc.nal.usda.gov/api-key-signup", "fdc.nal.usda.gov")}.</>}
        saved="A USDA key is saved. Searches include USDA."
        none="No USDA key yet. Searches use your foods and Open Food Facts."
        onSaved={setKeys}
      />
      <KeyBlock
        source="spoonacular"
        title="Spoonacular"
        noun="key"
        fields={[{ name: "spoonacularApiKey", label: "Spoonacular API key", secret: true }]}
        hasKey={has("spoonacular")}
        about={<>Big chains' menus for the Restaurants tab (free plan: about 22 lookups a day). Get a key at {link("https://spoonacular.com/food-api/console", "spoonacular.com")}.</>}
        saved="A Spoonacular key is saved. The Restaurants tab tries it first."
        none="No Spoonacular key yet."
        testable
        onSaved={setKeys}
      />
      <KeyBlock
        source="fatsecret"
        title="FatSecret"
        noun="credentials"
        fields={[
          { name: "fatsecretClientId", label: "FatSecret client ID", secret: false },
          { name: "fatsecretClientSecret", label: "FatSecret client secret", secret: true },
        ]}
        hasKey={has("fatsecret")}
        about={<>Restaurants fallback when Spoonacular has no key, runs out or finds nothing. Get a client ID and secret at {link("https://platform.fatsecret.com", "platform.fatsecret.com")}, and allow this server's IP address there.</>}
        saved="FatSecret credentials are saved."
        none="No FatSecret credentials yet."
        testable
        onSaved={setKeys}
      />
      <Notice msg={msg} />
    </Card>
  );
}
