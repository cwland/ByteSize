// Sample My Foods data shaped like the API (Task B report): foods, a recipe and a quick meal.

const food = <T extends Record<string, unknown>>(over: T) => ({
  kind: "user_food",
  brand: null,
  barcode: null,
  aiFields: [],
  imageUrl: null,
  override: false,
  source: "mine",
  foodKind: "custom",
  ...over,
});

// Ingredients: ground beef (per 100 g), kidney beans (100 g or a 177 g cup), chili sauce (no fiber known)
export const beef = food({ kind: "cache", id: 10, name: "Ground beef 85%", icon: "🥩", source: "usda", servings: [{ label: "100 g", grams: 100 }], nutrients: { calories: 250, protein_g: 26, fiber_g: 0, carbs_g: 0, fat_g: 15 } });
export const beans = food({
  kind: "cache",
  id: 11,
  name: "Kidney beans",
  icon: "🫘",
  source: "usda",
  servings: [
    { label: "100 g", grams: 100 },
    { label: "1 cup", grams: 177 },
  ],
  nutrients: { calories: 127, protein_g: 8.7, fiber_g: 6.4, carbs_g: 22.8, fat_g: 0.5 },
});
export const sauce = food({ id: 12, name: "Chili sauce", icon: "🌶️", servings: [{ label: "1 tbsp" }], nutrients: { calories: 20, protein_g: 0, carbs_g: 4, fat_g: 0 } });

export const chili = food({
  id: 30,
  name: "Chili",
  icon: "🍲",
  foodKind: "recipe",
  servings: [
    { label: "1 serving (350 g)", grams: 350 },
    { label: "100 g", grams: 100 },
  ],
  nutrients: { calories: 246, protein_g: 23.2, carbs_g: 6.7, fat_g: 12.6 },
});
export const breakfastMeal = food({ id: 31, name: "Usual breakfast", icon: "🍽️", foodKind: "quick_meal", servings: [{ label: "1 meal" }], nutrients: { calories: 420, protein_g: 30, fiber_g: 6, carbs_g: 50, fat_g: 9 } });
export const shake = food({ id: 5, name: "Peanut protein shake", icon: "🥤", servings: [{ label: "1 bottle", ml: 330 }], nutrients: { calories: 160, protein_g: 30, fiber_g: 1 } });

const view = (f: any, portion: Record<string, number | string>, over: Record<string, unknown> = {}) => ({
  food: { kind: f.kind, id: f.id },
  foodKind: f.foodKind,
  name: f.name,
  brand: f.brand,
  icon: f.icon,
  imageUrl: f.imageUrl,
  servingIndex: 0,
  unit: "serving",
  quantity: 1,
  fraction: 1,
  ...portion,
  servings: f.servings,
  perServing: f.nutrients,
  nutrients: {},
  available: true,
  ...over,
});

// GET /api/my-foods/30: 500 g beef, 1 cup beans; 6 servings of 350 g
export const chiliDetail = {
  ...chili,
  notes: "Freezes well",
  recipeServings: 6,
  servingGrams: 350,
  items: [view(beef, { unit: "g", quantity: 500 }), view(beans, { servingIndex: 1 })],
};

const yogurt = food({ kind: "cache", id: 20, name: "Greek yogurt", icon: "🥛", source: "usda", servings: [{ label: "1 cup", grams: 245 }], nutrients: { calories: 220, protein_g: 20, fiber_g: 0, carbs_g: 9, fat_g: 11 } });
export const banana = food({ kind: "cache", id: 21, name: "Banana", icon: "🍌", source: "usda", servings: [{ label: "1 medium", grams: 118 }], nutrients: { calories: 105, protein_g: 1.3, fiber_g: 3.1, carbs_g: 27, fat_g: 0.4 } });
export { yogurt };

// GET /api/my-foods/31: yogurt and a banana
export const breakfastDetail = {
  ...breakfastMeal,
  notes: null,
  recipeServings: 1,
  servingGrams: null,
  items: [view(yogurt, {}), view(banana, {})],
};
