// "What's new": one entry per version, newest first (W1, as in Culury). With each release add an entry and bump
// "version" in frontend/package.json and backend/package.json (a test keeps the three equal). Everyone sees the
// new entries once after signing in, and every version any time from the version number in the bottom left.
// Each change is sorted into a kind (SPEC-19): what's new (added), what works differently (changed), what was put right (fixed).
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title?: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
}

export const changeCount = (r: Release) => (r.added?.length ?? 0) + (r.changed?.length ?? 0) + (r.fixed?.length ?? 0);

export const CHANGELOG: Release[] = [
  {
    version: "0.11.0",
    date: "2026-11-21",
    title: "Photo and Describe results",
    added: [
      "iPhone: every food Photo or Describe finds has a checkbox. Uncheck the ones you don't want, then Log selected.",
      "iPhone: Retake photo under a photo's results, Take another photo on a photographed barcode or label, and Scan again on a scanned food.",
    ],
    fixed: [
      "iPhone: tapping a found food to change its amount no longer closes the screen straight away (from the + menu).",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-11-21",
    title: "Passkeys and Authentik on iPhone",
    added: [
      "iPhone: sign in with a passkey you made on the web (Face ID or Touch ID), at the same address.",
      "iPhone: sign in with Authentik (or whichever sign-in service your server uses), in Safari's sign-in sheet.",
    ],
    changed: [
      "iPhone: Track Food's keyboard comes up when it opens, not again every time you come back from Scan, Photo or Describe.",
      "iPhone: the source chips read as selected to VoiceOver, and wrap instead of being cut off at large text sizes.",
    ],
    fixed: [
      "iPhone: clearing the search drops its source chips straight away.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-11-21",
    title: "Tidier menus and What's new",
    added: [
      "Your initials at the bottom of the side rail open an account menu: Profile & security, Sign out, and Sign out everywhere.",
      "What's new shows this version in full, grouped into Added, Changed and Fixed, with earlier updates folded below — tap one to open it.",
      "The plan picker has ‹ and › arrows to step through the plans.",
      "iPhone: Describe Food has a clear button in the text box.",
    ],
    changed: [
      "Settings sits with the other pages in the side rail, and Users comes right after Profile.",
      "The version number lives in the bottom-left corner of the side rail.",
    ],
    fixed: [
      "The plan cards never slide under the side rail or get cut off at the edge: only whole cards show.",
    ],
  },
  {
    version: "0.8.1",
    date: "2026-11-20",
    title: "Track Food on iPhone",
    added: [
      "iPhone: pick which sources a search shows (My foods, FatSecret, Basic, USDA, Open Food Facts, Culury), as on the web — tap “Show results from” to open the chips; your picks are remembered.",
    ],
    changed: [
      "iPhone: Photo, Scan and Describe sit right under the search in Track Food, and Close is there as soon as it opens.",
    ],
    fixed: [
      "iPhone: the day strip never shows a day cut off at the edge.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-11-20",
    title: "Apple Health",
    added: [
      "iPhone: turn on Weight, Steps and Workouts in your Profile to bring them in from Apple Health — your scale's weight, your Watch's steps and workouts — when you open the app and in the background.",
    ],
    changed: [
      "A weigh-in from Health only fills a day with none; a day whose weigh-in you deleted stays empty, and one you type always wins.",
      "Watch workouts come in once: your edits and notes stay, and one you delete stays deleted.",
    ],
    fixed: [
      "iPhone: the day strip on the Food Log is the same card, in the same place, as on the Dashboard.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-11-20",
    title: "Goals and My Foods on iPhone",
    added: [
      "iPhone: the Goals tab shows your targets and active goals, a weight chart (1W, 1M, 3M, All) with your trend, and every weigh-in with its change. Log weight from there, or swipe one away.",
      "iPhone: the My Foods tab lists your foods, corrections, recipes and quick meals, with search, filters and sorting. Tap one to log it; a quick meal lets you leave items out or change amounts before Log all.",
      "iPhone: the day strip and calendar reach a week ahead, so you can plan and pre-log food. Water, weight and shots wait for the day.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-11-20",
    title: "Today on iPhone",
    added: [
      "iPhone: the Food Log shows what you've eaten, what's left, and protein and fiber against your targets.",
      "iPhone: Log shot takes the dose (your medication's steps or a custom dose), the date and notes.",
    ],
    changed: [
      "iPhone: the Dashboard and Food Log have a day strip you swipe one day at a time (tap the date for a month calendar); days you've seen show instantly, without a flash.",
      "iPhone: Today's overview opens with a chevron to the full daily totals, and the calorie bar goes light green, dark green in range, red over.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-11-20",
    title: "Adding food on iPhone",
    added: [
      "iPhone: the Food Log always shows Breakfast, Lunch, Dinner and Snacks, each with its own Add, which opens Track Food in that meal.",
      "iPhone: before you type, Track Food shows Same as yesterday, Favorites and Recently tracked. The + on a row logs it at once (at the amount you last had); Log all copies all of yesterday's meal.",
      "iPhone: the bookmark on a food's amount screen makes it a Favorite.",
    ],
    fixed: [
      "iPhone: Photo, Scan and Describe sit right under the search in Track Food and log into the meal you chose; the (+) menu buttons no longer overlap.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-11-20",
    title: "Amount wheels and logging in a row on iPhone",
    added: [
      "iPhone: amounts are picked on three wheels — whole number, fraction (in eighths) and unit — when logging and when editing an entry.",
      "iPhone: a big amount (more than 20 servings or 2,000 calories) asks \"That's a lot — log it?\" first, as on the web.",
    ],
    changed: [
      "iPhone: after logging, Scan Food goes back to the camera and Track Food back to the search, so you can log several foods in a row. Close when you're done. The meal you picked stays for the next food.",
    ],
    fixed: [
      "Editing an entry shows its calories exactly, even for very small amounts.",
      "AI-drafted foods with absurd servings are trimmed, and a slow AI says \"The AI took too long — try again\".",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-11-20",
    title: "Log by the piece, in eighths",
    added: [
      "Foods offer the units you count in: \"1 prune\" from a \"5 prunes\" serving, \"1 slice\" from \"4 slices (56g)\", and Small / Medium / Large for apples, bananas, oranges, pears, peaches, potatoes, sweet potatoes, eggs, avocados and chicken breasts. Six prunes logs 1.2 servings' worth.",
      "A big amount (more than 20 servings or 2,000 calories in one entry) asks \"That's a lot — log it?\" before logging.",
      "Server support for Favorites and Same as yesterday in the iPhone app.",
    ],
    changed: [
      "Amounts go in eighths: ⅛ ¼ ⅓ ⅜ ½ ⅝ ⅔ ¾ ⅞.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-11-20",
    title: "GLP-1 doses, What's new, and the iPhone app",
    added: [
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
    added: [
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
