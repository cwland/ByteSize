import XCTest
@testable import ByteSizeKit

final class OverviewTests: XCTestCase {
    private let calories = TargetRange(min: 1500, max: 2000)

    func testBudgetBelowInAndOver() {
        XCTAssertEqual(budget(calories: 1138, range: calories), .toGo(362))
        XCTAssertEqual(budget(calories: 1138, range: calories).text, "362 to go")
        XCTAssertEqual(budget(calories: 1500, range: calories), .inRange)
        XCTAssertEqual(budget(calories: 1750, range: calories).text, "In range")
        XCTAssertEqual(budget(calories: 2000, range: calories), .inRange)
        XCTAssertEqual(budget(calories: 2180, range: calories), .over(180))
        XCTAssertEqual(budget(calories: 2180, range: calories).text, "180 over")
        XCTAssertEqual(budget(calories: 1499.6, range: calories), .inRange, "rounds like the web (whole calories)")
    }

    func testRingIsFullAtTheMinimum() {
        let protein = TargetRange(min: 110, max: 130)
        let r = ringProgress(value: 97, range: protein)
        XCTAssertEqual(r.fraction, 97.0 / 110, accuracy: 0.0001)
        XCTAssertFalse(r.over)
        XCTAssertEqual(ringProgress(value: 120, range: protein).fraction, 1)
        XCTAssertFalse(ringProgress(value: 130, range: protein).over)
        XCTAssertTrue(ringProgress(value: 140, range: protein).over)
        XCTAssertEqual(ringProgress(value: 5, range: TargetRange(min: 0, max: 10)).fraction, 1)
    }

    func testRangeLabel() {
        XCTAssertEqual(rangeLabel(value: 97, range: TargetRange(min: 110, max: 130), unit: "g"), "97 / 110–130 g")
    }

    func testNoticeWithoutTargets() throws {
        XCTAssertNil(overviewNotice(try Fixtures.decodeDay()))
        XCTAssertEqual(overviewNotice(try Fixtures.decodeDay(Fixtures.dayNoTargets)), "Choose a plan in the web app to see your targets")
    }
}

final class BadgesTests: XCTestCase {
    func testNamesAndIconsMatchTheWeb() {
        XCTAssertEqual(badgeInfo("first_weigh_in", units: .imperial), BadgeInfo(name: "First weigh-in", icon: "⚖️"))
        XCTAssertEqual(badgeInfo("halfway", units: .imperial), BadgeInfo(name: "Halfway there", icon: "🚩"))
        XCTAssertEqual(badgeInfo("goal_reached", units: .imperial), BadgeInfo(name: "Goal reached", icon: "🎯"))
        XCTAssertEqual(badgeInfo("shots_on_time_4", units: .imperial), BadgeInfo(name: "4 shots on time", icon: "💉"))
        XCTAssertEqual(badgeInfo("goal_met", units: .imperial), BadgeInfo(name: "Goal met", icon: "🏆"))
        XCTAssertEqual(badgeInfo("streak_7", units: .imperial), BadgeInfo(name: "7-day streak", icon: "🔥"))
        XCTAssertEqual(badgeInfo("mystery", units: .imperial), BadgeInfo(name: "mystery", icon: "🏅"))
    }

    func testWeightLossBadgesFollowUnits() {
        XCTAssertEqual(badgeInfo("lost_5", units: .imperial), BadgeInfo(name: "5 lb down", icon: "📉"))
        XCTAssertEqual(badgeInfo("lost_5", units: .metric).name, "2 kg down") // rounded down to the half kg
        XCTAssertEqual(badgeInfo("lost_10", units: .metric).name, "4.5 kg down")
        XCTAssertEqual(badgeInfo("lost_20", units: .metric).name, "9 kg down")
    }
}
