import XCTest
@testable import ByteSizeKit

/// Today polish (SPEC-11): Log shot with dose, date and notes.
@MainActor
final class ShotFormTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private static let meds = #"[{"name":"Zepbound","ingredient":"tirzepatide","doses":[2.5,5,7.5,10,12.5,15]},{"name":"Wegovy","ingredient":"semaglutide","doses":[0.25,0.5,1,1.7,2.4]}]"#
    private static let shots = #"[{"day":"2026-11-18","medication":"Zepbound","doseMg":7.5,"doseUnit":"mg","site":"thigh_left","note":"itchy"},{"day":"2026-11-11","medication":"Zepbound","doseMg":5,"doseUnit":"mg","site":"arm_right","note":null}]"#

    private func view(medication: String = "Zepbound", dose: Double = 5, unit: String = "mg", shots: String = ShotFormTests.shots) throws -> Glp1View {
        let json = #"{"settings":{"medication":"\#(medication)","doseMg":\#(dose),"doseUnit":"\#(unit)","injectionWeekday":3},"lastShot":null,"nextDue":"2026-11-25","status":"upcoming","overdueDays":0,"suggestedSite":"abdomen_right","shots":\#(shots),"medications":\#(Self.meds)}"#
        return try JSONDecoder().decode(Glp1View.self, from: Data(json.utf8))
    }

    func testBrandMedicationOffersItsDoses() throws {
        let f = ShotForm(view: try view(), today: "2026-11-19")
        XCTAssertEqual(f.doses, [2.5, 5, 7.5, 10, 12.5, 15])
        XCTAssertEqual(f.doseMg, 5)
        XCTAssertEqual(f.doseUnit, "mg")
        XCTAssertFalse(f.custom)
        XCTAssertEqual(f.day, "2026-11-19")
        XCTAssertEqual(f.site, "abdomen_right", "the suggested site")
        XCTAssertEqual(f.note, "")
        XCTAssertFalse(f.replaces)
    }

    func testCompoundedHasOnlyACustomDose() throws {
        let f = ShotForm(view: try view(medication: "Compounded Tirzepatide + B12", dose: 25, unit: "units", shots: "[]"), today: "2026-11-19")
        XCTAssertEqual(f.doses, [])
        XCTAssertTrue(f.custom)
        XCTAssertEqual(f.doseMg, 25)
        XCTAssertEqual(f.doseUnit, "units")
        XCTAssertTrue(f.canSave)
    }

    func testADayWithAShotOpensWithIt() throws {
        let f = ShotForm(view: try view(), today: "2026-11-19")
        f.day = "2026-11-18"
        XCTAssertEqual(f.site, "thigh_left")
        XCTAssertEqual(f.doseMg, 7.5)
        XCTAssertEqual(f.note, "itchy")
        XCTAssertTrue(f.replaces)
        f.day = "2026-11-17"
        XCTAssertEqual(f.doseMg, 5, "a day without a shot: the settings' dose")
        XCTAssertEqual(f.note, "")
        XCTAssertFalse(f.replaces)
    }

    func testADifferentDoseOnTheLatestShotSaysSo() throws {
        let f = ShotForm(view: try view(), today: "2026-11-19")
        XCTAssertFalse(f.becomesCurrentDose)
        f.doseMg = 7.5
        XCTAssertTrue(f.becomesCurrentDose)
        f.day = "2026-11-12" // before the latest shot (Nov 18): a backdated shot never changes it
        f.doseMg = 10
        XCTAssertFalse(f.becomesCurrentDose)
    }

    func testDoseLimits() throws {
        let f = ShotForm(view: try view(), today: "2026-11-19")
        f.custom = true
        f.doseMg = 101
        XCTAssertNotNil(f.error)
        XCTAssertFalse(f.canSave)
        f.doseUnit = "units"
        f.doseMg = 1000
        XCTAssertNil(f.error)
        XCTAssertTrue(f.canSave)
        f.doseMg = 0
        XCTAssertFalse(f.canSave)
    }

    func testResavingAnUnchangedShotLeavesTheDoseOut() async throws {
        serve()
        let days = DayStore(api: api, timeZone: TimeZone(identifier: "America/Boise")!, now: { ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")! })
        let m = DashboardModel(api: api, dayStore: days, units: .imperial)
        // settings say 10 mg (changed on the web since); the Nov 18 shot was 7.5 mg
        let f = ShotForm(view: try view(dose: 10), today: "2026-11-19")
        f.day = "2026-11-18"
        XCTAssertFalse(f.becomesCurrentDose, "the day's own dose, unchanged, says nothing about the current one")
        f.note = "itchy, then fine"
        try await m.logShot(f)
        let put = try XCTUnwrap(HTTPStub.requests.first { $0.request.httpMethod == "PUT" })
        XCTAssertNil(put.json?["doseMg"], "left out: the server keeps the shot's dose and the current one")
        XCTAssertNil(put.json?["doseUnit"])
        XCTAssertEqual(put.json?["note"] as? String, "itchy, then fine")
        f.doseMg = 12.5
        XCTAssertTrue(f.becomesCurrentDose)
    }

    func testAClearedDoseFieldCantBeSaved() throws {
        let f = ShotForm(view: try view(), today: "2026-11-19")
        f.custom = true
        f.doseText = ""
        XCTAssertEqual(f.error, "Enter a dose")
        XCTAssertFalse(f.canSave, "never the previous dose behind an empty field")
        f.doseText = "3.5"
        XCTAssertEqual(f.doseMg, 3.5)
        XCTAssertTrue(f.canSave)
        XCTAssertEqual(f.doseText, "3.5")
    }

    func testADoseReadsInItsUnit() throws {
        let shot = try JSONDecoder().decode(Shot.self, from: Data(#"{"day":"2026-11-18","medication":"Compounded","doseMg":25,"doseUnit":"units","site":"arm_left","note":null}"#.utf8))
        XCTAssertEqual(shot.doseText, "25 units")
        let mg = try JSONDecoder().decode(Shot.self, from: Data(#"{"day":"2026-11-18","medication":"Zepbound","doseMg":7.5,"site":"arm_left"}"#.utf8))
        XCTAssertEqual(mg.doseText, "7.5 mg")
    }

    func testNoFutureDay() throws {
        let f = ShotForm(view: try view(), today: "2026-11-19")
        f.day = "2026-11-20"
        XCTAssertFalse(f.canSave)
    }

    private func serve() {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            if req.httpMethod == "PUT", path.hasPrefix("/api/glp1/shots/") { return .json(200, #"{"ok":true}"#) }
            if path == "/api/glp1" { return .json(200, #"{"settings":null,"lastShot":null,"nextDue":null,"status":"none","overdueDays":0,"suggestedSite":"abdomen_left"}"#) }
            if path.hasPrefix("/api/day/") { return .json(200, Fixtures.day) }
            return .json(200, #"{"days":[]}"#)
        }
    }

    func testLogShotSendsEverything() async throws {
        serve()
        let days = DayStore(api: api, timeZone: TimeZone(identifier: "America/Boise")!, now: { ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")! })
        let m = DashboardModel(api: api, dayStore: days, units: .imperial)
        let f = ShotForm(view: try view(), today: "2026-11-19")
        f.day = "2026-11-18"
        f.note = "" // cleared on purpose
        f.doseMg = 10
        try await m.logShot(f)
        let put = try XCTUnwrap(HTTPStub.requests.first { $0.request.httpMethod == "PUT" })
        XCTAssertEqual(put.request.url?.path(), "/api/glp1/shots/2026-11-18")
        XCTAssertEqual(put.json?["site"] as? String, "thigh_left")
        XCTAssertEqual(put.json?["doseMg"] as? Double, 10)
        XCTAssertEqual(put.json?["doseUnit"] as? String, "mg")
        XCTAssertEqual(put.json?["note"] as? String, "", "an empty note clears it")
    }
}
