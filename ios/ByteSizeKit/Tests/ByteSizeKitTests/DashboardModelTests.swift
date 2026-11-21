import XCTest
@testable import ByteSizeKit

@MainActor
final class DashboardModelTests: XCTestCase {
    private let boise = TimeZone(identifier: "America/Boise")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let noon = ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")!

    /// A small server: settings, layout, weight, GLP-1, badges, a day, and the writes.
    private func serve(layout: String = #"{"layout":null}"#, glp1On: Bool = true, weightError: Bool = false) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/settings/me"): return .json(200, #"{"waterButtonsMl":[237,473],"weekStart":0,"glp1On":\#(glp1On)}"#)
            case ("GET", "/api/layouts/ios"): return .json(200, layout)
            case ("PUT", "/api/layouts/ios"): return .json(200, #"{"layout":{"version":1,"columns":[[]]}}"#)
            case ("GET", "/api/weight"): return .json(200, #"{"weighIns":[{"day":"2026-11-12","weightKg":83.0,"trendKg":83.1},{"day":"2026-11-19","weightKg":82.28,"trendKg":82.6}],"latest":{"day":"2026-11-19","weightKg":82.28},"goalKg":75}"#)
            case ("PUT", _) where req.url!.path().hasPrefix("/api/weigh-ins/"):
                return weightError ? .json(400, #"{"error":"Invalid request","details":[{"path":"weightKg","message":"Enter a weight between 30 and 350 kg"}]}"#) : .json(200, #"{"weighIn":{}}"#)
            case ("GET", "/api/glp1"): return .json(200, #"{"settings":null,"lastShot":{"day":"2026-11-13","medication":"Zepbound","doseMg":5,"site":"abdomen_left"},"nextDue":"2026-11-20","status":"upcoming","overdueDays":0,"suggestedSite":"abdomen_right"}"#)
            case ("PUT", _) where req.url!.path().hasPrefix("/api/glp1/shots/"): return .json(200, #"{"ok":true}"#)
            case ("GET", "/api/badges"): return .json(200, #"{"badges":[{"id":"first_weigh_in","earnedOn":"2026-11-02"},{"id":"lost_5","earnedOn":"2026-11-15"},{"id":"halfway","earnedOn":null},{"id":"streak_7","earnedOn":"2026-11-10"},{"id":"streak_14","earnedOn":"2026-11-17"},{"id":"streak_30","earnedOn":"2026-11-18"}]}"#)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            case ("GET", _) where req.url!.path().hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("POST", "/api/log"): return .json(200, #"{"entry":{"id":99,"day":"2026-11-19","meal":"supplements","name":"Water","brand":null,"icon":"💧","servingIndex":0,"unit":"ml","quantity":237,"fraction":1,"servings":[],"nutrients":{"water_ml":237},"aiEstimated":false,"source":"water"}}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func model(units: Units = .imperial) -> (DashboardModel, DayStore) {
        let days = DayStore(api: api, timeZone: boise, now: { self.noon })
        return (DashboardModel(api: api, dayStore: days, units: units), days)
    }

    private func requests(_ method: String, _ path: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && $0.request.url?.path() == path }
    }

    func testDefaultLayout() async {
        serve()
        let (m, _) = model()
        await m.load()
        XCTAssertEqual(m.widgets, DashboardWidget.allCases)
        XCTAssertEqual(m.waterButtonsMl, [237, 473])
        XCTAssertEqual(m.weight?.latest?.weightKg, 82.28)
        XCTAssertEqual(m.glp1?.suggestedSite, "abdomen_right")
    }

    func testShotsHiddenByDefaultWithoutGlp1() async {
        serve(glp1On: false)
        let (m, _) = model()
        await m.load()
        XCTAssertFalse(m.widgets.contains(.shots))
        XCTAssertEqual(m.hidden, [.shots])
        XCTAssertNil(m.glp1)
    }

    func testSavedLayoutDropsUnknownIds() async {
        serve(layout: #"{"layout":{"version":1,"columns":[["water","overview","food"]]}}"#)
        let (m, _) = model()
        await m.load()
        XCTAssertEqual(m.widgets, [.water, .overview])
        XCTAssertEqual(m.hidden, [.calendar, .weight, .streak, .badges, .shots])
    }

    func testEditAndSave() async throws {
        serve()
        let (m, _) = model()
        await m.load()
        m.startEditing()
        XCTAssertTrue(m.editing)
        m.remove(.badges)
        m.move(from: IndexSet(integer: 1), to: 0) // overview to the top
        m.add(.badges)
        await m.finishEditing()
        XCTAssertFalse(m.editing)
        XCTAssertEqual(m.widgets, [.overview, .calendar, .water, .weight, .streak, .shots, .badges])
        let put = try XCTUnwrap(requests("PUT", "/api/layouts/ios").last)
        XCTAssertEqual(put.json?["version"] as? Int, 1)
        XCTAssertEqual(put.json?["columns"] as? [[String]], [["overview", "calendar", "water", "weight", "streak", "shots", "badges"]])
    }

    func testCancelEditing() async {
        serve()
        let (m, _) = model()
        await m.load()
        m.startEditing()
        m.remove(.water)
        m.cancelEditing()
        XCTAssertEqual(m.widgets, DashboardWidget.allCases)
        XCTAssertTrue(requests("PUT", "/api/layouts/ios").isEmpty)
    }

    func testAddWaterLogsToTheSelectedDayAndReloads() async throws {
        serve()
        let (m, days) = model()
        await days.select("2026-11-18")
        HTTPStub.requests = []
        await m.addWater(ml: 237)
        let post = try XCTUnwrap(requests("POST", "/api/log").first)
        XCTAssertEqual(post.json?["water_ml"] as? Int, 237)
        XCTAssertEqual(post.json?["day"] as? String, "2026-11-18")
        XCTAssertFalse(requests("GET", "/api/day/2026-11-18").isEmpty, "the day reloads")
    }

    func testLogWeightConvertsFromPounds() async throws {
        serve()
        let (m, _) = model(units: .imperial)
        try await m.logWeight(display: 181.4)
        let put = try XCTUnwrap(requests("PUT", "/api/weigh-ins/2026-11-19").first)
        XCTAssertEqual(try XCTUnwrap(put.json?["weightKg"] as? Double), 82.28, accuracy: 0.01)
        XCTAssertFalse(requests("GET", "/api/weight").isEmpty, "weight reloads")
    }

    func testLogWeightErrorIsShown() async {
        serve(weightError: true)
        let (m, _) = model()
        do {
            try await m.logWeight(display: 10)
            XCTFail("should throw")
        } catch {
            XCTAssertEqual((error as? APIError)?.message, "Enter a weight between 30 and 350 kg")
        }
    }

    func testLogShotOnTodayAndReload() async throws {
        serve()
        let (m, days) = model()
        await m.load()
        await days.select("2026-11-17") // looking at another day: the shot is still today's
        HTTPStub.requests = []
        let view = try XCTUnwrap(m.glp1)
        let form = ShotForm(view: view, today: days.today)
        form.site = "abdomen_right"
        try await m.logShot(form)
        let put = try XCTUnwrap(requests("PUT", "/api/glp1/shots/2026-11-19").first)
        XCTAssertEqual(put.json?["site"] as? String, "abdomen_right")
        XCTAssertFalse(requests("GET", "/api/glp1").isEmpty)
    }

    func testBadgesNewestEarnedFirstAtMostFour() async {
        serve()
        let (m, _) = model()
        await m.load()
        XCTAssertEqual(m.badges.map(\.id), ["streak_30", "streak_14", "lost_5", "streak_7"])
    }

    func testNoWaterOnAFutureDay() async {
        serve()
        let (m, days) = model()
        await days.select("2026-11-20")
        HTTPStub.requests = []
        await m.addWater(ml: 237)
        XCTAssertTrue(requests("POST", "/api/log").isEmpty)
    }
}
