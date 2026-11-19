import XCTest
@testable import ByteSizeKit

final class LogAPITests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let entryJSON = #"{"entry":{"id":13,"day":"2026-11-19","meal":"supplements","name":"Water","brand":null,"icon":"💧","servingIndex":0,"unit":"ml","quantity":250,"fraction":1,"servings":[{"label":"1 ml","ml":1}],"nutrients":{"water_ml":250},"aiEstimated":false,"source":"water"}}"#

    private func sent() -> HTTPStub.Recorded { HTTPStub.requests.last! }

    func testDay() async throws {
        HTTPStub.routes(["/api/day/2026-11-19": .json(200, Fixtures.day)])
        let d = try await api.send(LogAPI.day("2026-11-19"))
        XCTAssertEqual(d.entries.count, 3)
    }

    func testLogged() async throws {
        HTTPStub.routes(["/api/days/logged": .json(200, #"{"days":["2026-11-16","2026-11-18"]}"#)])
        let r = try await api.send(LogAPI.logged(from: "2026-11-15", to: "2026-11-21"))
        XCTAssertEqual(r.days, ["2026-11-16", "2026-11-18"])
        XCTAssertEqual(sent().request.url?.query(), "from=2026-11-15&to=2026-11-21")
    }

    func testWater() async throws {
        HTTPStub.routes(["/api/log": .json(200, entryJSON)])
        let r = try await api.send(LogAPI.water(ml: 250, day: "2026-11-19"))
        XCTAssertEqual(r.entry.quantity, 250)
        XCTAssertEqual(sent().request.httpMethod, "POST")
        XCTAssertEqual(sent().json?["water_ml"] as? Int, 250)
        XCTAssertEqual(sent().json?["day"] as? String, "2026-11-19")
    }

    func testUpdateSendsOnlyGivenFields() async throws {
        HTTPStub.routes(["/api/log/13": .json(200, entryJSON)])
        _ = try await api.send(LogAPI.update(id: 13, quantity: 2, fraction: nil, servingIndex: nil))
        XCTAssertEqual(sent().request.httpMethod, "PATCH")
        XCTAssertEqual(sent().json?.keys.sorted(), ["quantity"])
        _ = try await api.send(LogAPI.update(id: 13, quantity: 1, fraction: 0.5, servingIndex: 1))
        XCTAssertEqual(sent().json?.keys.sorted(), ["fraction", "quantity", "servingIndex"])
    }

    func testDeleteRestoreMove() async throws {
        let entryJSON = self.entryJSON
        HTTPStub.handler = { req in
            switch (req.httpMethod, req.url?.path()) {
            case ("DELETE", "/api/log/13"): return .raw(204, contentType: "", body: "")
            case ("POST", "/api/log/13/restore"): return .json(200, entryJSON)
            case ("POST", "/api/log/move"): return .json(200, #"{"entries":[],"combined":[]}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
        _ = try await api.send(LogAPI.delete(id: 13))
        XCTAssertEqual(sent().request.httpMethod, "DELETE")
        let back = try await api.send(LogAPI.restore(id: 13))
        XCTAssertEqual(back.entry.id, 13)
        _ = try await api.send(LogAPI.move(ids: [11, 12], day: "2026-11-20", meal: .dinner, copy: true))
        XCTAssertEqual(sent().json?["ids"] as? [Int], [11, 12])
        XCTAssertEqual(sent().json?["day"] as? String, "2026-11-20")
        XCTAssertEqual(sent().json?["meal"] as? String, "dinner")
        XCTAssertEqual(sent().json?["copy"] as? Bool, true)
    }

    func testBodyCalls() async throws {
        HTTPStub.handler = { req in
            switch (req.httpMethod, req.url?.path()) {
            case ("GET", "/api/settings/me"): return .json(200, #"{"mealWindows":{},"waterButtonsMl":[237,473],"weekStart":1,"dateFormat":"mdy","glp1On":true}"#)
            case ("GET", "/api/weight"): return .json(200, #"{"weighIns":[{"day":"2026-11-12","weightKg":83.0,"trendKg":83.1,"note":null},{"day":"2026-11-19","weightKg":82.28,"trendKg":82.6,"note":null}],"start":{"day":"2026-11-12","weightKg":83.0},"latest":{"day":"2026-11-19","weightKg":82.28},"trendKg":82.6,"goalKg":75,"lostKg":0.4}"#)
            case ("PUT", "/api/weigh-ins/2026-11-19"): return .json(200, #"{"weighIn":{"day":"2026-11-19","weightKg":82.28,"note":null}}"#)
            case ("GET", "/api/glp1"): return .json(200, #"{"settings":{"medication":"tirzepatide","doseMg":5,"injectionWeekday":2},"lastShot":{"day":"2026-11-13","medication":"tirzepatide","doseMg":5,"site":"abdomen_left","note":null},"nextDue":"2026-11-20","status":"upcoming","overdueDays":0,"suggestedSite":"abdomen_right","shots":[],"doseHistory":[]}"#)
            case ("PUT", "/api/glp1/shots/2026-11-19"): return .json(200, #"{"ok":true}"#)
            case ("GET", "/api/badges"): return .json(200, #"{"badges":[{"id":"first_weigh_in","earnedOn":"2026-11-02","seen":true},{"id":"lost_5","earnedOn":null,"seen":false},{"id":"goal_met","earnedOn":null,"seen":false,"count":0}],"new":[]}"#)
            case ("GET", "/api/layouts/ios"): return .json(200, #"{"layout":{"version":1,"columns":[["water","overview"]]}}"#)
            case ("PUT", "/api/layouts/ios"): return .json(200, #"{"layout":{"version":1,"columns":[["streak"]]}}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
        let me = try await api.send(BodyAPI.settings())
        XCTAssertEqual(me.waterButtonsMl, [237, 473])
        XCTAssertEqual(me.weekStart, 1)
        XCTAssertTrue(me.glp1On)

        let w = try await api.send(BodyAPI.weight(from: "2026-08-21"))
        XCTAssertEqual(w.latest?.weightKg, 82.28)
        XCTAssertEqual(w.weighIns.count, 2)
        XCTAssertEqual(sent().request.url?.query(), "from=2026-08-21")

        _ = try await api.send(BodyAPI.saveWeight(day: "2026-11-19", kg: 82.28))
        XCTAssertEqual(sent().json?["weightKg"] as? Double, 82.28)

        let g = try await api.send(BodyAPI.glp1())
        XCTAssertEqual(g.status, "upcoming")
        XCTAssertEqual(g.suggestedSite, "abdomen_right")
        XCTAssertEqual(g.lastShot?.doseMg, 5)

        _ = try await api.send(BodyAPI.logShot(day: "2026-11-19", site: "abdomen_right"))
        XCTAssertEqual(sent().request.httpMethod, "PUT")
        XCTAssertEqual(sent().json?["site"] as? String, "abdomen_right")

        let b = try await api.send(BodyAPI.badges())
        XCTAssertEqual(b.badges.first?.earnedOn, "2026-11-02")
        XCTAssertNil(b.badges[1].earnedOn)

        let layout = try await api.send(BodyAPI.layout())
        XCTAssertEqual(layout.layout?.columns, [["water", "overview"]])
        _ = try await api.send(BodyAPI.saveLayout(["streak"]))
        XCTAssertEqual(sent().json?["version"] as? Int, 1)
        XCTAssertEqual(sent().json?["columns"] as? [[String]], [["streak"]])
    }
}
