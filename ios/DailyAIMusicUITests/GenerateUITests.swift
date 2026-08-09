import XCTest

/// 生成タブのスモークテスト: おまかせ生成ボタンの表示と、カスタム生成の折りたたみ開閉・
/// 入力による送信ボタンの有効化を確認する。
/// 実際の生成(クレジット消費)は行わないため、おまかせ生成・生成するボタンはタップしない。
/// サーバー(http://localhost:3014)が起動していることが前提。
final class GenerateUITests: XCTestCase {
    @MainActor
    func testDailyHeroAndCustomDisclosure() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["生成"].tap()
        XCTAssertTrue(app.buttons["generate.daily"].waitForExistence(timeout: 5), "おまかせ生成ボタンが表示されること")

        // カスタム生成は折りたたまれている(入力欄の要素タイプは iOS 版により変わるため any で探す)
        let toggle = app.buttons["generate.custom.toggle"]
        let prompt = app.descendants(matching: .any)["generate.custom.prompt"].firstMatch
        XCTAssertTrue(toggle.exists, "カスタム生成の折りたたみ行があること")
        XCTAssertFalse(prompt.exists, "初期状態では入力欄が隠れていること")

        // 開くと入力欄が出て、空のままでは送信できない
        toggle.tap()
        XCTAssertTrue(prompt.waitForExistence(timeout: 3), "開くと入力欄が出ること")
        let submit = app.buttons["generate.custom.submit"]
        XCTAssertFalse(submit.isEnabled, "空のままでは生成するが無効なこと")

        // 入力すると送信ボタンが有効になる(実際の送信はしない)
        prompt.tap()
        prompt.typeText("テスト用プロンプト")
        XCTAssertTrue(submit.isEnabled, "入力すると生成するが有効になること")

        // 複数行入力欄は return が改行になるため、キーボードツールバーの「閉じる」で閉じる
        // (シミュレータにハードウェアキーボードが接続されているとソフトウェアキーボードが
        // 出ないため、キーボード表示を前提条件にガードする)
        if app.keyboards.firstMatch.exists {
            let done = app.buttons["generate.keyboard.done"]
            XCTAssertTrue(done.waitForExistence(timeout: 3), "キーボードツールバーに閉じるボタンが出ること")
            attachScreenshot(app, name: "keyboard-open")
            done.tap()
            XCTAssertTrue(
                app.keyboards.firstMatch.waitForNonExistence(timeout: 3),
                "閉じるでキーボードが消えること"
            )
            attachScreenshot(app, name: "keyboard-dismissed")
        }

        // 閉じると入力欄が隠れる
        toggle.tap()
        XCTAssertFalse(prompt.exists, "閉じると入力欄が隠れること")
    }

    /// キーボード開閉の目視確認用スクリーンショットを xcresult に添付する
    @MainActor
    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
