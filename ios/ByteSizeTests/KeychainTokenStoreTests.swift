import ByteSizeKit
import XCTest

/// Runs in the simulator (the Keychain needs a real app host).
final class KeychainTokenStoreTests: XCTestCase {
    private let store = KeychainTokenStore(service: "com.cwland.bytesize.tests", account: "login-token")

    override func tearDown() {
        store.write(nil)
    }

    func testRoundTrip() {
        store.write(nil)
        XCTAssertNil(store.read())
        store.write("first")
        XCTAssertEqual(store.read(), "first")
        store.write("second")
        XCTAssertEqual(store.read(), "second")
        store.write(nil)
        XCTAssertNil(store.read())
    }
}
