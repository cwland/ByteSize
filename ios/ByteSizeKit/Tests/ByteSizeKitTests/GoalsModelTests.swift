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
        #"{"weighIns":\#(list),"start":{"day":"2026-08-01","weightKg":90.0},"latest":{"day":"2026-11-19","weightKg":82.28},"trendKg":83.2,"goalKg":75,"lostKg":6.8,"projection":{"status":"ok","date":"2027-03-01","kgPerWeek":0.5},"goalDate":{"status":"ok","kgPerWeek":0.5,"toGoKg":8.2,"weeks":{"min":12,"max":20},"date":"2027-03-01","earliest":"2027-02-10","latest":"2027-04-10"},"replanHint":null}"#
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

    func testLoadsGoalsTargetsAndWeight() async {
        serve()
        let m = model()
        await m.load()
        XCTAssertEqual(m.goals.count, 2)
        XCTAssertEqual(m.targets?.calories.max, 2000)
        XCTAssertEqual(m.weight?.lostKg, 6.8)
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
