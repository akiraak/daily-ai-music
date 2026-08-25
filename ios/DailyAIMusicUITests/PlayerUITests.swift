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

    /// ランダム再生: トグルで状態が切り替わり、ON でも次の曲へ送れて、シートを閉じて開いても状態が残ること。
    /// 状態は UserDefaults に残るので、開始時に OFF へ寄せ、終了時も OFF に戻して他のテストへ持ち越さない。
    /// 並びが実際にランダムになることはここでは見ない(乱数なので UI からは決定的に確かめられない。
    /// 順序を作る純関数側で分布を確認している)
    @MainActor
    func testShuffleToggle() throws {
        let app = XCUIApplication()
        app.launch()

        let firstPlayButton = app.buttons.matching(identifier: "track.play").firstMatch
        XCTAssertTrue(firstPlayButton.waitForExistence(timeout: 10), "楽曲一覧が読み込まれること(サーバー起動と API Secret 注入が必要)")
        firstPlayButton.tap()
        XCTAssertTrue(app.buttons["miniplayer.pause"].waitForExistence(timeout: 10), "再生が始まること")
        app.buttons["miniplayer.open"].tap()

        let title = app.staticTexts["player.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), "フルプレイヤーが開くこと")

        let shuffleOn = app.buttons["player.shuffle.on"]
        let shuffleOff = app.buttons["player.shuffle.off"]
        XCTAssertTrue(
            shuffleOn.waitForExistence(timeout: 5) || shuffleOff.exists,
            "ランダム再生のトグルがあること"
        )
        if shuffleOn.exists { shuffleOn.tap() }
        XCTAssertTrue(shuffleOff.waitForExistence(timeout: 5), "OFF から始められること")

        // OFF → ON
        shuffleOff.tap()
        XCTAssertTrue(shuffleOn.waitForExistence(timeout: 5), "タップで ON になること")

        // ON でも次の曲へ送れること(曲が 2 件以上あるときのみ)
        if app.buttons["player.next"].isEnabled {
            let originalTitle = title.label
            app.buttons["player.next"].tap()
            let advanced = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label != %@", originalTitle),
                object: title
            )
            XCTAssertEqual(
                XCTWaiter().wait(for: [advanced], timeout: 15), .completed,
                "ランダム再生中も次の曲へ送れること(title=\(title.label))"
            )
        }

        // シートを閉じて開き直しても ON のまま
        app.swipeDown()
        XCTAssertTrue(app.buttons["miniplayer.open"].waitForExistence(timeout: 5), "ミニプレイヤーへ戻ること")
        app.buttons["miniplayer.open"].tap()
        XCTAssertTrue(shuffleOn.waitForExistence(timeout: 5), "開き直しても ON が残ること")

        // 後片付け: OFF へ戻す
        shuffleOn.tap()
        XCTAssertTrue(shuffleOff.waitForExistence(timeout: 5), "OFF に戻せること")
    }
}
