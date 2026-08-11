import XCTest

/// 生成タブのスモークテスト: おまかせ生成ボタンと、参照曲を選ぶ 3 つの導線
/// (生成パラメータ・曲名から生成・アーティストから生成)の表示を確認する。
/// 実際の生成(クレジット消費)は行わないため、おまかせ生成ボタンはタップしない。
/// サーバー(http://localhost:3014)が起動していることが前提。
final class GenerateUITests: XCTestCase {
    @MainActor
    func testDailyHeroAndEntryRows() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["生成"].tap()
        XCTAssertTrue(app.buttons["generate.daily"].waitForExistence(timeout: 5), "おまかせ生成ボタンが表示されること")

        // 参照曲ベースの入口が並ぶ(カスタム生成は 2026-08-10 に廃止)
        for identifier in ["generate.params", "generate.songSearch", "generate.artists"] {
            XCTAssertTrue(app.buttons[identifier].exists, "\(identifier) の行があること")
        }
        attachScreenshot(app, name: "generate-tab")
    }

    /// アーティスト経由生成への導線。一覧の表示までを確認する(登録は外部の iTunes 通信を
    /// 伴うためここでは掘らない。サーバー側は curl シナリオでカバー済み)。
    /// 実際の生成(クレジット消費)は行わないため、曲はタップしない
    @MainActor
    func testArtistsEntryPoint() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["生成"].tap()
        let row = app.buttons["generate.artists"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "アーティストから生成の行があること")

        row.tap()
        XCTAssertTrue(
            app.navigationBars["アーティスト"].waitForExistence(timeout: 5),
            "アーティスト一覧へ遷移すること"
        )
        // 未登録なら空表示、登録済みなら行が出る。どちらでも + から追加シートを開ける
        let add = app.buttons["artists.add"]
        XCTAssertTrue(add.waitForExistence(timeout: 3), "追加ボタンがあること")
        add.tap()
        XCTAssertTrue(
            app.navigationBars["アーティストを追加"].waitForExistence(timeout: 3),
            "追加シートが開くこと"
        )
        attachScreenshot(app, name: "artists-add-sheet")
        app.buttons["閉じる"].tap()
        XCTAssertTrue(
            app.navigationBars["アーティスト"].waitForExistence(timeout: 3),
            "閉じるでシートが閉じること"
        )
        attachScreenshot(app, name: "artists-list")
    }

    /// 曲名からの生成への導線。検索して候補が並ぶところまでを確認する
    /// (登録は iTunes からの取り込みと生成まで進んでクレジットを消費するため候補はタップしない。
    /// サーバー側は curl シナリオでカバー済み)
    @MainActor
    func testSongSearchEntryPoint() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["生成"].tap()
        let row = app.buttons["generate.songSearch"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "曲名から生成の行があること")

        row.tap()
        XCTAssertTrue(
            app.navigationBars["曲名から生成"].waitForExistence(timeout: 5),
            "曲名検索画面へ遷移すること"
        )
        let term = app.descendants(matching: .any)["song.search.term"].firstMatch
        XCTAssertTrue(term.waitForExistence(timeout: 3), "曲名の入力欄があること")
        let submit = app.buttons["song.search.submit"]
        XCTAssertFalse(submit.isEnabled, "空のままでは検索できないこと")

        term.tap()
        term.typeText("Lemon")
        XCTAssertTrue(submit.isEnabled, "入力すると検索が有効になること")
        submit.tap()

        // 候補は iTunes 経由なので待ち時間を長めに取る
        let candidate = app.buttons["song.candidate"].firstMatch
        XCTAssertTrue(candidate.waitForExistence(timeout: 20), "曲の候補が並ぶこと")
        attachScreenshot(app, name: "song-search-candidates")
    }

    /// 目視確認用スクリーンショットを xcresult に添付する
    @MainActor
    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
