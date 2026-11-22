import XCTest
@testable import ByteSizeKit

@MainActor
final class ScanModelTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private nonisolated static let saved = #"{"kind":"user_food","id":9,"name":"Wheat crackers","brand":"Acme","icon":"🍘","barcode":"0099999999999","servings":[{"label":"2 crackers","grams":30}],"nutrients":{"calories":140},"aiFields":["calories"],"imageUrl":null,"override":false,"source":"mine","foodKind":"custom"}"#

    /// A server that knows 0012345678905, and 0099999999999 only once a food has been saved for it.
    private func serve(save: HTTPStub.Reply = .json(200, #"{"food":\#(ScanModelTests.saved)}"#), label: HTTPStub.Reply = .json(200, #"{"photoIds":["p1"],"draft":\#(FoodFixtures.draft),"errors":[],"labelReading":true}"#), lookup: HTTPStub.Reply? = nil) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            let savedYet = HTTPStub.requests.contains { $0.request.httpMethod == "POST" && $0.request.url?.path() == "/api/my-foods" }
            switch (req.httpMethod ?? "", path) {
            case ("GET", "/api/foods/barcode/0012345678905"): return lookup ?? .json(200, #"{"code":"0012345678905","food":\#(FoodFixtures.banana),"errors":[]}"#)
            case ("GET", "/api/foods/barcode/0099999999999"):
                return .json(200, savedYet ? #"{"code":"0099999999999","food":\#(ScanModelTests.saved),"errors":[]}"# : #"{"code":"0099999999999","food":null,"errors":[]}"#)
            case ("POST", "/api/photos/analyze"): return label
            case ("POST", "/api/my-foods"): return save
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func count(_ method: String, _ prefix: String) -> Int {
        HTTPStub.requests.filter { $0.request.httpMethod == method && ($0.request.url?.path() ?? "").hasPrefix(prefix) }.count
    }

    func testAKnownBarcodeIsFound() async {
        serve()
        let m = ScanModel(api: api)
        XCTAssertEqual(m.step, .scanning)
        await m.scanned("0012345678905")
        guard case .found(let food) = m.step else { return XCTFail("\(m.step)") }
        XCTAssertEqual(food.name, "Banana")
    }

    func testReadsWhileLookingAreIgnored() async {
        serve(lookup: .delayed(0.3, .json(200, #"{"code":"0012345678905","food":\#(FoodFixtures.banana),"errors":[]}"#)))
        let m = ScanModel(api: api)
        let first = Task { await m.scanned("0012345678905") }
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(m.step, .looking("0012345678905"))
        await m.scanned("0012345678905") // the scanner keeps reporting the same code
        await m.scanned("4006381333931")
        await first.value
        XCTAssertEqual(count("GET", "/api/foods/barcode/"), 1)
    }

    func testOnlyTheDigitsCount() async {
        serve()
        let m = ScanModel(api: api)
        await m.scanned(" 0012-3456-78905 ")
        XCTAssertEqual(HTTPStub.requests.last?.request.url?.path(), "/api/foods/barcode/0012345678905")
        m.restart()
        await m.scanned("no digits")
        XCTAssertEqual(m.step, .scanning)
    }

    func testUnknownBarcodeThenTheLabelThenSaved() async throws {
        serve()
        let m = ScanModel(api: api)
        await m.scanned("0099999999999")
        XCTAssertEqual(m.step, .notFound("0099999999999"))

        await m.readLabel(jpeg: Data([0xFF, 0xD8]))
        guard case .review(let draft, let code) = m.step else { return XCTFail("\(m.step)") }
        XCTAssertEqual(code, "0099999999999")
        XCTAssertEqual(draft.name, "Wheat crackers")
        let upload = String(decoding: try XCTUnwrap(HTTPStub.requests.last?.body), as: UTF8.self)
        XCTAssertTrue(upload.contains("name=\"mode\"\r\n\r\nlabel\r\n"))

        var edited = draft
        edited.name = "Acme wheat crackers"
        await m.save(edited)
        guard case .saved(let food) = m.step else { return XCTFail("\(m.step)") }
        XCTAssertEqual(food.ref, "user_food:9")
        let body = try XCTUnwrap(HTTPStub.requests.last?.json)
        XCTAssertEqual(body["barcode"] as? String, "0099999999999")
        XCTAssertEqual(body["name"] as? String, "Acme wheat crackers")

        // Next time, the same barcode finds the food just saved
        m.restart()
        await m.scanned("0099999999999")
        guard case .found(let again) = m.step else { return XCTFail("\(m.step)") }
        XCTAssertEqual(again.ref, "user_food:9")
    }

    func testAnUnreadableLabel() async {
        serve(label: .json(200, #"{"photoIds":["p1"],"errors":[{"source":"ai","message":"The AI couldn't read a nutrition label in that photo."}],"labelReading":true}"#))
        let m = ScanModel(api: api)
        await m.scanned("0099999999999")
        await m.readLabel(jpeg: Data([1]))
        XCTAssertEqual(m.step, .failed("Couldn't read that label. Try again with the whole Nutrition Facts panel in view."))
        XCTAssertEqual(m.code, "0099999999999", "the barcode is kept so the label can be tried again")
    }

    func testNoPhotoAI() async {
        serve(label: .json(200, #"{"photoIds":["p1"],"errors":[],"labelReading":false}"#))
        let m = ScanModel(api: api)
        await m.scanned("0099999999999")
        await m.readLabel(jpeg: Data([1]))
        XCTAssertEqual(m.step, .failed(ScanModel.needsPhotoAI))
    }

    func testCantReachTheServer() async {
        serve(lookup: .fail(.notConnectedToInternet))
        let m = ScanModel(api: api)
        await m.scanned("0012345678905")
        XCTAssertEqual(m.step, .failed("Can't reach ByteSize at h.test"))
        m.restart()
        XCTAssertEqual(m.step, .scanning)
        XCTAssertNil(m.code)
    }

    func testAFailedSaveKeepsTheEditsToTryAgain() async throws {
        serve(save: .json(400, #"{"error":"Invalid request","details":[{"path":"name","message":"Give the food a name"}]}"#))
        let m = ScanModel(api: api)
        await m.scanned("0099999999999")
        await m.readLabel(jpeg: Data([1]))
        guard case .review(var draft, _) = m.step else { return XCTFail("\(m.step)") }
        draft.nutrients = Nutrients(["calories": 150])
        await m.save(draft)
        XCTAssertEqual(m.step, .review(draft, barcode: "0099999999999"), "back to the form, edits kept")
        XCTAssertEqual(m.message, "Give the food a name")
    }

    func testAfterLoggingBackToTheCamera() async {
        serve()
        let m = ScanModel(api: api)
        await m.scanned("0012345678905")
        m.logged("Banana")
        XCTAssertEqual(m.step, .scanning)
        XCTAssertNil(m.code)
        XCTAssertEqual(m.lastLogged, "Banana")
        await m.scanned("0099999999999", fromCamera: true) // the next product
        guard case .notFound = m.step else { return XCTFail("\(m.step)") }
    }

    func testTheProductJustLoggedIsntReadAgainByTheCamera() async {
        serve()
        var clock = Date(timeIntervalSince1970: 1_000)
        let m = ScanModel(api: api, now: { clock })
        await m.scanned("0012345678905", fromCamera: true)
        m.logged("Banana")
        await m.scanned("0012345678905", fromCamera: true) // still in front of the camera
        XCTAssertEqual(m.step, .scanning, "it would open the food just logged again")
        clock += 4
        await m.scanned("0012345678905", fromCamera: true) // a second one, on purpose
        guard case .found = m.step else { return XCTFail("\(m.step)") }
    }

    func testATypedBarcodeIsAlwaysLookedUp() async {
        serve()
        let m = ScanModel(api: api)
        await m.scanned("0012345678905", fromCamera: true)
        m.logged("Banana")
        await m.scanned("0012345678905") // typed
        guard case .found = m.step else { return XCTFail("\(m.step)") }
    }

    func testSavingAnEditedLabelMarksOnlyWhatTheAIRead() async throws {
        serve()
        let m = ScanModel(api: api)
        await m.scanned("0099999999999")
        await m.readLabel(jpeg: Data([1]))
        guard case .review(var draft, _) = m.step else { return XCTFail("\(m.step)") }
        draft.nutrients = Nutrients(["calories": 150, "protein_g": 3, "fat_g": 5])
        await m.save(draft)
        XCTAssertEqual(HTTPStub.requests.last?.json?["aiFields"] as? [String], ["fat_g", "protein_g"])
    }

    // 2026-11-22: the sources disagree on what a barcode is: pick from a short list (remembered for it), or none
    private nonisolated static let vague = #"{"kind":"cache","id":902,"name":"Hills bros","brand":"Hills Bros.","icon":"☕️","barcode":"0018400312944","servings":[{"label":"100 g","grams":100}],"nutrients":{"calories":417},"aiFields":[],"imageUrl":null,"override":false,"source":"off","foodKind":"custom","savedAt":null}"#
    private nonisolated static let real = #"{"kind":"cache","id":901,"name":"HILLS BROS, CAPPUCCINO","brand":"Hills Bros.","icon":"☕️","barcode":"0018400312944","servings":[{"label":"3 tbsp","grams":18}],"nutrients":{"calories":78},"aiFields":[],"imageUrl":null,"override":false,"source":"usda","foodKind":"custom","savedAt":null}"#

    private func serveChoices() {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/foods/barcode/0018400312944"):
                return .json(200, #"{"code":"0018400312944","food":\#(ScanModelTests.real),"errors":[],"choices":[\#(ScanModelTests.real),\#(ScanModelTests.vague)]}"#)
            case ("POST", "/api/foods/barcode/0018400312944/pick"): return .json(204, "")
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    func testSourcesThatDisagreeGiveAShortList() async {
        serveChoices()
        let m = ScanModel(api: api)
        await m.scanned("018400312944")
        guard case .choose(let foods, let code) = m.step else { return XCTFail("\(m.step)") }
        XCTAssertEqual(foods.map(\.name), ["HILLS BROS, CAPPUCCINO", "Hills bros"])
        XCTAssertEqual(code, "0018400312944")
    }

    func testPickingOneOpensItAndRemembersIt() async throws {
        serveChoices()
        let m = ScanModel(api: api)
        await m.scanned("018400312944")
        guard case .choose(let foods, _) = m.step else { return XCTFail("\(m.step)") }
        await m.pick(foods[1])
        guard case .found(let food) = m.step else { return XCTFail("\(m.step)") }
        XCTAssertEqual(food.name, "Hills bros")
        let pick = try XCTUnwrap(HTTPStub.requests.last { $0.request.url?.path() == "/api/foods/barcode/0018400312944/pick" })
        XCTAssertEqual(pick.request.httpMethod, "POST")
        XCTAssertEqual(pick.json?["id"] as? Int, 902)
    }

    func testNoneOfTheseGoesToTheLabelPhoto() async {
        serveChoices()
        let m = ScanModel(api: api)
        await m.scanned("018400312944")
        m.noneOfThese()
        XCTAssertEqual(m.step, .notFound("0018400312944"))
    }

    func testAgreeingSourcesOpenTheFoodAsBefore() async {
        serve()
        let m = ScanModel(api: api)
        await m.scanned("0012345678905")
        guard case .found = m.step else { return XCTFail("\(m.step)") }
    }
}
