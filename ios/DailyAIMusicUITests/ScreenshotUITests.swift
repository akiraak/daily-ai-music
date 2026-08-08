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
                if app.buttons["player.lyrics"].exists {
                    app.buttons["player.lyrics"].tap()
                    _ = app.buttons["player.lyrics.ja"].waitForExistence(timeout: 3)
                    attach(app, name: "\(style)-player-lyrics")
                    app.navigationBars.buttons.firstMatch.tap()
                    _ = app.buttons["player.lyrics"].waitForExistence(timeout: 3)
                }
                // シートは上端付近から下へドラッグして閉じる(swipeDown はスライダー等に
                // 当たると閉じないことがある)。閉じ切って行が押せるようになるまで待つ
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08))
                    .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
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
                app.navigationBars.buttons.firstMatch.tap()
            }
        } else {
            attach(app, name: "\(style)-library-empty")
        }

        for (tab, name) in [("生成", "generate"), ("設定", "settings")] {
            XCTAssertTrue(app.tabBars.buttons[tab].waitForExistence(timeout: 5))
            app.tabBars.buttons[tab].tap()
            attach(app, name: "\(style)-\(name)")
            // 生成タブはカスタム生成を開いた状態も撮る(生成ボタンはタップしない)
            if name == "generate" {
                app.buttons["generate.custom.toggle"].tap()
                attach(app, name: "\(style)-generate-custom")
                app.buttons["generate.custom.toggle"].tap()
            }
        }
    }

    @MainActor
    private func attach(_ app: XCUIApplication, name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
