import XCTest
@testable import ByteSizeKit

final class ThemeTests: XCTestCase {
    func testSixThemes() {
        XCTAssertEqual(ThemeID.allCases.count, 6)
        XCTAssertEqual(ThemeID.allCases.map(\.rawValue), ["avocado", "fresh", "harbor", "terracotta-sage", "slate-rose", "midnight-coral"])
    }

    func testAvocadoColors() {
        XCTAssertEqual(Theme.palette(.avocado, dark: false)["brand"], "#5aa83c")
        XCTAssertEqual(Theme.palette(.avocado, dark: true)["page"], "#0d0d0f")
    }

    func testDefaults() {
        XCTAssertEqual(Theme.defaultTheme, .avocado)
        XCTAssertEqual(Theme.defaultMode, .dark)
        XCTAssertEqual(Theme.name(.slateRose), "Slate & Rose")
    }

    func testUnknownTokenFallsBackToInk() {
        let p = Theme.palette(.fresh, dark: false)
        XCTAssertEqual(p["no-such-token"], p["ink"])
    }

    func testEveryThemeHasTheCoreTokens() {
        let core = ["page", "container", "line", "ink", "subtle", "muted", "primary", "on-primary", "brand", "success", "error", "warning"]
        for id in ThemeID.allCases {
            for dark in [false, true] {
                let p = Theme.palette(id, dark: dark)
                for token in core {
                    XCTAssertTrue(p.has(token), "\(id) dark=\(dark) is missing \(token)")
                }
            }
        }
    }

    func testHexParsing() throws {
        let red = try XCTUnwrap(rgba(hex: "#ff0000"))
        XCTAssertEqual(red.r, 1); XCTAssertEqual(red.g, 0); XCTAssertEqual(red.a, 1)
        XCTAssertEqual(try XCTUnwrap(rgba(hex: "#ff000080")).a, 128.0 / 255, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(rgba(hex: "#0f0")).g, 1)
        XCTAssertNil(rgba(hex: "zz"))
        XCTAssertNil(rgba(hex: "#12345"))
    }
}
