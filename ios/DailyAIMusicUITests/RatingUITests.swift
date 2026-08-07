import XCTest

/// 楽曲一覧の 👍/👎 トグルのスモークテスト。
/// サーバー(http://localhost:3014)が起動していて楽曲が 1 件以上あることが前提。
/// 最後に元の評価状態へ戻すため、実行してもデータは変化しない。
final class RatingUITests: XCTestCase {
    @MainActor
    func testThumbsUpTogglesAndRestores() throws {
        let app = XCUIApplication()
        app.launch()

        let firstRow = app.buttons.matching(identifier: "track.row").firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 10), "楽曲一覧が読み込まれること(サーバー起動と API Secret 注入が必要)")

        let up = app.buttons.matching(identifier: "track.rate.up").firstMatch
        let down = app.buttons.matching(identifier: "track.rate.down").firstMatch
        XCTAssertTrue(up.exists && down.exists, "各行に 👍/👎 ボタンがあること")

        let upWasOn = stringValue(of: up) == "on"
        let downWasOn = stringValue(of: down) == "on"

        // 👍 をタップ → トグルされる(off なら on、on なら解除)
        up.tap()
        waitForValue(up, upWasOn ? "off" : "on", "👍 タップで状態が切り替わること")
        if downWasOn {
            waitForValue(down, "off", "👍 を付けると 👎 は外れること")
        }

        // もう一度タップ → 👍 が元に戻る
        up.tap()
        waitForValue(up, upWasOn ? "on" : "off", "👍 再タップで元に戻ること")

        // 元が 👎 だった場合は付け直してデータを復元する
        if downWasOn {
            down.tap()
            waitForValue(down, "on", "👎 を復元できること")
        }
    }

    private func stringValue(of element: XCUIElement) -> String {
        element.value as? String ?? ""
    }

    private func waitForValue(
        _ element: XCUIElement, _ expected: String, _ message: String,
        timeout: TimeInterval = 10
    ) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", expected),
            object: element
        )
        let result = XCTWaiter().wait(for: [expectation], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(message)(value=\(stringValue(of: element)))")
    }
}
