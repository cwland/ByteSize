import XCTest
@testable import ByteSizeKit

@MainActor
final class AccountSettingsModelTests: XCTestCase {
    private let server = ServerAddress("https://h.test")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let denver = TimeZone(identifier: "America/Denver")!
    nonisolated private static let orderError = "Meal times must go breakfast, lunch, snacks, dinner, each later than the one before"
    nonisolated private static let settingsJSON = #"{"mealWindows":{"breakfast":"10:30","lunch":"14:30","snacks":"17:00","dinner":"21:00"},"waterButtonsMl":[237,473],"weekStart":0,"dateFormat":"weekday-long-month-short","glp1On":false}"#

    private var session: SessionStore!
    private var days: DayStore!

    override func setUp() async throws {
        HTTPStub.requests = []
        let defaults = UserDefaults(suiteName: "AccountSettingsModelTests-\(UUID().uuidString)")!
        session = SessionStore(tokens: InMemoryTokenStore(), defaults: defaults, session: HTTPStub.session)
        HTTPStub.routes(["/api/auth/login": .json(200, #"{"token":"abc","user":\#(AuthServiceTests.userJSON)}"#)])
        try await session.signIn(server: server, username: "alex", password: "pw")
        days = DayStore(api: api, timeZone: denver)
    }

    /// GET answers the saved settings; PUT echoes the body (or the order error); PATCH /api/profile returns the user with the units sent.
    private func serve(putError: Bool = false, getError: Bool = false, meUnits: String = "imperial") {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let body = HTTPStub.requests.last?.body ?? Data() // the stub read the body stream when it recorded the request
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/settings/me"): return getError ? .json(500, #"{"error":"Something went wrong"}"#) : .json(200, Self.settingsJSON)
            case ("GET", "/api/auth/me"):
                return .json(200, #"{"user":\#(AuthServiceTests.userJSON.replacingOccurrences(of: #""units":"imperial""#, with: #""units":"\#(meUnits)""#))}"#)
            case ("PUT", "/api/settings/me"):
                if putError { return .json(400, #"{"error":"\#(Self.orderError)"}"#) }
                var json = (try? JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:]
                json["glp1On"] = false
                let data = (try? JSONSerialization.data(withJSONObject: json)) ?? Data()
                return .json(200, String(decoding: data, as: UTF8.self))
            case ("PATCH", "/api/profile"):
                let units = ((try? JSONSerialization.jsonObject(with: body)) as? [String: Any])?["units"] as? String ?? "imperial"
                return .json(200, #"{"user":\#(AuthServiceTests.userJSON.replacingOccurrences(of: #""units":"imperial""#, with: #""units":"\#(units)""#))}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func model() -> AccountSettingsModel { AccountSettingsModel(api: api, dayStore: days, session: session) }

    private func sent(_ method: String, _ path: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && $0.request.url?.path() == path }
    }

    func testControlsDisabledUntilLoaded() async {
        serve()
        let m = model()
        XCTAssertNil(m.settings)
        await m.load()
        XCTAssertEqual(m.settings?.weekStart, 0)
        XCTAssertEqual(m.units, .imperial)
    }

    func testSetWeekStartSendsFullSettings() async throws {
        serve()
        let m = model()
        await m.load()
        await m.setWeekStart(1)
        let put = try XCTUnwrap(sent("PUT", "/api/settings/me").last?.json)
        XCTAssertEqual(put["weekStart"] as? Int, 1)
        XCTAssertEqual(put["waterButtonsMl"] as? [Int], [237, 473])
        XCTAssertEqual(put["dateFormat"] as? String, "weekday-long-month-short")
        XCTAssertEqual((put["mealWindows"] as? [String: String])?["lunch"], "14:30")
        XCTAssertEqual(days.weekStart, 1)
        XCTAssertEqual(m.settings?.weekStart, 1)
        XCTAssertNil(m.message)
    }

    func testSetDateFormatAppliesToDayStore() async throws {
        serve()
        let m = model()
        await m.load()
        await m.setDateFormat(.iso)
        XCTAssertEqual(sent("PUT", "/api/settings/me").last?.json?["dateFormat"] as? String, "iso")
        XCTAssertEqual(days.dateFormat, .iso)
    }

    func testSetMealWindowsAppliesToDayStore() async throws {
        serve()
        let m = model()
        await m.load()
        let w = MealWindows(breakfast: "09:00", lunch: "13:00", snacks: "16:30", dinner: "20:00")
        await m.setMealWindows(w)
        XCTAssertEqual((sent("PUT", "/api/settings/me").last?.json?["mealWindows"] as? [String: String])?["lunch"], "13:00")
        XCTAssertEqual(days.mealWindows, w)
        XCTAssertEqual(m.settings?.mealWindows, w)
    }

    func testOutOfOrderMealTimesRestore() async {
        serve(putError: true)
        let m = model()
        await m.load()
        await m.setMealWindows(MealWindows(breakfast: "10:30", lunch: "08:00", snacks: "17:00", dinner: "21:00"))
        XCTAssertEqual(m.settings?.mealWindows, .defaults)
        XCTAssertEqual(days.mealWindows, .defaults)
        XCTAssertEqual(m.message, Self.orderError)
    }

    func testResetMealWindowsSendsDefaults() async {
        serve()
        let m = model()
        await m.load()
        await m.setMealWindows(MealWindows(breakfast: "09:00", lunch: "13:00", snacks: "16:30", dinner: "20:00"))
        await m.resetMealWindows()
        XCTAssertEqual((sent("PUT", "/api/settings/me").last?.json?["mealWindows"] as? [String: String])?["breakfast"], "10:30")
        XCTAssertEqual(days.mealWindows, .defaults)
    }

    func testSetUnitsPatchesProfileAndUpdatesSession() async throws {
        serve()
        let m = model()
        await m.load()
        await m.setUnits(.metric)
        XCTAssertEqual(sent("PATCH", "/api/profile").last?.json?["units"] as? String, "metric")
        guard case .signedIn(let user) = session.state else { return XCTFail("not signed in") }
        XCTAssertEqual(user.units, "metric")
        XCTAssertEqual(m.units, .metric)
    }

    func testLoadClearsAnOldMessage() async {
        serve(getError: true)
        let m = model()
        await m.load()
        XCTAssertEqual(m.message, "Something went wrong")
        serve()
        await m.load()
        XCTAssertNil(m.message, "settings loaded fine this time")
    }

    func testRefreshPicksUpChangesMadeOnTheWeb() async {
        serve(meUnits: "metric")
        let m = model()
        await m.refresh()
        guard case .signedIn(let user) = session.state else { return XCTFail("not signed in") }
        XCTAssertEqual(user.units, "metric", "units changed on the web")
        XCTAssertEqual(m.settings?.weekStart, 0)
        XCTAssertEqual(days.mealWindows, .defaults)
    }

    func testRefreshLeavesTheSameAccountAlone() async {
        serve()
        let m = model()
        guard case .signedIn(let before) = session.state else { return XCTFail("not signed in") }
        await m.refresh()
        guard case .signedIn(let after) = session.state else { return XCTFail("not signed in") }
        XCTAssertEqual(before, after)
    }
}
