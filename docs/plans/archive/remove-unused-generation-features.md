# 参照曲ベース化で使われなくなった機能の削除

TODO: 「毎日更新が曲参照になったのでそれ以外の機能を洗い出して削除する」

## 目的・背景

2026-08-10 に毎日の自動生成を参照曲ベースへ切り替えた([archive/daily-reference-song.md](archive/daily-reference-song.md))。毎日の曲は「登録済みの曲(`artist_songs`)からサーバーが 1 曲選び、`web_search` で BPM・キー・編成を調べさせて style を書かせる」経路だけを通るようになり、それまで毎日の曲を組み立てていた仕組み(要素プール・評価学習・冒険日・直近スタイル注入)は**登録曲 0 件のときのフォールバックにしか残っていない**。切り替えプランでは撤去を範囲外として、この TODO に送ってあった。

**この機会に、参照曲ベースで通らなくなった経路をすべて削除する**(2026-08-10 決定)。残すのは「参照曲 + 今日のコンテキスト + リアルワード制限」だけの一本道にする。

## 「使われていない」の根拠

1. プロンプトの分岐は `referenceSong` の有無で決まる(`buildSongPlanPrompt()`)。参照曲があると要素プール節・直近スタイル節・冒険日節は一切出ない
2. 冒険日は `scheduler.ts:133` が `!reference && Math.random() < ...`。参照曲があると**構造上ゼロ確率**
3. 要素プールが提示されるのは「参照曲なしの daily」だけ。`manual` 分岐は `presetPool` を見ない
4. `manual` の `selectedPresets` を埋める `presetIds` を送るクライアントが**ひとつも無い**(iOS の `GenerateRequest` は prompt / instrumental / artistSongId、管理画面の生成ボタンは `daily/run`、`artists.js` は artistSongId + 自由テキスト)
5. 評価集計 `countPresetRatings()` の LLM 注入は `scheduler.ts:181` の 1 箇所のみ = 参照曲があると **👍/👎 は生成に一切影響していない**

## 決定事項(2026-08-10)

| # | 論点 | 決定 |
|---|---|---|
| Q1 | 参照曲 0 件のフォールバック | **廃止**。候補ゼロなら生成せず警告(スケジューラは 30 分後に再試行、`POST /api/daily/run` は 409) |
| Q2 | 👍/👎 評価 | **完全廃止**(UI・API・`tracks.rating` / `rated_at` カラムまで) |
| Q3 | カスタム生成(`mode = manual`) | **廃止**。`POST /api/generate` は `artistSongId` 必須になる |
| Q4 | 過去データの表示・旧アプリ互換 | **どちらも捨てる**。冒険日バッジ・使用プリセット表示を削除し、`POST /api/daily/run` 応答の `adventure` キーも削除 |
| Q5 | パラメータ一覧ページ | **ページごと削除**。`GET /api/real-world-words` も削除(利用者はこのページだけ。リアルワードの状況は iOS の生成パラメータ画面で見られる) |
| Q6 | DB のテーブル | **DROP する**(`presets` / `task_presets` / `profile` + `tracks.rating` / `rated_at`) |

### 決定から導かれる構造

- **生成モードは `daily` と `artist` の 2 つだけ**になり、どちらも参照曲を必ず持つ。`SongPlanInput.referenceSong` は必須(optional をやめる)、`SongPlanInput.mode` はプロンプトが参照しなくなるので削除(タスク行に記録する `mode` は残す)
- **`buildSongPlanPrompt()` から分岐が消えて直線になる**: リファレンス楽曲 → 作り方(厳守)→ 追加の要望(任意)→ 今日のコンテキスト(任意)→ 使用禁止ワード(任意)→ 残り 1 回のワード(任意)→ 出力条件
- `web_search` は常時有効になる(`requestSongPlan()` の `tools` 三項演算子が消える)
- **自由テキスト(`freeText`)は残る** — 管理画面の `artists.js` が参照曲生成に「追加の要望」として添えて送っている(`song-extra`)。消えるのは「自由テキストだけで作る `manual` 経路」

## 非目標(今回はやらない)

- **`instrumental`**: カスタム生成の削除で常に `false` になるが、API の受け口・DB カラム・Suno への引き渡し・表示は残す(参照曲がインスト曲のときに使う余地があり、過去データも持っている)。不要と判断したら別 TODO
- リアルワード制限・今日のコンテキスト(ニュース)・参照曲まわり一式(`reference.ts` / アーティスト・曲の登録 / iTunes 連携)・生成の非同期化・ポーラー・`daily_count` / `daily_hour` / `daily_timezone` / `llm_effort` — **すべて残す**
- `favorite` → `rating` 変換の旧マイグレーション(`db.ts` L149-158)は `rating` 列ごと消えるので同時に削除するが、それ以外の `addColumnIfMissing()` 群は触らない

