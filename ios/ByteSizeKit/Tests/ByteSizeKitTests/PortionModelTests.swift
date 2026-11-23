import XCTest
@testable import ByteSizeKit

/// L1: a portion is whole + fraction of any unit the food offers (its servings — including ones the server worked
/// out, like "1 prune" — then g/oz when it has a weight, then volumes when it has a volume).
@MainActor
final class PortionModelTests: XCTestCase {
    private let prunes = [Serving(label: "5 prunes", grams: 40), Serving(label: "1 prune", grams: 8, derived: true)]

    private func portion(_ servings: [Serving], calories: Double = 150) -> PortionModel {
        PortionModel(name: "Prunes", icon: "🍇", servings: servings, nutrients: Nutrients(["calories": calories]), meal: .snacks)
    }

    func testStartsAtOneOfTheFoodsServing() {
        let p = portion(prunes)
        XCTAssertEqual(p.whole, 1)
        XCTAssertEqual(p.fraction, 0)
        XCTAssertEqual(p.choice, .serving(0))
        XCTAssertEqual(p.quantity, 1)
        XCTAssertTrue(p.canLog)
        XCTAssertEqual(p.previewCalories, 150)
    }

    private func scanned(_ servings: String, start: String) throws -> Food {
        try JSONDecoder().decode(Food.self, from: Data("""
        {"kind":"cache","id":5,"name":"Mix","brand":null,"icon":"🥤","barcode":null,"servings":\(servings),"nutrients":{"calories":70},"aiFields":[],"source":"off","start":\(start)}
        """.utf8))
    }

