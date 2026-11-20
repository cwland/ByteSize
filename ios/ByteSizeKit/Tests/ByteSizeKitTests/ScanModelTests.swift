import XCTest
@testable import ByteSizeKit

@MainActor
final class ScanModelTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private static let saved = #"{"kind":"user_food","id":9,"name":"Wheat crackers","brand":"Acme","icon":"🍘","barcode":"0099999999999","servings":[{"label":"2 crackers","grams":30}],"nutrients":{"calories":140},"aiFields":["calories"],"imageUrl":null,"override":false,"source":"mine","foodKind":"custom"}"#

    /// A server that knows 0012345678905, and 0099999999999 only once a food has been saved for it.
    private func serve(label: HTTPStub.Reply = .json(200, #"{"photoIds":["p1"],"draft":\#(FoodFixtures.draft),"errors":[],"labelReading":true}"#), lookup: HTTPStub.Reply? = nil) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            let savedYet = HTTPStub.requests.contains { $0.request.httpMethod == "POST" && $0.request.url?.path() == "/api/my-foods" }
            switch (req.httpMethod ?? "", path) {
            case ("GET", "/api/foods/barcode/0012345678905"): return lookup ?? .json(200, #"{"code":"0012345678905","food":\#(FoodFixtures.banana),"errors":[]}"#)
            case ("GET", "/api/foods/barcode/0099999999999"):
                return .json(200, savedYet ? #"{"code":"0099999999999","food":\#(ScanModelTests.saved),"errors":[]}"# : #"{"code":"0099999999999","food":null,"errors":[]}"#)
            case ("POST", "/api/photos/analyze"): return label
            case ("POST", "/api/my-foods"): return .json(200, #"{"food":\#(ScanModelTests.saved)}"#)
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
}
