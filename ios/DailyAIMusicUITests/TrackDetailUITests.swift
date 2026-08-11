import XCTest

/// 行タップ → 楽曲詳細の遷移と、詳細内の操作(原文スタイル折りたたみ・歌詞言語切替)のスモークテスト。
/// サーバー(http://localhost:3014)が起動していて、LLM 生成の楽曲(スタイル・歌詞あり)が
/// 先頭に 1 件以上あることが前提。
final class TrackDetailUITests: XCTestCase {
    @MainActor
    func testRowOpensDetailAndSectionsInteract() throws {
        let app = XCUIApplication()
        app.launch()

        let firstRow = app.buttons.matching(identifier: "track.row").firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 10), "楽曲一覧が読み込まれること(サーバー起動と API Secret 注入が必要)")
        firstRow.tap()

        // 詳細画面が開く(再生ピル)
        XCTAssertTrue(app.buttons["detail.play"].waitForExistence(timeout: 5), "行タップで楽曲詳細へ遷移すること")

        // 原文スタイルの折りたたみが開閉できる
        let original = app.buttons["detail.style.original"]
        if original.exists {
            original.tap()
            XCTAssertTrue(original.label.contains("隠す"), "展開でラベルが「原文スタイルを隠す」に変わること")
            original.tap()
            XCTAssertTrue(original.label.contains("表示"), "再タップで折りたたまれること")
        }

        // 歌詞の言語セグメントが切り替わる(英語・日本語の両方がある曲のみ)
        let english = app.buttons["detail.lyrics.en"]
        if english.exists {
            english.tap()
            app.buttons["detail.lyrics.ja"].tap()
        }

        // 戻る → ヒーロー(今日の一曲)があればタップでも詳細が開く
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(firstRow.waitForExistence(timeout: 5), "ライブラリへ戻れること")
        let hero = app.otherElements["hero.card"].firstMatch
        if hero.exists {
            hero.tap()
            XCTAssertTrue(app.buttons["detail.play"].waitForExistence(timeout: 5), "ヒーロータップでも詳細へ遷移すること")
        }
    }
}
