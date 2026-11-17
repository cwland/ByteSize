// Category / name → emoji (pure). Rules run in order; specific ones come first.

const DEFAULT_ICON = "🍽️";

const RULES: [string[], string][] = [
  [["ice cream", "gelato", "frozen dessert"], "🍨"],
  [["peanut butter", "almond butter", "nut butter"], "🥜"],
  [["juice", "nectar"], "🧃"],
  [["wine"], "🍷"],
  [["beer", "alcohol", "alcoholic beverage", "spirit", "liquor", "cider", "vodka", "whisky", "whiskey"], "🍺"],
  [["coffee", "espresso", "latte"], "☕"],
  [["tea", "matcha"], "🍵"],
  [["water", "mineral water", "sparkling water"], "💧"],
  [["protein shake", "protein powder", "supplement", "dietary supplement", "whey"], "🥤"],
  [["shrimp", "prawn"], "🦐"],
  [["banana"], "🍌"],
  [["berry", "berries", "blueberry", "blueberries", "strawberry", "strawberries", "raspberry", "raspberries", "blackberry", "blackberries"], "🫐"],
  [["avocado"], "🥑"],
  [["salad"], "🥗"],
  [["pizza"], "🍕"],
  [["burger", "hamburger", "cheeseburger"], "🍔"],
  [["sandwich", "sandwiche", "sub", "wrap"], "🥪"],
  [["soup", "stew", "broth", "chili"], "🍲"],
  [["chocolate", "candy", "candie", "confectionery", "confectionerie", "sweet"], "🍫"],
  [["cookie", "biscuit", "baked good", "pastry", "pastrie", "muffin", "brownie"], "🍪"],
  [["cake", "dessert", "pie", "pudding", "cheesecake"], "🍰"],
  [["chip", "crisp", "snack", "popcorn", "pretzel", "cracker"], "🍿"],
  [["cheese"], "🧀"],
  [["yogurt", "yoghurt"], "🥛"],
  [["milk", "dairy", "dairie", "cream"], "🥛"],
  [["egg"], "🥚"],
  [["chicken", "poultry", "poultrie", "turkey"], "🍗"],
  [["pork", "bacon", "salami", "ham", "sausage", "pepperoni", "prosciutto"], "🥓"],
  [["beef", "steak", "meat", "jerky"], "🥩"],
  [["fish", "seafood", "salmon", "tuna", "cod", "tilapia"], "🐟"],
  [["bean", "legume", "lentil", "chickpea", "hummus"], "🫘"],
  [["nut", "almond", "cashew", "peanut", "walnut", "pecan", "pistachio"], "🥜"],
  [["bread", "toast", "bagel", "bun", "roll", "tortilla"], "🍞"],
  [["cereal", "oat", "oatmeal", "porridge", "granola", "muesli"], "🥣"],
  [["pasta", "spaghetti", "noodle", "macaroni", "lasagna"], "🍝"],
  [["rice"], "🍚"],
  [["sauce", "condiment", "ketchup", "mustard", "mayonnaise", "dressing", "salsa", "spread"], "🫙"],
  [["oil", "butter", "fat", "margarine", "ghee"], "🧈"],
  [["fruit", "apple", "orange", "pear", "grape", "peach", "mango"], "🍎"],
  [["vegetable", "veggie", "broccoli", "spinach", "carrot", "lettuce", "kale", "potato", "potatoe"], "🥦"],
  [["drink", "beverage", "soda", "smoothie", "shake"], "🥤"],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word match with an optional plural "s"/"es" (so "tea" doesn't match "steak").
const COMPILED: [RegExp, string][] = RULES.map(([words, icon]) => [
  new RegExp(`\\b(?:${words.map(escape).join("|")})(?:e?s)?\\b`),
  icon,
]);

function normalize(text: string): string {
  // "en:ice-creams" → "en ice creams"
  return text.toLowerCase().replace(/[^a-z]+/g, " ");
}

function match(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = normalize(text);
  for (const [re, icon] of COMPILED) if (re.test(t)) return icon;
  return null;
}

/** Emoji by category keyword, then by name keyword, then "🍽️". */
export function iconFor(category: string | null | undefined, name?: string): string {
  return match(category) ?? match(name) ?? DEFAULT_ICON;
}