---

## Phase 1: 冒険日(`daily_adventure`)の削除

各 Phase 単体で `npm run typecheck` が通る状態を保つ。

**server**
- `scheduler.ts`: `DailySettings.adventureProbability` / `SETTING_DEFAULTS.adventureProbability` / `getDailySettings()` の読み出し / 冒険判定(L133-134)とログ(L142) / `DailyRunStart.adventure` / `runDaily()` の戻り値 / tick のログ。`mode` は `"daily"` 固定になる
- `llm.ts`: `GenerationMode` から `"daily_adventure"` を削除 / 冒険日節(L233-241)
- `index.ts`: `PUT /settings` の `adventureProbability` 検証(L191-197)/ `GET /generation-params` の `adventureProbability`(L274)/ `POST /daily/run` 応答の `adventure`(L307)

**管理画面**
- `settings.html`: 「冒険日の確率」の設定行(L83-88)
- `app.js`: `MODE_LABELS` / `MODE_BADGES` の `daily_adventure`

**iOS**
- `SettingsView`: 冒険日スライダー(`adventureValue` / `saveAdventure()` / L100-110・266-268・298・322)
- `GenerationParamsView`: 冒険日確率の行(L53-57)
- `GenerateView`: 進行中カードの「· 冒険日」(L399)
- `TrackListView`: 冒険バッジ(L291-293・363-365)
- `APIModels`: `ServerSettings.adventureProbability` / `SettingsUpdateRequest.adventureProbability` / `GenerationParams.adventureProbability` / `Track.isAdventure` / `taskModeLabel` の `daily_adventure` / `DailyRunResponse.adventure`

`settings` テーブルの `adventure_probability` 行は Phase 7 で削除する。

## Phase 2: カスタム生成(`mode = manual`)の削除

**server**
- `index.ts` `POST /generate`: `presetIds` の受理と `selectedPresets` の解決を削除、`artistSongId` を**必須**にして未指定は 400、`mode` は `"artist"` 固定、`displayPrompt` からプリセット表記を削除
- `llm.ts`: `buildSongPlanPrompt()` の `else if (input.mode === "manual")` 分岐(L220-228)と、禁止ワード注記の manual 分岐(L259-260)
- `generation.ts`: `completeGeneration()` の `selectedPresets` 引数

**iOS**
- `GenerateView`: カスタム生成セクション一式(`showsCustom` / `prompt` / `instrumental` / `isSubmitting` / `customError` / `promptFocused` / `canSubmitCustom` / `customSection` / `submitCustom()` / キーボードツールバー)
- `APIModels`: `GenerateRequest` の `artistSongId` を必須化、`prompt` は「追加の要望」の意味に(現状 iOS からは常に空文字)
- UI テスト: `GenerateUITests` のカスタム生成の開閉・送信テスト(L16-25 付近)、`ScreenshotUITests` L90-93 のカスタム生成の撮影

## Phase 3: フォールバック経路の削除と `llm.ts` の直線化

**server**
- `scheduler.ts` `startDailyRun()`: `selectReferenceSong()` が `undefined` なら**エラーを投げる**(「参照曲が登録されていないため生成できません」)。フォールバックの `console.warn` とプリセット渡しを削除し、`planInput` は参照曲・コンテキスト・instrumental だけになる
  - tick 側は既存の `catch` がそのまま拾い、`lastFailedAt` により **30 分後に再試行**(`last_daily_*` を進めないので、アーティストを登録すればその日のうちに追い生成される)。ログ文言だけ調整する
- `index.ts` `POST /daily/run`: 参照曲が無いことによる失敗は **409**(それ以外は現状どおり 502)
- `llm.ts`:
  - `SongPlanInput` を `{ instrumental, freeText, extraContext?, referenceSong }` に縮める(`mode` / `selectedPresets` / `presetPool` / `presetRatings` / `recentStyles` を削除)
  - `buildSongPlanPrompt()` を分岐なしの直線に(要素プール節・直近スタイル節・モード別の禁止ワード注記・歌声指示の三項演算子を解消)
  - `requestSongPlan()` の `tools` を常時有効に、`planIssues()` の `if (input.referenceSong)` を無条件に、`GenerationMode` を `"daily" | "artist"` に
