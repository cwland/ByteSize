import XCTest
@testable import ByteSizeKit

final class ServerAddressTests: XCTestCase {
    func testBareHostGetsHTTPS() {
        XCTAssertEqual(ServerAddress("bytesize.example.com")?.url.absoluteString, "https://bytesize.example.com")
    }

    func testTrimsAndDropsPathAndHash() {
        XCTAssertEqual(ServerAddress("  https://bytesize.example.com/#/settings ")?.url.absoluteString, "https://bytesize.example.com")
    }

    func testKeepsHTTPAndPort() {
        XCTAssertEqual(ServerAddress("http://192.168.1.30:4100/")?.url.absoluteString, "http://192.168.1.30:4100")
    }

    func testHost() {
        XCTAssertEqual(ServerAddress("bytesize.example.com")?.host, "bytesize.example.com")
    }

    func testRejectsJunk() {
        XCTAssertNil(ServerAddress(""))
        XCTAssertNil(ServerAddress("not a url"))
        XCTAssertNil(ServerAddress("ftp://x.com"))
    }
}
