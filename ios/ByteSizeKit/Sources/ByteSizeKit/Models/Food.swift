import Foundation

/// A food the server found (search, barcode, recent, My Foods): what it's called and what one serving holds.
public struct Food: Codable, Identifiable, Equatable, Sendable {
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

    public var ref: String { "\(kind):\(id)" }
    /// Culury recipes are tracked in the web app; a quick meal is logged item by item there too.
    public var isLoggable: Bool { kind != "culury" && foodKind != "quick_meal" }
    public var calories: Double { nutrients["calories"] }
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
    public var calories: Double { food.calories * quantity }
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
}

public struct BarcodeResult: Codable, Equatable, Sendable {
    public let code: String
    public let food: Food?
}

public struct FoodList: Codable, Equatable, Sendable { public let foods: [Food] }
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
    public let assumed: Bool
    public let interpretedAs: String?
}

/// What a photo is of: `auto` tries a barcode, then a label.
public enum PhotoMode: String, Sendable {
    case auto, barcode, label, plate
}
