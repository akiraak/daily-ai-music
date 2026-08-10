# 曲名で登録できるようにする(曲名からアーティストを逆引き)

## 目的・背景

生成経路「アーティスト経由」の入口は今のところ **アーティスト名の検索のみ**。「この曲みたいな曲が作りたい」と思ったとき、ユーザーは

1. その曲を誰が歌っているか思い出す
2. アーティスト名で検索して登録する(最大 200 曲を取り込む)
3. 曲一覧から目当ての曲を探す

という遠回りを強いられる。アーティスト名が分からない曲(CM で聴いた・サビだけ知っている)は入口にすら立てない。

そこで **曲名で検索して、その曲を直接登録できる** ようにする。曲を選んだ時点でアーティストは iTunes の応答から逆引きできるので、アーティストの登録もまとめて済ませる。既存のアーティスト名検索は残し、入口を 2 つにする。

## 事前調査(実測済み)

iTunes Search API を実際に叩いて確認した(2026-08-09)。

| 用途 | エンドポイント | 実測結果 |
|---|---|---|
| 曲名検索 | `GET /search?term=<曲名>&entity=song&limit=25&country=JP` | track 行に `artistId` が入る → **逆引きは検索の 1 リクエストで完結**(追加の問い合わせ不要) |
| 曲メタの取得 | `GET /lookup?id=<trackId>&country=JP` | track 1 行。`trackName` / `artistId` / `artistName` / `collectionName` / `releaseDate` / `primaryGenreName` |
| アーティストの正式名 | `GET /lookup?id=<artistId>&entity=song&limit=200` の `wrapperType=artist` 行 | `530814268`→`Kenshi Yonezu` / `3296287`→`Queen` / `547853144`→`Daoko` |

実測から確定した仕様:

- **track 行の `artistName` はローカライズされた表示名で、登録名には使えない**。`country=JP` の曲検索では `artistId=3296287` が「クイーン」、`530814268` が「米津玄師」で返る。一方 `entity=musicArtist` の検索と `lookup` の artist 行は正式表記(「Queen」「Kenshi Yonezu」)。**登録名は lookup の artist 行から採る**。理由は 2 つ:
  - 既存のアーティスト名検索経路と同じ名前になり、`artists.name` の UNIQUE が効いて二重登録(「Queen」と「クイーン」が別行)を防げる
  - `llm.ts` の固有名詞混入チェック(`containsName(body, ref.artist)`)は `artists.name` を英語の style / title / lyrics から探す。「クイーン」で登録すると **"Queen" の混入を検出できなくなる**
- **カバー・ピアノ版・オルゴールのノイズが多い**。「Lemon」の上位 10 件で本家(米津玄師)は 2 行だけ、残りはカバー・ピアノ BGM・インスト。「ボヘミアンラプソディ」(カタカナ)では本家クイーンが上位 5 件に入らない。→ **候補一覧から選ばせる**(アーティスト名検索と同じ思想)。`limit` は 25 にして本家が埋もれにくくする
- **同一アーティスト・同一曲名が複数版返る**(クイーンの `Bohemian Rhapsody` は Greatest Hits / Jewels / A Night At The Opera 等で 4 行)。`(artistId, 正規化した曲名)` で重複除去すると 25 件 → 18 件。既存 `fetchSongs()` と同じ規則(trim + 小文字化、最古のリリースを残す)を使い、並び順は iTunes の関連度順(初出の位置)を保つ
- **日本語で検索できる**。「レモン」→ 1 位が `Lemon / 米津玄師`、「夜に駆ける」→ 1 位が YOASOBI。ただし読みマッチのため曲名が一致しない行(「感電」「パプリカ」)も混ざる → 候補行には必ず曲名とアーティスト名の両方を出す。「米津玄師 Lemon」のようにアーティスト名を足すと精度が上がるので UI のヒントに書く
- **`attribute=songTerm` は付けても結果が変わらなかった**(「Lemon」「レモン」「打上花火」「夜に駆ける」で同一)。付けない(既存 `searchArtists()` と同じシンプルさを保つ)
- **コラボ曲の `artistId` は片方のもの**。「打上花火 / DAOKO×米津玄師」の `artistId` は `547853144` = `Daoko`。逆引き先は Daoko になる(その `lookup` に「打上花火」も含まれるので整合はする)。候補行には track の表示名を出しつつ、**登録先アーティスト名が異なる場合は登録後のメッセージで明示**する
- **選んだ曲がアーティストの `lookup` 200 件に含まれないことがある**(`limit` は 200 で頭打ち。米津玄師は JP で 162 track、Queen は 200 で打ち切り)。→ **選んだトラックは必ず個別に `INSERT`** して、登録した曲が一覧に無い事故を防ぐ

