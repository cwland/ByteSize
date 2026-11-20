import XCTest
@testable import ByteSizeKit

@MainActor
final class FoodLogModelTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let noon = ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")!

    private static let entry = #"{"entry":{"id":11,"day":"2026-11-19","meal":"breakfast","name":"Greek yogurt","brand":"Fage","icon":"🥣","servingIndex":0,"unit":"serving","quantity":1,"fraction":1,"servings":[{"label":"1 cup","grams":227}],"nutrients":{"calories":130},"aiEstimated":false,"source":"cache"}}"#

    private func serve(deleteStatus: Int = 204, restore: HTTPStub.Reply = .json(200, FoodLogModelTests.entry), patch: HTTPStub.Reply = .json(200, FoodLogModelTests.entry)) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            switch (req.httpMethod ?? "", path) {
            case ("GET", _) where path.hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            case ("PATCH", "/api/log/11"): return patch
            case ("DELETE", "/api/log/11"): return deleteStatus == 204 ? .raw(204, contentType: "", body: "") : .json(deleteStatus, #"{"error":"Entry not found"}"#)
            case ("POST", "/api/log/11/restore"): return restore
            case ("POST", "/api/log/move"): return .json(200, #"{"entries":[],"combined":[]}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func model() async -> (FoodLogModel, DayStore) {
        let days = DayStore(api: api, timeZone: denver, now: { self.noon })
        await days.select("2026-11-19")
        return (FoodLogModel(api: api, dayStore: days), days)
    }

    private func requests(_ method: String, _ path: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && $0.request.url?.path() == path }
    }

    private func entry(_ id: Int, in days: DayStore) throws -> LogEntry { try XCTUnwrap(days.day?.entries.first { $0.id == id }) }

    func testSectionsInMealOrderSkippingEmptyMeals() async {
        serve()
        let (m, _) = await model()
        XCTAssertEqual(m.sections.map(\.meal), [.breakfast, .lunch, .supplements])
        XCTAssertEqual(m.sections[0].entries.map(\.id), [11])
        XCTAssertEqual(m.sections[0].totals?.calories, 260)
    }

    func testUpdateSendsOnlyChangesAndReloads() async throws {
        serve()
        let (m, days) = await model()
        HTTPStub.requests = []
        await m.update(try entry(11, in: days), quantity: 1, fraction: 0.5, servingIndex: 0)
        let patch = try XCTUnwrap(requests("PATCH", "/api/log/11").first)
        XCTAssertEqual(patch.json?.keys.sorted(), ["fraction", "quantity"]) // serving unchanged
        XCTAssertEqual(patch.json?["quantity"] as? Double, 1)
        XCTAssertFalse(requests("GET", "/api/day/2026-11-19").isEmpty)
    }

    func testMoveAndCopy() async throws {
        serve()
        let (m, days) = await model()
        HTTPStub.requests = []
        await m.move(try entry(11, in: days), to: "2026-11-20", meal: .lunch)
        var body = try XCTUnwrap(requests("POST", "/api/log/move").last?.json)
        XCTAssertEqual(body["ids"] as? [Int], [11])
        XCTAssertEqual(body["day"] as? String, "2026-11-20")
        XCTAssertEqual(body["meal"] as? String, "lunch")
        XCTAssertEqual(body["copy"] as? Bool, false)
        await m.copy(try entry(11, in: days), to: "2026-11-19", meal: .dinner)
        body = try XCTUnwrap(requests("POST", "/api/log/move").last?.json)
        XCTAssertEqual(body["copy"] as? Bool, true)
        XCTAssertEqual(requests("GET", "/api/day/2026-11-19").count, 2, "reloaded after each")
    }

    func testDeleteOffersUndoAndUndoRestores() async throws {
        serve()
        let (m, days) = await model()
        let yogurt = try entry(11, in: days)
        await m.delete(yogurt)
        XCTAssertEqual(requests("DELETE", "/api/log/11").count, 1)
        XCTAssertEqual(m.undo, UndoOffer(entryId: 11, name: "Greek yogurt"))
        await m.undoDelete()
        XCTAssertEqual(requests("POST", "/api/log/11/restore").count, 1)
        XCTAssertNil(m.undo)
        XCTAssertNil(m.message)
        XCTAssertGreaterThanOrEqual(requests("GET", "/api/day/2026-11-19").count, 3) // select + after delete + after undo
    }

    func testUndoTooLate() async throws {
        serve(restore: .json(404, #"{"error":"That's too late to undo"}"#))
        let (m, days) = await model()
        await m.delete(try entry(11, in: days))
        await m.undoDelete()
        XCTAssertEqual(m.message, "That's too late to undo")
        XCTAssertNil(m.undo)
    }

    func testDismissUndo() async throws {
        serve()
        let (m, days) = await model()
        await m.delete(try entry(11, in: days))
        m.dismissUndo()
        XCTAssertNil(m.undo)
    }

    func testAFailedWriteShowsTheServersWords() async throws {
        serve(patch: .json(400, #"{"error":"Invalid request","details":[{"path":"quantity","message":"Enter an amount above 0"}]}"#))
        let (m, days) = await model()
        await m.update(try entry(11, in: days), quantity: 0, fraction: 1, servingIndex: 0)
        XCTAssertEqual(m.message, "Enter an amount above 0")
        XCTAssertEqual(days.day?.entries.count, 3)
    }

    func testAFailedDeleteOffersNoUndo() async throws {
        serve(deleteStatus: 404)
        let (m, days) = await model()
        await m.delete(try entry(11, in: days))
        XCTAssertNil(m.undo)
        XCTAssertEqual(m.message, "Entry not found")
    }

    func testEditingWithTheWheelSendsTheWholePortion() async throws {
        serve()
        let (m, days) = await model()
        let e = try entry(11, in: days)
        let portion = PortionModel(entry: e)
        portion.whole = 3
        portion.fraction = 0.5
        HTTPStub.requests = []
        await m.update(e, portion: portion)
        let patch = try XCTUnwrap(requests("PATCH", "/api/log/11").first?.json)
        XCTAssertEqual(patch.keys.sorted(), ["fraction", "quantity", "servingIndex", "unit"])
        XCTAssertEqual(patch["quantity"] as? Double, 3.5)
        XCTAssertEqual(patch["fraction"] as? Double, 1)
        XCTAssertEqual(patch["unit"] as? String, "serving")
        XCTAssertFalse(requests("GET", "/api/day/2026-11-19").isEmpty, "the day reloads")
    }
}
