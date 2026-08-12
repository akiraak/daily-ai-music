# アーティストの曲を全て有効/無効にできる仕組みをアプリに入れる

## 目的・背景

参照曲は曲ごとに有効/無効を持ち(2026-08-11 導入、[artist-song-enabled-flag](archive/artist-song-enabled-flag.md))、**取り込みは既定で無効**。1 アーティスト最大 200 曲が無効の状態で入るため、使いたい曲を選ぶ操作が必ず発生する。

いま iOS の曲一覧(`ArtistSongsView`)にあるのは **行ごとのトグルだけ** で、

- 「このアーティストは全部いいから全部有効にしたい」を 200 回タップでしかできない
- 「一旦全部無効にしてから選び直したい」ができない

Web 管理画面には既に一括操作(全て有効 / 全て無効)がある。前回のプランでは「iOS からの一括操作(管理画面で足りる)」をスコープ外にしたが、実際の運用は iPhone からのため、同じ操作をアプリにも入れる。

**サーバーは変更不要**。`PATCH /api/artists/:id/songs`(body `{ enabled, ids? }` → `{ artist, updated }`)が既にあり、`ids` 省略でそのアーティストの全曲、指定すればその曲だけを更新する(`setArtistSongsEnabled()` は `WHERE artist_id = ?` で絞るので、他アーティストの id が混ざっても無視される)。今回は iOS からこれを呼ぶだけ。

## 決めたこと(方針)

| 論点 | 決定 | 理由 |
|---|---|---|
| 対象の範囲 | **表示中の曲**(絞り込み + 表示フィルタ適用後)。全件なら `ids` 省略、部分なら `ids` を送る | 管理画面と同じ意味論。「全て」と言いながら見えていない曲まで変えると取り返しがつかない。絞り込みと組み合わせれば「"Live" を含む曲だけ無効」のような操作もできる |
| 置き場所 | ナビゲーションバー右上のメニュー(`ellipsis.circle`) | 画面上部は絞り込み欄・表示フィルタ・件数表示で既に詰まっており、ボタンを 2 つ足すと曲行(生成の主導線)が下がる。破壊的な操作なので 1 タップ目に置かないほうが安全 |
| 確認 | `confirmationDialog` で「表示中の N 曲を有効にしますか?」/ 全件なら「全 N 曲を〜」。無効側は `role: .destructive` | 200 曲が一度に変わるため。管理画面の `confirm()` と揃える |
| 反映 | 楽観更新はせず、PATCH 成功後に `load()` で取り直す | 200 行の巻き戻しは煩雑で、サーバーの結果を正としたほうが単純。件数表示(有効 N / 全 M)も同時に正しくなる |
| 成功時の通知 | 出さない(件数表示の変化で伝わる) | トーストの仕組みが今のアプリに無く、この 1 画面のために足す価値が薄い |
| アーティスト一覧からの一括操作 | やらない(曲一覧の中だけ) | 対象が「表示中の曲」である以上、絞り込みのある曲一覧が置き場所として正しい。入口を 2 つにすると意味論も 2 つになる |

### 却下した案

- **セグメントの隣にボタン 2 つ**: 常時見えるのは利点だが、破壊的操作が誤爆しやすく、上部の情報量も増える
- **選択モード(複数選択 → まとめて操作)**: `List` を使っていない画面なので `EditButton` 相当が使えず自前実装になる。絞り込み + 表示フィルタで対象を作るいまの方式で用は足りる

## Phase 1: iOS の曲一覧に一括操作を入れる

### `ios/DailyAIMusic/Sources/Models/APIModels.swift`

```swift
/// PATCH /api/artists/:id/songs の body(曲の一括更新)
struct SetArtistSongsEnabledRequest: Encodable {
    let enabled: Bool
    /// 対象の曲 id。nil はそのアーティストの全曲(Encodable は nil のキーを出さない)
    let ids: [Int]?
}

struct ArtistSongsBulkResponse: Decodable {
    let artist: Artist
    /// 実際に更新された曲数
    let updated: Int
}
```

### `ios/DailyAIMusic/Sources/Views/ArtistSongsView.swift`

- `@State private var pendingBulk: BulkAction?` と `@State private var isBulkUpdating = false` を追加
  - `BulkAction` は `enabled: Bool` を持つだけの小さい `Identifiable`(確認ダイアログの出し分け用)
