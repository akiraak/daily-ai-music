# アーティストの曲に有効/無効を持たせる

## 目的・背景

参照曲は iTunes から一括で取り込む(1 アーティスト最大 200 曲)ため、生成の参照曲としてふさわしくない曲がそのまま候補に入る。今は「ノイズ除外」(`server/src/reference.ts`)が **生成のたびに曲名を見て** Live / Remix / Instrumental 等を候補から外しているが、この方式には次の問題がある。

- **見えない**。曲一覧には全曲が同じ顔で並び、どれが実際には選ばれないのかが分からない
- **直せない**。キーワード判定を外したい曲(「Live and Let Die」のような原曲、逆に判定から漏れたカバー曲)を手で上書きできない
- **キーワード以外の理由で外せない**。「この曲は参照曲にしたくない」(短いインタールード、朗読トラック、単に好みでない)という判断を残す場所が無い

そこで **曲ごとに有効/無効を持たせ、生成は有効な曲からしか行わない** ようにする。実行時のノイズ除外は廃止し、その判定は **取り込み時の初期値** に格下げする(判定基準は今のまま流用し、以後は人が上書きできる)。

## 決めたこと(方針)

| 論点 | 決定 |
|---|---|
| 持ち方 | `artist_songs.enabled INTEGER NOT NULL DEFAULT 1` |
| ノイズ除外との関係 | **取り込み時に反映して実行時の自動除外は廃止**。`insertArtistSongs` が曲名を見て noisy なら `enabled = 0` で入れる。`reference.ts` の `usableCandidates()` / `isNoisyTitle()` / `NOISE_KEYWORDS` は選択ロジックから外す |
| 既存データ | 起動時に **1 回だけ** 同じ基準で backfill(noisy な曲を `enabled = 0` に)。実施記録を `settings` に残し、手で有効に戻した曲を再び無効化しない |
| 「有効な曲が 0 件」 | 参照曲 0 件と同じ扱い(生成しない)。`NoReferenceSongError`・スケジューラの 30 分後再試行・`POST /api/daily/run` の 409 はそのまま流用し、メッセージだけ「有効な曲が無い」ケースを含む文言に直す |
| 曲を明示指定した生成 | 無効な曲を `POST /api/generate` に渡したら **409**(UI 側でも押せないようにするが、サーバーで弾くのが正) |
| 曲名からの登録 | 選んだ曲が既存の無効曲だったら **有効に戻す**(その曲で生成するために選んだ操作なので) |
| 曲の再取得 | 新規曲だけが上の初期値で入る。既存曲の `enabled` は変えない(`INSERT OR IGNORE` のまま) |

### なぜ実行時フィルタを残さないか

残すと除外基準が二重になり、「一覧では有効なのに生成では選ばれない曲」が生まれる。今回の目的は候補の可視化と上書きなので、除外は `enabled` の 1 か所に集約する。ノイズ判定のロジック自体は捨てず、初期値を決める役に回す。

また `usableCandidates()` にある「除外して 0 件になるなら除外しない」フォールバックも廃止する。全曲を手で無効にしたなら「今は生成しない」が利用者の意思であり、勝手に無効曲へ戻ってはいけない。

## データモデル

```sql
ALTER TABLE artist_songs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
```

- `addColumnIfMissing("artist_songs", "enabled", "enabled INTEGER NOT NULL DEFAULT 1")` で既存 DB に追加(既存行はすべて 1)
- 追加後、**`settings` の `migration_disable_noisy_songs` が未設定のときだけ** 全曲を読んで `isNoisyTitle(title)` が真の行を `enabled = 0` に更新し、キーを立てる
  - 冪等ではない処理なので実施記録が要る(毎起動でやると、人が有効に戻した Live 曲が翌起動でまた無効に戻る)
  - 既存の `DROP TABLE IF EXISTS` 系の後片付けとは性質が違う点に注意
- インデックスは張らない(`artist_songs` は数千行規模で、`idx_artist_songs_artist` で足りる)

### ノイズ判定の置き場所

`insertArtistSongs`(`db.ts`)と backfill(`db.ts`)から判定を呼ぶが、`reference.ts` は `db.ts` を import しているので逆流させると循環参照になる。判定だけを DB 非依存の新規モジュール **`server/src/songtitle.ts`** に移す。

