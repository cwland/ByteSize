import XCTest

/// Runs the app against its built-in stub server (launch argument -UITestStubServer): no real server needed.
/// Set TEST_RUNNER_SHOTS_DIR to a folder to also save screenshots there.
final class SmokeUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-UITestStubServer"]
        app.launch()
    }

    func testSignInTabsMenuProfileSignOut() {
        shot("1-sign-in")
        signIn(password: "pw")
        dismissSavePassword()

        for tab in ["Dashboard", "Food Log", "Goals", "My Foods", "Quick add"] {
            XCTAssertTrue(app.buttons[tab].waitForExistence(timeout: 5), "missing \(tab)")
        }
        shot("2-dashboard")

        // Closed: the quick actions aren't on screen (or read by VoiceOver)
        XCTAssertFalse(app.buttons["Track Food"].exists)
        app.buttons["Quick add"].tap()
        for action in ["Track Food", "Scan Food", "Photo", "Describe Food"] {
            XCTAssertTrue(app.buttons[action].waitForExistence(timeout: 3), "missing \(action)")
            XCTAssertTrue(app.buttons[action].isHittable, "\(action) can't be tapped")
        }
        sleep(1)
        shot("3-quick-add")
        app.buttons["Close"].firstMatch.tap()

        app.buttons["Profile"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Account and goals are set up in the ByteSize web app."].waitForExistence(timeout: 5))
        shot("4-profile")
        app.buttons["Sign out"].firstMatch.tap()
        let confirm = app.sheets.buttons["Sign out"].exists ? app.sheets.buttons["Sign out"] : app.buttons.matching(identifier: "Sign out").element(boundBy: 1)
        XCTAssertTrue(confirm.waitForExistence(timeout: 3))
        confirm.tap()

        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 5), "back on sign-in")
    }

    func testWrongPassword() {
        signIn(password: "wrong")
        let error = app.staticTexts["signInError"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertEqual(error.label, "Wrong username or password")
    }

    private func signIn(password: String) {
        let server = app.textFields["serverField"]
        XCTAssertTrue(server.waitForExistence(timeout: 5))
        server.tap()
        server.typeText("stub.test")
        app.buttons["Continue"].tap()

        let username = app.textFields["usernameField"]
        XCTAssertTrue(username.waitForExistence(timeout: 5))
        username.tap()
        username.typeText("alex")
        let pass = app.secureTextFields["passwordField"]
        pass.tap()
        pass.typeText(password)
        app.buttons["Sign in"].tap()
    }

    /// iOS offers to save the password after signing in; say Not Now so it doesn't swallow the next tap.
    private func dismissSavePassword() {
        for source in [app!, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
            let notNow = source.buttons["Not Now"]
            if notNow.waitForExistence(timeout: 3) {
                notNow.tap()
                return
            }
        }
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"], !dir.isEmpty {
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
