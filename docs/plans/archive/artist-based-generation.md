# 音楽生成の経路「アーティスト経由」を追加

## 目的・背景

現在の生成経路は「おまかせ(`daily` / `daily_adventure`)」と「カスタム(`manual`: プリセット+自由テキスト)」の 2 つ。ここに 3 つ目として「好きなアーティストの特定の曲に似た曲を作る」経路を追加する。

- アーティスト名を登録する
- アーティスト名から楽曲名を検索して自動で登録する
- 生成時にアーティストと楽曲を選択し、その楽曲に似た曲を生成するプロンプトを AI(LLM)で生成して Suno で曲生成

## 事前調査(実測済み)

### 楽曲データソース: iTunes Search API を採用

API キー不要・無料で、`.env` にも本番デプロイにも影響が出ないため iTunes Search API を使う(Spotify はキー必須で本番のシークレット管理が増える、MusicBrainz は 1 req/s 制限+曲の網羅性が中途半端)。以下は実際に叩いて確認した挙動。

| 用途 | エンドポイント | 実測結果 |
|---|---|---|
| アーティスト検索 | `GET /search?term=<名前>&entity=musicArtist&limit=10&country=JP` | 日本語入力「米津玄師」→ `artistId=530814268` / `artistName="Kenshi Yonezu"` / `primaryGenreName="J-Pop"`。`Radiohead` → `657515` |
| 楽曲取得 | `GET /lookup?id=<artistId>&entity=song&limit=200&country=JP` | 162 track 行。うち **ユニークな曲名は 130**(重複 32) |

実測から確定した仕様:

- **アーティスト名はローマ字で返る**(`lang=ja_jp` を付けても「Kenshi Yonezu」)。日本語で検索してヒットはするので入力は日本語で構わないが、登録名は iTunes の正式表記になる。候補一覧をユーザーに選ばせる UI にして取り違えを防ぐ(「米津玄師」の検索結果には別名義の「Hachi」も混ざる)
- **`limit` は 200 で頭打ち**(300 を指定しても `resultCount` は 201 = アーティスト 1 行 + track 200 行)。多作なアーティストは切り捨てになるが、参照曲を選ぶ用途には十分。UI に「最大 200 曲」と明記する
- **同名の重複が出る**(シングル版・アルバム版・ベスト盤)。`trackName` の trim + 小文字化で同一視し、`releaseDate` が最古の行を残す(`(Live)` 等の別バージョンは曲名自体が違うので残る)
- 使えるフィールド: `trackId` / `trackName` / `collectionName` / `releaseDate` / `primaryGenreName` / `trackTimeMillis` / `artistId`。**`primaryGenreName` は LLM への有力なヒント**になるので保存する
- track 行の `artistId` は登録アーティストと一致しないものが混ざる(162 件中 154 件が一致。残りは「DAOKO×米津玄師」「中田ヤスタカ feat. 米津玄師」等のコラボ)。これらも本人の曲なので**除外しない**
- レート制限は約 20 req/分。登録・再取得は手動操作のみなので当たらない

### Suno の制約: プロンプトにアーティスト名・曲名を入れられない

Suno はアーティスト名の指定をモデレーションで弾く。実際 `server/src/suno/kieai.ts` の `FAILURE_STATUSES` には既に **`SENSITIVE_WORD_ERROR`** があり、弾かれた場合はタスクが FAILED になって進行状況にエラーとして出る(= 静かに壊れるのではなく観測できる)。

したがってこの機能の肝は「参照曲を名指しで Suno に伝える」ことではなく、**LLM に参照曲の音楽的特徴(ジャンル・テンポ・楽器編成・ボーカルの質感・プロダクション)を具体的な音楽用語へ翻訳させ、固有名詞を落とした style を書かせる**ことにある。生成後にサーバー側で名前の混入を検査し、混入していたら指示を強めて 1 回だけ再生成する(既存の禁止ワード検証リトライと同じ形)。

歌詞は著作権上、原曲の複製を明示的に禁止する(テーマ・情景の参考のみ、完全な新作歌詞)。LLM が参照曲を知らない場合は「そのアーティストの一般的な作風から推定する」よう指示し、**何を根拠にしたかを `intent`(狙い)に書かせる**ことで、ユーザーが結果の妥当性を判断できるようにする。

### 評価学習・リアルワードとの関係

`artist` モードではプリセットプールを LLM に提示しない(`usedPresets` は空配列)。よって 👍/👎 はプリセット集計に影響せず、既存の学習ループは汚れない。リアルワード制限は `manual` と同じ扱い(ユーザー指定が最優先という注記付きで注入)。直近スタイルの重複回避は「参照曲に似せる」という目的と真っ向から矛盾するので `artist` モードでは注入しない。

## 対応方針

### Phase 1: サーバー基盤(アーティスト・楽曲の登録)