- 移すもの: `NOISE_KEYWORDS` / `containsKeyword()` / `annotations()` / `isNoisyTitle()`(中身は変えない)
- `reference.ts` からは `usableCandidates()` ごと削除し、`pickReferenceSong()` は渡された候補をそのまま使う

## Phase 1: サーバー(DB・選択ロジック・API)

### `server/src/songtitle.ts`(新規)

`reference.ts` からノイズ判定を移設。

### `server/src/db.ts`

- `ArtistSongRow` に `enabled: number`、`ArtistWithCountRow` に `enabled_song_count: number`
- マイグレーション + backfill(上記)
- `insertArtistSongs()`: `enabled` を `isNoisyTitle(s.title) ? 0 : 1` で INSERT
- `listArtists()` / `getArtist()` / `getArtistByItunesId()` / `getArtistByName()`: 集計に
  `SUM(CASE WHEN s.enabled = 1 THEN 1 ELSE 0 END)` を追加(共通の SELECT 文を定数に切り出す)
- `listReferenceCandidates()`: `WHERE s.enabled = 1` を追加
- 追加関数
  - `setArtistSongEnabled(id: number, enabled: boolean): boolean` — 1 曲更新(存在しなければ false)
  - `setArtistSongsEnabled(artistId: number, enabled: boolean, ids?: number[]): number` — 一括更新。`ids` 省略でそのアーティストの全曲。更新件数を返す
  - `listArtistSongs()` は全件返したまま(一覧は有効・無効の両方を表示する)

### `server/src/reference.ts`

- ノイズ判定の削除(`songtitle.ts` へ)、`usableCandidates()` の削除
- `pickReferenceSong()` / `referenceCandidateSummary()` から `usableCandidates()` 呼び出しを外す
- 冒頭コメントの選択規則を「有効な曲だけを候補に、アーティストを LRU → その人の曲を LRU」に更新

### `server/src/scheduler.ts`

- `NoReferenceSongError` のメッセージを更新
  「生成できる参照曲がありません。アーティストを登録するか、曲一覧で曲を有効にしてください」
- `no_reference_song` の `detail` に `enabledSongCount`(と `songCount`)を追加し、
  「未登録」と「全部無効」をログで区別できるようにする

### `server/src/index.ts`

- `artistSongJson()` に `enabled: s.enabled === 1`、`artistJson()` に `enabledSongCount`
- `POST /api/generate`: `song.enabled === 0` なら 409
  「この曲は無効になっています。曲一覧で有効にしてから生成してください」
- `POST /api/artist-songs`(曲名からの登録): 合流した既存曲が無効なら `setArtistSongEnabled(id, true)`。
  応答の `song.enabled` に反映される
- 追加ルート
  - `PATCH /api/artist-songs/:id` — body `{ enabled: boolean }` → `{ song }`。
    `id` 不正は 400、未存在は 404、`enabled` が boolean でなければ 400
  - `PATCH /api/artists/:id/songs` — body `{ enabled: boolean, ids?: number[] }` → `{ artist, updated }`。
    一覧の「全て有効 / 全て無効」「絞り込み中の曲をまとめて」用。`ids` は数値配列のみ受ける
- `GET /api/generation-params` は変更不要(`referenceCandidateSummary()` が有効曲だけを数えるようになる)

## Phase 2: Web 管理画面(`server/public/`)

- `artists.html`
  - 曲パネルの見出しを「◯◯ の曲(有効 N / 全 M)」に
  - 絞り込み欄の隣に表示フィルタ(すべて / 有効のみ / 無効のみ)と一括ボタン(全て有効 / 全て無効)
- `artists.js`
  - 曲行にチェックボックス(有効)。変更で `PATCH /admin/api/artist-songs/:id`。楽観更新し、失敗したらチェック状態を戻してメッセージ表示
  - 無効行は薄く表示し、「この曲で生成」は無効化する
  - 一括ボタンは `PATCH /admin/api/artists/:id/songs`(確認ダイアログ付き)。完了後に曲一覧を再読込
  - アーティスト行のメタを `${a.enabledSongCount} / ${a.songCount} 曲` に
- `style.css` に無効行のスタイル(`.song.is-disabled` の文字色を薄く)

## Phase 3: iOS アプリ(`ios/DailyAIMusic/`)

- `Models/APIModels.swift`
  - `ArtistSong` に `enabled: Bool`、`Artist` に `enabledSongCount: Int`
- `Services/BackendAPI.swift`
  - `patchJSON` を追加(既存の `postJSON` と同形。`X-API-Secret` 付与・デコード失敗の報告は共通経路のまま)
