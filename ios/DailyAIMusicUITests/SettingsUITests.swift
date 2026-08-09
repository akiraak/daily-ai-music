import XCTest

/// 設定タブのサーバー設定(GET/PUT /api/settings)のスモークテスト。
/// サーバー(http://localhost:3014)が起動していることが前提。
/// ニューストグルを 2 回タップして往復させ、PUT が通ること(失敗時は再読込で元の値へ
/// 戻る実装のため、反転値が維持されれば保存成功)を確認する。最終状態は元に戻るため、
/// ローカルサーバーの設定値は変更されない
final class SettingsUITests: XCTestCase {
    @MainActor
    func testServerSettingsLoadAndToggleRoundTrip() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.tabBars.buttons["設定"].waitForExistence(timeout: 5))
        app.tabBars.buttons["設定"].tap()

        let newsToggle = app.switches["settings.contextNews"].firstMatch
        XCTAssertTrue(newsToggle.waitForExistence(timeout: 10), "サーバー設定が読み込まれること(サーバー起動と API Secret 注入が必要)")
        XCTAssertTrue(app.descendants(matching: .any)["settings.dailyHour"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["settings.dailyCount"].firstMatch.exists)

        // タイムゾーン欄にサーバーの現在値が入っていること
        let timezone = app.descendants(matching: .any)["settings.dailyTimezone"].firstMatch
        XCTAssertTrue(timezone.exists)
        XCTAssertFalse((timezone.value as? String ?? "").isEmpty, "タイムゾーンにサーバー値が表示されること")

        let initial = newsToggle.value as? String
        let flipped = initial == "1" ? "0" : "1"

        newsToggle.tap()
        XCTAssertEqual(
            XCTWaiter().wait(for: [expectValue(flipped, of: newsToggle)], timeout: 5), .completed,
            "タップで値が反転すること"
        )
        // PUT 応答(サーバー値での上書き)後も反転値が維持されること
        sleep(2)
        XCTAssertEqual(newsToggle.value as? String, flipped, "PUT 成功後もサーバー応答の値が維持されること")

        // 元に戻す(サーバー設定を変更したままにしない)
        newsToggle.tap()
        XCTAssertEqual(
            XCTWaiter().wait(for: [expectValue(initial ?? "1", of: newsToggle)], timeout: 5), .completed,
            "もう一度タップで元の値へ戻ること"
        )
        sleep(2)
        XCTAssertEqual(newsToggle.value as? String, initial)
    }

    @MainActor
    private func expectValue(_ value: String, of element: XCUIElement) -> XCTNSPredicateExpectation {
        XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@ AND enabled == true", value),
            object: element
        )
    }
}
