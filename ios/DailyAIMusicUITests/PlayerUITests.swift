import XCTest

/// フルプレイヤーのスモークテスト: ミニプレイヤー本体タップでシートが開き、
/// 再生/一時停止・前の曲(3 秒以上で曲頭へ)・曲終了の自動送り(シークバーで終端近くへ)が動くこと。
/// サーバー(http://localhost:3014)が起動していて楽曲が 1 件以上あることが前提
/// (自動送りの検証は 2 件以上あるときのみ)。
final class PlayerUITests: XCTestCase {
    @MainActor
    func testFullPlayerControlsAndAutoAdvance() throws {
        let app = XCUIApplication()
        app.launch()

        // 1 曲目を再生してフルプレイヤーを開く
        let firstPlayButton = app.buttons.matching(identifier: "track.play").firstMatch
        XCTAssertTrue(firstPlayButton.waitForExistence(timeout: 10), "楽曲一覧が読み込まれること(サーバー起動と API Secret 注入が必要)")
        firstPlayButton.tap()
        XCTAssertTrue(app.buttons["miniplayer.pause"].waitForExistence(timeout: 10), "再生が始まること")
        app.buttons["miniplayer.open"].tap()

        let title = app.staticTexts["player.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), "ミニプレイヤータップでフルプレイヤーが開くこと")

        // 再生/一時停止のトグル
        let pauseButton = app.buttons["player.pause"]
        XCTAssertTrue(pauseButton.waitForExistence(timeout: 5), "フルプレイヤーが再生中表示なこと")
        pauseButton.tap()
        XCTAssertTrue(app.buttons["player.play"].waitForExistence(timeout: 5), "一時停止できること")
        app.buttons["player.play"].tap()
        XCTAssertTrue(pauseButton.waitForExistence(timeout: 5), "再開できること")

        // 3 秒以上再生してから前の曲 → 曲頭へ戻る(曲は変わらない)
        let originalTitle = title.label
        sleep(4)
        app.buttons["player.prev"].tap()
        XCTAssertEqual(title.label, originalTitle, "再生 3 秒以降の「前の曲」は曲頭へ戻るだけなこと")

        // 次の曲があるときのみ: シークバーで終端近くへ送り、曲終了で自動送りされること
        if app.buttons["player.next"].isEnabled {
            app.sliders["player.seek"].adjust(toNormalizedSliderPosition: 0.98)
            let advanced = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label != %@", originalTitle),
                object: title
            )
            XCTAssertEqual(
                XCTWaiter().wait(for: [advanced], timeout: 25), .completed,
                "曲終了で次の曲へ自動送りされること(title=\(title.label))"
            )
        }

        // シートを閉じてミニプレイヤーへ戻る
        app.swipeDown()
        XCTAssertTrue(app.buttons["miniplayer.pause"].waitForExistence(timeout: 5), "シートを閉じてもミニプレイヤーが残ること")
    }
}
