import XCTest

/// 生成まわりのスモークテスト: 生成タブの導線(おまかせ生成・曲を選んで生成・生成パラメータ)と
/// 参照曲タブ(アーティスト一覧 → 曲一覧・追加シート)の表示を確認する。
/// 実際の生成(クレジット消費)は行わない。
/// サーバー(http://localhost:3014)が起動していることが前提。
final class GenerateUITests: XCTestCase {
    /// タブ構成(4 タブ)と生成タブの 3 経路(おまかせ / アーティストでおまかせ / 曲から生成)。
    /// おまかせは確認ダイアログが出るところまで見て、実行はせずに閉じる(クレジット消費を避ける)
    @MainActor
    func testTabsAndGenerateEntryRows() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["生成"].tap()
        XCTAssertTrue(app.buttons["generate.daily"].waitForExistence(timeout: 5), "おまかせの行が表示されること")
        XCTAssertTrue(app.buttons["generate.artistPicker"].exists, "アーティストでおまかせの行があること")
        XCTAssertTrue(app.buttons["generate.songPicker"].exists, "曲から生成の行があること")
        XCTAssertTrue(app.buttons["generate.params"].exists, "生成パラメータの行があること")
        attachScreenshot(app, name: "generate-tab")

        // おまかせは即実行ではなく確認ダイアログ(誤タップで課金しない)
        app.buttons["generate.daily"].tap()
        XCTAssertTrue(
            app.staticTexts["おまかせで 1 曲生成しますか?"].waitForExistence(timeout: 3),
            "おまかせの確認ダイアログが出ること"
        )
        attachScreenshot(app, name: "generate-daily-confirm")
        dismissConfirmationDialog(app)
        XCTAssertTrue(app.buttons["generate.daily"].waitForExistence(timeout: 3), "閉じると生成タブに戻ること")

