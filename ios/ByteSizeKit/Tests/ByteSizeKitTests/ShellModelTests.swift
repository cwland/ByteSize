import XCTest
@testable import ByteSizeKit

@MainActor
final class ShellModelTests: XCTestCase {
    func testStartsOnDashboardWithMenuClosed() {
        let m = ShellModel()
        XCTAssertEqual(m.tab, .dashboard)
        XCTAssertFalse(m.menuOpen)
        XCTAssertNil(m.activeAction)
        XCTAssertFalse(m.profileOpen)
    }

    func testToggleMenu() {
        let m = ShellModel()
        m.toggleMenu()
        XCTAssertTrue(m.menuOpen)
        m.toggleMenu()
        XCTAssertFalse(m.menuOpen)
    }

    func testChooseClosesMenuAndOpensAction() {
        let m = ShellModel()
        m.toggleMenu()
        m.choose(.scan)
        XCTAssertFalse(m.menuOpen)
        XCTAssertEqual(m.activeAction, .scan)
    }

    func testCloseMenu() {
        let m = ShellModel()
        m.toggleMenu()
        m.closeMenu()
        XCTAssertFalse(m.menuOpen)
    }

    func testSwitchingTabClosesMenu() {
        let m = ShellModel()
        m.toggleMenu()
        m.select(.goals)
        XCTAssertEqual(m.tab, .goals)
        XCTAssertFalse(m.menuOpen)
    }

    func testTabsAndActions() {
        XCTAssertEqual(AppTab.allCases.map(\.title), ["Dashboard", "Food Log", "Goals", "My Foods"])
        XCTAssertEqual(AppTab.allCases.map(\.systemImage), ["square.grid.2x2", "list.bullet.rectangle", "target", "fork.knife"])
        XCTAssertEqual(QuickAction.allCases.map(\.title), ["Track Food", "Scan Food", "Photo", "Describe Food"])
        XCTAssertEqual(QuickAction.allCases.map(\.systemImage), ["magnifyingglass", "barcode.viewfinder", "camera", "text.bubble"])
    }

    func testRadialOffsetsFanEvenlyAboveTheButton() {
        let p = radialOffsets(count: 4, radius: 100, spreadDegrees: 120)
        XCTAssertEqual(p.count, 4)
        XCTAssertEqual(p[0].x, -p[3].x, accuracy: 0.001)
        XCTAssertEqual(p[1].x, -p[2].x, accuracy: 0.001)
        XCTAssertEqual(p[0].y, p[3].y, accuracy: 0.001)
        XCTAssertLessThan(p[0].x, p[1].x)
        for point in p {
            XCTAssertLessThan(point.y, 0)
            XCTAssertEqual((point.x * point.x + point.y * point.y).squareRoot(), 100, accuracy: 0.001)
        }
        // the outer buttons sit 60° either side of straight up
        XCTAssertEqual(p[0].x, -100 * sin(.pi / 3), accuracy: 0.001)
    }

    func testRadialOffsetsSingle() {
        let p = radialOffsets(count: 1, radius: 100, spreadDegrees: 120)
        XCTAssertEqual(p.count, 1)
        XCTAssertEqual(p[0].x, 0, accuracy: 0.001)
        XCTAssertEqual(p[0].y, -100, accuracy: 0.001)
    }

    func testRadialOffsetsNone() {
        XCTAssertTrue(radialOffsets(count: 0, radius: 100, spreadDegrees: 120).isEmpty)
    }
}
