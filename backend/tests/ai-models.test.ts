import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recommendModels } from "../src/lib/aiModels.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// Model lists as the providers send them (dated + alias + preview + embedding/audio names mixed in)
const anthropic = [
  "claude-opus-4-1-20250805",
  "claude-opus-4-1",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5",
  "claude-3-5-haiku-20241022",
  "claude-3-haiku-20240307",
];
const openai = [
  "gpt-4o-mini-tts",
  "gpt-4o-mini-transcribe",
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-mini-search-preview",
  "gpt-4o-mini-audio-preview",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4.1-mini",
  "gpt-5-mini-2025-08-07",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5",
  "gpt-5-2025-08-07",
  "gpt-5.1",
  "gpt-5.1-chat-latest",
  "gpt-5-pro",
  "gpt-4.1",
  "gpt-4o",
  "gpt-image-1",
  "text-embedding-3-small",
  "omni-moderation-latest",
  "gpt-3.5-turbo-instruct",
  "o4-mini",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex",
  "codex-mini-latest",
];
const gemini = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-exp",
  "gemini-2.0-flash-live-001",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-flash-preview-09-2025",
  "gemini-2.5-flash",
  "gemini-2.5-pro-preview-06-05",
  "gemini-2.5-pro",
  "gemini-1.5-pro",
  "text-embedding-004",
  "gemma-3-27b-it",
];

describe("recommendModels", () => {
  it("Claude: newest Haiku, then newest Sonnet (alias above dated)", () => {
    expect(recommendModels("anthropic", anthropic)).toEqual(["claude-haiku-4-5", "claude-sonnet-4-5"]);
  });

  it("Claude: a dated name is picked when it's the only one of the newest version", () => {
    expect(recommendModels("anthropic", ["claude-3-5-haiku-20241022", "claude-haiku-4-5-20251001", "claude-3-7-sonnet-20250219", "claude-sonnet-4-20250514"])).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514",
    ]);
    // Same version: the later date wins
    expect(recommendModels("anthropic", ["claude-3-5-haiku-20240620", "claude-3-5-haiku-20241022"])).toEqual(["claude-3-5-haiku-20241022"]);
  });

  it("OpenAI: newest mini, then newest bare flagship", () => {
    expect(recommendModels("openai", openai)).toEqual(["gpt-5-mini", "gpt-5.1"]);
    // Coding models (codex) are never picked, even when their version is newer
    expect(recommendModels("openai", ["gpt-5-mini", "gpt-5.1-codex-mini", "gpt-5.1", "o4-mini", "gpt-5.1-codex", "codex-mini-latest"])).toEqual(["gpt-5-mini", "gpt-5.1"]);
    expect(recommendModels("openai", ["gpt-5-mini", "gpt-5.1-codex-mini", "gpt-5", "gpt-5.1-codex"])).toEqual(["gpt-5-mini", "gpt-5"]);
    expect(recommendModels("openai", ["gpt-4o-mini", "gpt-4o-mini-tts", "gpt-4o"])).toEqual(["gpt-4o-mini"]);
    expect(recommendModels("openai", ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o-mini-tts", "gpt-4.1", "gpt-4o"])).toEqual(["gpt-4.1-mini", "gpt-4.1"]);
  });

  it("Gemini: newest Flash (not lite/image/tts/live/preview), then newest Pro", () => {
    expect(recommendModels("gemini", gemini)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    expect(recommendModels("gemini", ["gemini-2.5-flash-lite", "gemini-2.5-flash-preview-tts", "gemini-2.0-flash", "text-embedding-004"])).toEqual(["gemini-2.0-flash"]);
    // A revision pin ("-001") ranks below the alias of the same version
    expect(recommendModels("gemini", ["gemini-2.0-flash-001", "gemini-2.0-flash"])).toEqual(["gemini-2.0-flash"]);
  });

  it("Gemini: a size tag (-8b) isn't a version, and a sized model ranks below its plain sibling", () => {
    expect(recommendModels("gemini", ["gemini-1.5-flash-8b", "gemini-1.5-flash", "gemini-1.5-pro"])).toEqual(["gemini-1.5-flash", "gemini-1.5-pro"]);
    expect(recommendModels("gemini", ["gemini-1.5-flash", "gemini-1.5-flash-8b"])).toEqual(["gemini-1.5-flash"]);
    // Still offered when it's all there is
    expect(recommendModels("gemini", ["gemini-1.5-flash-8b"])).toEqual(["gemini-1.5-flash-8b"]);
  });

  it("Gemini: experimental models (-experimental, -exp-0827) are never suggested", () => {
    expect(recommendModels("gemini", ["learnlm-2.0-flash-experimental", "gemini-2.0-flash", "gemini-exp-1206"])).toEqual(["gemini-2.0-flash"]);
    expect(recommendModels("gemini", ["learnlm-2.0-flash-experimental"])).toEqual([]);
  });

  it("OpenRouter: the same families by provider prefix, at most 2", () => {
    const list = [
      "anthropic/claude-3.5-haiku",
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5-mini",
      "openai/gpt-5",
      "google/gemini-2.5-flash",
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct",
      "mistralai/mistral-small-3.2-24b-instruct",
    ];
    expect(recommendModels("openrouter", list)).toEqual(["anthropic/claude-haiku-4.5", "openai/gpt-5-mini"]);
    expect(recommendModels("openrouter", ["openai/gpt-5", "google/gemini-2.5-pro", "google/gemini-2.5-flash", "mistralai/mistral-large"])).toEqual(["openai/gpt-5", "google/gemini-2.5-flash"]);
    expect(recommendModels("openrouter", ["openai/gpt-5.1-codex-mini", "openai/gpt-5-mini", "openai/gpt-5.1-codex", "openai/codex-mini"])).toEqual(["openai/gpt-5-mini"]);
    expect(recommendModels("openrouter", ["meta-llama/llama-3.3-70b-instruct", "qwen/qwen3-32b"])).toEqual([]);
  });

  it("Home AI: no recommendation", () => {
    expect(recommendModels("local", ["llama3.2:3b", "qwen3:8b", "gemma3:4b"])).toEqual([]);
  });

  it("never more than 2, never preview/embedding/audio/tts, always from the list", () => {
    for (const [p, list] of [["anthropic", anthropic], ["openai", openai], ["gemini", gemini]] as const) {
      const r = recommendModels(p, list);
      expect(r.length).toBeLessThanOrEqual(2);
      for (const m of r) {
        expect(list).toContain(m);
        expect(m).not.toMatch(/preview|exp|embed|audio|tts|realtime|transcribe|image|moderation|instruct|codex/);
      }
    }
    expect(recommendModels("openai", [])).toEqual([]);
  });
});

describe("POST /api/settings/ai/models", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  beforeEach(async () => {
    await t.reset();
    await t.login();
  });
  afterAll(async () => t.close());

  it("returns the recommended models with the list", async () => {
    t.ai.respond = () => ({ status: 200, json: { data: anthropic.map((id) => ({ id })) } });
    const r = await t.api("POST", "/api/settings/ai/models", { provider: "anthropic", apiKey: "K" });
    expect(r.status).toBe(200);
    expect(r.body.models).toEqual([...anthropic].sort());
    expect(r.body.recommended).toEqual(["claude-haiku-4-5", "claude-sonnet-4-5"]);
  });
});
