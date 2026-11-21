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
public struct MyFoodDetail: Codable, Equatable, Sendable { public let items: [MealItem]? }
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

    /// Deleted when never logged or used; otherwise archived (hidden) so the log stays as it is.
    public static func delete(id: Int) -> Endpoint<Archived> { Endpoint("DELETE", "/api/my-foods/\(id)") }

    struct MealBody: Encodable { let foodId: Int; let day: String; let meal: String; let items: [MealItemBody] }
    public static func logMeal(foodId: Int, day: String, meal: Meal, items: [MealItemBody]) -> Endpoint<EntriesResponse> {
        Endpoint("POST", "/api/log/meal", json: MealBody(foodId: foodId, day: day, meal: meal.rawValue, items: items))
    }
}