**DB(`server/src/db.ts`)** — 新規 2 テーブル。

```sql
CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,            -- iTunes の正式表記(ローマ字のことが多い)
  itunes_artist_id INTEGER,
  genre TEXT,                           -- iTunes の primaryGenreName(表示用)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS artist_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  title TEXT NOT NULL,
  album TEXT,
  release_year INTEGER,
  genre TEXT,                           -- track の primaryGenreName(LLM へのヒント)
  itunes_track_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (artist_id, title)
);
CREATE INDEX IF NOT EXISTS idx_artist_songs_artist ON artist_songs(artist_id);
```

`tasks` へ後方互換カラム追加(既存の `addColumnIfMissing` を使う):

- `artist_id INTEGER` / `artist_song_id INTEGER` — 将来のアーティスト別評価集計用
- `ref_artist_name TEXT` / `ref_song_title TEXT` — 表示用スナップショット(アーティストを削除しても過去タスク・楽曲詳細に出せる。`task_presets` と同じ考え方)

関数: `listArtists()`(曲数付き)/ `getArtist()` / `createArtist()` / `deleteArtist()`(曲も削除)/ `replaceArtistSongs()` — `INSERT OR IGNORE` で既存を保ち新譜だけ足す / `listArtistSongs()` / `getArtistSong()`(アーティスト名を JOIN して返す)。

**iTunes クライアント(新規 `server/src/itunes.ts`)** — 外部 API の面倒(タイムアウト 10 秒・HTTP エラーの日本語化・重複除去)をここに閉じ込める。

- `searchArtists(term)` → `{ itunesArtistId, name, genre }[]`。`country=JP` で 0 件なら `country=US` で再試行(邦楽・洋楽の両対応)
- `fetchSongs(itunesArtistId)` → `{ title, album, releaseYear, genre, itunesTrackId }[]`。重複除去(最古を残す)込み

**API(`server/src/index.ts`)**

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/artists/search?term=` | iTunes のアーティスト候補(DB には触らない。登録前の曖昧性解消用) |
| POST | `/api/artists` | `{ name, itunesArtistId? }`。省略時は検索の最上位候補。登録と同時に楽曲取得まで行う。同名 409 / 候補 0 件 404 |
| GET | `/api/artists` | 一覧(曲数付き) |
| GET | `/api/artists/:id/songs` | 曲一覧(リリース年の新しい順、年不明は末尾) |
| POST | `/api/artists/:id/refresh` | 楽曲リストの再取得(新譜の取り込み。差分のみ追加) |
| DELETE | `/api/artists/:id` | アーティストと曲を削除(生成済みタスクはスナップショットで表示継続) |

### Phase 2: 生成経路

**`server/src/llm.ts`**

- `GenerationMode` に `"artist"` を追加
- `SongPlanInput` に `referenceSong?: { artist, title, album, releaseYear, genre }` を追加
- `buildSongPlanPrompt()` に `artist` 分岐:
  - `## リファレンス楽曲(この曲に似た新曲を作る)` にアーティスト・曲名・アルバム・年・ジャンルを提示
  - 指示: 参照曲の音楽的特徴を具体的な英語の音楽用語に翻訳して style を書く / **style・title・lyrics にアーティスト名・曲名を含めない(Suno のモデレーションが拒否する)** / 歌詞は原曲を複製せず完全な新作 / 曲を知らなければアーティストの一般的作風から推定し、その根拠を `intent` に書く
  - 要素プール・直近スタイルの節は出さない。禁止ワード節は `manual` と同じ「ユーザー指定優先」注記付き。自由テキストがあれば「追加の要望」として併記
- `generateSongPlan()` の検証に `artist` モード用のチェックを足す(style / title / lyrics にアーティスト名、title に曲名が含まれていないか。小文字化した部分一致)。違反時は既存の禁止ワードと同じく指示を強めて 1 回だけ再生成し、それでも残れば警告ログのみで続行(Suno 側で弾かれれば FAILED として観測できる)

**`server/src/generation.ts`** — `startGeneration()` の input に `artist?: { artistId, artistSongId, artistName, songTitle }` を追加し、`tasks` の新カラムへ記録するだけ。Suno 送信・ポーラー・音源保存は不変更。

**`server/src/index.ts`** — `POST /api/generate` の body に `artistSongId?: number` を追加。指定時は `mode: 'artist'` で生成する(自由テキストは「追加の要望」として併用可、`presetIds` は無視)。表示用 prompt は「<アーティスト>「<曲名>」風」。`taskJson` / `trackJson` に `refArtistName` / `refSongTitle`(null 許容)を追加。

### Phase 3: 管理画面(`server/public/`)

