import Foundation

/// Finding and logging foods (routes/foods.ts, routes/photos.ts, routes/log.ts, routes/my-foods.ts).
public enum FoodAPI {
    /// AI calls (photo reading, estimates) can take a minute on a slow model.
    static let aiTimeout: TimeInterval = 120

    public static func search(_ q: String) -> Endpoint<SearchResult> {
        Endpoint("GET", "/api/foods/search", query: [URLQueryItem(name: "q", value: q)])
    }

    public static func barcode(_ code: String) -> Endpoint<BarcodeResult> {
        Endpoint("GET", "/api/foods/barcode/\(code)")
    }

    struct PickBody: Encodable { let id: Int }
    /// Remembers the product picked for a barcode the sources disagreed on: its next scan opens it straight away.
    public static func pickBarcode(_ code: String, foodId: Int) -> Endpoint<Empty> {
        Endpoint("POST", "/api/foods/barcode/\(code)/pick", json: PickBody(id: foodId))
    }

    public static func recent(meal: Meal?) -> Endpoint<FoodList> {
        Endpoint("GET", "/api/foods/recent", query: mealQuery(meal))
    }

    public static func frequent(meal: Meal?) -> Endpoint<FoodList> {
        Endpoint("GET", "/api/foods/frequent", query: mealQuery(meal))
    }

    /// L2: what was logged in `meal` the day before `day` (each food at that amount).
    public static func sameAsYesterday(day: String, meal: Meal) -> Endpoint<FoodList> {
        Endpoint("GET", "/api/foods/same-as-yesterday", query: [URLQueryItem(name: "day", value: day), URLQueryItem(name: "meal", value: meal.rawValue)])
    }

    /// L2: bookmarked foods, newest first.
    public static func favorites() -> Endpoint<FoodList> { Endpoint("GET", "/api/foods/favorites") }

    struct FavoriteBody: Encodable { let food: FoodRef }

    public static func addFavorite(_ food: Food) -> Endpoint<FavoriteRefs> {
        Endpoint("PUT", "/api/foods/favorites", json: FavoriteBody(food: FoodRef(kind: food.kind, id: food.id)))
    }

    public static func removeFavorite(kind: String, id: Int) -> Endpoint<FavoriteRefs> {
        Endpoint("DELETE", "/api/foods/favorites/\(kind)/\(id)")
    }

    private static func mealQuery(_ meal: Meal?) -> [URLQueryItem] {
        meal.map { [URLQueryItem(name: "meal", value: $0.rawValue)] } ?? []
    }

    struct FoodRef: Encodable { let kind: String; let id: Int }
    struct LogBody: Encodable {
        let day: String
        let meal: String
        let food: FoodRef
        let servingIndex: Int
        let unit: String
        let quantity: Double
        let fraction: Double
        /// Only for a Culury recipe without nutrition: the AI's estimate per serving (logged as AI-estimated).
        var nutrients: Nutrients? = nil
    }

    /// Logs a found food: an amount of one of its servings, or of a weight/volume unit (fraction is always 1: the
    /// wheel's fraction is part of the quantity, as the web sends it).
    public static func log(food: Food, day: String, meal: Meal, servingIndex: Int, unit: AmountUnit = .serving, quantity: Double, estimate: Nutrients? = nil) -> Endpoint<EntryResponse> {
        Endpoint("POST", "/api/log", json: LogBody(day: day, meal: meal.rawValue, food: FoodRef(kind: food.kind, id: food.id), servingIndex: servingIndex, unit: unit.rawValue, quantity: quantity, fraction: 1, nutrients: estimate))
    }

    /// A Culury recipe, read live from Culury by the server (the phone never calls Culury itself).
    public static func culuryRecipe(_ id: Int) -> Endpoint<CuluryRecipe> {
        Endpoint("GET", "/api/culury/recipes/\(id)")
    }

    struct EstimateLogItem: Encodable {
        let name: String
        let brand: String?
        let icon: String
        let servings: [Serving]
        let nutrients: Nutrients
        let servingIndex: Int
        let quantity: Double
    }
    struct Combine: Encodable { let name: String; let save: Bool }
    struct EstimatesBody: Encodable { let day: String; let meal: String; let items: [EstimateLogItem]; let combine: Combine? }

    /// Logs what the AI estimated as entries (marked AI), without saving any food. With `combine` (Describe's One
    /// meal) they become one entry with that name, saved to My foods first when `save`.
    public static func logEstimates(_ items: [EstimateItem], day: String, meal: Meal, combine: (name: String, save: Bool)? = nil) -> Endpoint<EntriesResponse> {
        let list = items.map { EstimateLogItem(name: $0.food.name, brand: $0.food.brand, icon: $0.food.icon, servings: $0.food.servings, nutrients: $0.food.nutrients, servingIndex: $0.servingIndex, quantity: $0.quantity) }
        return Endpoint("POST", "/api/log/estimates", json: EstimatesBody(day: day, meal: meal.rawValue, items: list, combine: combine.map { Combine(name: $0.name, save: $0.save) }))
    }

    struct TextBody: Encodable { let text: String }
    public static func estimateItems(_ text: String) -> Endpoint<EstimateItems> {
        Endpoint("POST", "/api/ai/estimate-items", json: TextBody(text: text), timeout: aiTimeout)
    }

    /// One photo (a JPEG) read for a barcode, a nutrition label or the foods on a plate.
    public static func analyzePhoto(jpeg: Data, mode: PhotoMode) -> Endpoint<PhotoResult> {
        Endpoint("POST", "/api/photos/analyze", multipart: [
            .field("mode", mode.rawValue),
            .file("images", filename: "photo.jpg", contentType: "image/jpeg", data: jpeg),
        ], timeout: aiTimeout)
    }

    struct SaveBody: Encodable {
        let name: String
        let brand: String?
        let barcode: String?
        let category: String?
        let servings: [Serving]
        let nutrients: Nutrients
        let aiFields: [String]
        let photoId: String?
    }

    /// Saves what the AI read as the person's own food; with a barcode, the next scan of it finds this food.
    /// original: what the AI read, so values the person corrected or typed in aren't marked AI.
    public static func saveFood(_ draft: AiDraft, barcode: String?, original: AiDraft? = nil) -> Endpoint<FoodResponse> {
        let aiFields = draft.nutrients.values.keys.sorted().filter { key in
            guard let original else { return true }
            guard let read = original.nutrients.values[key] else { return false }
            return abs(read - draft.nutrients[key]) < 1e-9
        }
        return Endpoint("POST", "/api/my-foods", json: SaveBody(name: draft.name, brand: draft.brand, barcode: barcode ?? draft.barcode, category: draft.category, servings: draft.servings, nutrients: draft.nutrients, aiFields: aiFields, photoId: draft.photoId))
    }
}