## 対応方針

### Phase 1: サーバー基盤

**`server/src/itunes.ts`** — 3 点の追加・拡張。

```ts
// 追加: 曲名で検索(逆引き用に artistId も返す)
export interface SongCandidate {
  itunesTrackId: number;
  title: string;
  artistName: string;      // track 行の表示名(ローカライズ済み。表示専用)
  itunesArtistId: number;
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
}
export async function searchSongs(term: string): Promise<SongCandidate[]>
//   entity=song&limit=25、country=JP → 0 件なら US(searchArtists と同じフォールバック)
//   trackId / trackName / artistId が揃わない行は捨てる
//   (artistId, normalizeTitle(trackName)) で重複除去・最古を残す・初出順を保つ

// 追加: trackId から曲メタを取り直す(クライアントの申告を信用しない)
export async function fetchTrack(itunesTrackId: number): Promise<SongCandidate | null>

// 拡張: 戻り値に artistName(正式表記)を足す
export async function fetchSongs(itunesArtistId: number): Promise<{
  artistName: string | null;   // ← 追加
  artistGenre: string | null;
  songs: ArtistSongInput[];
}>
```

`fetchSongs()` の既存呼び出し 2 箇所(`POST /api/artists` と `POST /api/artists/:id/refresh`)は分割代入なので **拡張しても影響しない**。

**`server/src/db.ts`** — スキーマ変更なし。読み取り関数を 2 本足すだけ。

```ts
export function getArtistByItunesId(itunesArtistId: number): ArtistWithCountRow | undefined
// 曲名の正規化一致で既存行を探す(artist_songs の UNIQUE は完全一致・BINARY 照合なので、
// 大小文字だけ違う重複行ができるのを防ぐ)
export function findArtistSongByTitle(artistId: number, title: string): ArtistSongRow | undefined
```

**`server/src/index.ts`** — API 2 本(いずれも既存の `artistJson` / `artistSongJson` を再利用)。

| メソッド | パス | 内容 |
|---|---|---|
| `GET` | `/api/artist-songs/search?term=` | `itunes.searchSongs()` をそのまま返す。DB には触らない。失敗は 502(既存 `/api/artists/search` と同形) |
| `POST` | `/api/artist-songs` | body は `{ itunesTrackId }` のみ。曲メタはサーバーが取り直す |

`POST /api/artist-songs` の処理順:

1. `itunes.fetchTrack(itunesTrackId)` → 見つからなければ 404
2. `db.getArtistByItunesId(track.itunesArtistId)` で登録済みか見る
   - **未登録**: `itunes.fetchSongs(artistId)` で正式名・ジャンル・曲一覧を取り、`createArtist()`(名前は lookup の artist 行の正式名。取れなければ track の表示名にフォールバック)→ `insertArtistSongs()`。名前が既存と衝突(UNIQUE 違反)したら、その名前の既存アーティストに合流する
   - **登録済み**: 追加の `lookup` は打たない(曲メタは手順 1 で揃っている)
3. `db.findArtistSongByTitle()` で対象曲を探し、無ければ 1 曲だけ `insertArtistSongs()` する(200 件頭打ちで漏れた曲の救済)
4. `{ artist, song, artistCreated, added }` を 201 で返す(`song.id` をそのまま `POST /api/generate` の `artistSongId` に使える)

パス名は `artist_songs` テーブルに合わせた。`/api/tracks`(= 生成した曲)と紛れないようにするため `/api/songs` は避ける。

### Phase 2: 管理画面(`server/public/artists.html` / `artists.js`)

「アーティストを登録」パネルを **「登録」パネル** に統合し、検索対象を選べるようにする。

