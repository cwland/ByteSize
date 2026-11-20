import XCTest
@testable import ByteSizeKit

/// L1: the phone's "≈ N cal" uses the same amount math as the server. Resources/amount-vectors.json is a byte-for-byte
/// copy of backend/tests/fixtures/amount-vectors.json (a backend test fails if they ever differ).
final class AmountMathTests: XCTestCase {
    struct Vector: Decodable {
        let name: String
        let servings: [Serving]
        let servingIndex: Int
        let unit: String
        let quantity: Double
        let factor: Double?
    }

    func testTheSharedVectors() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "amount-vectors", withExtension: "json"))
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: url))
        XCTAssertGreaterThanOrEqual(vectors.count, 15)
        for v in vectors {
            let unit = try XCTUnwrap(AmountUnit(rawValue: v.unit), v.name)
            let got = AmountMath.factor(v.servings, servingIndex: v.servingIndex, unit: unit, quantity: v.quantity)
            if let want = v.factor {
                XCTAssertEqual(try XCTUnwrap(got, v.name), want, accuracy: 1e-9, v.name)
            } else {
                XCTAssertNil(got, v.name)
            }
        }
    }

    func testServingsCarryTheirShare() throws {
        let s = try JSONDecoder().decode(Serving.self, from: Data(#"{"label":"1 cracker","per":0.25,"derived":true}"#.utf8))
        XCTAssertEqual(s.per, 0.25)
        XCTAssertEqual(s.derived, true)
    }

    func testFractionsGoInEighths() {
        XCTAssertEqual(AmountMath.fractions.map(\.label), ["—", "⅛", "¼", "⅓", "⅜", "½", "⅝", "⅔", "¾", "⅞"])
        XCTAssertEqual(AmountMath.fractions[3].value, 1.0 / 3, accuracy: 1e-12)
    }

    func testBigAmounts() {
        XCTAssertTrue(AmountMath.isBig(factor: 21, calories: 300))
        XCTAssertTrue(AmountMath.isBig(factor: 2, calories: 2100))
        XCTAssertFalse(AmountMath.isBig(factor: 20, calories: 2000))
    }
}
