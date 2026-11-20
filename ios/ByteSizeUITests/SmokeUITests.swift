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
        XCTAssertTrue(app.buttons["Dashboard"].waitForExistence(timeout: 5))
        dismissSavePassword(timeout: 6)

        for tab in ["Dashboard", "Food Log", "Goals", "My Foods", "Quick add"] {
            XCTAssertTrue(app.buttons[tab].waitForExistence(timeout: 5), "missing \(tab)")
        }
        shot("2-dashboard")

        // Closed: the quick actions aren't on screen (or read by VoiceOver)
        XCTAssertFalse(app.buttons["Track Food"].exists)
        app.buttons["Quick add"].tap()
        if !app.buttons["Track Food"].waitForExistence(timeout: 3) {
            // the Save Password prompt can show up late and take the tap
            dismissSavePassword(timeout: 2)
            app.buttons["Quick add"].tap()
        }
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
        username.typeText("cory")
        // UI-test runs use a plain field for the password (no Save Password prompt)
        let pass = app.textFields["passwordField"].exists ? app.textFields["passwordField"] : app.secureTextFields["passwordField"]
        pass.tap()
        pass.typeText(password)
        app.buttons["Sign in"].tap()
    }

    /// iOS offers to save the password after signing in; say Not Now so it doesn't swallow the next tap.
    private func dismissSavePassword(timeout: TimeInterval) {
        let sources = [app!, XCUIApplication(bundleIdentifier: "com.apple.springboard")]
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for source in sources where source.buttons["Not Now"].exists {
                source.buttons["Not Now"].tap()
                return
            }
            usleep(250_000)
        } while Date() < deadline
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

    // MARK: - Round 2: Dashboard and Food Log (stub day: 1138 cal of 1500–2000, 500 ml water)

    /// Polls `condition` for up to `timeout` seconds.
    private func waitUntil(timeout: TimeInterval = 5, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            usleep(200_000)
        }
        return condition()
    }

    private func signedIn() {
        signIn(password: "pw")
        XCTAssertTrue(app.buttons["Dashboard"].waitForExistence(timeout: 5))
        dismissSavePassword(timeout: 6)
    }

    func testDashboardShowsToday() {
        signedIn()
        XCTAssertTrue(app.staticTexts["362 to go"].waitForExistence(timeout: 5))
        let water = app.staticTexts["waterTotal"]
        XCTAssertTrue(water.waitForExistence(timeout: 3))
        XCTAssertEqual(water.label, "17 fl oz")
        shot("5-dashboard")
        app.buttons["Add 8 fl oz of water"].tap()
        XCTAssertTrue(waitUntil { water.label == "25 fl oz" }, "water went up by 8 fl oz")
        app.swipeUp()
        shot("6-dashboard-lower")
    }

    func testFoodLogSwipeDeleteAndUndo() {
        signedIn()
        app.buttons["Food Log"].tap()
        let yogurt = app.staticTexts["Greek yogurt"]
        XCTAssertTrue(yogurt.waitForExistence(timeout: 5))
        shot("7-food-log")
        app.cells.containing(.staticText, identifier: "Greek yogurt").firstMatch.swipeLeft()
        XCTAssertTrue(app.buttons["Move"].waitForExistence(timeout: 3))
        shot("8-swipe-actions")
        app.buttons["Delete"].tap()
        let undo = app.buttons["Undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3))
        XCTAssertTrue(undo.isHittable, "the Undo toast sits above the tab bar")
        XCTAssertFalse(app.staticTexts["Greek yogurt"].exists)
        shot("9-undo")
        undo.tap()
        XCTAssertTrue(app.staticTexts["Greek yogurt"].waitForExistence(timeout: 5))
    }

    func testEditEntryAmount() {
        signedIn()
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.staticTexts["Greek yogurt"].waitForExistence(timeout: 5))
        app.staticTexts["Greek yogurt"].tap()
        XCTAssertTrue(app.navigationBars["Edit"].waitForExistence(timeout: 3))
        app.buttons["½"].tap()
        shot("10-edit-entry")
        app.buttons["Save"].tap()
        // the row reads as one combined label ("Greek yogurt, Fage · ½ × 2 × 1 cup, 130")
        let halved = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "½ × 2 × 1 cup")).firstMatch
        XCTAssertTrue(halved.waitForExistence(timeout: 5))
    }

    func testEditDashboardLayout() {
        signedIn()
        XCTAssertTrue(app.staticTexts["362 to go"].waitForExistence(timeout: 5))
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 3))
        let badges = app.descendants(matching: .any).matching(identifier: "edit-badges").firstMatch
        XCTAssertTrue(badges.waitForExistence(timeout: 3))
        shot("11-dashboard-edit")
        // edit mode shows a red ⊖ before each row: tap it (left of the row's label), then Delete
        // (the ⊖ sits about 30 pt left of the row's icon)
        badges.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5)).withOffset(CGVector(dx: -30, dy: 0)).tap()
        let delete = app.buttons["Delete"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 3))
        delete.tap()
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "edit-badges").firstMatch.waitForExistence(timeout: 1))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["362 to go"].waitForExistence(timeout: 5))
        app.swipeUp()
        app.swipeUp()
        XCTAssertFalse(app.staticTexts["Badges"].exists, "the Badges card is gone")
    }

    // MARK: - Round 3: logging food (the stub knows "Banana", barcode 0012345678905, and estimates "2 eggs and toast")

    private func openAction(_ title: String) {
        app.buttons["Quick add"].tap()
        if !app.buttons[title].waitForExistence(timeout: 3) {
            dismissSavePassword(timeout: 2)
            app.buttons["Quick add"].tap()
        }
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 3))
        app.buttons[title].tap()
    }

    func testTrackFoodSearchAndLog() {
        signedIn()
        openAction("Track Food")
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        shot("7-track-food")
        search.tap()
        search.typeText("banana")
        let row = app.buttons["food-Banana"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let log = app.buttons["logButton"]
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["≈ 105"].exists, "the calorie preview")
        shot("8-portion")
        log.tap()
        XCTAssertTrue(waitUntil { !self.app.buttons["logButton"].exists && !self.app.searchFields.firstMatch.exists }, "both sheets close")
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.staticTexts["Banana"].waitForExistence(timeout: 5))
    }

    func testTypedBarcodeNotFoundOffersLabel() {
        signedIn()
        openAction("Scan Food")
        // The simulator has no camera: say so, and offer typing
        XCTAssertTrue(app.staticTexts["Camera isn't available — type the barcode instead"].waitForExistence(timeout: 5))
        let field = app.textFields["barcodeField"]
        field.tap()
        field.typeText("0099999999999")
        app.buttons["lookUpBarcode"].tap()
        XCTAssertTrue(app.staticTexts["We don't know this barcode yet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Choose a photo of the label"].exists, "the label can be read instead")
        shot("9-scan-unknown")
    }

    func testDescribeLogsItems() {
        signedIn()
        openAction("Describe Food")
        let field = app.textFields["describeField"].exists ? app.textFields["describeField"] : app.textViews["describeField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("2 eggs and toast")
        app.buttons["estimateButton"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["item-Egg"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["item-Toast"].exists)
        XCTAssertTrue(app.staticTexts["2 × 1 large egg · ≈ 144 cal"].exists)
        shot("10-describe")
        app.buttons["logAll"].tap()
        XCTAssertTrue(waitUntil { !self.app.buttons["logAll"].exists }, "the sheet closes")
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.staticTexts["Egg"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Toast"].exists)
        XCTAssertGreaterThanOrEqual(app.staticTexts.matching(identifier: "AI").count + app.staticTexts.matching(NSPredicate(format: "label == 'AI'")).count, 1, "marked AI")
        shot("11-log-with-ai")
    }
}

