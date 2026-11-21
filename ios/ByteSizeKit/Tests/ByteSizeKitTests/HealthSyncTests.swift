import XCTest
@testable import ByteSizeKit

/// What the tests hand HealthSync instead of HealthKit, and what it was asked.
final class FakeHealthStore: HealthStore, @unchecked Sendable {
    var weightList: [HealthWeight] = []
    var steps: [String: Int] = [:]
    var workoutList: [HealthWorkout] = []
    var refuse = false
    var locked = false
    private(set) var asked: [(kind: String, from: Date)] = []

    func requestAccess(_ kind: HealthKind) async throws {
        if refuse { throw URLError(.userAuthenticationRequired) }
    }
    func weights(from: Date, to: Date) async throws -> [HealthWeight] {
        asked.append(("weight", from))
        if locked { throw URLError(.cannotOpenFile) }
        return weightList
    }
    func dailySteps(from: Date, to: Date, zone: TimeZone) async throws -> [String: Int] {
        asked.append(("steps", from))
        if locked { throw URLError(.cannotOpenFile) }
        return steps
    }
    func workouts(from: Date, to: Date) async throws -> [HealthWorkout] {
        asked.append(("workouts", from))
        if locked { throw URLError(.cannotOpenFile) }
        return workoutList
    }
}

