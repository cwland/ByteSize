import XCTest
@testable import ByteSizeKit

@MainActor
final class GoalsModelTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let noon = ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")!

    nonisolated static let targets = #"{"targets":{"calories":{"min":1500,"max":2000},"protein_g":{"min":110,"max":130},"fiber_g":{"min":25,"max":35},"water_ml":{"min":2000,"max":3000},"plan":"steady","effectiveFrom":"2026-11-01"}}"#
    nonisolated static let weighIns = #"[{"day":"2026-08-01","weightKg":90.0,"trendKg":90.0,"note":null},{"day":"2026-11-05","weightKg":84.0,"trendKg":85.0,"note":null},{"day":"2026-11-12","weightKg":83.0,"trendKg":84.0,"note":null},{"day":"2026-11-19","weightKg":82.28,"trendKg":83.2,"note":null}]"#
    nonisolated static func weight(_ list: String = weighIns) -> String {
        #"{"weighIns":\#(list),"start":{"day":"2026-08-01","weightKg":90.0},"latest":{"day":"2026-11-19","weightKg":82.28},"trendKg":83.2,"goalKg":75,"lostKg":7.72,"lostTrendKg":6.8,"projection":{"status":"ok","date":"2027-03-01","kgPerWeek":0.5},"goalDate":{"status":"ok","kgPerWeek":0.5,"toGoKg":8.2,"weeks":{"min":12,"max":20},"date":"2027-03-01","earliest":"2027-02-10","latest":"2027-04-10"},"replanHint":null}"#
    }
    nonisolated static func goal(id: Int, type: String, period: String, state: String = "active", value: Double = 3, target: Double = 5, start: String = "2026-11-01", end: String? = "2026-12-31", measure: String? = nil, hit: Int = 2, needed: Int? = 4, of: Int? = 5) -> String {
        let endJSON = end.map { "\"\($0)\"" } ?? "null"
        let measureJSON = measure.map { "\"\($0)\"" } ?? "null"
        let current = state == "upcoming" ? "null" : #"{"start":"2026-11-16","end":"2026-11-22","value":\#(value),"target":\#(target),"status":"open"}"#
        return #"{"id":\#(id),"type":"\#(type)","name":"Goal \#(id)","target":\#(target),"period":"\#(period)","measure":\#(measureJSON),"start":"\#(start)","end":\#(endJSON),"createdAt":"2026-11-01T00:00:00Z","endedEarly":false,"frozen":false,"progress":{"state":"\#(state)","periods":[],"current":\#(current),"hit":\#(hit),"done":2,"of":\#(of.map(String.init) ?? "null"),"needed":\#(needed.map(String.init) ?? "null"),"startKg":null,"asOf":"2026-11-19"}}"#
    }

    final class CallCount: @unchecked Sendable { var n = 0 }

    private func serve(goals: String? = nil, targets: String = targets, weight: @escaping @Sendable () -> String = { GoalsModelTests.weight() }) {
        let goals = goals ?? #"{"active":[\#(Self.goal(id: 1, type: "protein_days", period: "week")),\#(Self.goal(id: 2, type: "weight_by_date", period: "stretch", target: 75))],"past":[]}"#
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/goals"): return .json(200, goals)
            case ("GET", "/api/targets"): return .json(200, targets)
            case ("GET", "/api/weight"): return .json(200, weight())
            case ("PUT", _) where req.url!.path().hasPrefix("/api/weigh-ins/"): return .json(200, #"{"weighIn":{"day":"2026-11-19","weightKg":81.6,"note":null}}"#)
            case ("DELETE", _) where req.url!.path().hasPrefix("/api/weigh-ins/"): return .raw(204, contentType: "application/json", body: "")
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func model(units: Units = .metric, changed: CallCount = CallCount()) -> GoalsModel {
        let days = DayStore(api: api, timeZone: denver, now: { self.noon })
        return GoalsModel(api: api, dayStore: days, units: units, weightChanged: { changed.n += 1 })
    }

    private func count(_ method: String, _ prefix: String) -> Int {
        HTTPStub.requests.filter { $0.request.httpMethod == method && ($0.request.url?.path() ?? "").hasPrefix(prefix) }.count
    }

    func testAWeighInSaysWhereItCameFrom() throws {
        let json = #"[{"day":"2026-11-01","weightKg":90,"trendKg":90,"note":null,"source":"health"},{"day":"2026-11-02","weightKg":89,"trendKg":89.9,"note":null,"source":null},{"day":"2026-11-03","weightKg":88,"trendKg":89.8,"note":null}]"#
        let list = try JSONDecoder().decode([WeighIn].self, from: Data(json.utf8))
        XCTAssertEqual(list.map(\.source), ["health", nil, nil])
    }

    func testAnOlderServerWithoutTheTrendFigureLoads() async {
        serve(weight: { GoalsModelTests.weight().replacingOccurrences(of: #","lostTrendKg":6.8"#, with: "") })
        let m = model()
        await m.load()
        XCTAssertEqual(m.weight?.lostKg, 7.72)
        XCTAssertNil(m.weight?.lostTrendKg)
    }

    func testLoadsGoalsTargetsAndWeight() async {
        serve()
        let m = model()
        await m.load()
        XCTAssertEqual(m.goals.count, 2)
        XCTAssertEqual(m.targets?.calories.max, 2000)
        XCTAssertEqual(m.weight?.lostKg, 7.72) // by the scale
        XCTAssertEqual(m.weight?.lostTrendKg, 6.8) // by the trend
        XCTAssertEqual(m.weight?.goalDate?.date, "2027-03-01")
        XCTAssertTrue(m.loaded)
        // all weigh-ins: no from=
        let weightReq = HTTPStub.requests.first { $0.request.url?.path() == "/api/weight" }
        XCTAssertNil(weightReq?.request.url?.query())
    }

    func testRangesCutTheChart() async {
        serve()
        let m = model()
        await m.load()
        m.range = .week
        XCTAssertEqual(m.chartPoints.map(\.day), ["2026-11-19"])
        m.range = .month
        XCTAssertEqual(m.chartPoints.map(\.day), ["2026-11-05", "2026-11-12", "2026-11-19"])
        m.range = .threeMonths
        XCTAssertEqual(m.chartPoints.map(\.day), ["2026-11-05", "2026-11-12", "2026-11-19"])
        m.range = .all
        XCTAssertEqual(m.chartPoints.count, 4)
    }

    func testHistoryIsNewestFirstWithChanges() async {
        serve()
        let m = model()
        await m.load()
        XCTAssertEqual(m.history.map(\.day), ["2026-11-19", "2026-11-12", "2026-11-05", "2026-08-01"])
        let changes = m.history.map(\.changeKg)
        XCTAssertEqual(changes[0]!, -0.72, accuracy: 0.001)
        XCTAssertEqual(changes[1]!, -1.0, accuracy: 0.001)
        XCTAssertEqual(changes[2]!, -6.0, accuracy: 0.001)
        XCTAssertNil(changes[3])
    }

    /// Owner: the newest weigh-in is the Last weigh-in card; the 5 before it are Recent; the rest after "Show all".
    func testTheLastWeighInThenFiveRecentUntilExpanded() async {
        let seven = (1...7).map { #"{"day":"2026-11-0\#($0)","weightKg":\#(90 - Double($0)),"trendKg":90,"note":null}"# }.joined(separator: ",")
        serve(weight: { GoalsModelTests.weight("[\(seven)]") })
        let m = model()
        await m.load()
        XCTAssertFalse(m.showAllHistory)
        XCTAssertEqual(m.latestRow?.day, "2026-11-07")
        XCTAssertEqual(m.recentRows.map(\.day), ["2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02"])
        XCTAssertEqual(m.hiddenHistoryCount, 1)
        m.showAllHistory = true
        XCTAssertEqual(m.recentRows.count, 6)
        XCTAssertEqual(m.hiddenHistoryCount, 0)
    }

    func testFewWeighInsHideNothing() async {
        serve()
        let m = model()
        await m.load()
        XCTAssertEqual(m.latestRow?.day, "2026-11-19")
        XCTAssertEqual(m.recentRows.count, 3)
        XCTAssertEqual(m.hiddenHistoryCount, 0)
    }

    func testOneWeighInIsTheLastWithNoChangeAndNoRecent() async {
        serve(weight: { GoalsModelTests.weight(#"[{"day":"2026-11-19","weightKg":82,"trendKg":82,"note":null,"source":"health"}]"#) })
        let m = model()
        await m.load()
        XCTAssertEqual(m.latestRow?.day, "2026-11-19")
        XCTAssertEqual(m.latestRow?.source, "health")
        XCTAssertNil(GoalsModel.change(m.latestRow?.changeKg, units: .imperial))
        XCTAssertTrue(m.recentRows.isEmpty)
        XCTAssertEqual(m.hiddenHistoryCount, 0)
    }

    // MARK: - Pills, Lost and the estimate line

    func testChangePills() {
        let lb = 1 / Units.lbPerKg
        XCTAssertEqual(GoalsModel.change(-2.9 * lb, units: .imperial), .init(kind: .loss, text: "2.9 lb"))
        XCTAssertEqual(GoalsModel.change(0.2 * lb, units: .imperial), .init(kind: .gain, text: "0.2 lb"))
        // rounds to 0.0: neutral, never green or red
        XCTAssertEqual(GoalsModel.change(-0.03 * lb, units: .imperial), .init(kind: .none, text: "0.0 lb"))
        XCTAssertEqual(GoalsModel.change(0, units: .imperial), .init(kind: .none, text: "0.0 lb"))
        XCTAssertEqual(GoalsModel.change(0.06, units: .metric), .init(kind: .gain, text: "0.1 kg"))
        XCTAssertEqual(GoalsModel.change(-0.04, units: .metric), .init(kind: .none, text: "0.0 kg"))
        XCTAssertNil(GoalsModel.change(nil, units: .metric))
        // With the weigh-in's own weight, the pill follows the two weights as shown: 82.24 → 82.26 kg shows
        // 82.2 → 82.3, so +0.1, not a neutral 0.0 next to two different numbers
        XCTAssertEqual(GoalsModel.change(0.02, weightKg: 82.26, units: .metric), .init(kind: .gain, text: "0.1 kg"))
        XCTAssertEqual(GoalsModel.change(-0.02, weightKg: 82.24, units: .metric), .init(kind: .loss, text: "0.1 kg")) // 82.3 → 82.2
        XCTAssertEqual(GoalsModel.change(0.02, weightKg: 82.23, units: .metric), .init(kind: .none, text: "0.0 kg")) // 82.2 → 82.2
    }

    func testLostNeverGoesBelowZero() {
        let lb = 1 / Units.lbPerKg
        XCTAssertEqual(GoalsModel.lost(90.5 * lb, units: .imperial), .init(text: "90.5 lb", isLoss: true))
        XCTAssertEqual(GoalsModel.lost(-2 * lb, units: .imperial), .init(text: "0.0 lb", isLoss: false))
        XCTAssertEqual(GoalsModel.lost(0, units: .metric), .init(text: "0.0 kg", isLoss: false))
        XCTAssertEqual(GoalsModel.lost(0.02, units: .metric), .init(text: "0.0 kg", isLoss: false))
        // a tiny gain rounds to −0.0: still shown as "0.0", never "-0.0"
        XCTAssertEqual(GoalsModel.lost(-0.02, units: .metric), .init(text: "0.0 kg", isLoss: false))
        XCTAssertEqual(GoalsModel.lost(-0.03 * lb, units: .imperial), .init(text: "0.0 lb", isLoss: false))
        XCTAssertNil(GoalsModel.lost(nil, units: .metric))
    }

    func testEstimatedGoalDateLine() throws {
        func view(_ json: String) throws -> GoalDateView { try JSONDecoder().decode(GoalDateView.self, from: Data(json.utf8)) }
        let f = DateFormat.weekdayLongMonthShort
        let ok = try view(#"{"status":"ok","date":"2027-07-24","earliest":"2027-06-28","latest":"2027-09-02"}"#)
        XCTAssertEqual(GoalsModel.goalDateLine(ok, format: f, today: "2026-11-27"), .init(main: "Jul 24, 2027", detail: "Between Jun 28 and Sep 2, 2027"))
        let noRange = try view(#"{"status":"ok","date":"2027-07-24"}"#) // an older server
        XCTAssertEqual(GoalsModel.goalDateLine(noRange, format: f, today: "2026-11-27"), .init(main: "Jul 24, 2027", detail: nil))
        XCTAssertEqual(GoalsModel.goalDateLine(try view(#"{"status":"reached"}"#), format: f, today: "2026-11-27"), .init(main: "Goal reached", detail: nil))
        XCTAssertEqual(GoalsModel.goalDateLine(try view(#"{"status":"not_enough"}"#), format: f, today: "2026-11-27"), .init(main: "Not enough weigh-ins yet", detail: nil))
        XCTAssertEqual(GoalsModel.goalDateLine(try view(#"{"status":"not_losing"}"#), format: f, today: "2026-11-27"), .init(main: "Not losing at the moment", detail: nil))
        XCTAssertNil(GoalsModel.goalDateLine(try view(#"{"status":"no_goal"}"#), format: f, today: "2026-11-27"))
        XCTAssertNil(GoalsModel.goalDateLine(nil, format: f, today: "2026-11-27"))
    }

    private func decode(_ json: String) throws -> Goal { try JSONDecoder().decode(Goal.self, from: Data(json.utf8)) }

    func testProgressText() throws {
        let m = Units.metric
        XCTAssertEqual(GoalsModel.progressText(try decode(Self.goal(id: 1, type: "protein_days", period: "week")), units: m), "3 of 5 days this week")
        XCTAssertEqual(GoalsModel.progressText(try decode(Self.goal(id: 1, type: "protein_days", period: "month")), units: m), "3 of 5 days this month")
        XCTAssertEqual(GoalsModel.progressText(try decode(Self.goal(id: 1, type: "protein_days", period: "stretch")), units: m), "3 of 5 days so far")
        XCTAssertEqual(GoalsModel.progressText(try decode(Self.goal(id: 1, type: "steps", period: "week", value: 8200, target: 10000, measure: "total")), units: m), "8,200 of 10,000 steps this week")
        XCTAssertEqual(GoalsModel.progressText(try decode(Self.goal(id: 1, type: "weight_by_date", period: "stretch", target: 75)), units: .imperial), "Reach 165.3 lb by Dec 31")
        XCTAssertEqual(GoalsModel.progressText(try decode(Self.goal(id: 1, type: "logging_days", period: "week", state: "upcoming", start: "2026-12-01")), units: m), "Starts Tue, Dec 1")
    }

    func testOverallText() throws {
        XCTAssertEqual(GoalsModel.overallText(try decode(Self.goal(id: 1, type: "protein_days", period: "week"))), "2 of 4 needed (5 weeks)")
        XCTAssertEqual(GoalsModel.overallText(try decode(Self.goal(id: 1, type: "protein_days", period: "month"))), "2 of 4 needed (5 months)")
        XCTAssertNil(GoalsModel.overallText(try decode(Self.goal(id: 1, type: "protein_days", period: "week", end: nil, needed: nil, of: nil))))
    }

    func testLogWeightRefusesAFutureDay() async {
        serve()
        let m = model(units: .imperial)
        await m.load()
        do {
            try await m.logWeight(display: 180, day: "2026-11-20")
            XCTFail("a future day must be refused")
        } catch {
            XCTAssertEqual((error as? APIError)?.message ?? "\(error)", "Choose today or an earlier day")
        }
        XCTAssertEqual(count("PUT", "/api/weigh-ins/"), 0)
    }

    func testLogAndDeleteReloadAndTellTheDashboard() async throws {
        serve()
        let changed = CallCount()
        let m = model(units: .metric, changed: changed)
        await m.load()
        HTTPStub.requests = []
        try await m.logWeight(display: 81.6, day: "2026-11-19")
        let put = HTTPStub.requests.first { $0.request.httpMethod == "PUT" }
        XCTAssertEqual(put?.request.url?.path(), "/api/weigh-ins/2026-11-19")
        XCTAssertEqual(put?.json?["weightKg"] as? Double, 81.6)
        XCTAssertEqual(count("GET", "/api/weight"), 1)
        XCTAssertEqual(changed.n, 1)
        await m.deleteWeighIn(day: "2026-11-19")
        XCTAssertEqual(count("DELETE", "/api/weigh-ins/2026-11-19"), 1)
        XCTAssertEqual(count("GET", "/api/weight"), 2)
        XCTAssertEqual(changed.n, 2)
    }

    func testEmptyAccount() async {
        serve(goals: #"{"active":[],"past":[]}"#, targets: #"{"targets":null}"#, weight: {
            #"{"weighIns":[],"start":null,"latest":null,"trendKg":null,"goalKg":null,"lostKg":null,"projection":{"status":"not_enough"},"goalDate":{"status":"no_goal"},"replanHint":null}"#
        })
        let m = model()
        await m.load()
        XCTAssertTrue(m.goals.isEmpty)
        XCTAssertNil(m.targets)
        XCTAssertTrue(m.chartPoints.isEmpty)
        XCTAssertTrue(m.history.isEmpty)
        XCTAssertNil(m.message)
    }

    func testDeletingTheLastWeighInEmptiesHistory() async {
        final class Gone: @unchecked Sendable { var yes = false }
        let gone = Gone()
        serve(weight: { gone.yes ? GoalsModelTests.weight("[]") : GoalsModelTests.weight(#"[{"day":"2026-11-19","weightKg":82.28,"trendKg":82.28,"note":null}]"#) })
        let m = model()
        await m.load()
        XCTAssertEqual(m.history.count, 1)
        gone.yes = true
        await m.deleteWeighIn(day: "2026-11-19")
        XCTAssertTrue(m.history.isEmpty)
        XCTAssertTrue(m.chartPoints.isEmpty)
    }
}