- `Views/ArtistSongsView.swift`
  - 行の構成を「タイトル部(タップで生成)+ 右端にトグル」に変更。
    `List` を使っていない画面なので swipeActions は使えず、行内トグルが素直
  - 無効行はタイトルを secondary にし、`sparkles` を隠してタップで生成できないようにする
  - トグル変更で `PATCH /api/artist-songs/:id`。楽観更新し、失敗したら元に戻してエラー表示
  - 絞り込み欄の下に表示フィルタ(すべて / 有効のみ)、見出しに「有効 N / 全 M」
  - 有効曲が 0 件のときの案内文を出す
- `Views/ArtistsView.swift`
  - 曲数表示を `有効 N / 全 M 曲` に
- `Views/GenerateView.swift`
  - おまかせ生成の 409 が「未登録」だけでなく「全部無効」でも起きるので、エラー表示の文言をサーバー由来のまま出していることを確認(ハードコードしていれば直す)

## Phase 4: 本番反映

- g3plus 上のコンテナを更新して再起動(マイグレーション + backfill が起動時に走る)
- 反映前に `data/db.sqlite` のバックアップ(`sqlite3 .backup`)を取る
- 反映後に `GET /api/artists` で `enabledSongCount` を確認し、`scripts/fetch-error-logs.sh` でエラーが出ていないことを見る
- `CLAUDE.md` の記述を更新(「参照曲の選択」からノイズ除外の説明を外し、有効/無効に置き換え。API 一覧に `PATCH` 2 本を追加)

## 影響範囲

| ファイル | 変更 |
|---|---|
| `server/src/songtitle.ts` | 新規(ノイズ判定の移設先) |
| `server/src/db.ts` | カラム追加・backfill・集計・候補の絞り込み・更新関数 2 つ |
| `server/src/reference.ts` | ノイズ判定と `usableCandidates()` の削除 |
| `server/src/scheduler.ts` | エラーメッセージとログ detail |
| `server/src/index.ts` | JSON 整形・`PATCH` 2 本・無効曲の 409・曲名登録時の再有効化 |
| `server/public/artists.{html,js}`, `style.css` | 曲一覧の有効/無効 UI |
| `ios/.../APIModels.swift`, `BackendAPI.swift`, `ArtistSongsView.swift`, `ArtistsView.swift` | 同上(iOS) |
| `CLAUDE.md` | 仕様の記述更新 |

生成済みタスク(`tasks.artist_song_id` / `ref_*`)には触らない。無効にした曲を参照した過去の楽曲はそのまま表示され続ける。

## テスト方針

サーバーに自動テストの仕組みは無いため、`npm run typecheck` + 隔離 DB のテストサーバー(本番 DB を `sqlite3 .backup` でコピー、`daily_enabled=false`、ポート 3014)で以下を手動確認する。

1. **マイグレーション**: 起動後、`SELECT title, enabled FROM artist_songs WHERE enabled = 0` に Live / Remix 系だけが並ぶ。ある 1 曲を手で有効に戻して再起動しても無効に戻らない(実施記録が効いている)
2. **選択**: `GET /api/generation-params` の候補数が有効曲の数と一致する。無効曲だけのアーティストが候補一覧から消える
3. **PATCH**: 単体と一括の両方で `enabled` が変わり、`GET /api/artists` の `enabledSongCount` が追随する。不正な body が 400、未存在 id が 404
4. **生成の入口**: 無効曲を指定した `POST /api/generate` が 409(LLM を呼ぶ前に弾かれる = Suno のクレジットを消費しない)。全曲無効の状態で `POST /api/daily/run` が 409
5. **曲名からの登録**: 無効にした曲を曲名検索から選び直すと有効に戻る
6. **管理画面**: ヘッドレス Chrome でスクリーンショット(`--window-size` は最小 500px)。有効/無効の表示・一括操作・生成ボタンの抑止
7. **iOS**: シミュレータビルド + XCUITest のスモーク(曲一覧が開ける・トグルが表示される)。トグル操作と生成抑止は実機/シミュレータで目視

## やらないこと(今回のスコープ外)

- アーティスト単位の有効/無効(曲の一括操作で代替できる)
- 曲ごとの重み・優先度(選択は今まで通り LRU + ランダム)
- iOS からの一括操作(管理画面で足りる)
- 無効理由の記録(自動判定か手動かの区別)
