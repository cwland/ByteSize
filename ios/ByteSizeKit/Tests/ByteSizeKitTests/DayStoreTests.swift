import XCTest
@testable import ByteSizeKit

@MainActor
final class DayStoreTests: XCTestCase {
    private let boise = TimeZone(identifier: "America/Boise")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    /// 2026-11-20 06:30 UTC = 2026-11-19 23:30 in Boise
    private let lateEvening = ISO8601DateFormatter().date(from: "2026-11-20T06:30:00Z")!

    private func dayJSON(_ day: String) -> String { Fixtures.day.replacingOccurrences(of: "2026-11-19", with: day) }

    /// Answers any /api/day/<d> with that day, and logged days with one day.
    private func serveDays(delay: [String: TimeInterval] = [:]) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            if path.hasPrefix("/api/day/") {
                let d = String(path.dropFirst("/api/day/".count))
                let answer = HTTPStub.Reply.json(200, self.dayJSON(d))
                return delay[d].map { .delayed($0, answer) } ?? answer
            }
            if path == "/api/days/logged" { return .json(200, #"{"days":["2026-11-17"]}"#) }
            return .json(404, #"{"error":"Not found"}"#)
        }
    }

    private func store(weekStart: Int = 0) -> DayStore {
        DayStore(api: api, timeZone: boise, weekStart: weekStart, now: { self.lateEvening })
    }

    func testTodayIsTheAccountsDay() {
        let s = store()
        XCTAssertEqual(s.today, "2026-11-19")
        XCTAssertEqual(s.selected, "2026-11-19")
    }

    func testWeekStartingSunday() {
        XCTAssertEqual(store().week(containing: "2026-11-19"), ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"])
    }

    func testWeekStartingMonday() {
        XCTAssertEqual(store(weekStart: 1).week(containing: "2026-11-19"), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"])
        XCTAssertEqual(store(weekStart: 1).week(containing: "2026-11-16").first, "2026-11-16")
    }

    func testAddDays() {
        XCTAssertEqual(DayMath.add(1, to: "2026-11-30"), "2026-12-01")
        XCTAssertEqual(DayMath.add(-1, to: "2026-03-01"), "2026-02-28")
    }

    func testSelectLoadsTheDayAndTheWeeksLoggedDays() async {
        serveDays()
        let s = store()
        await s.select("2026-11-18")
        XCTAssertEqual(s.selected, "2026-11-18")
        XCTAssertEqual(s.day?.day, "2026-11-18")
        XCTAssertEqual(s.loggedDays, ["2026-11-17"])
        let logged = HTTPStub.requests.first { $0.request.url?.path() == "/api/days/logged" }
        XCTAssertEqual(logged?.request.url?.query(), "from=2026-11-15&to=2026-11-21")
        XCTAssertFalse(s.loading)
        XCTAssertNil(s.error)
    }

    func testALateAnswerForAnEarlierDayIsIgnored() async {
        serveDays(delay: ["2026-11-17": 0.4])
        let s = store()
        let slow = Task { await s.select("2026-11-17") }
        try? await Task.sleep(for: .milliseconds(50))
        await s.select("2026-11-18")
        await slow.value
        XCTAssertEqual(s.selected, "2026-11-18")
        XCTAssertEqual(s.day?.day, "2026-11-18")
    }

    func testReloadKeepsTheDay() async {
        serveDays()
        let s = store()
        await s.select("2026-11-18")
        HTTPStub.requests = []
        await s.reload()
        XCTAssertEqual(s.day?.day, "2026-11-18")
        XCTAssertEqual(HTTPStub.requests.first?.request.url?.path(), "/api/day/2026-11-18")
    }

    func testAFailedLoadKeepsWhatWasShown() async {
        serveDays()
        let s = store()
        await s.select("2026-11-18")
        HTTPStub.handler = { _ in .fail(.notConnectedToInternet) }
        await s.reload()
        XCTAssertEqual(s.day?.day, "2026-11-18")
        XCTAssertEqual(s.error, "Can't reach ByteSize at h.test")
    }

    func testShiftWeek() async {
        serveDays()
        let s = store()
        await s.select("2026-11-18")
        await s.shiftWeek(-1)
        XCTAssertEqual(s.selected, "2026-11-11")
    }
}
