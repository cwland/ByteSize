import XCTest
@testable import ByteSizeKit

/// The phone writes dates exactly as the web's frontend/src/dateFormat.ts does.
final class DateFormatTests: XCTestCase {
    func testLongMatchesWeb() {
        XCTAssertEqual(DateFormat.allCases.map { $0.long("2026-11-18") }, [
            "Wednesday, Nov 18", "Wed, Nov 18", "Wednesday, November 18", "11/18/2026", "Wednesday 18 Nov",
            "Wed 18 Nov", "Wednesday 18 November", "18/11/2026", "18.11.2026", "2026-11-18",
        ])
        XCTAssertEqual(DateFormat.allCases.map(\.rawValue), [
            "weekday-long-month-short", "weekday-short-month-short", "weekday-long-month-long", "mdy-slash",
            "weekday-long-day-month-short", "weekday-short-day-month-short", "weekday-long-day-month-long",
            "dmy-slash", "dmy-dot", "iso",
        ])
    }

    func testShortAddsYearOutsideThisYear() {
        XCTAssertEqual(DateFormat.default.short("2027-04-05", today: "2026-11-18"), "Apr 5, 2027")
        XCTAssertEqual(DateFormat.default.short("2026-04-05", today: "2026-11-18"), "Apr 5")
        XCTAssertEqual(DateFormat.weekdayLongDayMonthLong.short("2027-04-05", today: "2026-11-18"), "5 April 2027")
        XCTAssertEqual(DateFormat.weekdayShortDayMonthShort.short("2026-04-05", today: "2026-11-18"), "5 Apr")
        XCTAssertEqual(DateFormat.dmySlash.short("2026-04-05", today: "2026-11-18"), "05/04/2026")
        XCTAssertEqual(DateFormat.iso.short("2026-04-05", today: "2026-11-18"), "2026-04-05")
    }

    func testUnknownKeyIsDefault() {
        XCTAssertEqual(DateFormat(key: nil), .weekdayLongMonthShort)
        XCTAssertEqual(DateFormat(key: "nonsense"), .weekdayLongMonthShort)
        XCTAssertEqual(DateFormat(key: "dmy-dot"), .dmyDot)
    }
}