        XCTAssertTrue(app.tabBars.buttons["参照曲"].exists, "参照曲タブがあること")
        app.tabBars.buttons["参照曲"].tap()
        XCTAssertTrue(
            app.navigationBars["参照曲"].waitForExistence(timeout: 5),
            "参照曲タブでアーティスト一覧が出ること"
        )
        XCTAssertTrue(app.buttons["artists.add"].waitForExistence(timeout: 3), "追加ボタンがあること")
        attachScreenshot(app, name: "reference-tab")
    }

    /// アーティストでおまかせ。有効な曲を持つアーティストの一覧 → 確認ダイアログまでを見て、
    /// 実行はせずに閉じる(クレジット消費を避ける。サーバー側は curl シナリオでカバー済み)
    @MainActor
    func testArtistPickerEntryPoint() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["生成"].tap()
        let row = app.buttons["generate.artistPicker"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "アーティストでおまかせの行があること")
        row.tap()
        XCTAssertTrue(
            app.navigationBars["アーティストでおまかせ"].waitForExistence(timeout: 5),
            "アーティスト選択画面へ遷移すること"
        )
        let artist = app.buttons["artistPicker.row"].firstMatch
        guard artist.waitForExistence(timeout: 5) else {
            throw XCTSkip("有効な参照曲を持つアーティストがいないため確認ダイアログまで進めない")
        }
        attachScreenshot(app, name: "artist-picker")
        artist.tap()
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "label ENDSWITH %@", "でおまかせ生成しますか?")
            ).firstMatch.waitForExistence(timeout: 3),
            "確認ダイアログが出ること"
        )
        attachScreenshot(app, name: "artist-picker-confirm")
        dismissConfirmationDialog(app)
        XCTAssertTrue(artist.waitForExistence(timeout: 3), "閉じると一覧に戻ること")
    }

    /// 確認ダイアログを実行せずに閉じる。行から出したダイアログもポップオーバーで表示され、
    /// キャンセル行が描かれないことがある(iOS 標準の挙動)ため、無ければ外側タップで閉じる
    @MainActor
    private func dismissConfirmationDialog(_ app: XCUIApplication) {
        let cancel = app.buttons["キャンセル"]
        if cancel.waitForExistence(timeout: 1) {
            cancel.tap()
        } else {
            app.otherElements["PopoverDismissRegion"].tap()
        }
    }

    /// 参照曲の追加シート(アーティスト名 / 曲名の 2 経路を統合)。
    /// 登録は外部の iTunes 通信を伴うためここでは掘らない(サーバー側は curl シナリオでカバー済み)
    @MainActor
    func testAddReferenceSheet() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["参照曲"].tap()
        let add = app.buttons["artists.add"]
        XCTAssertTrue(add.waitForExistence(timeout: 5), "追加ボタンがあること")
        add.tap()
        XCTAssertTrue(
            app.navigationBars["参照曲を追加"].waitForExistence(timeout: 3),
            "追加シートが開くこと"
        )
        XCTAssertTrue(
            app.descendants(matching: .any)["artists.add.mode"].firstMatch.exists,
            "アーティスト名 / 曲名の切り替えがあること"
        )
        attachScreenshot(app, name: "reference-add-sheet")
        app.buttons["閉じる"].tap()
        XCTAssertTrue(
            app.navigationBars["参照曲"].waitForExistence(timeout: 3),
            "閉じるでシートが閉じること"
        )
    }

    /// アーティストの曲一覧。有効/無効のトグルと表示フィルタが出るところまでを確認する
    /// (トグルを実際に動かすとサーバーの曲が無効になるため、ここでは表示だけ見る。
    /// PATCH は curl シナリオでカバー済み)
    @MainActor
    func testArtistSongsShowEnabledToggle() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["参照曲"].tap()
        let artist = app.buttons["artists.row"].firstMatch
        guard artist.waitForExistence(timeout: 5) else {
            throw XCTSkip("アーティストが登録されていないため曲一覧を開けない")
        }
        artist.tap()

        XCTAssertTrue(
            app.descendants(matching: .any)["artist.songs.filter"].firstMatch
                .waitForExistence(timeout: 5),
            "曲の絞り込み欄があること"
        )
        XCTAssertTrue(
            app.descendants(matching: .any)["artist.songs.visibility"].firstMatch.exists,
            "表示フィルタ(すべて / 有効のみ)があること"
        )
        XCTAssertTrue(
            app.switches["artist.song.toggle"].firstMatch.waitForExistence(timeout: 5),
            "曲行に有効/無効のトグルがあること"
        )
        attachScreenshot(app, name: "artist-songs")

        // 一括操作は確認ダイアログが出るところまで見て、実行はせずに閉じる
        // (実行するとサーバーの曲がまとめて書き換わるため。PATCH は curl シナリオでカバー済み)
        let bulk = app.buttons["artist.songs.bulk"]
        XCTAssertTrue(bulk.waitForExistence(timeout: 3), "一括操作のメニューがあること")
        bulk.tap()
        let enableAll = app.buttons["artist.songs.bulk.enable"]
        XCTAssertTrue(enableAll.waitForExistence(timeout: 3), "「表示中を全て有効」があること")
        XCTAssertTrue(app.buttons["artist.songs.bulk.disable"].exists, "「表示中を全て無効」があること")
        attachScreenshot(app, name: "artist-songs-bulk-menu")

        enableAll.tap()
        XCTAssertTrue(
            app.buttons["有効にする"].waitForExistence(timeout: 3),
            "確認ダイアログが出ること"
        )
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "label ENDSWITH %@", "曲を有効にしますか?")
            ).firstMatch.exists,
            "確認ダイアログに対象の曲数が出ること"
        )
        attachScreenshot(app, name: "artist-songs-bulk-confirm")

        // メニューから出した確認ダイアログはポップオーバーで表示され、キャンセル行は描かれない
        // (iOS 標準の挙動。外側をタップして閉じる)
        app.otherElements["PopoverDismissRegion"].tap()
        XCTAssertTrue(
            bulk.waitForExistence(timeout: 3),
            "ダイアログを閉じると曲一覧に戻ること"
        )
    }

    /// 曲から生成(有効な参照曲の横断リスト)と、そこからの曲名検索
    /// (登録済みにない曲を探す)。候補はタップしない(登録 → 生成まで進んで
    /// クレジットを消費するため。サーバー側は curl シナリオでカバー済み)
    @MainActor
    func testSongPickerAndSearchEntryPoint() throws {
        let app = XCUIApplication()
        app.launch()

        app.tabBars.buttons["生成"].tap()
        let row = app.buttons["generate.songPicker"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "曲から生成の行があること")

        row.tap()
        XCTAssertTrue(
            app.navigationBars["曲から生成"].waitForExistence(timeout: 5),
            "曲から生成へ遷移すること"
        )
        XCTAssertTrue(
            app.descendants(matching: .any)["songPicker.filter"].firstMatch.waitForExistence(timeout: 5),
            "絞り込み欄があること"
        )
        attachScreenshot(app, name: "song-picker")

        let search = app.buttons["songPicker.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 3), "「登録済みにない曲を探す」の行があること")
        search.tap()
        XCTAssertTrue(
            app.navigationBars["曲名から探す"].waitForExistence(timeout: 5),
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
