import Foundation

/// A food the server found (search, barcode, recent, My Foods): what it's called and what one serving holds.
public struct Food: Codable, Identifiable, Hashable, Sendable {
    /// "cache" (a database food), "user_food" (the person's own) or "culury" (a Culury recipe).
    public let kind: String
    public let id: Int
    public let name: String
    public let brand: String?
    public let icon: String
    public let barcode: String?
    public let servings: [Serving]
    /// Per `servings[0]`.
    public let nutrients: Nutrients
    public let aiFields: [String]
    public let source: String
    /// "custom", "override", "recipe" or "quick_meal".
    public let foodKind: String?
    /// The amount it was last logged at (recent, favorites, same as yesterday); absent elsewhere.
    public let last: LastPortion?
    /// A correction: the database food it corrects (so a favorite stored as that one is found).
    public let baseCacheId: Int?

    public var ref: String { "\(kind):\(id)" }
    /// A quick meal is logged item by item (My Foods); everything else, Culury recipes included, logs here.
    public var isLoggable: Bool { foodKind != "quick_meal" }
    public var isCulury: Bool { kind == "culury" }
    public var calories: Double { nutrients["calories"] }
}

/// An amount as the server stores it: `quantity` × `fraction` of serving `servingIndex` (unit "serving"), or of a unit.
extension Food {
    /// The same food with other nutrition (a Culury recipe's AI estimate for one serving).
    public func with(nutrients: Nutrients) -> Food {
        Food(kind: kind, id: id, name: name, brand: brand, icon: icon, barcode: barcode, servings: servings, nutrients: nutrients,
             aiFields: Array(nutrients.values.keys), source: source, foodKind: foodKind, last: last, baseCacheId: baseCacheId)
    }
}

/// A Culury recipe read live through the server: no nutrition, or nutrition Culury marks out of date.
public struct CuluryRecipe: Codable, Sendable {
    public let food: Food
    public let hasNutrition: Bool
    public let outdated: Bool
}

public struct LastPortion: Codable, Hashable, Sendable {
    public let servingIndex: Int
    public let unit: String
    public let quantity: Double
    public let fraction: Double

    public init(servingIndex: Int, unit: String, quantity: Double, fraction: Double) {
        self.servingIndex = servingIndex
        self.unit = unit
        self.quantity = quantity
        self.fraction = fraction
    }
}

/// What the AI read or estimated: a food that isn't saved anywhere (yet).
public struct AiDraft: Codable, Equatable, Sendable {
    public var name: String
    public var brand: String?
    public var icon: String
    public var category: String?
    public var barcode: String?
    public var servings: [Serving]
    /// Per `servings[0]`.
    public var nutrients: Nutrients
    public var aiFields: [String]?
    /// The uploaded photo it came from (becomes the food's photo when saved).
    public var photoId: String?

    public init(name: String, brand: String? = nil, icon: String = "🍽️", category: String? = nil, barcode: String? = nil, servings: [Serving], nutrients: Nutrients, aiFields: [String]? = nil, photoId: String? = nil) {
        self.name = name
        self.brand = brand
        self.icon = icon
        self.category = category
        self.barcode = barcode
        self.servings = servings
        self.nutrients = nutrients
        self.aiFields = aiFields
        self.photoId = photoId
    }

    public var calories: Double { nutrients["calories"] }
}

/// One of several foods the AI saw or read about, with how many of its first serving.
public struct EstimateItem: Codable, Equatable, Sendable {
    public var food: AiDraft
    public var servingIndex: Int
    public var quantity: Double

    public init(food: AiDraft, servingIndex: Int = 0, quantity: Double = 1) {
        self.food = food
        self.servingIndex = servingIndex
        self.quantity = quantity
    }

    /// Calories for the amount (≈: the server's numbers rule once logged).
    public var calories: Double { food.calories * (AmountMath.factor(food.servings, servingIndex: servingIndex, unit: .serving, quantity: quantity) ?? quantity) }
}

public struct SourceError: Codable, Equatable, Sendable {
    public let source: String
    public let message: String
}

public struct FoodGroup: Codable, Equatable, Sendable, Identifiable {
    public let source: String
    public let label: String
    public let foods: [Food]
    public var id: String { source }
}

public struct SearchResult: Codable, Equatable, Sendable {
    public let groups: [FoodGroup]
    public let errors: [SourceError]
    public let suggestion: String?
    /// The sources a typed search asked (pill order); nil from a barcode or an older server.
    public let searched: [String]?

    public init(groups: [FoodGroup], errors: [SourceError], suggestion: String? = nil, searched: [String]? = nil) {
        self.groups = groups
        self.errors = errors
        self.suggestion = suggestion
        self.searched = searched
    }
}

public struct BarcodeResult: Codable, Equatable, Sendable {
    public let code: String
    public let food: Food?
}

public struct FoodList: Codable, Equatable, Sendable { public let foods: [Food] }
/// The favorites as stored ("cache:42", "user_food:9") after a bookmark change.
public struct FavoriteRefs: Codable, Equatable, Sendable { public let refs: [String] }
public struct FoodResponse: Codable, Equatable, Sendable { public let food: Food }

public struct PlateResult: Codable, Equatable, Sendable { public let items: [EstimateItem] }

public struct PhotoResult: Codable, Equatable, Sendable {
    public let photoIds: [String]
    public let barcode: String?
    public let food: Food?
    public let draft: AiDraft?
    public let plate: PlateResult?
    public let errors: [SourceError]
    /// False: no AI service on the server reads photos.
    public let labelReading: Bool
}

public struct EstimateItems: Codable, Equatable, Sendable {
    public let items: [EstimateItem]
    /// A short name for the foods together ("Breakfast sandwich"): nil for one food (and from older servers).
    public let mealName: String?
    public let assumed: Bool
    public let interpretedAs: String?
}

/// What a photo is of: `auto` tries a barcode, then a label.
public enum PhotoMode: String, Sendable {
    case auto, barcode, label, plate
}
