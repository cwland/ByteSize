import XCTest
@testable import ByteSizeKit

/// Shaped like the server's GET /api/day/:date (routes/log.ts dayView).
enum Fixtures {
    static let day = #"""
    {"day":"2026-11-19",
     "entries":[
      {"id":11,"day":"2026-11-19","meal":"breakfast","name":"Greek yogurt","brand":"Fage","icon":"🥣","imageUrl":null,"servingIndex":0,"unit":"serving","quantity":2,"fraction":1,"servings":[{"label":"1 cup","grams":227}],"nutrients":{"calories":260,"protein_g":36,"fiber_g":null,"carbs_g":12,"fat_g":0},"aiEstimated":false,"source":"cache","sourceRef":"cache:7","treat":false},
      {"id":12,"day":"2026-11-19","meal":"lunch","name":"Protein bar","brand":null,"icon":"🍫","imageUrl":null,"servingIndex":0,"unit":"serving","quantity":1,"fraction":0.5,"servings":[{"label":"1 bar","grams":60}],"nutrients":{"calories":110,"protein_g":10},"aiEstimated":true,"source":"user_food","sourceRef":"user_food:3","treat":false},
      {"id":13,"day":"2026-11-19","meal":"supplements","name":"Water","brand":null,"icon":"💧","imageUrl":null,"servingIndex":0,"unit":"ml","quantity":500,"fraction":1,"servings":[{"label":"1 ml","ml":1}],"nutrients":{"water_ml":500},"aiEstimated":false,"source":"water","sourceRef":null,"treat":false}
     ],
     "totals":{"calories":1138,"protein_g":97,"carbs_g":80,"fat_g":30,"water_ml":1500,"unknownCount":1},
     "meals":{"breakfast":{"calories":260,"protein_g":36,"carbs_g":12,"fat_g":0,"fiber_g":0,"suggested":{"min":300,"max":500}},"lunch":{"calories":110,"protein_g":10,"carbs_g":0,"fat_g":0,"fiber_g":0,"suggested":null},"dinner":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0,"suggested":null},"snacks":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0,"suggested":null},"supplements":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0,"suggested":null}},
     "targets":{"calories":{"min":1500,"max":2000},"protein_g":{"min":110,"max":130},"fiber_g":{"min":25,"max":35},"water_ml":{"min":2000,"max":3000},"plan":"steady","effectiveFrom":"2026-11-01"},
     "exercise":{"calories":0},"streak":12}
    """#

    static let dayNoTargets = day.replacingOccurrences(
        of: #""targets":{"calories":{"min":1500,"max":2000},"protein_g":{"min":110,"max":130},"fiber_g":{"min":25,"max":35},"water_ml":{"min":2000,"max":3000},"plan":"steady","effectiveFrom":"2026-11-01"}"#,
        with: #""targets":null"#
    )

    static func decodeDay(_ json: String = day) throws -> DayView {
        try JSONDecoder().decode(DayView.self, from: Data(json.utf8))
    }
}

final class ModelsTests: XCTestCase {
    func testEntryDecodesSourceRef() throws {
        let base = #"{"id":1,"day":"2026-11-19","meal":"lunch","name":"Oatmeal","brand":null,"icon":"🥣","servingIndex":0,"unit":"serving","quantity":1,"fraction":1,"servings":[{"label":"1 cup"}],"nutrients":{"calories":150},"aiEstimated":false,"source":"cache""#
        let with = try JSONDecoder().decode(LogEntry.self, from: Data((base + #","sourceRef":"cache:42"}"#).utf8))
        XCTAssertEqual(with.sourceRef, "cache:42")
        let without = try JSONDecoder().decode(LogEntry.self, from: Data((base + "}").utf8))
        XCTAssertNil(without.sourceRef)
    }

    func testFoodDecodesLastAndBase() throws {
        let base = #"{"kind":"user_food","id":9,"name":"Prunes","brand":null,"icon":"🍇","barcode":null,"servings":[{"label":"5 prunes","grams":40}],"nutrients":{"calories":150},"aiFields":[],"source":"mine","foodKind":"override""#
        let with = try JSONDecoder().decode(Food.self, from: Data((base + #","last":{"servingIndex":1,"unit":"serving","quantity":6,"fraction":1},"baseCacheId":7}"#).utf8))
        XCTAssertEqual(with.last, LastPortion(servingIndex: 1, unit: "serving", quantity: 6, fraction: 1))
        XCTAssertEqual(with.baseCacheId, 7)
        let without = try JSONDecoder().decode(Food.self, from: Data((base + "}").utf8))
        XCTAssertNil(without.last)
        XCTAssertNil(without.baseCacheId)
    }

    func testDecodesADay() throws {
        let d = try Fixtures.decodeDay()
        XCTAssertEqual(d.day, "2026-11-19")
        XCTAssertEqual(d.entries.map(\.id), [11, 12, 13])
        XCTAssertEqual(d.entries[1].fraction, 0.5)
        XCTAssertTrue(d.entries[1].aiEstimated)
        XCTAssertTrue(d.entries[2].isWater)
        XCTAssertEqual(d.entries[0].meal, .breakfast)
        XCTAssertEqual(d.totals["calories"], 1138)
        XCTAssertEqual(d.meals["breakfast"]?.calories, 260)
        XCTAssertEqual(d.targets?.calories, TargetRange(min: 1500, max: 2000))
        XCTAssertEqual(d.targets?.water_ml.max, 3000)
        XCTAssertEqual(d.streak, 12)
    }

    func testNoTargets() throws {
        XCTAssertNil(try Fixtures.decodeDay(Fixtures.dayNoTargets).targets)
    }

    func testMissingOrNullNutrientsAreZero() throws {
        let d = try Fixtures.decodeDay()
        XCTAssertEqual(d.entries[0].nutrients["fiber_g"], 0) // null
        XCTAssertEqual(d.totals["fiber_g"], 0) // missing
        XCTAssertEqual(d.entries[0].nutrients["protein_g"], 36)
    }

    func testMealsInOrderWithTitles() {
        XCTAssertEqual(Meal.allCases.map(\.title), ["Breakfast", "Lunch", "Dinner", "Snacks", "Supplements & water"])
    }

    func testSuggestedMealByTimeInTheAccountsZone() throws {
        let boise = try XCTUnwrap(TimeZone(identifier: "America/Boise"))
        func at(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }
        // Boise is UTC-7 in November
        XCTAssertEqual(Meal.suggested(at: at("2026-11-19T14:00:00Z"), in: boise), .breakfast) // 07:00
        XCTAssertEqual(Meal.suggested(at: at("2026-11-19T19:00:00Z"), in: boise), .lunch) // 12:00
        XCTAssertEqual(Meal.suggested(at: at("2026-11-19T22:00:00Z"), in: boise), .snacks) // 15:00
        XCTAssertEqual(Meal.suggested(at: at("2026-11-20T01:00:00Z"), in: boise), .dinner) // 18:00
        XCTAssertEqual(Meal.suggested(at: at("2026-11-20T05:00:00Z"), in: boise), .snacks) // 22:00
    }

    func testAmountText() throws {
        let d = try Fixtures.decodeDay()
        XCTAssertEqual(d.entries[0].amountText(units: .imperial), "2 × 1 cup")
        XCTAssertEqual(d.entries[1].amountText(units: .imperial), "½ × 1 bar")
        XCTAssertEqual(d.entries[2].amountText(units: .imperial), "17 fl oz")
        XCTAssertEqual(d.entries[2].amountText(units: .metric), "500 ml")
    }

    func testUnits() {
        XCTAssertEqual(Units("imperial"), .imperial)
        XCTAssertEqual(Units("metric"), .metric)
        XCTAssertEqual(Units(nil), .imperial)
        XCTAssertEqual(Units.imperial.weight(kg: 82.28), "181.4 lb")
        XCTAssertEqual(Units.metric.weight(kg: 82.28), "82.3 kg")
        XCTAssertEqual(Units.imperial.water(ml: 473), "16 fl oz")
        XCTAssertEqual(Units.metric.water(ml: 250), "250 ml")
        XCTAssertEqual(Units.imperial.kg(fromDisplay: 181.4), 82.28, accuracy: 0.01)
        XCTAssertEqual(Units.metric.kg(fromDisplay: 82.3), 82.3, accuracy: 0.0001)
        XCTAssertEqual(Units.imperial.weightUnit, "lb")
        // water amounts as typed in the edit sheet
        XCTAssertEqual(Units.imperial.waterValue(ml: 473), 16, accuracy: 0.01)
        XCTAssertEqual(Units.imperial.ml(fromWaterDisplay: 12), 354.88, accuracy: 0.01)
        XCTAssertEqual(Units.metric.waterValue(ml: 250), 250)
        XCTAssertEqual(Units.metric.ml(fromWaterDisplay: 250), 250)
    }

    func testAmountsReadInFractionsLikeTheWheel() throws {
        func entry(_ unit: String, _ q: Double) throws -> LogEntry {
            try JSONDecoder().decode(LogEntry.self, from: Data(#"{"id":1,"day":"2026-11-20","meal":"lunch","name":"Rice","brand":null,"icon":"🍚","servingIndex":0,"unit":"\#(unit)","quantity":\#(q),"fraction":1,"servings":[{"label":"1 cup","grams":158}],"nutrients":{"calories":1},"aiEstimated":false,"source":"cache"}"#.utf8))
        }
        XCTAssertEqual(try entry("serving", 2.5).amountText(units: .imperial), "2½ × 1 cup")
        XCTAssertEqual(try entry("serving", 0.375).amountText(units: .imperial), "⅜ × 1 cup")
        XCTAssertEqual(try entry("cup", 1.75).amountText(units: .imperial), "1¾ cup")
        XCTAssertEqual(try entry("g", 150.5).amountText(units: .imperial), "150.5 g")
        XCTAssertEqual(try entry("serving", 1.3).amountText(units: .imperial), "1.3 × 1 cup")
    }
}

