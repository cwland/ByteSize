import { useEffect, useState, type ReactNode } from "react";
import { BookMarked, CalendarDays, CalendarHeart, Camera, Flame, Globe, Layers, Lightbulb, Scale, ScanBarcode, Sparkles, Syringe, TrendingDown, Users, Utensils, Zap, type LucideIcon } from "lucide-react";
import { api } from "../../api";
import { shortDay } from "../../format";
import type { AppInfo } from "../../types";
import { Card } from "../ui/Card";
import { CountUp } from "../ui/CountUp";
import { Notice, errorMsg, type Msg } from "../ui/Notice";

const STAGGER_MS = 70; // each tile starts a little after the one before

type TileData = { label: string; Icon: LucideIcon; value?: number; decimals?: number; text?: string; lines?: [string, number][] };

// One number (or a date) with its label and a small icon; lines: a breakdown underneath, counted up too
function Tile({ tile, index }: { tile: TileData; index: number }) {
  const delayMs = index * STAGGER_MS;
  return (
    <div role="group" aria-label={tile.label} className="rounded-2xl bg-page p-4">
      <span className="flex size-8 items-center justify-center rounded-full bg-pressed text-action">
        <tile.Icon className="size-4" aria-hidden="true" />
      </span>
      <p className="mt-2 text-3xl font-bold tabular-nums">{tile.text ?? <CountUp value={tile.value!} decimals={tile.decimals} delayMs={delayMs} />}</p>
      <p className="text-sm text-subtle">{tile.label}</p>
      {tile.lines && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {tile.lines.map(([name, n]) => (
            <li key={name} className="flex justify-between gap-2">
              <span>{name}</span>
              <span className="tabular-nums">
                <CountUp value={n} delayMs={delayMs} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tiles({ title, description, tiles, children }: { title: string; description?: ReactNode; tiles: TileData[]; children?: ReactNode }) {
  return (
    <Card title={title} description={description}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <Tile key={t.label} tile={t} index={i} />
        ))}
      </div>
      {children}
    </Card>
  );
}

// Settings › App info (§29): fun numbers that count up when the tab opens. Everyone sees their own; the admin
// also sees totals for the whole server.
export default function AppInfoSettings() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    let live = true;
    api<AppInfo>("GET", "/api/app-info").then(
      (r) => live && setInfo(r),
      (e) => live && setMsg(errorMsg(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!info) return msg ? <Notice msg={msg} /> : <p className="px-1 text-subtle">Loading…</p>;
  const { you, everyone } = info;
  const lost = you.weightLost;
  const own: TileData[] = [
    { label: "Days logged", Icon: CalendarDays, value: you.daysLogged },
    { label: "Foods logged", Icon: Utensils, value: you.foodsLogged },
    { label: "Different foods", Icon: Layers, value: you.differentFoods },
    { label: "My foods", Icon: BookMarked, value: you.myFoods },
    { label: "Weigh-ins", Icon: Scale, value: you.weighIns },
    ...(lost ? [{ label: lost.unit === "kg" ? "Kilograms lost" : "Pounds lost", Icon: TrendingDown, value: lost.amount, decimals: 1 }] : []),
    ...(you.shots !== null ? [{ label: "Shots logged", Icon: Syringe, value: you.shots }] : []),
    { label: "Longest streak", Icon: Flame, value: you.longestStreak },
    { label: "Member since", Icon: CalendarHeart, text: shortDay(you.memberSince, true) },
  ];
  const o = you.outsideLookups;
  const counted: TileData[] = [
    { label: "Barcodes scanned", Icon: ScanBarcode, value: you.barcodesScanned },
    { label: "Photos read", Icon: Camera, value: you.photosRead },
    { label: "AI estimates", Icon: Sparkles, value: you.aiEstimates },
    { label: "AI insights", Icon: Lightbulb, value: you.aiInsights ?? 0 },
    { label: "Lookups saved", Icon: Zap, value: you.lookupsSaved },
    { label: "Outside lookups", Icon: Globe, value: o.total, lines: [["Open Food Facts", o.off], ["USDA", o.usda], ["FatSecret", o.fatsecret], ["Spoonacular", o.spoonacular], ["RecipeHub", o.culury]] },
  ];
  return (
    <>
      <Tiles title="Your numbers" description="What you've done in ByteSize." tiles={own} />
      <Tiles title="Lookups and tools" tiles={counted}>
        <p className="mt-3 text-sm text-muted">Counting since {shortDay(info.countingSince, true)}</p>
      </Tiles>
      {everyone && (
        <Tiles
          title="Everyone on this server"
          description="Totals across every person, for you as the admin. Nobody else sees these."
          tiles={[
            { label: "People", Icon: Users, value: everyone.people },
            { label: "Days logged", Icon: CalendarDays, value: everyone.daysLogged },
            { label: "Foods logged", Icon: Utensils, value: everyone.foodsLogged },
            { label: "Barcodes scanned", Icon: ScanBarcode, value: everyone.barcodesScanned },
            { label: "Outside lookups", Icon: Globe, value: everyone.outsideLookups },
            { label: "Lookups saved", Icon: Zap, value: everyone.lookupsSaved },
          ]}
        />
      )}
      <p className="px-1 text-center text-sm text-muted">ByteSize v{info.version}</p>
    </>
  );
}
