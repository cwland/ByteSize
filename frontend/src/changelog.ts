// "What's new": one entry per version, newest first (W1, as in RecipeHub). With each release add an entry and bump
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
    version: "0.19.0",
    date: "2026-11-27",
    title: "A cleaner weight log on the iPhone",
    added: [
      "iPhone Goals: Est. goal date sits under Goal weight, and the row under the chart is now Start · Current · Lost.",
      "iPhone Goals: a Last weigh-in card, then your recent weigh-ins as cards with the weight above the date. Losses are green, gains red, no change gray.",
      "Weigh-ins remember whether you typed them or they came from Apple Health; the iPhone marks Apple Health ones with a heart. Older weigh-ins are matched against Apple Health once, on your next sync.",
    ],
    changed: ["Lost so far never shows below 0.0."],
  },
  {
    version: "0.18.0",
    date: "2026-11-26",
    title: "Weight lost by the scale and the trend, and a steadier goal date",
    added: [
      "Settings › Profile › Goal estimate: choose whether your goal date goes by your scale weigh-ins or your trend, and how far back it looks (6, 12 or 26 weeks).",
    ],
    changed: [
      "Weight lost so far shows what your scale says, with the trend's figure beside it (Dashboard, Goals, App info and the iPhone Goals tab).",
      "Weight badges (pounds lost, Halfway, Goal reached) are earned on the day your weigh-in gets there, without waiting for the trend. Badges you've earned stay earned.",
      "Your goal date now looks at your last 12 weeks of weigh-ins by default, so one slow month doesn't push it far out. The Goals page and the Goal date widget give the same date.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-11-25",
    title: "Meal times, restaurant tags and meal pills",
    added: [
      "Settings › Profile: set your own meal times (when breakfast, lunch, snacks and dinner end). They decide which meal new food goes to by default.",
      "Restaurant tags: food from a restaurant shows the restaurant's name as a teal tag in search and in your food log, on the web and the iPhone. Big chains are known already; mark any other brand in Edit entry (or long-press on the iPhone) with \"Treat … as a restaurant\", or say a brand isn't one.",
      "iPhone: Profile › Settings changes your units, week start, date format and meal times. They're saved to your account, so the web app matches.",
    ],
    changed: [
      "iPhone: the amount screen picks the meal with Breakfast · Lunch · Dinner · Snacks pills at the bottom, and the Log button says which meal (\"Log to Dinner\").",
      "iPhone: the default meal and the dates follow your own meal times and date format.",
      "Food log on the web: each entry shows its brand.",
    ],
  },
  {
    version: "0.16.7",
    date: "2026-11-24",
    fixed: [
      "Security: a device on your network can no longer pretend to be a different address on each try to get around the sign-in lockout. Behind a reverse proxy, set TRUST_PROXY to the proxy's address (see the README).",
    ],
  },
  {
    version: "0.16.6",
    date: "2026-11-24",
    fixed: [
      "Security: updated the photo reader, the email sender and the web file server to versions with known security holes fixed.",
    ],
  },
  {
    version: "0.16.5",
    date: "2026-11-24",
    fixed: [
      "Web: a page left open overnight shows the new day's food, not yesterday's under today's date. A day that failed to load (the computer just woke) is tried again within 30 seconds.",
    ],
  },
  {
    version: "0.16.4",
    date: "2026-11-23",
    changed: [
      "Web: a food logged on the iPhone shows up on its own. The day is checked again when you come back to the page and every 30 seconds while it's open; the screen only changes when something did.",
    ],
  },
  {
    version: "0.16.3",
    date: "2026-11-23",
    changed: [
      "iPhone Describe works like Photo: every food it finds is checked; uncheck what you don't want and Log selected logs each as its own entry. One meal (one combined entry) is still a tap away.",
    ],
  },
  {
    version: "0.16.2",
    date: "2026-11-23",
    changed: ["RecipeHub recipes show their serving size when RecipeHub has one — 1 serving · About 1⅓ cups (330 g) — in search, on the food and in the food log."],
  },
  {
    version: "0.16.1",
    date: "2026-11-22",
    changed: ["iPhone: a food in a list (a scan, search, recent) shows the calories for the amount it opens at — 80 cal · 1 slice — not per 100 g."],
  },
  {
    version: "0.16.0",
    date: "2026-11-22",
    title: "A food shows its nutrition",
    changed: [
      "iPhone: a food opens showing its serving and every nutrient for that amount. Tap Serving to open the amount wheel; the nutrition follows it.",
      "iPhone: a food in the food log opens to read. Tap Serving to change the amount; Save shows once something changed.",
    ],
  },
  {
    version: "0.15.1",
    date: "2026-11-22",
    changed: ["Move to… and Copy to… are a small, tidy window."],
    fixed: ["Pop-up windows keep their padding at the bottom: the last button no longer sits on the edge."],
  },
  {
    version: "0.15.0",
    date: "2026-11-22",
    title: "Amounts start at the package's serving",
    changed: [
      "A food's amount starts at its package serving, written its own way: 2 | tbsp, 15 | g, 1 | slice — never 1 × 100 g. On the iPhone, + on a scan logs that amount.",
      "A spoon serving can be counted in spoons: 2½ tbsp, 3 tbsp, and so on.",
      "An AI lookup of a branded product the food databases know uses their serving size instead of guessing it.",
      "iPhone: each serving line in the food editor says what goes in each box (Serving, Weight (g), Volume (ml)).",
    ],
    fixed: [
      "Small, medium and large sizes only show for the food itself (an avocado), not a dish with it in the name (a turkey avocado sandwich).",
      "Grams and ml go through every number on the amount wheel, so 144 g is there (it used to skip in 5s, 25s and 50s above 20).",
    ],
  },
  {
    version: "0.14.3",
    date: "2026-11-22",
    changed: [
      "iPhone: a scan always shows what it found as a list first, even one food. Tap it for its amount, or + to log it straight away; Back from the amount returns to the list.",
    ],
  },
  {
    version: "0.14.2",
    date: "2026-11-22",
    title: "Better barcode matches and photo amounts",
    fixed: [
      "Scanning a US barcode now also finds the product in USDA FoodData Central, so when the sources disagree you get the short list to pick from.",
      "A photo of a packaged product (a can, box, bag or canister) counts as one serving, not every serving in the package. If a photo amount still looks too big to trust, it's read as 1 serving with a \"Check the amount\" note (iPhone app).",
    ],
  },
  {
    version: "0.14.1",
    date: "2026-11-22",
    title: "Culury is now RecipeHub",
    changed: ["The recipe and meal-planning app ByteSize links to is now called RecipeHub everywhere: Settings › Integrations, Track Food, search and My foods. Your link and settings are unchanged."],
  },
  {
    version: "0.14.0",
    date: "2026-11-22",
    title: "Barcodes: pick the right product",
    added: [
      "A scanned or typed barcode now asks every food source (Open Food Facts, FatSecret on Premier, USDA) at once. When they don't agree on what the product is, you get a short list to pick from — the most complete entry first — instead of whichever answered first.",
      "The product you pick is remembered for that barcode, so the next scan opens it straight away.",
      "None of these: search instead (web) or photograph its label (iPhone).",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-11-22",
    title: "Describe: one meal or separate items",
    added: [
      "Describe several foods (\"2 fried eggs, a light English muffin and light mayo\") and choose how to log them: One meal (one entry, like \"Breakfast sandwich\") or Separate items (one line each). It opens on One meal.",
      "One meal: rename it, and tick Save to My foods to keep it for next time.",
      "Change any food's amount, remove one, or add another with Add a food — the totals follow, and your changes stay when you switch. On the web and on iPhone.",
    ],
  },
  {
    version: "0.12.2",
    date: "2026-11-21",
    fixed: [
      "Describe: a food the AI gave a very long serving name (like a whole sandwich's ingredients) no longer fails with \"The AI couldn't estimate that\"; the name is shortened instead.",
    ],
  },
  {
    version: "0.12.1",
    date: "2026-11-21",
    changed: [
      "iPhone: on a scanned or photographed food's Track screen, Log and Scan again (or Take another photo) sit at the bottom.",
      "iPhone: the weight history on Goals shows your last 5 weigh-ins; Show all opens the rest.",
    ],
  },
  {
    version: "0.12.0",
    date: "2026-11-21",
    title: "My foods on iPhone",
    added: [
      "iPhone: swipe a food in My foods to edit or delete it. Deleting one that's been logged or used hides it instead, as on the web.",
      "iPhone: + in My foods makes a new food, recipe or quick meal.",
      "iPhone: the food, recipe and quick meal editors from the web — servings, nutrients and Fill gaps with AI; ingredients, servings, weight, notes and Recalculate; a quick meal's foods.",
    ],
  },
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
      "iPhone: pick which sources a search shows (My foods, FatSecret, Basic, USDA, Open Food Facts, RecipeHub), as on the web — tap “Show results from” to open the chips; your picks are remembered.",
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
      "RecipeHub meal plans and recipes, restaurant menus, backups, API keys, email and sign-in with passkeys.",
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
