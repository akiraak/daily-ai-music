import XCTest

/// 全タブのスクリーンショットを撮る(デザインの目視確認用。docs/plans/ios-app-design.md のテスト方針)。
/// アサーションは「画面が出ること」だけで、見た目の判断は添付画像で行う。
/// ライト/ダークはアプリ側では切り替えられないため、呼び出し側で
/// `xcrun simctl ui <simulator> appearance dark` を実行してから撮り直す。
/// ファイル名の接頭辞は TEST_RUNNER_SCREENSHOT_STYLE で渡す
/// (xcodebuild の引数ではなくシェルの環境変数として。引数だと build setting 扱いになり届かない)。
/// 実行例: cd ios && TEST_RUNNER_SCREENSHOT_STYLE=Dark xcodebuild test \
///   -project DailyAIMusic.xcodeproj -scheme DailyAIMusic \
///   -destination 'platform=iOS Simulator,name=iPhone 17' \
///   -only-testing:DailyAIMusicUITests/ScreenshotUITests \
///   -resultBundlePath /tmp/shots.xcresult BACKEND_API_SECRET=<.env の API_SECRET>
/// 添付画像の取り出し: xcrun xcresulttool export attachments --path /tmp/shots.xcresult --output-path <dir>
final class ScreenshotUITests: XCTestCase {
    @MainActor
    func testCaptureAllTabs() throws {
        let style = ProcessInfo.processInfo.environment["SCREENSHOT_STYLE"] ?? "Light"
        let app = XCUIApplication()
        app.launch()

        // ライブラリタブ: 一覧が読み込まれたら 1 曲再生してミニプレイヤーも写す
        let firstRow = app.buttons.matching(identifier: "track.row").firstMatch
        if firstRow.waitForExistence(timeout: 10) {
            attach(app, name: "\(style)-library")
            app.buttons.matching(identifier: "track.play").firstMatch.tap()
            _ = app.buttons["miniplayer.pause"].waitForExistence(timeout: 10)
            attach(app, name: "\(style)-library-playing")

            // フルプレイヤー: ミニプレイヤー本体タップでシートを開き、歌詞画面も撮る
            app.buttons["miniplayer.open"].tap()
            if app.staticTexts["player.title"].waitForExistence(timeout: 5) {
                attach(app, name: "\(style)-player")
                // ランダム再生 ON の見た目(ティントが乗った状態)も撮って、撮り終えたら OFF に戻す
                if app.buttons["player.shuffle.off"].exists {
                    app.buttons["player.shuffle.off"].tap()
                    _ = app.buttons["player.shuffle.on"].waitForExistence(timeout: 3)
                    attach(app, name: "\(style)-player-shuffle")
                    app.buttons["player.shuffle.on"].tap()
                    _ = app.buttons["player.shuffle.off"].waitForExistence(timeout: 3)
                }
                if app.buttons["player.lyrics"].exists {
                    app.buttons["player.lyrics"].tap()
                    _ = app.buttons["player.lyrics.ja"].waitForExistence(timeout: 3)
                    attach(app, name: "\(style)-player-lyrics")
                    app.navigationBars.buttons.firstMatch.tap()
                    _ = app.buttons["player.lyrics"].waitForExistence(timeout: 3)
                }
                // シートを閉じ切って、行が押せるようになるまで待つ
                dismissPlayerSheet(app)
                let rowHittable = XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "hittable == true"), object: firstRow
                )
                _ = XCTWaiter().wait(for: [rowHittable], timeout: 5)
            }

            // 楽曲詳細: 行タップで遷移し、スクロールして歌詞側も撮る
            firstRow.tap()
            if app.buttons["detail.play"].waitForExistence(timeout: 5) {
                attach(app, name: "\(style)-detail")
                app.swipeUp()
                attach(app, name: "\(style)-detail-scrolled")
                // 生成プロンプトの折りたたみを開いた状態も撮る(llmPrompt 無し旧データではボタン自体が無い)
                let prompt = app.buttons["detail.prompt"]
                if prompt.exists {
                    // 画面下端はミニプレイヤーが覆っている。隠れたまま tap すると座標が
                    // ミニプレイヤーに当たってフルプレイヤーのシートが開き、以降の操作が
                    // すべてシートに吸われるので、押せるようになるまでスクロールする
                    // (詳細画面はセクションが増えると伸びるため 1 回の swipe では足りない)
                    var scrolls = 0
                    while !prompt.isHittable && scrolls < 5 {
                        app.swipeUp()
                        scrolls += 1
                    }
                    if prompt.isHittable {
                        prompt.tap()
                        // isHittable でもレイアウトのずれでシートが開いてしまうことがある。
                        // 開いたら閉じてスクロールし直し、もう一度だけ押す
                        if dismissPlayerSheet(app) {
                            app.swipeUp()
                            if prompt.isHittable { prompt.tap() }
                        }
                        app.swipeUp()
                        attach(app, name: "\(style)-detail-prompt")
                    }
                }
                app.navigationBars.buttons.firstMatch.tap()
            }
        } else {
            attach(app, name: "\(style)-library-empty")
        }

        // タブへ移る前に、開いたままのシートが残っていないことを確かめる
        // (残っていると以降のタップがすべてシートに吸われ、タブの中身が撮れない)
        dismissPlayerSheet(app)

        for (tab, name) in [("生成", "generate"), ("参照曲", "reference"), ("設定", "settings")] {
            XCTAssertTrue(app.tabBars.buttons[tab].waitForExistence(timeout: 5))
            app.tabBars.buttons[tab].tap()
            // 設定タブはサーバー設定の読み込みを待ってから撮り、スクロール後(サーバー接続側)も撮る
            if name == "settings" {
                _ = app.switches["settings.dailyEnabled"].firstMatch.waitForExistence(timeout: 5)
            }
            attach(app, name: "\(style)-\(name)")
            if name == "generate" {
                // 生成パラメータ画面(push)も、読み込み完了を待ってから撮る。
                // 参照曲の候補が長いため、スクロール後と最下部(リアルワード)も撮る
                app.buttons["generate.params"].tap()
                if app.staticTexts["params.context"].waitForExistence(timeout: 10) {
                    attach(app, name: "\(style)-generate-params")
                    app.swipeUp()
                    attach(app, name: "\(style)-generate-params-scrolled")
                    app.swipeUp()
                    app.swipeUp()
                    attach(app, name: "\(style)-generate-params-bottom")
                }
                app.navigationBars.buttons.firstMatch.tap()
            }
            if name == "settings" {
                app.swipeUp()
                attach(app, name: "\(style)-settings-scrolled")
            }
        }
    }

    /// フルプレイヤーのシートが開いていたら閉じる(閉じたら true)。
    /// 上端付近から下へドラッグする(swipeDown はスライダー等に当たると閉じないことがある)
    @MainActor
    @discardableResult
    private func dismissPlayerSheet(_ app: XCUIApplication) -> Bool {
        let title = app.staticTexts["player.title"]
        guard title.exists else { return false }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
        let closed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: title
        )
        _ = XCTWaiter().wait(for: [closed], timeout: 5)
        return true
    }

    @MainActor
    private func attach(_ app: XCUIApplication, name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
