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
    version: "0.7.0",
    date: "2026-11-20",
    title: "Goals and My Foods on iPhone",
    changes: [
      "iPhone: the Goals tab shows your targets and active goals, a weight chart (1W, 1M, 3M, All) with your trend, and every weigh-in with its change. Log weight from there, or swipe one away.",
      "iPhone: the My Foods tab lists your foods, corrections, recipes and quick meals, with search, filters and sorting. Tap one to log it; a quick meal lets you leave items out or change amounts before Log all.",
      "iPhone: the day strip and calendar reach a week ahead, so you can plan and pre-log food. Water, weight and shots wait for the day.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-11-20",
    title: "Today on iPhone",
    changes: [
      "iPhone: the Dashboard and Food Log have a day strip you swipe one day at a time (tap the date for a month calendar); days you've seen show instantly, without a flash.",
      "iPhone: the Food Log shows what you've eaten, what's left, and protein and fiber against your targets.",
      "iPhone: Today's overview opens with a chevron to the full daily totals, and the calorie bar goes light green, dark green in range, red over.",
      "iPhone: Log shot takes the dose (your medication's steps or a custom dose), the date and notes.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-11-20",
    title: "Adding food on iPhone",
    changes: [
      "iPhone: the Food Log always shows Breakfast, Lunch, Dinner and Snacks, each with its own Add, which opens Track Food in that meal.",
      "iPhone: before you type, Track Food shows Same as yesterday, Favorites and Recently tracked. The + on a row logs it at once (at the amount you last had); Log all copies all of yesterday's meal.",
      "iPhone: the bookmark on a food's amount screen makes it a Favorite.",
      "iPhone: Photo, Scan and Describe sit right under the search in Track Food and log into the meal you chose; the (+) menu buttons no longer overlap.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-11-20",
    title: "Amount wheels and logging in a row on iPhone",
    changes: [
      "iPhone: amounts are picked on three wheels — whole number, fraction (in eighths) and unit — when logging and when editing an entry.",
      "iPhone: after logging, Scan Food goes back to the camera and Track Food back to the search, so you can log several foods in a row. Close when you're done. The meal you picked stays for the next food.",
      "iPhone: a big amount (more than 20 servings or 2,000 calories) asks \"That's a lot — log it?\" first, as on the web.",
      "Editing an entry shows its calories exactly, even for very small amounts.",
      "AI-drafted foods with absurd servings are trimmed, and a slow AI says \"The AI took too long — try again\".",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-11-20",
    title: "Log by the piece, in eighths",
    changes: [
      "Foods offer the units you count in: \"1 prune\" from a \"5 prunes\" serving, \"1 slice\" from \"4 slices (56g)\", and Small / Medium / Large for apples, bananas, oranges, pears, peaches, potatoes, sweet potatoes, eggs, avocados and chicken breasts. Six prunes logs 1.2 servings' worth.",
      "Amounts go in eighths: ⅛ ¼ ⅓ ⅜ ½ ⅝ ⅔ ¾ ⅞.",
      "A big amount (more than 20 servings or 2,000 calories in one entry) asks \"That's a lot — log it?\" before logging.",
      "Server support for Favorites and Same as yesterday in the iPhone app.",
    ],
  },
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
