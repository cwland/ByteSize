import Foundation

/// A food an item of a recipe or quick meal points at.
public struct FoodRef: Codable, Hashable, Sendable {
    public let kind: String
    public let id: Int
}

/// One item of a quick meal or recipe, as GET /api/my-foods/:id gives it (lib/recipes.ts ItemView).
public struct MealItem: Codable, Equatable, Sendable {
    public let food: FoodRef
    public let name: String
    public let icon: String
    public let servingIndex: Int
    public let unit: String
    public let quantity: Double
    public let fraction: Double
    public let servings: [Serving]
    /// The food's, per its servings[0].
    public let perServing: Nutrients
    /// This item's amount, as saved.
    public let nutrients: Nutrients
    /// false: the food is archived or gone; its saved values are used.
    public let available: Bool
}

public struct Archived: Decodable, Sendable { public let archived: Bool }

/// Only the items are needed: the list already carries the food.
public struct MyFoodDetail: Codable, Equatable, Sendable {
    public let items: [MealItem]?
    // R2: what the recipe and quick meal editors show
    public let name: String?
    public let notes: String?
    public let recipeServings: Double?
    public let servingGrams: Double?
}
public struct MyFoodDetailResponse: Codable, Equatable, Sendable { public let food: MyFoodDetail }

/// One item to log from a quick meal (POST /api/log/meal).
public struct MealItemBody: Encodable, Equatable, Sendable {
    public let food: FoodRef
    public let servingIndex: Int
    public let unit: String
    public let quantity: Double
    public let fraction: Double
}

/// The person's own foods (routes/my-foods.ts) and logging a quick meal (routes/log.ts).
public enum MyFoodsAPI {
    public static func list(q: String, kind: String, sort: String) -> Endpoint<FoodList> {
        var query = [URLQueryItem(name: "kind", value: kind), URLQueryItem(name: "sort", value: sort)]
        if !q.isEmpty { query.append(URLQueryItem(name: "q", value: q)) }
        return Endpoint("GET", "/api/my-foods", query: query)
    }

    public static func detail(id: Int) -> Endpoint<MyFoodDetailResponse> { Endpoint("GET", "/api/my-foods/\(id)") }

    /// A food's fields as the food editor sends them (POST to create, PATCH to edit).
    public struct FoodBody: Encodable, Sendable {
        public let name: String
        public let brand: String?
        public let barcode: String?
        public let servings: [Serving]
        public let nutrients: Nutrients
        public let aiFields: [String]

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(name, forKey: .name)
            try c.encode(brand, forKey: .brand) // null clears it
            try c.encode(barcode, forKey: .barcode)
            try c.encode(servings, forKey: .servings)
            try c.encode(nutrients, forKey: .nutrients)
            try c.encode(aiFields, forKey: .aiFields)
        }
        enum CodingKeys: String, CodingKey { case name, brand, barcode, servings, nutrients, aiFields }
    }

    public static func createFood(_ body: FoodBody) -> Endpoint<FoodResponse> { Endpoint("POST", "/api/my-foods", json: body) }
    public static func updateFood(id: Int, _ body: FoodBody) -> Endpoint<FoodResponse> { Endpoint("PATCH", "/api/my-foods/\(id)", json: body) }

    struct FillBody: Encodable { let food: FoodRef }
    public struct Filled: Decodable, Sendable {
        public let nutrients: Nutrients
        public let aiFields: [String]
    }
    /// The AI's guesses for the nutrients a food doesn't say.
    public static func fillGaps(id: Int) -> Endpoint<Filled> {
        Endpoint("POST", "/api/ai/fill-gaps", json: FillBody(food: FoodRef(kind: "user_food", id: id)), timeout: FoodAPI.aiTimeout)
    }

    struct RecipeBody: Encodable {
        let name: String
        let items: [MealItemBody]
        let servings: Double
        let servingGrams: Double?
        let notes: String?
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(name, forKey: .name)
            try c.encode(items, forKey: .items)
            try c.encode(servings, forKey: .servings)
            try c.encode(servingGrams, forKey: .servingGrams) // null: no weight
            try c.encode(notes, forKey: .notes)
        }
        enum CodingKeys: String, CodingKey { case name, items, servings, servingGrams, notes }
    }
    struct MealBodyEdit: Encodable { let name: String; let items: [MealItemBody] }

    public static func createRecipe(name: String, items: [MealItemBody], servings: Double, servingGrams: Double?, notes: String?) -> Endpoint<FoodResponse> {
        Endpoint("POST", "/api/my-foods/recipes", json: RecipeBody(name: name, items: items, servings: servings, servingGrams: servingGrams, notes: notes))
    }
    public static func updateRecipe(id: Int, name: String, items: [MealItemBody], servings: Double, servingGrams: Double?, notes: String?) -> Endpoint<FoodResponse> {
        Endpoint("PUT", "/api/my-foods/recipes/\(id)", json: RecipeBody(name: name, items: items, servings: servings, servingGrams: servingGrams, notes: notes))
    }
    /// The recipe's ingredients re-read from their foods as they are now.
    public static func recalculate(id: Int) -> Endpoint<MyFoodDetailResponse> { Endpoint("POST", "/api/my-foods/\(id)/recalculate") }
    public static func createMeal(name: String, items: [MealItemBody]) -> Endpoint<FoodResponse> {
        Endpoint("POST", "/api/my-foods/meals", json: MealBodyEdit(name: name, items: items))
    }
    public static func updateMeal(id: Int, name: String, items: [MealItemBody]) -> Endpoint<FoodResponse> {
        Endpoint("PUT", "/api/my-foods/meals/\(id)", json: MealBodyEdit(name: name, items: items))
    }

    /// Deleted when never logged or used; otherwise archived (hidden) so the log stays as it is.
    public static func delete(id: Int) -> Endpoint<Archived> { Endpoint("DELETE", "/api/my-foods/\(id)") }

    struct MealBody: Encodable { let foodId: Int; let day: String; let meal: String; let items: [MealItemBody] }
    public static func logMeal(foodId: Int, day: String, meal: Meal, items: [MealItemBody]) -> Endpoint<EntriesResponse> {
        Endpoint("POST", "/api/log/meal", json: MealBody(foodId: foodId, day: day, meal: meal.rawValue, items: items))
    }
}
