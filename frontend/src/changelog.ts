// "What's new": one entry per version, newest first (W1, as in Culury). With each release add an entry and bump
// "version" in frontend/package.json and backend/package.json (a test keeps the three equal). Everyone sees the
// new entries once after signing in, and every version any time from the version number in the bottom left.
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title?: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.2.0",
    date: "2026-11-20",
    title: "GLP-1 doses, What's new, and the iPhone app",
    changes: [
      "GLP-1 setup lists Wegovy, Ozempic, Zepbound, Mounjaro, Saxenda and Trulicity with their standard dose steps. Compounded lets you enter your own medication name, dose and unit (mg, units or ml).",
      "What's new: after an update this window shows what changed. The version number in the bottom-left corner opens it any time.",
      "Server support for the ByteSize iPhone app: photos of a plate list the foods on it, Describe Food understands several foods at once (\"2 eggs, toast and coffee\"), and foods the AI estimated can be logged without saving them to My Foods.",
      "Deleting a food from the log can be undone for 10 minutes.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-16",
    title: "The first ByteSize",
    changes: [
      "Food log with calorie and protein ranges, rings and streaks; search, barcodes, photos of labels, AI estimates, My Foods, recipes and quick meals.",
      "Weight, goals and plans, weekly trends, badges, GLP-1 shot tracking and Insights.",
      "Culury meal plans and recipes, restaurant menus, backups, API keys, email and sign-in with passkeys.",
    ],
  },
];

/** a newer than b (major.minor.patch, compared as numbers); nothing seen yet counts as older. */
export function isNewer(a: string, b: string | null | undefined): boolean {
  if (!b) return true;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