- `db.ts`: `listRecentStyles()` / `listRecentStyleRows()` / `RecentStyleRow`(注入も表示も無くなる)

**iOS**
- `GenerateView` のヒーロー文言・`GenerationParamsView` の説明文で「登録が無いとき」の含みがあれば調整

## Phase 4: プリセットの削除

**server**
- `presets.ts` を**ファイルごと削除**(`SEED_PRESETS` / `CATEGORY_LABELS`)
- `index.ts`: `GET/POST/PUT/DELETE /api/presets` / `presetJson()` / `parsePresetBody()` / 起動時の初期プリセット投入(L743-755)/ instrument 廃止マイグレーション(L729-741)/ `taskJson()`・`trackJson()` の `usedPresets` / `usedPresetJson()`
- `db.ts`: `PresetRow` / `listPresets()` / `getPreset()` / `createPreset()` / `updatePreset()` / `deletePreset()` / `deletePresetsByCategory()` / `TaskPresetRow` / `insertTaskPresets()` / `listTaskPresets()`(テーブル定義は Phase 7)
- `llm.ts`: `presetLines()` / `PresetRatings` / `SongPlan.usedPresets` / **`SONG_PLAN_SCHEMA` の `usedPresets`(`properties` と `required` の両方)**
- `generation.ts`: `resolveUsedPresets()` と `insertTaskPresets()` の呼び出し

**管理画面**
- `presets.html` / `presets.js` を削除、`index.html` / `settings.html` / `artists.html` のサイドバー「パラメータ一覧」リンクを削除
- `index.ts`: `GET /api/real-world-words`(利用者は `presets.js` だけだった)
- `app.js`: 「使用プリセット」行(L168)
- `style.css`: `.preset-*` / `.word-table` 系の未使用ルール

**iOS**
- `GenerationParamsView`: `poolSection()` / `categories()` / `pillText()`
- `TrackDetailView`: `presetsSection`(L128-136)
- `APIModels`: `PoolPreset` / `UsedPreset` / `Track.usedPresets` / `GenerationParams.presets` / `.categoryLabels`
- `ScreenshotUITests`: 要素プールの長さを前提にしたスクロール位置(L95 付近)

## Phase 5: 評価(👍/👎)の削除

**server**
- `index.ts`: `POST /api/tracks/:id/rating` / `trackJson()` の `rating`
- `db.ts`: `countPresetRatings()` / `PresetRatingCount` / `updateTrackRating()` / `TrackRow.rating` / `.rated_at` / `favorite` → `rating` 変換ブロック(L149-158)/ `addColumnIfMissing("tracks", "rating" | "rated_at", ...)`

**管理画面**
- `app.js`: 評価ボタンの描画(L120-122)と `syncRating()` / クリック処理(L210-238)
- `style.css`: `.rating` / `.rate-btn`

**iOS**
- `RatingButtons.swift` と `RatingUITests.swift` を**ファイルごと削除**
- `TrackListView`: `applyRating` と `onRated` の受け渡し(L37・45・86・323・354)
- `TrackDetailView`: `RatingButtons`(L68)と `onRated` の init 引数
- `FullPlayerView` / `MiniPlayerView`: `onRated` 引数
- `APIModels`: `Track.rating` / `RatingRequest` / `RatingResponse`
- `TrackDetailUITests`: 評価ボタンを前提にした記述(L16 付近)

## Phase 6: 生成パラメータ API / 画面の整理

- `index.ts` `GET /generation-params` の返却を **`referenceCandidates` / `recentReferences` / `contextNews` / `wordMaxUses` / `wordWindowDays` / `bannedWords` / `lastChanceWords` / `trackedWordCount`** に絞る。`referenceMode` は削除する(フォールバックが無くなり分岐の意味が消えるため。候補が空 = おまかせ生成できない、という表示に変える)
- `GenerationParamsView`: `referenceMode` 分岐を解消して参照曲の候補を常時表示。候補が空のときは「アーティストを登録してください」を出す
- `APIModels`: `GenerationParams` の該当キー削除、`referenceCandidates` / `recentReferences` を非 optional に

## Phase 7: DB の整理

起動時 DDL からテーブル定義を削除し、一回限りの後片付けを入れる(既存の instrument マイグレーションと同じ流儀。`DROP ... IF EXISTS` は冪等なので `settings` への記録は不要)。

