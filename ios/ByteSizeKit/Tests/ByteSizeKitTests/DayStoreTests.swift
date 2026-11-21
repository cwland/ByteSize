import XCTest
@testable import ByteSizeKit

@MainActor
final class DayStoreTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    /// 2026-11-20 06:30 UTC = 2026-11-19 23:30 in Denver
    private let lateEvening = ISO8601DateFormatter().date(from: "2026-11-20T06:30:00Z")!

    private nonisolated static func dayJSON(_ day: String) -> String { Fixtures.day.replacingOccurrences(of: "2026-11-19", with: day) }

    /// Answers any /api/day/<d> with that day, and logged days with one day.
    private func serveDays(delay: [String: TimeInterval] = [:]) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            if path.hasPrefix("/api/day/") {
                let d = String(path.dropFirst("/api/day/".count))
                let answer = HTTPStub.Reply.json(200, DayStoreTests.dayJSON(d))
                if let wait = delay[d] { return .delayed(wait, answer) }
                return answer
            }
            if path == "/api/days/logged" { return .json(200, #"{"days":["2026-11-17"]}"#) }
            return .json(404, #"{"error":"Not found"}"#)
        }
    }

    private func store(weekStart: Int = 0) -> DayStore {
        DayStore(api: api, timeZone: denver, weekStart: weekStart, now: { self.lateEvening })
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
        XCTAssertEqual(logged?.request.url?.query(), "from=2026-10-18&to=2026-11-26", "a window around the day, at most a week ahead")
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
        // the day and its week's logged days load together (either may go first)
        XCTAssertTrue(HTTPStub.requests.contains { $0.request.url?.path() == "/api/day/2026-11-18" })
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

    func testAFailedSwitchDoesNotShowTheOldDayUnderTheNewDate() async {
        serveDays()
        let s = store()
        await s.select("2026-11-18")
        HTTPStub.handler = { _ in .fail(.notConnectedToInternet) }
        await s.select("2026-11-19")
        XCTAssertEqual(s.selected, "2026-11-19")
        XCTAssertNil(s.day, "Wednesday's entries must not show under Thursday")
        XCTAssertEqual(s.error, "Can't reach ByteSize at h.test")
    }

    // MARK: - Today polish (SPEC-03/04): the strip's range, the day cache, logged-day windows

    func testStripRunsAYearBackToAWeekAhead() {
        let s = store()
        XCTAssertEqual(s.stripDays.first, "2025-11-19")
        XCTAssertEqual(s.stripDays.last, "2026-11-26")
        XCTAssertEqual(s.stripDays.count, 373)
        XCTAssertTrue(s.canSelect("2026-11-19"))
        XCTAssertTrue(s.canSelect("2025-11-19"))
        XCTAssertTrue(s.canSelect("2026-11-20"), "tomorrow can be chosen to pre-log food")
        XCTAssertTrue(s.canSelect("2026-11-26"))
        XCTAssertFalse(s.canSelect("2026-11-27"))
        XCTAssertFalse(s.canSelect("2025-11-18"))
    }

    func testADayPastTheStripIsntSelected() async {
        serveDays()
        let s = store()
        await s.select("2026-11-27")
        XCTAssertEqual(s.selected, "2026-11-19")
        XCTAssertFalse(HTTPStub.requests.contains { $0.request.url?.path() == "/api/day/2026-11-27" })
    }

    func testTomorrowIsFuture() async {
        serveDays()
        let s = store()
        XCTAssertTrue(s.isFuture("2026-11-20"))
        XCTAssertFalse(s.isFuture("2026-11-19"))
        XCTAssertFalse(s.selectedIsFuture)
        await s.select("2026-11-21")
        XCTAssertEqual(s.selected, "2026-11-21")
        XCTAssertTrue(s.selectedIsFuture)
    }

    func testRolloverMakesTomorrowToday() async {
        serveDays()
        let clock = Clock(ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")!) // Nov 19, noon in Denver
        let s = DayStore(api: api, timeZone: denver, now: { clock.now })
        await s.select("2026-11-20")
        XCTAssertTrue(s.selectedIsFuture)
        XCTAssertFalse(s.canSelect("2026-11-27"))
        clock.now = ISO8601DateFormatter().date(from: "2026-11-20T15:00:00Z")! // Nov 20, 8 am
        await s.dayMayHaveChanged()
        XCTAssertFalse(s.selectedIsFuture)
        XCTAssertTrue(s.canSelect("2026-11-27"))
    }

    func testSwitchingToALoadedDayShowsItAtOnce() async {
        serveDays()
        let s = store()
        await s.select("2026-11-18")
        await s.select("2026-11-19")
        serveDays(delay: ["2026-11-18": 0.4])
        let back = Task { await s.select("2026-11-18") }
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(s.day?.day, "2026-11-18", "shown from the cache while it refreshes")
        XCTAssertEqual(s.dayIsFor, "2026-11-18")
        await back.value
        XCTAssertTrue(HTTPStub.requests.contains { $0.request.url?.path() == "/api/day/2026-11-18" }, "and refreshed quietly")
    }

    func testSwitchingToANewDayKeepsThePreviousDayOnScreen() async {
        serveDays(delay: ["2026-11-17": 0.4])
        let s = store()
        await s.select("2026-11-19")
        let next = Task { await s.select("2026-11-17") }
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(s.day?.day, "2026-11-19", "no empty state between days")
        XCTAssertEqual(s.dayIsFor, "2026-11-19")
        XCTAssertEqual(s.selected, "2026-11-17")
        await next.value
        XCTAssertEqual(s.day?.day, "2026-11-17")
        XCTAssertEqual(s.dayIsFor, "2026-11-17")
    }

    func testLoggedDotsLoadInWindows() async {
        serveDays()
        let s = store()
        await s.select("2026-11-19")
        let logged = { HTTPStub.requests.filter { $0.request.url?.path() == "/api/days/logged" }.map { $0.request.url?.query() ?? "" } }
        XCTAssertEqual(logged(), ["from=2026-10-19&to=2026-11-26"])
        await s.select("2026-11-18")
        XCTAssertEqual(logged().count, 1, "18 is inside the loaded window")
        await s.loadLogged(around: "2026-08-01")
        XCTAssertEqual(logged().last, "from=2026-07-01&to=2026-08-31")
        XCTAssertTrue(s.loggedDays.contains("2026-11-17"))
    }

    func testCopyingToAnotherDayDropsItsCachedCopy() async {
        serveDays()
        let s = store()
        await s.select("2026-11-18")
        await s.select("2026-11-19")
        s.invalidate("2026-11-18")
        serveDays(delay: ["2026-11-18": 0.4])
        let back = Task { await s.select("2026-11-18") }
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(s.dayIsFor, "2026-11-19", "a dropped day isn't shown from the cache")
        await back.value
        XCTAssertEqual(s.dayIsFor, "2026-11-18")
    }

    func testANewTodayMovesTheStrip() async {
        serveDays()
        let clock = Clock(ISO8601DateFormatter().date(from: "2026-11-19T06:00:00Z")!) // Nov 18, 11 pm in Denver
        let s = DayStore(api: api, timeZone: denver, now: { clock.now })
        XCTAssertEqual(s.stripDays.last, "2026-11-25")
        clock.now = ISO8601DateFormatter().date(from: "2026-11-19T14:00:00Z")!
        await s.dayMayHaveChanged()
        XCTAssertEqual(s.stripDays.last, "2026-11-26")
        XCTAssertTrue(s.canSelect("2026-11-19"))
    }

    func testTodayIsObservedSoTheStripMovesWhileOnAnOlderDay() async {
        serveDays()
        let clock = Clock(ISO8601DateFormatter().date(from: "2026-11-19T06:00:00Z")!) // Nov 18, 11 pm in Denver
        let s = DayStore(api: api, timeZone: denver, now: { clock.now })
        await s.select("2026-11-10")
        let changed = Flag()
        withObservationTracking { _ = s.stripDays; _ = s.isToday } onChange: { changed.set() }
        clock.now = ISO8601DateFormatter().date(from: "2026-11-19T14:00:00Z")! // Nov 19, 7 am
        await s.dayMayHaveChanged()
        XCTAssertTrue(changed.value, "views showing the strip must redraw: Nov 19 is choosable now")
        XCTAssertEqual(s.selected, "2026-11-10")
        XCTAssertTrue(s.canSelect("2026-11-19"))
    }

    func testFollowsTodayPastMidnight() async {
        serveDays()
        let clock = Clock(ISO8601DateFormatter().date(from: "2026-11-19T06:00:00Z")!) // Nov 18, 11 pm in Denver
        let s = DayStore(api: api, timeZone: denver, now: { clock.now })
        XCTAssertEqual(s.selected, "2026-11-18")
        clock.now = ISO8601DateFormatter().date(from: "2026-11-19T14:00:00Z")! // Nov 19, 7 am
        await s.dayMayHaveChanged()
        XCTAssertEqual(s.selected, "2026-11-19")
        XCTAssertEqual(s.day?.day, "2026-11-19")
    }

    func testStaysOnAnOlderDayTheyChose() async {
        serveDays()
        let clock = Clock(ISO8601DateFormatter().date(from: "2026-11-19T06:00:00Z")!)
        let s = DayStore(api: api, timeZone: denver, now: { clock.now })
        await s.select("2026-11-15")
        clock.now = ISO8601DateFormatter().date(from: "2026-11-19T14:00:00Z")!
        await s.dayMayHaveChanged()
        XCTAssertEqual(s.selected, "2026-11-15")
    }
}

/// A clock the test can move.
final class Clock: @unchecked Sendable {
    var now: Date
    init(_ now: Date) { self.now = now }
}

/// Set from an observation callback (any thread).
final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var on = false
    func set() { lock.withLock { on = true } }
    var value: Bool { lock.withLock { on } }
}
