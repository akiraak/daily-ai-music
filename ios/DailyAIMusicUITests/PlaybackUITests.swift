import XCTest

/// 楽曲一覧 → タップ → ミニプレイヤー表示・再生開始のスモークテスト。
/// サーバー(http://localhost:3014)が起動していて楽曲が 1 件以上あることが前提。
/// 実行例: cd ios && xcodebuild test -project DailyAIMusic.xcodeproj -scheme DailyAIMusic \
///   -destination 'platform=iOS Simulator,name=iPhone 17' BACKEND_API_SECRET=<.env の API_SECRET>
final class PlaybackUITests: XCTestCase {
    @MainActor
    func testTapTrackShowsMiniPlayerAndStartsPlaying() throws {
        let app = XCUIApplication()
        app.launch()

        let firstRow = app.buttons.matching(identifier: "track.row").firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 10), "楽曲一覧が読み込まれること(サーバー起動と API Secret 注入が必要)")
        firstRow.tap()

        // 再生が始まればミニプレイヤーの一時停止ボタンが出る
        let pauseButton = app.buttons["miniplayer.pause"]
        XCTAssertTrue(pauseButton.waitForExistence(timeout: 10), "タップでミニプレイヤーが表示され再生中になること")

        // 一時停止 → 再生ボタンに切り替わる
        pauseButton.tap()
        XCTAssertTrue(app.buttons["miniplayer.play"].waitForExistence(timeout: 5), "一時停止で再生ボタンに切り替わること")
    }
}
