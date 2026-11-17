import { useEffect, useState } from "react";
import { api } from "../../api";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

// Settings › Food sources (admin): Open Food Facts needs nothing; USDA needs a free key.
// The key is never sent back — the server only says whether one is saved.
export default function FoodSourcesSettings() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ usda: { hasKey: boolean } }>("GET", "/api/admin/food-sources")
      .then((r) => setHasKey(r.usda.hasKey))
      .catch((e) => setMsg(errorMsg(e)));
  }, []);

  const save = async (usdaApiKey: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ usda: { hasKey: boolean } }>("PUT", "/api/admin/food-sources", { usdaApiKey });
      setHasKey(r.usda.hasKey);
      setKey("");
      setMsg({ ok: true, text: r.usda.hasKey ? "USDA key saved" : "USDA key removed" });
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Food sources"
      description={
        <>
          Open Food Facts works without setup. USDA FoodData Central adds whole foods and more branded items; it needs a free key from{" "}
          <a className="text-link underline" href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noreferrer">
            fdc.nal.usda.gov
          </a>
          .
        </>
      }
    >
      {hasKey !== null && <p className="text-sm text-subtle">{hasKey ? "A USDA key is saved. Searches include USDA." : "No USDA key yet. Searches use your foods and Open Food Facts."}</p>}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) void save(key.trim());
        }}
      >
        <Field label="USDA API key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "Enter a new key to replace it" : "Paste your key"} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryButton} disabled={busy || !key.trim()}>
            Save key
          </button>
          {hasKey && (
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => void save(null)}>
              Remove key
            </button>
          )}
        </div>
      </form>
      <Notice msg={msg} />
    </Card>
  );
}