- フォームに `<select id="search-kind">`(`アーティスト名` / `曲名`)を追加。プレースホルダとヒント文を選択に応じて差し替える(曲名モード: 「曲名(例: Lemon / 夜に駆ける)」+「アーティスト名を足すと精度が上がります(例: 米津玄師 Lemon)」)
- 曲名モードの候補行: **曲名(強調)** / アーティスト名 · アルバム · 年 / 「登録」ボタン
- 登録後: `POST /api/artist-songs` の応答から
  - メッセージ「〈Kenshi Yonezu〉の「Lemon」を登録しました(曲 162 件を取り込み)」。候補行の表示名と登録名が違う場合(コラボ)は「〈DAOKO×米津玄師〉は **Daoko** として登録しました」と明示する
  - アーティスト一覧を再読み込みし、**そのアーティストの曲一覧を開いて絞り込み欄に曲名を入れる** → 「この曲で生成」がすぐ押せる状態にする

### Phase 3: iOS(`ios/DailyAIMusic/`)

**導線は「生成タブに専用の行を新設」に決定(2026-08-09)**。当初案はアーティスト追加シート内のセグメント切り替えだったが、曲名しか知らない人が「アーティスト」を 2 回通ることになり、この機能の動機と噛み合わないため。

- `Models/APIModels.swift`: `SongCandidate` / `SongSearchResponse` / `CreateArtistSongRequest` / `CreateArtistSongResponse` を追加
- `Views/SongSearchView.swift`(新規): 曲名の検索欄 → 候補一覧(曲名+アーティスト名 · 年 · アルバム)→ 候補タップで確認ダイアログ → 登録(`POST /api/artist-songs`)と生成(`POST /api/generate { artistSongId }`)を続けて実行 → 生成タブへ戻る(進行状況はそこに出る)
- `Views/GenerateView.swift`: 生成パラメータ行とアーティスト行の間に「曲名から生成 / 知っている曲を指定してつくる」の push 行を足す
- 生成だけ失敗した場合は登録済みである旨をメッセージに出す(アーティスト画面の曲一覧からやり直せる)
- `List` を使わない画面構成なので `.searchable` は使わない(既存の絞り込み欄と同じ通常の `TextField`)
- `ArtistsView` の追加シートは変更しない(アーティスト名検索のまま)

### Phase 4: ドキュメント更新と総合検証

- `CLAUDE.md`: API 一覧に `/api/artist-songs/search`・`POST /api/artist-songs` を追加。管理画面・iOS の画面説明に「曲名からの登録」を追記
- `docs/specs/music-generation-flow.md`: アーティスト経由生成の入口表に「曲名で検索 → 逆引き登録」を追加
- `docs/specs/music-generation.md`: 決定の記録として日付付きで追記(登録名は lookup の正式表記を使う理由 = 二重登録防止と固有名詞チェック)
- 総合検証(「テスト方針」の全項目)+ `TODO` → `DONE` 移動 + プランを `docs/plans/archive/` へ移動

## 影響範囲

- **生成ロジック(`llm.ts` / `generation.ts` / `scheduler.ts`)は不変更**。この機能は `artist_songs` に行を足す入口が増えるだけで、生成は既存の `POST /api/generate { artistSongId }` をそのまま使う
- **DB スキーマ変更なし**(マイグレーション不要)。既存データもそのまま
- **API は追加のみで既存キーの形状は不変** → 旧アプリ × 新サーバーは完全互換(本番反映はサーバーデプロイのみ必須。アプリから曲名登録を使うには実機の再インストールが要る)
- 既存のアーティスト名検索経路は挙動を変えない(`fetchSongs()` の戻り値に項目が増えるだけ)
- 評価学習(👍/👎 のプリセット集計)・リアルワード制限・毎日の自動生成には触れない

## 非目標(今回はやらない)

- 毎日の自動生成をアーティスト・曲から選ぶ形に変えること(`TODO.md` の別項目)
- 曲名の曖昧検索・スペル補正・サジェスト(iTunes の関連度順をそのまま使う)
- カバー版・オルゴール版を自動で除外すること(判定基準が曖昧で本家を誤って落とす方が害が大きい。ユーザーに選ばせる)
- コラボ曲で「もう一方のアーティスト」を選べるようにすること(iTunes の track 行は `artistId` を 1 つしか返さない)
- 曲単体の削除 UI(アーティストごと削除する既存の導線のみ)

