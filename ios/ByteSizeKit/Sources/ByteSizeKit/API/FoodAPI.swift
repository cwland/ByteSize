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

    public static func recent(meal: Meal?) -> Endpoint<FoodList> {
        Endpoint("GET", "/api/foods/recent", query: mealQuery(meal))
    }

    public static func frequent(meal: Meal?) -> Endpoint<FoodList> {
        Endpoint("GET", "/api/foods/frequent", query: mealQuery(meal))
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
    }

    /// Logs a found food: an amount of one of its servings, or of a weight/volume unit (fraction is always 1: the
    /// wheel's fraction is part of the quantity, as the web sends it).
    public static func log(food: Food, day: String, meal: Meal, servingIndex: Int, unit: AmountUnit = .serving, quantity: Double) -> Endpoint<EntryResponse> {
        Endpoint("POST", "/api/log", json: LogBody(day: day, meal: meal.rawValue, food: FoodRef(kind: food.kind, id: food.id), servingIndex: servingIndex, unit: unit.rawValue, quantity: quantity, fraction: 1))
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
    struct EstimatesBody: Encodable { let day: String; let meal: String; let items: [EstimateLogItem] }

    /// Logs what the AI estimated as entries (marked AI), without saving any food.
    public static func logEstimates(_ items: [EstimateItem], day: String, meal: Meal) -> Endpoint<EntriesResponse> {
        let list = items.map { EstimateLogItem(name: $0.food.name, brand: $0.food.brand, icon: $0.food.icon, servings: $0.food.servings, nutrients: $0.food.nutrients, servingIndex: $0.servingIndex, quantity: $0.quantity) }
        return Endpoint("POST", "/api/log/estimates", json: EstimatesBody(day: day, meal: meal.rawValue, items: list))
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
    public static func saveFood(_ draft: AiDraft, barcode: String?) -> Endpoint<FoodResponse> {
        Endpoint("POST", "/api/my-foods", json: SaveBody(name: draft.name, brand: draft.brand, barcode: barcode ?? draft.barcode, category: draft.category, servings: draft.servings, nutrients: draft.nutrients, aiFields: draft.nutrients.values.keys.sorted(), photoId: draft.photoId))
    }
}
