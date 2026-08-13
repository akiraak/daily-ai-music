import XCTest

/// 生成まわりのスモークテスト: 生成タブの導線(おまかせ生成・曲を選んで生成・生成パラメータ)と
/// 参照曲の管理(アーティスト一覧 → 曲一覧・追加シート)の表示を確認する。
/// タブ構成は検討中(案 1 = 参照曲タブ / 案 2 = 生成タブ内。docs/plans/generation-ui-restructure.md)
/// のため、テストごとに launch arguments で UserDefaults の uiVariant を固定して両案を確かめる。
/// 実際の生成(クレジット消費)は行わない。
/// サーバー(http://localhost:3014)が起動していることが前提。
final class GenerateUITests: XCTestCase {
    /// タブ構成を固定して起動する(-uiVariant は UserDefaults の NSArgumentDomain に入る)
    @MainActor
    private func launch(variant: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiVariant", variant]
        app.launch()
        return app
    }

    /// 案 1(4 タブ): 生成タブは「おまかせ / 曲を選んで生成 / 生成パラメータ」だけで、
    /// 参照曲の管理は独立タブに出る
    @MainActor
    func testFourTabsLayout() throws {
        let app = launch(variant: "four_tabs")

        app.tabBars.buttons["生成"].tap()
        XCTAssertTrue(app.buttons["generate.daily"].waitForExistence(timeout: 5), "おまかせ生成ボタンが表示されること")
        XCTAssertTrue(app.buttons["generate.songPicker"].exists, "曲を選んで生成の行があること")
        XCTAssertTrue(app.buttons["generate.params"].exists, "生成パラメータの行があること")
        XCTAssertFalse(app.buttons["generate.manageReference"].exists, "案 1 では参照曲の管理の行が無いこと")

        XCTAssertTrue(app.tabBars.buttons["参照曲"].exists, "参照曲タブがあること")
        attachScreenshot(app, name: "generate-tab-four")

        app.tabBars.buttons["参照曲"].tap()
        XCTAssertTrue(
            app.navigationBars["参照曲"].waitForExistence(timeout: 5),
            "参照曲タブでアーティスト一覧が出ること"
        )
        XCTAssertTrue(app.buttons["artists.add"].waitForExistence(timeout: 3), "追加ボタンがあること")
        attachScreenshot(app, name: "reference-tab-four")
    }

    /// 案 2(3 タブ): 参照曲タブは無く、生成タブに「参照曲の管理」の行が出る
    @MainActor
    func testThreeTabsLayout() throws {
        let app = launch(variant: "three_tabs")

        XCTAssertTrue(app.tabBars.buttons["生成"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.tabBars.buttons["参照曲"].exists, "案 2 では参照曲タブが無いこと")

        app.tabBars.buttons["生成"].tap()
        XCTAssertTrue(app.buttons["generate.daily"].waitForExistence(timeout: 5), "おまかせ生成ボタンが表示されること")
        for identifier in ["generate.songPicker", "generate.manageReference", "generate.params"] {
            XCTAssertTrue(app.buttons[identifier].exists, "\(identifier) の行があること")
        }
        attachScreenshot(app, name: "generate-tab-three")

        app.buttons["generate.manageReference"].tap()
        XCTAssertTrue(
            app.navigationBars["参照曲"].waitForExistence(timeout: 5),
            "参照曲の管理(アーティスト一覧)へ遷移すること"
        )
        attachScreenshot(app, name: "reference-pushed-three")
    }

    /// 参照曲の追加シート(アーティスト名 / 曲名の 2 経路を統合)。
    /// 登録は外部の iTunes 通信を伴うためここでは掘らない(サーバー側は curl シナリオでカバー済み)
    @MainActor
    func testAddReferenceSheet() throws {
        let app = launch(variant: "four_tabs")

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
        let app = launch(variant: "four_tabs")

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

    /// 曲を選んで生成(有効な参照曲の横断リスト)と、そこからの曲名検索
    /// (登録済みにない曲を探す)。候補はタップしない(登録 → 生成まで進んで
    /// クレジットを消費するため。サーバー側は curl シナリオでカバー済み)
    @MainActor
    func testSongPickerAndSearchEntryPoint() throws {
        let app = launch(variant: "four_tabs")

        app.tabBars.buttons["生成"].tap()
        let row = app.buttons["generate.songPicker"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "曲を選んで生成の行があること")

        row.tap()
        XCTAssertTrue(
            app.navigationBars["曲を選んで生成"].waitForExistence(timeout: 5),
            "曲を選んで生成へ遷移すること"
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
