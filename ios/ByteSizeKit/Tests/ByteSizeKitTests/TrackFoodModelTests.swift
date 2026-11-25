import XCTest
@testable import ByteSizeKit

@MainActor
final class TrackFoodModelTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    /// 8:00 in Denver: breakfast time.
    private let morning = ISO8601DateFormatter().date(from: "2026-11-19T15:00:00Z")!
    private static let entry = #"{"entry":{"id":30,"day":"2026-11-17","meal":"breakfast","name":"Banana","brand":null,"icon":"🍌","servingIndex":0,"unit":"serving","quantity":1,"fraction":1,"servings":[{"label":"1 medium","grams":118}],"nutrients":{"calories":105},"aiEstimated":false,"source":"cache"}}"#

    private func serve(search: @escaping @Sendable (String) -> HTTPStub.Reply = { _ in .json(200, FoodFixtures.search) }, log: HTTPStub.Reply = .json(200, TrackFoodModelTests.entry),
                       recipe: HTTPStub.Reply = .json(200, #"{"food":\#(FoodFixtures.culury),"hasNutrition":true,"outdated":false}"#),
                       estimate: HTTPStub.Reply = .json(200, #"{"items":[\#(FoodFixtures.toast)],"assumed":false}"#)) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            switch (req.httpMethod ?? "", path) {
            case ("GET", _) where path.hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            case ("GET", "/api/foods/recent"): return .json(200, #"{"foods":[\#(FoodFixtures.banana)]}"#)
            case ("GET", "/api/foods/frequent"): return .json(200, #"{"foods":[\#(FoodFixtures.banana),\#(FoodFixtures.banana)]}"#)
            case ("GET", "/api/foods/search"):
                let q = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
                return search(q)
            case ("GET", "/api/foods/barcode/0012345678905"): return .json(200, #"{"code":"0012345678905","food":\#(FoodFixtures.banana),"errors":[]}"#)
            case ("GET", "/api/foods/barcode/0099999999999"): return .json(200, #"{"code":"0099999999999","food":null,"errors":[]}"#)
            case ("POST", "/api/log"): return log
            case ("GET", "/api/culury/recipes/7"): return recipe
            case ("POST", "/api/ai/estimate-items"): return estimate
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func requests(_ method: String, _ path: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && $0.request.url?.path() == path }
    }

    private func model() -> (TrackFoodModel, DayStore) {
        let days = DayStore(api: api, timeZone: denver, now: { self.morning })
        return (TrackFoodModel(api: api, dayStore: days, now: { self.morning }), days)
    }

    func testLoadFetchesRecentForTheSuggestedMeal() async {
        serve()
        let (m, _) = model()
        XCTAssertEqual(m.meal, .breakfast)
        await m.load()
        XCTAssertEqual(m.recent.count, 1)
        XCTAssertEqual(requests("GET", "/api/foods/recent").first?.request.url?.query(), "meal=breakfast")
    }

    func testSearchNeedsTwoCharacters() async {
        serve()
        let (m, _) = model()
        m.query = "g"
        await m.search()
        XCTAssertTrue(requests("GET", "/api/foods/search").isEmpty)
        XCTAssertEqual(m.groups, [])
        m.query = "gr"
        await m.search()
        XCTAssertEqual(requests("GET", "/api/foods/search").count, 1)
        XCTAssertEqual(m.groups.map(\.label), ["Basic foods", "RecipeHub"])
        XCTAssertFalse(m.searching)
        m.query = ""
        await m.search()
        XCTAssertEqual(m.groups, [], "clearing the field goes back to recent and frequent")
    }

    func testATypedSearchKeepsTheAnswer() async {
        serve()
        let (m, _) = model()
        m.query = "banana"
        await m.search()
        XCTAssertEqual(m.found?.searched, ["basic", "usda"], "the chips need what the server asked")
        XCTAssertEqual(m.found?.groups.map(\.source), ["basic", "culury"])
    }

    func testAFailedSourceShowsEvenWhenNothingWasFound() async {
        serve(search: { _ in .json(200, #"{"groups":[{"source":"usda","label":"USDA","foods":[]}],"errors":[{"source":"usda","message":"USDA didn't answer"}],"searched":["mine","usda"]}"#) })
        let (m, _) = model()
        m.query = "kale"
        await m.search()
        XCTAssertEqual(m.found?.errors.map(\.source), ["usda"], "the failure must reach the chips")
        XCTAssertEqual(m.found?.searched, ["mine", "usda"])
        XCTAssertEqual(m.found?.groups, [], "empty groups are dropped")
        XCTAssertEqual(m.message, "Nothing found for “kale”")
    }

    func testABarcodeHitHasNoSources() async {
        serve()
        let (m, _) = model()
        m.query = "0012345678905"
        await m.search()
        XCTAssertNil(m.found?.searched)
        XCTAssertEqual(m.found?.groups.count, 1)
    }

    func testClearingTheSearchClearsTheAnswer() async {
        serve()
        let (m, _) = model()
        m.query = "banana"
        await m.search()
        m.query = "a"
        await m.search()
        XCTAssertNil(m.found)
        m.query = "0099999999999"
        await m.search()
        XCTAssertNil(m.found, "an unknown barcode")
    }

    // MARK: RecipeHub recipes on the phone (tests for what shipped untested in #14)

    private static let chili = try! JSONDecoder().decode(Food.self, from: Data(FoodFixtures.culury.utf8))
    private static func chiliWith(_ nutrients: String, grams: Bool = true) -> String {
        FoodFixtures.culury.replacingOccurrences(of: #""nutrients":{"calories":400}"#, with: #""nutrients":\#(nutrients)"#)
            .replacingOccurrences(of: #"[{"label":"1 bowl"}]"#, with: grams ? #"[{"label":"1 bowl","grams":60}]"# : #"[{"label":"1 bowl"}]"#)
    }

    func testCuluryRecipesAreLoggableHere() {
        XCTAssertTrue(Self.chili.isLoggable)
        XCTAssertTrue(Self.chili.isCulury)
    }

    func testARecipeIsReadLiveBeforeItOpens() async {
        serve(recipe: .json(200, #"{"food":\#(Self.chiliWith(#"{"calories":450}"#)),"hasNutrition":true,"outdated":false}"#))
        let (m, _) = model()
        let opened = await m.openRecipe(Self.chili)
        XCTAssertEqual(opened.calories, 450, "RecipeHub's numbers now, not the search's copy")
        XCTAssertNil(m.recipeNote)
        XCTAssertFalse(m.recipeNeedsEstimate)
    }

    func testAnOutOfDateRecipeSaysSo() async {
        serve(recipe: .json(200, #"{"food":\#(FoodFixtures.culury),"hasNutrition":true,"outdated":true}"#))
        let (m, _) = model()
        _ = await m.openRecipe(Self.chili)
        XCTAssertEqual(m.recipeNote, "RecipeHub's nutrition for this recipe may be out of date.")
    }

    func testCuluryDownUsesTheCopyInHand() async {
        serve(recipe: .json(502, #"{"error":"RecipeHub didn't answer"}"#))
        let (m, _) = model()
        let opened = await m.openRecipe(Self.chili)
        XCTAssertEqual(opened, Self.chili)
        XCTAssertEqual(m.recipeNote, "RecipeHub is unavailable — using the last logged version")
    }

    func testOtherFoodsOpenAsTheyAre() async {
        serve()
        let (m, _) = model()
        let banana = try! JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let opened = await m.openRecipe(banana)
        XCTAssertEqual(opened, banana)
        XCTAssertNil(m.recipeNote)
        XCTAssertTrue(requests("GET", "/api/culury/recipes/41").isEmpty)
    }

    func testARecipeWithoutNutritionIsEstimatedAndLoggedWithIt() async throws {
        // The recipe's bowl weighs 60 g; the AI's toast is 80 cal per 30 g slice → 160 cal per bowl
        serve(recipe: .json(200, #"{"food":\#(Self.chiliWith("{}")),"hasNutrition":false,"outdated":false}"#))
        let (m, _) = model()
        let opened = await m.openRecipe(Self.chili)
        XCTAssertTrue(m.recipeNeedsEstimate)
        XCTAssertEqual(m.recipeNote, "RecipeHub has no nutrition for this recipe. Estimate it, or track it as unknown.")
        let maybe = await m.estimateRecipe(opened)
        let estimated = try XCTUnwrap(maybe)
        XCTAssertEqual(estimated.calories, 160)
        XCTAssertFalse(m.recipeNeedsEstimate)
        XCTAssertEqual(requests("POST", "/api/ai/estimate-items").last?.json?["text"] as? String, "1 serving of Chili (60 g)")
        let portion = PortionModel(food: estimated, meal: .dinner)
        _ = await m.log(estimated, portion: portion)
        let body = try XCTUnwrap(requests("POST", "/api/log").last?.json)
        XCTAssertEqual((body["nutrients"] as? [String: Double])?["calories"], 160, "the estimate goes with the entry")
        XCTAssertEqual((body["food"] as? [String: Any])?["kind"] as? String, "culury")
    }

    func testOtherFoodsNeverSendNutrients() async throws {
        serve()
        let (m, _) = model()
        let banana = try! JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        _ = await m.log(banana, portion: PortionModel(food: banana, meal: .breakfast))
        XCTAssertNil(try XCTUnwrap(requests("POST", "/api/log").last?.json)["nutrients"])
    }

    /// TF2: the chips belong to the answer on screen — a cleared or shortened search hides them at once, not after
    /// the 300 ms pause before the next search.
    func testTheAnswerGoesTheMomentTheSearchIsCleared() async {
        serve()
        let (m, _) = model()
        m.query = "banana"
        await m.search()
        XCTAssertNotNil(m.answer)
        m.query = "b"
        XCTAssertNil(m.answer)
        m.query = ""
        XCTAssertNil(m.answer)
    }

    func testTypedBarcodeUsesTheBarcodeRoute() async {
        serve()
        let (m, _) = model()
        m.query = "0012345678905"
        await m.search()
        XCTAssertTrue(requests("GET", "/api/foods/search").isEmpty)
        XCTAssertEqual(m.groups.first?.foods.first?.name, "Banana")
        m.query = "0099999999999"
        await m.search()
        XCTAssertEqual(m.groups, [])
        XCTAssertEqual(m.message, "We don't know this barcode yet. Scan Food can read its label.")
    }

    func testTheLastSearchWins() async {
        let slow = #"{"groups":[{"source":"basic","label":"Old","foods":[\#(FoodFixtures.banana)]}],"errors":[]}"#
        let fast = #"{"groups":[{"source":"basic","label":"New","foods":[\#(FoodFixtures.banana)]}],"errors":[]}"#
        serve(search: { $0 == "ban" ? .delayed(0.4, .json(200, slow)) : .json(200, fast) })
        let (m, _) = model()
        m.query = "ban"
        let first = Task { await m.search() }
        try? await Task.sleep(for: .milliseconds(50))
        m.query = "bana"
        await m.search()
        await first.value
        XCTAssertEqual(m.groups.map(\.label), ["New"])
    }

    func testLogPostsTheSelectedDayAndThePortionsMeal() async throws {
        serve()
        let (m, days) = model()
        await days.select("2026-11-17") // not today
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let portion = PortionModel(food: food, meal: .breakfast)
        portion.meal = .dinner
        portion.whole = 2
        portion.fraction = 0.5
        let reloadsBefore = requests("GET", "/api/day/2026-11-17").count
        let ok = await m.log(food, portion: portion)
        XCTAssertTrue(ok)
        let body = try XCTUnwrap(requests("POST", "/api/log").last?.json)
        XCTAssertEqual(body["day"] as? String, "2026-11-17")
        XCTAssertEqual(body["meal"] as? String, "dinner")
        XCTAssertEqual(body["quantity"] as? Double, 2.5)
        XCTAssertEqual(body["fraction"] as? Double, 1)
        XCTAssertEqual(body["unit"] as? String, "serving")
        XCTAssertEqual(requests("GET", "/api/day/2026-11-17").count, reloadsBefore + 1, "the day reloads")
    }

    func testAServerNoIsShownAndNothingIsLogged() async throws {
        serve(log: .json(400, #"{"error":"Invalid request","details":[{"path":"quantity","message":"Enter an amount above 0"}]}"#))
        let (m, _) = model()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let ok = await m.log(food, portion: PortionModel(food: food, meal: .lunch))
        XCTAssertFalse(ok)
        XCTAssertEqual(m.message, "Enter an amount above 0")
    }

    func testAPortionThatCantBeLoggedIsntSent() async throws {
        serve()
        let (m, _) = model()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let portion = PortionModel(food: food, meal: .lunch)
        portion.whole = 0
        let ok = await m.log(food, portion: portion)
        XCTAssertFalse(ok)
        XCTAssertTrue(requests("POST", "/api/log").isEmpty)
    }

    func testATypedLetterCancellingTheLastSearchShowsNoError() async {
        serve(search: { $0 == "bana" ? .delayed(2, .json(200, FoodFixtures.search)) : .json(200, FoodFixtures.search) })
        let (m, _) = model()
        m.query = "ban"
        await m.search()
        XCTAssertEqual(m.groups.count, 2)
        m.query = "bana"
        let typing = Task { await m.search() }
        try? await Task.sleep(for: .milliseconds(100))
        typing.cancel() // the view's .task(id: query) does this on the next keystroke
        await typing.value
        XCTAssertNil(m.message, "no false 'can't reach' message")
        XCTAssertEqual(m.groups.count, 2, "the last results stay up")
    }

    func testGramsAreSentAsGrams() async throws {
        serve()
        let (m, _) = model()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let portion = PortionModel(food: food, meal: .lunch)
        portion.choice = .unit(.g)
        portion.whole = 150
        _ = await m.log(food, portion: portion)
        let body = try XCTUnwrap(requests("POST", "/api/log").last?.json)
        XCTAssertEqual(body["unit"] as? String, "g")
        XCTAssertEqual(body["quantity"] as? Double, 150)
        XCTAssertEqual(body["servingIndex"] as? Int, 0)
    }

    func testAfterLoggingTheSearchIsReadyForTheNext() async throws {
        serve()
        let (m, _) = model()
        m.query = "banana"
        await m.search()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let ok = await m.log(food, portion: PortionModel(food: food, meal: .lunch))
        XCTAssertTrue(ok)
        XCTAssertEqual(m.query, "")
        XCTAssertEqual(m.groups, [])
        XCTAssertEqual(m.lastLogged, "Banana")
    }

    func testTheMealChosenForOneFoodIsWhereTheNextStarts() async throws {
        serve()
        let (m, _) = model()
        m.meal = .lunch
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let portion = PortionModel(food: food, meal: m.meal)
        portion.meal = .dinner
        let ok = await m.log(food, portion: portion)
        XCTAssertTrue(ok)
        XCTAssertEqual(m.meal, .dinner, "a three-item dinner shouldn't need the meal changed three times")
    }

    func testStartsOnTheMealFromThePersonsMealTimes() {
        let days = DayStore(api: api, timeZone: denver, now: { self.morning })
        // With breakfast ending at 05:00, the morning is lunch
        days.mealWindows = MealWindows(breakfast: "05:00", lunch: "23:00", snacks: "23:30", dinner: "23:45")
        let m = TrackFoodModel(api: api, dayStore: days, now: { self.morning })
        XCTAssertEqual(m.meal, .lunch)
    }
}