## テスト方針

**サーバー(隔離 DB + curl)** — `sqlite3 .backup` で複製し `daily_enabled=false`、ポート 3015 で起動する(本番 DB と実生成に触れないため)。

1. 曲名検索: 日本語(「レモン」)・英語(「Bohemian Rhapsody」)・0 件(でたらめな文字列)。重複除去が効いて同一アーティストの同曲が 1 行になること
2. 未登録アーティストの曲を登録 → `artists` に **正式表記**(`Kenshi Yonezu`)で入り、曲が 130 件前後取り込まれ、対象曲(`Lemon`)が含まれること
3. 登録済みアーティストの別の曲を登録 → `artistCreated: false`・曲の追加なし・既存行の `song.id` が返ること
4. 200 件に含まれない曲の救済: 手順 2 の後に対象曲を `DELETE` してから同じ `POST` を叩き、1 曲だけ追加されること
5. コラボ曲(「打上花火」)→ `Daoko` として登録され、候補の表示名(`DAOKO×米津玄師`)と登録名が違うことが応答から分かること
6. 大小文字違い(`lemon` を検索して登録)→ 既存の `Lemon` に合流し重複行ができないこと
7. 存在しない `itunesTrackId` → 404(iTunes を叩くだけで DB は変わらない)
8. 登録した曲の `song.id` で `POST /api/generate` が通り、`mode: artist` のタスクになること(実生成は 1 曲だけ通す。style / title / 歌詞に固有名詞が無いことを確認)
9. `npm run typecheck`

**管理画面** — ヘッドレス Chrome の CDP 操作で「曲名」モードに切り替え → 検索 → 候補から登録 → 曲一覧が絞り込み済みで開くところまでを目視(`--window-size` は 500px 以上、`--timeout` を付ける)。

**iOS** — シミュレータビルド + `GenerateUITests` に曲名検索のスモークを追加(生成タブ → 曲名から生成 → 検索 → 候補が出る)。既存の UI テストに回帰が無いこと。サーバーは同じ隔離 DB(ポート 3014)。

## 実施結果(2026-08-09)

全 Phase 完了。検証の要点:

- サーバー: テスト方針 1〜7 と 9 をすべて実施(隔離 DB・ポート 3015・実 iTunes 通信込み)。登録名が正式表記になること(「Official髭男dism」→ `OFFICIAL HIGE DANDISM`、「DAOKO×米津玄師」→ `Daoko`)、重複除去(「Bohemian Rhapsody」25 → 18 件)、200 件から漏れた曲の個別 `INSERT`、大小文字違いの合流を確認。既存経路(`POST /api/artists` / `refresh`)の回帰も確認
- テスト方針 8(実生成): 曲名「Pretender」から登録 → 生成が `COMPLETE`(3:09、`Almost Yours`)。style / title / 歌詞に固有名詞なし、`ref_artist_name` / `ref_song_title` のスナップショットも記録された
- 管理画面: ヘッドレス Chrome の CDP 操作で 曲名モード → 検索 → 登録 → 曲一覧が絞り込み済みで開くまでを確認。**長い曲名が副題を 1 文字幅に潰すレイアウト崩れ**を発見し `style.css` を修正(`.artist-name` / `.song-title` に `flex: 1 1 auto`、行末ボタンに `flex: 0 0 auto`)
- iOS: シミュレータビルド + UI テスト 9 件すべて成功(新規の `testSongSearchEntryPoint` を含む)

**この機能とは別に見つかったこと**: 同じ参照曲でもう 1 曲生成したところ、Suno が style 内の `major7`(コード名)を「アーティスト名」と誤判定して `SENSITIVE_WORD_ERROR` で弾いた。artist モードのプロンプトはコード進行を音楽用語で書かせるため一定の確率で起こりうる。今回は再現 1 回のみで恒常的ではないため対処はしていない(頻発するようなら `llm.ts` の指示でコード名の書き方を制限する)。