@MainActor
final class HealthSyncTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let noon = ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")! // Nov 19, noon in Denver
    private var defaults: UserDefaults!

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "health-tests-\(UUID().uuidString)")!
    }

    private func iso(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

    /// Weigh-ins answer skipped for the days in `skipped`; `failWeight` answers 500.
    private func serve(skipped: Set<String> = [], failWeight: Bool = false) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            switch (req.httpMethod ?? "", path) {
            case ("PUT", _) where path.hasPrefix("/api/weigh-ins/"):
                if failWeight { return .json(500, #"{"error":"ByteSize didn't answer"}"#) }
                let day = String(path.dropFirst("/api/weigh-ins/".count))
                return .json(200, skipped.contains(day) ? #"{"weighIn":null,"skipped":true}"# : #"{"weighIn":{"day":"\#(day)","weightKg":80,"note":null},"skipped":false}"#)
            case ("PUT", _) where path.hasPrefix("/api/steps/"):
                return .json(200, #"{"day":"x","steps":1,"stepsSource":"health"}"#)
            case ("POST", "/api/workouts"):
                return .json(200, #"{"workout":null,"skipped":false}"#)
            default:
                return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func sync(_ store: FakeHealthStore, account: String = "h|1", clock: Clock? = nil) -> HealthSync {
        let now = clock.map { c in { c.now } } ?? { self.noon }
        let days = DayStore(api: api, timeZone: denver, now: now)
        return HealthSync(api: api, dayStore: days, store: store, defaults: defaults, account: account, now: now)
    }

    private func sent(_ method: String, _ prefix: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && ($0.request.url?.path() ?? "").hasPrefix(prefix) }
    }

    private func startOfDay(_ day: String) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = denver
        let p = day.split(separator: "-").map { Int($0)! }
        return c.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))!
    }

    func testSwitchesAreOffAndReadNothing() async {
        serve()
        let store = FakeHealthStore()
        let s = sync(store)
        XCTAssertFalse(s.isOn(.weight))
        await s.syncNow()
        XCTAssertTrue(store.asked.isEmpty)
        XCTAssertTrue(HTTPStub.requests.isEmpty)
        XCTAssertEqual(HealthKind.allCases.map(\.title), ["Weight", "Steps", "Workouts"])
    }

    func testFirstWeightSyncReadsThirtyDaysAndSendsTheFirstReadingOfEachDay() async throws {
        serve()
        let store = FakeHealthStore()
        store.weightList = [
            HealthWeight(date: iso("2026-11-19T02:00:00Z"), kg: 83.0, fromByteSize: false), // Nov 18, 7 pm
            HealthWeight(date: iso("2026-11-18T14:10:00Z"), kg: 82.4, fromByteSize: false), // Nov 18, 7:10 am
        ]
        let s = sync(store)
        await s.setOn(.weight, true)
        XCTAssertTrue(s.isOn(.weight))
        XCTAssertEqual(store.asked.first?.from, startOfDay("2026-10-21"))
        let puts = sent("PUT", "/api/weigh-ins/")
        XCTAssertEqual(puts.map { $0.request.url!.path() }, ["/api/weigh-ins/2026-11-18"])
        XCTAssertEqual(puts.first?.json?["weightKg"] as? Double, 82.4)
        XCTAssertEqual(puts.first?.json?["source"] as? String, "health")
        XCTAssertEqual(s.result, "1 weigh-in")
        XCTAssertEqual(s.lastSynced, noon)
    }

    func testLaterSyncsStartTwoDaysBeforeTheLast() async {
        serve()
        let store = FakeHealthStore()
        let clock = Clock(iso("2026-11-15T19:00:00Z"))
        let s = sync(store, clock: clock)
        await s.setOn(.weight, true)
        clock.now = noon
        await s.syncNow()
        XCTAssertEqual(store.asked.last?.from, startOfDay("2026-11-13"))
    }

    func testStepsAfterTheFirstSyncAreTheLastSevenDays() async {
        serve()
        let store = FakeHealthStore()
        let s = sync(store)
        await s.setOn(.steps, true)
        XCTAssertEqual(store.asked.last?.from, startOfDay("2026-10-21"))
        await s.syncNow()
        XCTAssertEqual(store.asked.last?.from, startOfDay("2026-11-13"))
    }

    func testZeroStepDaysAreNotSent() async {
        serve()
        let store = FakeHealthStore()
        store.steps = ["2026-11-17": 0, "2026-11-18": 8123, "2026-11-19": 2400]
        let s = sync(store)
        await s.setOn(.steps, true)
        let puts = sent("PUT", "/api/steps/")
        XCTAssertEqual(puts.map { $0.request.url!.path() }.sorted(), ["/api/steps/2026-11-18", "/api/steps/2026-11-19"])
        XCTAssertEqual(puts.first { $0.request.url!.path().hasSuffix("18") }?.json?["steps"] as? Int, 8123)
        XCTAssertEqual(puts.first?.json?["source"] as? String, "health")
        XCTAssertEqual(s.result, "steps for 2 days")
    }

    func testWorkoutMapping() async throws {
        serve()
        let store = FakeHealthStore()
        let at = iso("2026-11-18T15:00:00Z")
        store.workoutList = [
            HealthWorkout(id: "A", start: at, seconds: 1799.6, activeCalories: 312.4, activity: .running, fromByteSize: false),
            HealthWorkout(id: "B", start: at, seconds: 20, activeCalories: nil, activity: .sport, fromByteSize: false),
            HealthWorkout(id: "C", start: at, seconds: 600, activeCalories: 40, activity: .other, fromByteSize: false),
        ]
        let s = sync(store)
        await s.setOn(.workouts, true)
        let posts = sent("POST", "/api/workouts").compactMap(\.json)
        XCTAssertEqual(posts.count, 3)
        XCTAssertEqual(posts[0]["type"] as? String, "run")
        XCTAssertEqual(posts[0]["minutes"] as? Int, 30)
        XCTAssertEqual(posts[0]["calories"] as? Int, 312)
        XCTAssertEqual(posts[0]["externalId"] as? String, "A")
        XCTAssertEqual(posts[0]["source"] as? String, "health")
        XCTAssertEqual(posts[0]["day"] as? String, "2026-11-18")
        XCTAssertEqual(posts[1]["minutes"] as? Int, 1)
        XCTAssertNil(posts[1]["calories"])
        XCTAssertEqual(posts[1]["type"] as? String, "sport")
        XCTAssertEqual(posts[2]["type"] as? String, "other")
        let map: [(HealthActivity, String)] = [(.walking, "walk"), (.running, "run"), (.cycling, "cycling"), (.strength, "strength"), (.swimming, "swim"), (.hiking, "hike"), (.yoga, "yoga"), (.hiit, "hiit"), (.sport, "sport"), (.other, "other")]
        for (a, t) in map { XCTAssertEqual(a.serverType, t) }
        XCTAssertEqual(s.result, "3 workouts")
    }

    func testAWorkoutLandsOnItsStartDayInTheAccountZone() async {
        serve()
        let store = FakeHealthStore()
        store.workoutList = [HealthWorkout(id: "N", start: iso("2026-11-19T06:30:00Z"), seconds: 3600, activeCalories: 200, activity: .walking, fromByteSize: false)]
        let s = sync(store)
        await s.setOn(.workouts, true)
        XCTAssertEqual(sent("POST", "/api/workouts").first?.json?["day"] as? String, "2026-11-18")
    }

    func testNothingAfterTodayIsSent() async {
        serve()
        let store = FakeHealthStore()
        store.weightList = [HealthWeight(date: iso("2026-11-20T15:00:00Z"), kg: 80, fromByteSize: false)]
        store.steps = ["2026-11-20": 100]
        store.workoutList = [HealthWorkout(id: "F", start: iso("2026-11-20T15:00:00Z"), seconds: 600, activeCalories: nil, activity: .walking, fromByteSize: false)]
        let s = sync(store)
        await s.setOn(.weight, true)
        await s.setOn(.steps, true)
        await s.setOn(.workouts, true)
        XCTAssertTrue(HTTPStub.requests.isEmpty)
        XCTAssertEqual(s.result, "Up to date")
    }

    func testByteSizeSamplesAreSkipped() async {
        serve()
        let store = FakeHealthStore()
        store.weightList = [HealthWeight(date: iso("2026-11-18T14:00:00Z"), kg: 80, fromByteSize: true)]
        store.workoutList = [HealthWorkout(id: "M", start: iso("2026-11-18T15:00:00Z"), seconds: 600, activeCalories: nil, activity: .walking, fromByteSize: true)]
        let s = sync(store)
        await s.setOn(.weight, true)
        await s.setOn(.workouts, true)
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }

    func testResultCountsOnlyWhatWasAdded() async {
        serve(skipped: ["2026-11-17"])
        let store = FakeHealthStore()
        store.weightList = [
            HealthWeight(date: iso("2026-11-17T14:00:00Z"), kg: 81, fromByteSize: false),
            HealthWeight(date: iso("2026-11-18T14:00:00Z"), kg: 80, fromByteSize: false),
        ]
        let s = sync(store)
        await s.setOn(.weight, true)
        XCTAssertEqual(s.result, "1 weigh-in")
        serve(skipped: ["2026-11-17", "2026-11-18"])
        await s.syncNow()
        XCTAssertEqual(s.result, "Up to date")
    }

    func testAFailedSendKeepsLastSynced() async {
        serve(failWeight: true)
        let store = FakeHealthStore()
        store.weightList = [HealthWeight(date: iso("2026-11-18T14:00:00Z"), kg: 80, fromByteSize: false)]
        store.steps = ["2026-11-18": 5000]
        let s = sync(store)
        await s.setOn(.steps, true)
        await s.setOn(.weight, true)
        XCTAssertNil(s.lastSynced(for: .weight))
        XCTAssertEqual(s.lastSynced(for: .steps), noon)
        XCTAssertTrue(s.message?.contains("weight") == true, s.message ?? "nil")
        // the next sync tries weight's first window again
        await s.syncNow()
        XCTAssertEqual(store.asked.last { $0.kind == "weight" }?.from, startOfDay("2026-10-21"))
    }

    func testAStoreErrorSendsNothing() async {
        serve()
        let store = FakeHealthStore()
        store.locked = true
        store.weightList = [HealthWeight(date: iso("2026-11-18T14:00:00Z"), kg: 80, fromByteSize: false)]
        let s = sync(store)
        await s.setOn(.weight, true)
        XCTAssertTrue(HTTPStub.requests.isEmpty)
        XCTAssertNil(s.lastSynced(for: .weight))
        XCTAssertNotNil(s.message)
    }

    func testARefusedSwitchStaysOff() async {
        serve()
        let store = FakeHealthStore()
        store.refuse = true
        let s = sync(store)
        await s.setOn(.weight, true)
        XCTAssertFalse(s.isOn(.weight))
        XCTAssertEqual(s.message, "Allow ByteSize in the Health app: Sharing › Apps › ByteSize")
    }

    func testSwitchesBelongToTheAccount() async {
        serve()
        let store = FakeHealthStore()
        let a = sync(store, account: "h|1")
        await a.setOn(.weight, true)
        XCTAssertTrue(sync(store, account: "h|1").isOn(.weight), "saved for that account")
        XCTAssertFalse(sync(store, account: "h|2").isOn(.weight))
    }

    func testTurningASwitchOffStopsIt() async {
        serve()
        let store = FakeHealthStore()
        store.weightList = [HealthWeight(date: iso("2026-11-18T14:00:00Z"), kg: 80, fromByteSize: false)]
        let s = sync(store)
        await s.setOn(.weight, true)
        await s.setOn(.weight, false)
        HTTPStub.requests = []
        await s.syncNow()
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }

    func testABackgroundSyncUsesTheSavedSwitches() async {
        serve()
        let store = FakeHealthStore()
        let s = sync(store, account: "h|1")
        await s.setOn(.weight, true)
        // a cold start in the background knows who and what, without the app's screens
        XCTAssertEqual(HealthSync.lastAccount(defaults), "h|1")
        XCTAssertEqual(HealthSync.savedOn(account: "h|1", defaults: defaults), [.weight])
        XCTAssertEqual(HealthSync.savedOn(account: "h|2", defaults: defaults), [])
    }
}