    func testAScannedFoodStartsAtItsPackageServingWrittenItsOwnWay() throws {
        let mix = PortionModel(food: try scanned(#"[{"label":"100 g","grams":100},{"label":"2 Tbsp","grams":12},{"label":"1 tbsp","grams":6,"derived":true}]"#,
                                                 start: #"{"servingIndex":2,"unit":"serving","quantity":2}"#), meal: .breakfast)
        XCTAssertEqual(mix.whole, 2)
        XCTAssertEqual(mix.choice, .serving(2))
        XCTAssertEqual(mix.label(for: mix.choice), "tbsp", "2 | tbsp, not 2 | 1 tbsp")

        let mix15 = PortionModel(food: try scanned(#"[{"label":"100 g","grams":100},{"label":"15 g","grams":15}]"#,
                                                   start: #"{"servingIndex":0,"unit":"g","quantity":15}"#), meal: .breakfast)
        XCTAssertEqual(mix15.whole, 15)
        XCTAssertEqual(mix15.choice, .unit(.g))

        let half = PortionModel(food: try scanned(#"[{"label":"2½ tbsp","grams":15},{"label":"1 tbsp","grams":6,"derived":true}]"#,
                                                  start: #"{"servingIndex":1,"unit":"serving","quantity":2.5}"#), meal: .breakfast)
        XCTAssertEqual(half.whole, 2)
        XCTAssertEqual(half.fraction, 0.5)
        XCTAssertEqual(half.previewCalories, 70)
    }

    func testOneOfSomethingReadsWithoutTheOne() {
        let p = portion([Serving(label: "100 g", grams: 100), Serving(label: "1 SLICE (30 g)", grams: 30)])
        XCTAssertEqual(p.label(for: .serving(1)), "SLICE (30 g)")
        XCTAssertEqual(p.label(for: .serving(0)), "100 g")
        XCTAssertEqual(p.label(for: .unit(.g)), "g")
        let drink = portion([Serving(label: "1 cup", ml: 240)])
        XCTAssertEqual(drink.label(for: .serving(0)), "1 cup", "keeps its 1: cup is a volume on the wheel too")
    }

    // The Serving row reads the amount the way the wheel shows it: "2½ tbsp", "144 g", "SLICE (30 g)", "2 × 2 Tbsp"
    func testTheAmountInWords() {
        let mix = portion([Serving(label: "100 g", grams: 100), Serving(label: "2 Tbsp", grams: 12), Serving(label: "1 tbsp", grams: 6, derived: true)])
        mix.choice = .serving(2); mix.whole = 2; mix.fraction = 0.5
        XCTAssertEqual(mix.amountText, "2½ tbsp")
        mix.choice = .unit(.g); mix.whole = 144; mix.fraction = 0
        XCTAssertEqual(mix.amountText, "144 g")
        mix.choice = .serving(1); mix.whole = 1
        XCTAssertEqual(mix.amountText, "2 Tbsp", "one of a counted serving is just its name")
        mix.whole = 2
        XCTAssertEqual(mix.amountText, "2 × 2 Tbsp")
        mix.whole = 0; mix.fraction = 0.5
        XCTAssertEqual(mix.amountText, "½ × 2 Tbsp")
        let bread = portion([Serving(label: "100 g", grams: 100), Serving(label: "1 SLICE (30 g)", grams: 30)])
        bread.choice = .serving(1)
        XCTAssertEqual(bread.amountText, "1 SLICE (30 g)")
        let yogurt = portion([Serving(label: "1 cup")])
        yogurt.whole = 2
        XCTAssertEqual(yogurt.amountText, "2 × 1 cup", "the package's own serving keeps its name, as in the food log")
        let prunes = portion(self.prunes)
        prunes.choice = .serving(1); prunes.whole = 6
        XCTAssertEqual(prunes.amountText, "6 prune")
    }

    // Every nutrient the food has, for the amount chosen (not for its first serving)
    func testNutritionForTheAmount() {
        let p = PortionModel(name: "Asparagus", icon: "🥦", servings: [Serving(label: "100 g", grams: 100)],
                             nutrients: Nutrients(["calories": 20, "protein_g": 2.2, "fiber_g": 2.1, "sodium_mg": 2]), meal: .dinner)
        p.choice = .unit(.g); p.whole = 150
        XCTAssertEqual(p.facts.map(\.key), ["calories", "protein_g", "fiber_g", "sodium_mg"], "the food's own, in the usual order")
        XCTAssertEqual(p.facts.first?.value ?? 0, 30, accuracy: 0.001)
        XCTAssertEqual(p.facts[1].value, 3.3, accuracy: 0.001)
        XCTAssertEqual(p.facts[1].label, "Protein")
        XCTAssertEqual(p.facts[1].unit, "g")
        p.whole = 0
        XCTAssertEqual(p.facts.first?.value ?? -1, 0, accuracy: 0.001)
    }

    // A list row says what the food opens at, not what 100 g holds: "80 cal · 1 SLICE (30 g)"
    func testARowShowsTheCaloriesForTheAmountItOpensAt() throws {
        let bread = try scanned(#"[{"label":"100 g","grams":100},{"label":"1 SLICE (30 g)","grams":30}]"#,
                                start: #"{"servingIndex":1,"unit":"serving","quantity":1}"#)
        XCTAssertEqual(PortionModel.rowDetail(bread.with(nutrients: Nutrients(["calories": 266.7]))), "80 cal · 1 SLICE (30 g)")
        let mix = try scanned(#"[{"label":"2.5 tbsp"},{"label":"1 tbsp","per":0.4,"derived":true}]"#,
                              start: #"{"servingIndex":1,"unit":"serving","quantity":2.5}"#)
        XCTAssertEqual(PortionModel.rowDetail(mix), "70 cal · 2½ tbsp")
        let plain = try scanned(#"[{"label":"1 bar","grams":40}]"#, start: "null")
        XCTAssertEqual(PortionModel.rowDetail(plain), "70 cal · 1 bar")
    }

    func testSixPrunesFromAFivePruneFood() {
        let p = portion(prunes)
        p.choice = .serving(1)
        p.whole = 6
        XCTAssertEqual(p.servingIndex, 1)
        XCTAssertEqual(p.unit, .serving)
        XCTAssertEqual(p.previewCalories, 180)
    }

    func testTheUnitsOnOffer() {
        XCTAssertEqual(portion(prunes).choices.map(\.label), ["5 prunes", "1 prune", "g", "oz"])
        let drink = portion([Serving(label: "1 can", ml: 355)])
        XCTAssertEqual(drink.choices.map(\.label), ["1 can", "ml", "fl oz", "cup", "tbsp", "tsp"])
        let loose = portion([Serving(label: "1 bowl")])
        XCTAssertEqual(loose.choices.map(\.label), ["1 bowl"])
    }

    func testSwitchingUnitKeepsTheNumber() {
        let p = portion([Serving(label: "1 cup", grams: 240, ml: 240)], calories: 240)
        p.choice = .unit(.cup)
        p.whole = 3
        p.choice = .unit(.tbsp)
        XCTAssertEqual(p.whole, 3)
        XCTAssertEqual(p.unit, .tbsp)
        XCTAssertEqual(p.previewCalories, 44) // 3 tbsp = 44.36 ml of a 240 ml cup
    }

    func testGramsAndFractions() {
        let p = portion(prunes)
        p.choice = .unit(.g)
        p.whole = 100
        XCTAssertEqual(p.previewCalories, 375)
        XCTAssertTrue(p.wholeRange.contains(100))
        XCTAssertTrue(p.wholeRange.contains(1000))
        XCTAssertEqual(p.wholeRange, Array(0...1000), "every gram, no skipping: 144 g is there")
        p.choice = .serving(0)
        p.whole = 2
        p.fraction = 0.5
        XCTAssertEqual(p.quantity, 2.5)
        XCTAssertFalse(p.wholeRange.contains(1000), "big steps only for g and ml")
    }

    func testNothingCantBeLogged() {
        let p = portion(prunes)
        p.whole = 0
        p.fraction = 0
        XCTAssertFalse(p.canLog)
        XCTAssertNil(p.previewCalories)
    }

    func testBigAmounts() {
        let p = portion([Serving(label: "1 medium", grams: 118)], calories: 105)
        p.whole = 21
        XCTAssertTrue(p.isBig)
        XCTAssertEqual(p.previewCalories, 2205)
        p.whole = 3
        XCTAssertFalse(p.isBig)
    }

    func testFromAFood() throws {
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let p = PortionModel(food: food, meal: .lunch)
        XCTAssertEqual(p.name, "Banana")
        XCTAssertEqual(p.meal, .lunch)
        XCTAssertEqual(p.previewCalories, 105)
    }

    func testAnEntryLoggedBeforeKeepsItsServingAndAmount() throws {
        // logged in I2/I3: 1.5 × "1 tbsp" at ½ (0.75 tbsp), 30 cal for that amount
        let json = #"{"id":5,"day":"2026-11-18","meal":"breakfast","name":"Peanut butter","brand":null,"icon":"🥜","servingIndex":1,"unit":"serving","quantity":1.5,"fraction":0.5,"servings":[{"label":"2 tbsp","grams":32},{"label":"1 tbsp","grams":16}],"nutrients":{"calories":75},"aiEstimated":false,"source":"cache"}"#
        let entry = try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8))
        let p = PortionModel(entry: entry)
        XCTAssertEqual(p.choice, .serving(1))
        XCTAssertEqual(p.whole, 0)
        XCTAssertEqual(p.fraction, 0.75, accuracy: 1e-9)
        XCTAssertEqual(p.meal, .breakfast)
        XCTAssertEqual(p.previewCalories, 75, "the same amount reads the same")
        p.whole = 1
        p.fraction = 0.5
        XCTAssertEqual(p.previewCalories, 150) // 1.5 tbsp of a 200-cal 2 tbsp
    }

    func testAnEntryInGrams() throws {
        let json = #"{"id":6,"day":"2026-11-18","meal":"lunch","name":"Rice","brand":null,"icon":"🍚","servingIndex":0,"unit":"g","quantity":150,"fraction":1,"servings":[{"label":"1 cup","grams":158}],"nutrients":{"calories":195},"aiEstimated":false,"source":"cache"}"#
        let p = PortionModel(entry: try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8)))
        XCTAssertEqual(p.choice, .unit(.g))
        XCTAssertEqual(p.whole, 150)
        XCTAssertEqual(p.previewCalories, 195)
    }

    func testAnEntryPreviewsFromTheFoodsOwnNutrients() throws {
        // 1 g of 349 cal/100 g is stored as 3 cal; worked back from that it read "300" at 100 g
        let json = #"{"id":7,"day":"2026-11-18","meal":"lunch","name":"Rice","brand":null,"icon":"🍚","servingIndex":0,"unit":"g","quantity":1,"fraction":1,"servings":[{"label":"100 g","grams":100}],"nutrients":{"calories":3},"perServing":{"calories":349},"aiEstimated":false,"source":"user"}"#
        let p = PortionModel(entry: try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8)))
        p.whole = 100
        XCTAssertEqual(p.previewCalories, 349)
    }

    func testAnEntryStoredAtZeroStillPreviews() throws {
        let json = #"{"id":8,"day":"2026-11-18","meal":"lunch","name":"Lettuce","brand":null,"icon":"🥬","servingIndex":0,"unit":"g","quantity":1,"fraction":1,"servings":[{"label":"100 g","grams":100}],"nutrients":{"calories":0},"perServing":{"calories":15},"aiEstimated":false,"source":"user"}"#
        let p = PortionModel(entry: try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8)))
        p.whole = 200
        XCTAssertEqual(p.previewCalories, 30)
    }

    func testThePortionStartsAtTheLastAmount() throws {
        let json = #"{"kind":"cache","id":42,"name":"Prunes","brand":null,"icon":"🍇","barcode":null,"servings":[{"label":"5 prunes","grams":40},{"label":"1 prune","grams":8,"derived":true}],"nutrients":{"calories":150},"aiFields":[],"source":"usda","foodKind":"custom","last":{"servingIndex":1,"unit":"serving","quantity":6,"fraction":1}}"#
        let p = PortionModel(food: try JSONDecoder().decode(Food.self, from: Data(json.utf8)), meal: .lunch)
        XCTAssertEqual(p.choice, .serving(1))
        XCTAssertEqual(p.whole, 6)
        XCTAssertEqual(p.previewCalories, 180)
    }

    func testServingsOnlyForAIEstimates() {
        let p = PortionModel(name: "Egg", icon: "🥚", servings: [Serving(label: "1 large egg", grams: 50)], nutrients: Nutrients(["calories": 72]), meal: .breakfast, servingsOnly: true)
        XCTAssertEqual(p.choices.map(\.label), ["1 large egg"])
    }
}
