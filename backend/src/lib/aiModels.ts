import type { AiProvider } from "./ai.js";

// Which models to suggest first in Settings › AI. Picked by family and version rather than a fixed
// list of names, so it keeps working as providers release new models:
//  - Claude: newest Haiku (fast, reads photos), then newest Sonnet
//  - OpenAI: newest "gpt-N[.N][o]-mini" or "oN-mini" (never codex), then the newest plain "gpt-N[.N]"
//  - Gemini: newest Flash (not lite/image/tts/live), then newest Pro
//  - OpenRouter: the same rules on "anthropic/", "openai/" and "google/" names (main pick of each)
//  - Home AI: nothing (the list is shown A–Z)
// At most 2 per provider, best first.

const MAX = 2;

// Never suggested: previews, experiments and models that aren't for chat (codex = coding models)
const EXCLUDED = /(^|[-_/.:])(preview|exp\w*|embed\w*|audio|tts|realtime|transcribe|image\w*|moderation|instruct|codex)(?=$|[-_/.:\d])/i;

// A pin on the end of a name: a date (20251001 or 2025-08-07) or a revision (001)
const PIN = /-(\d{8}|\d{4}-\d{2}-\d{2}|\d{3})$/;

interface Parsed {
  name: string;
  base: string; // without the pin
  version: number[]; // the numbers in the name, left to right
  sized: boolean; // has a size tag (-8b, -70b): ranks below the plain model of the same version
  pin: number | null; // null = an alias (ranked above pinned names of the same version)
}

const SIZE = /^\d+b$/i;

function parse(name: string): Parsed {
  const m = name.match(PIN);
  const base = m ? name.slice(0, m.index) : name;
  // Size tags like "8b" are not part of the version
  const parts = base.split(/[-_/.:]/);
  const sized = parts.some((t) => SIZE.test(t));
  const version = parts.filter((t) => !SIZE.test(t)).flatMap((t) => t.match(/\d+/g) ?? []).map(Number);
  return { name, base, version, sized, pin: m ? Number(m[1].replace(/-/g, "")) : null };
}

// Newest first: higher version numbers, then an alias, then the later pin
function newer(a: Parsed, b: Parsed): number {
  for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
    const d = (b.version[i] ?? 0) - (a.version[i] ?? 0);
    if (d) return d;
  }
  if (a.sized !== b.sized) return a.sized ? 1 : -1;
  if (a.pin !== b.pin) return a.pin === null ? -1 : b.pin === null ? 1 : b.pin - a.pin;
  return a.name.localeCompare(b.name);
}

const tokens = (base: string) => base.toLowerCase().split(/[-_/.:]/);
const newest = (list: Parsed[], fits: (p: Parsed, t: string[]) => boolean) => list.filter((p) => fits(p, tokens(p.base))).sort(newer)[0]?.name;

type Rule = (list: Parsed[]) => (string | undefined)[];
const RULES: Record<"anthropic" | "openai" | "gemini", Rule> = {
  anthropic: (l) => [newest(l, (_p, t) => t.includes("haiku")), newest(l, (_p, t) => t.includes("sonnet"))],
  openai: (l) => [newest(l, (p) => /^(gpt-\d+(\.\d+)?o?|o\d+)-mini$/i.test(p.base)), newest(l, (p) => /^gpt-\d+(\.\d+)?$/i.test(p.base))],
  gemini: (l) => [
    newest(l, (_p, t) => t.includes("flash") && !t.some((x) => ["lite", "image", "tts", "live"].includes(x))),
    newest(l, (_p, t) => t.includes("pro")),
  ],
};

const pick = (rule: Rule, names: string[]) => {
  const list = names.filter((n) => !EXCLUDED.test(n)).map(parse);
  return rule(list).filter((n): n is string => !!n);
};

// OpenRouter prefix → the provider whose rules apply, in order of preference
const OPENROUTER: [string, keyof typeof RULES][] = [
  ["anthropic", "anthropic"],
  ["openai", "openai"],
  ["google", "gemini"],
];

export function recommendModels(provider: AiProvider, models: string[]): string[] {
  if (provider === "anthropic" || provider === "openai" || provider === "gemini") return pick(RULES[provider], models).slice(0, MAX);
  if (provider === "openrouter") {
    const out: string[] = [];
    for (const [prefix, rules] of OPENROUTER) {
      // Variants such as ":free" or ":thinking" are left out
      const names = models.filter((m) => m.startsWith(`${prefix}/`) && !m.includes(":")).map((m) => m.slice(prefix.length + 1));
      const main = pick(RULES[rules], names)[0];
      if (main) out.push(`${prefix}/${main}`);
    }
    return out.slice(0, MAX);
  }
  return [];
}