```
DROP TABLE IF EXISTS presets;
DROP TABLE IF EXISTS task_presets;   -- インデックス idx_task_presets_task も道連れ
DROP TABLE IF EXISTS profile;        -- 2026-08-08 に廃止済み・参照ゼロ
ALTER TABLE tracks DROP COLUMN rating;
ALTER TABLE tracks DROP COLUMN rated_at;
```

- `settings` の不要キーも削除: `adventure_probability` / `migration_drop_instrument_presets`
- **不可逆**。実施前に `sqlite3 data/db.sqlite ".backup ..."` でバックアップを取る(WAL のため `cp` は不可 — [memory: isolated-db-test-server])

## Phase 8: ドキュメントと総合検証

- `CLAUDE.md`: 「現状」段落(生成経路 3 → 2、プリセット評価学習の記述を削除)/ 管理画面のページ一覧 / `llm.ts` の説明(分岐が無くなった旨)/ `scheduler.ts` の説明(フォールバックの削除)/ API 一覧
- `docs/specs/music-generation.md` / `docs/specs/music-generation-flow.md` を現状に合わせて更新(廃止した仕組みは経緯として日付付きで残す — このリポジトリの書き方に合わせる)
- `docs/specs/music-generation-flow/*.svg` 3 点、とくに評価のフィードバックループを描いている `flow-overview.svg` を描き直す
- TODO → DONE(完了日)、本プランを `docs/plans/archive/` へ移動

---

## 影響範囲

- **server**: `presets.ts`(削除)/ `llm.ts` / `generation.ts` / `scheduler.ts` / `index.ts` / `db.ts`
- **管理画面**: `presets.html`・`presets.js`(削除)/ `index.html`・`settings.html`・`artists.html`(ナビ)/ `app.js` / `style.css`
- **iOS**: `RatingButtons.swift`・`RatingUITests.swift`(削除)/ `APIModels` / `GenerateView` / `GenerationParamsView` / `SettingsView` / `TrackListView` / `TrackDetailView` / `FullPlayerView` / `MiniPlayerView` / `GenerateUITests` / `ScreenshotUITests` / `TrackDetailUITests`
- **ドキュメント**: `CLAUDE.md` / `docs/specs/music-generation.md` / `docs/specs/music-generation-flow.md` + SVG 3 点

## リスクと注意

- **旧アプリは新サーバーで動かなくなる**。`DailyRunResponse.adventure` が非 optional なので、おまかせ生成の応答デコードが失敗する。カスタム生成は 400、評価 POST は 404 になる。**サーバーと実機アプリを同時に更新する**必要があり、既存 TODO「本番反映」と合流させて進める
- **DROP は不可逆**。Phase 7 の前にバックアップ(上記)
- 参照曲が 0 件になると毎日の生成が止まる(意図した挙動)。アーティストを 1 件も登録していない環境では何も作られないため、ログと API のエラーメッセージで理由が分かるようにする

## テスト方針

- `npm run typecheck` を Phase ごとに実行。型に出ない削除漏れは `grep` で参照ゼロを確認する(`preset` / `rating` / `adventure` / `recentStyle` / `manual`)
- 隔離 DB テストサーバー([memory: isolated-db-test-server] — `sqlite3 .backup` でコピー・`daily_enabled=false`)で:
  - **既存 DB**(プリセット・`task_presets`・評価が入っている)で起動できること、Phase 7 の DROP が通ること
  - **空 DB** で起動できること(初期プリセット投入を消しても落ちない)
  - `GET /api/settings` / `GET /api/generation-params` / `GET /api/tracks` の応答キーを削除前後で比較
  - 参照曲 0 件で `POST /api/daily/run` が 409、登録ありで 201(受付のみ)
  - 削除した経路が 404 / 400 を返すこと(`/api/presets`・`/api/real-world-words`・`/api/tracks/:id/rating`・`artistSongId` 無しの `/api/generate`)
- 実生成 2 曲: 参照曲ベースの daily(スケジューラ経由で `last_daily_*` が進むこと)と artist 経由(管理画面から自由テキスト付き)。`usedPresets` を消したスキーマで LLM が正常に返ること・`sources` が入ることを確認
- 管理画面をヘッドレス Chrome で目視([memory: headless-chrome-admin-screenshots])— ナビ 3 項目・評価ボタンの消失・楽曲詳細の表示
- iOS シミュレータビルド + UI テスト([memory: ios-simulator-ui-testing])。削除したテストを除いた全件が通ること