- `artists.html` / `artists.js` を新規追加(`presets.html` と同じサイドバー+`panel` 構成に揃える)
  - アーティスト登録(検索 → 候補から選択 → 登録)
  - アーティスト一覧(曲数・再取得・削除)
  - アーティストを開くと曲一覧 → 「この曲に似た曲を生成」ボタン(+追加の要望テキスト欄)
- 既存 3 ページ(`index.html` / `presets.html` / `settings.html`)のサイドバー `nav.menu` に「アーティスト」リンクを追加(4 ページすべてで同じ並びにする)

### Phase 4: iOS(`ios/DailyAIMusic/`)

- `Models/APIModels.swift`: `Artist` / `ArtistSong` / `ArtistCandidate` と各レスポンス型を追加。`GenerateRequest` に `artistSongId: Int?`(nil ならキー自体が出ない)。`Track` / `GenerationTask` に `refArtistName` / `refSongTitle` を optional で追加
- `Views/GenerateView.swift`: `paramsRow` と `customSection` の間に「アーティストから生成」の `NavigationLink` 行を追加(既存の行スタイルを流用)
- `Views/ArtistsView.swift`(新規): 登録済みアーティスト一覧(曲数)・スワイプ削除・右上 + で追加シート(検索語入力 → 候補一覧 → 選択で登録)
- `Views/ArtistSongsView.swift`(新規): 曲一覧 → タップで確認ダイアログ「この曲に似た曲を生成」→ `POST /api/generate { artistSongId }` → 生成タブの進行状況へ戻す
- `Views/TrackDetailView.swift`: `refArtistName` があれば「リファレンス: <アーティスト>「<曲名>」」を 1 行表示

### Phase 5: ドキュメント更新と総合検証

- `docs/specs/music-generation.md` に「アーティスト経由生成」節(採用理由・Suno の固有名詞制約・著作権上の歌詞方針)を日付付きで追記
- `docs/specs/music-generation-flow.md` の入力表に `artist` モードを追加
- `CLAUDE.md` の「現状」と API 一覧を更新
- 完了後に `TODO.md` → `DONE.md`、本プランを `docs/plans/archive/` へ移動

## 影響範囲

- サーバー: `db.ts` / `index.ts` / `llm.ts` / `generation.ts` + 新規 `itunes.ts`、管理画面 4 ページ
- iOS: `APIModels.swift` / `GenerateView.swift` / `TrackDetailView.swift` + 新規 View 2 つ
- **API は追加のみで既存キーの形状は変えない** — 旧アプリ × 新サーバーは完全互換(`taskJson` / `trackJson` への null 許容キー追加と `/api/generate` の任意フィールド追加のみ)。本番反映はサーバーデプロイのみ必須で、実機アプリの再インストールはアーティスト経由生成を使いたくなったときでよい
- `.env` / 本番のシークレット設定は変更なし(iTunes Search API はキーレス)
- `daily` / `manual` の生成フロー・評価学習・リアルワード制限のロジックは不変更(`artist` は分岐の追加のみ)

## 非目標(今回はやらない)

- 毎日の自動生成に登録アーティストを織り込む(まず手動経路の質を見てから判断する)
- アーティスト別・曲別の 👍/👎 集計と学習への反映(`tasks.artist_id` は記録だけしておき、データが溜まってから設計する)
- 参照曲の音楽的特徴を Web 検索や音源解析で補強する(LLM の知識+`intent` への根拠明記でどこまで実用になるかを先に見る)

## テスト方針

- `npm run typecheck`
- 隔離 DB サーバー(`sqlite3 .backup` でコピー、`daily_enabled=false`、ポート 3014)で curl シナリオ:
  - 邦楽・洋楽 1 組ずつ検索 → 候補選択 → 登録 → 曲一覧(実 iTunes API。重複除去が効いて件数が減ること、200 件上限を確認)
  - 同名登録 409 / 存在しないアーティスト 404 / `refresh` が差分だけ足すこと / 削除でアーティストと曲が消え、生成済みタスクの表示は残ること
- `buildSongPlanPrompt()` のリファレンス節・固有名詞除外指示・要素プール非注入を使い捨てスクリプトで直接検証(実生成なし。既存のプリセット検証と同じ手法)
- 名前混入の検証リトライは、検査関数に固有名詞入りの偽プランを渡す単体確認で挙動を見る
- **通しの実生成は最後に 1 曲だけ**実行し、Suno が `SENSITIVE_WORD_ERROR` を返さないこと・出来上がった style に固有名詞が無いこと・曲が参照曲に似ているかを実聴で確認する
- 管理画面: ヘッドレス Chrome で `artists.html` のスクリーンショット目視(`--window-size` は 500px 以上)
- iOS: シミュレータビルド + UI テストにスモーク(生成タブ →「アーティストから生成」→ 一覧表示)を追加。登録フローは外部通信を伴うため UI テストでは掘らず、サーバー側 curl シナリオでカバー。最後に実機へインストールして操作確認