- `.toolbar` に `ToolbarItem(placement: .topBarTrailing)` で `Menu`
  - 「表示中を全て有効」「表示中を全て無効(`role: .destructive`)」
  - `filteredSongs.isEmpty || isBulkUpdating || isGenerating` のとき `disabled`
  - `accessibilityIdentifier`: メニュー `artist.songs.bulk`、項目 `artist.songs.bulk.enable` / `artist.songs.bulk.disable`
- 確認ダイアログ(既存の生成確認とは別の `confirmationDialog`)
  - タイトルは対象数で出し分け — 全件なら「全 N 曲を有効にしますか?」、部分なら「表示中の N 曲を〜」
  - メッセージは有効化のとき「有効にした曲は毎日の自動生成の参照曲候補になります。」
- `setAllEnabled(_ enabled: Bool)`
  - `targets = filteredSongs`、`ids = targets.count == songs.count ? nil : targets.map(\.id)`
  - `isBulkUpdating = true`(`defer` で戻す)→ `BackendAPI.patchJSON(ArtistSongsBulkResponse.self, path: "/api/artists/\(artist.id)/songs", body: ...)` → `await load()`
  - 失敗は `errorMessage` に出すだけ(既存のトグル失敗と同じ扱い)
- 進行表示は既存の「生成を開始しています…」行の隣に「曲を更新しています…」を同じ形で出す
- 画面上部の説明文はそのまま(「トグルを入れた曲だけが参照曲になります」)。一括操作の存在はメニューアイコンで気づける範囲とする

## Phase 2: 戻ったときのアーティスト一覧の件数更新

`ArtistsView` は `.task { await load() }` の 1 回読みなので、曲一覧で有効/無効を変えて `NavigationStack` を戻っても行の「有効 N / 全 M 曲」が古いまま残る。1 曲トグルでも起きていた既存の粗だが、一括操作では 0 → 200 のように大きくずれて明確に間違って見える。

- `ArtistSongsView` に `var onSongsChanged: (() -> Void)? = nil` を持たせ、単体トグル成功時と一括更新成功時に呼ぶ
- `ArtistsView` の push 先で `ArtistSongsView(artist: artist) { Task { await load() } }` のように渡す
- `onAppear` での再読み込みにしないのは、初回に `.task` と二重で走るのと、戻るたびに毎回通信するのを避けるため

## Phase 3: 確認と後片付け

- `xcodebuild` でシミュレータビルド(iPhone 17)
- XCUITest: `GenerateUITests` の曲一覧スモークに、メニュー(`artist.songs.bulk`)が存在して開けることの確認を足す。実際の一括実行は DB を書き換えるのでテストでは行わない
- シミュレータ + 隔離 DB のテストサーバー(本番 DB を `sqlite3 .backup` でコピー、`daily_enabled=false`、ポート 3014)で目視
  1. 全件に対して「全て有効」→ 件数表示が「有効 N / 全 N」になり、`GET /api/artists` の `enabledSongCount` も追随する
  2. 絞り込みに文字を入れた状態で「表示中を全て無効」→ 絞り込みに合う曲だけが無効になる(それ以外は変わらない)
  3. 表示フィルタ「有効のみ」+「全て無効」→ 一覧が空になり、案内文が出る
  4. 戻ってアーティスト一覧の件数が更新されている(Phase 2)
  5. サーバーを止めた状態で実行 → エラー表示が出て一覧は壊れない
- `CLAUDE.md` の iOS 画面説明(アーティストの曲一覧)に一括操作を追記
- `TODO.md` の項目を `DONE.md` へ、このプランを `docs/plans/archive/` へ移動

## 影響範囲

| ファイル | 変更 |
|---|---|
| `ios/.../Models/APIModels.swift` | 一括更新のリクエスト/レスポンス型を追加 |
| `ios/.../Views/ArtistSongsView.swift` | ツールバーのメニュー・確認ダイアログ・一括更新処理・変更通知 |
| `ios/.../Views/ArtistsView.swift` | 曲一覧を push するときに再読み込みのコールバックを渡す |
| `ios/DailyAIMusicUITests/GenerateUITests.swift` | メニューの存在確認を追加 |
| `CLAUDE.md` | iOS の画面説明を更新 |

サーバー・Web 管理画面・DB は変更しない。

## やらないこと(今回のスコープ外)

- アーティスト行から直接の一括操作(曲一覧の中だけ)
- 複数選択モード(絞り込み + 表示フィルタで代替)
- 一括操作の取り消し(直前の状態に戻す)
- アーティスト単位の有効/無効フラグ(曲の一括操作で足りる)
