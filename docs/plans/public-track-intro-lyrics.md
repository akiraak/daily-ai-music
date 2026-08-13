# 公開ページの曲詳細に短い紹介と歌詞を表示する

作成: 2026-08-12

## 目的・背景

公開ページ(2026-08-12 公開。[public-tracks-web](archive/public-tracks-web.md))の曲詳細は、カバー・曲名・日付・生成モデル名とプレイヤーだけで、**曲の中身の手がかりが無い**。聴く前に「どんな曲か」が分かるように、詳細ページへ **短い紹介** と **歌詞** を足す。

**既存の `tasks.intent`(狙い)はそのまま出せない。** intent は「リファレンス楽曲から取り入れた音楽的特徴と、その根拠(検索で確認した / 曲を知っている / 作風からの推定)を項目ごとに書き分ける」という指示で書かせている開発者向けのメモで、内容が参照曲に依存する。公開条件 (3)「参照曲(実在アーティスト名・曲名)を公開ページに出さない」に真っ向から抵触するため、**公開用の紹介文は別に持つ**。

歌詞の公開は Phase 0 調査([public-tracks-web](archive/public-tracks-web.md))の枠内で進められる。生成時に「原曲の歌詞を複製・翻訳・言い換えしない」と指示済みで、問題があれば opt-out(`tracks.published`)で下げられる = 条件 (2)。ただし**既存曲との類似が最も目に見える形で出るのが歌詞**なので、公開後に気になる曲が出たら曲ごと非公開にする運用は今まで以上に効かせる。

## 決めたこと(2026-08-12 ユーザー確認済み)

| 論点 | 決定 | 理由 |
|---|---|---|
| 紹介文の出どころ | **LLM の出力に公開用の `intro` を足す**(新曲は生成時に作られる)+ **既存 36 曲は 1 回きりのスクリプトでバックフィル** | intent は流用できない(上記)。初日から全曲に紹介が付いた状態にする |
| 紹介文の入力 | 曲名・スタイル(日本語訳)・歌詞だけ。**参照曲(アーティスト名・曲名)は渡さない** | 入力に入れなければ出力に混ざりようがない。プロンプトでの禁止だけに頼らない |
| 歌詞のセクションタグ | `[Verse]` `[Chorus]` 等は **サーバー側で落として本文だけ**返す | 表示側で隠すのではなく公開 API が出さない(既存の「出さないものはレスポンスに含めない」と揃える) |
| 歌詞の訳 | 原詞のみ。`lyrics_ja` は出さない | 歌声の言語は既定 `ja` で、訳を持つのは旧データの英語詞だけ。切替 UI を足す価値が薄い |
| 詳細の取得 | **`GET /site/api/tracks/:id` を新設**。一覧 `GET /site/api/tracks` は据え置き | 歌詞は 1 曲で数百〜数千字。全曲を返す一覧に載せると一覧ページの転送量が跳ねる |
| 一覧ページ | 変更しない(紹介文も出さない) | ジャケット主役のグリッドという案A の設計。カードに文章を足すと崩れる |
| 編集 UI | **作らない**。管理画面の楽曲一覧には**表示だけ**足す | 文面に問題があれば曲ごと非公開にすれば止まる(opt-out と同じ考え方)。編集の口を足すと保存 API・検証・iOS 追従まで広がる |
| インストゥルメンタル | 歌詞ブロックごと出さない(`lyrics` は null) | 空の見出しだけ残ると壊れて見える |
| バックフィルの置き場所 | `server/src/scripts/backfill-intro.ts` | `COPY server/src ./src` に含まれるので **ops 側の Dockerfile を触らずに** `docker compose exec` で実行できる(公開ページ導入時に `server/site` の COPY 漏れで `/` が 404 になった反省) |

### 却下した案

- **intent を LLM で公開用に書き直して流用**: 元が技術メモなので紹介文としては薄くなりやすく、毎回「参照曲名が混ざっていないか」を検査する仕掛けが要る。入力から参照曲を外して書き下ろすほうが単純で安全
- **新曲だけ紹介を付ける(バックフィルしない)**: 当面ほとんどの曲で欄が空になり、詳細ページの見た目が安定しない
- **歌詞を一覧 API に含めてしまう**: 実装は一番小さいが、一覧の転送量が 36 曲で数十 KB → 数百 KB に増える。曲は毎日増えるので後で必ず効いてくる

## Phase 1: サーバー — `tasks.intro` と曲詳細 API

### `server/src/db.ts`

- `addColumnIfMissing("tasks", "intro", "intro TEXT")`(冪等。旧データは NULL = 紹介なし)
- `TaskRow` / `TRACK_TASK_COLUMNS` / `updateTaskPlan()` に `intro` を通す
- `getPublishedTrack(id)` を追加(`WHERE tracks.id = ? AND tracks.published = 1`。非公開・不在は undefined)

### `server/src/llm.ts`

- `songPlanSchema()` に `intro` を追加 — 「公開ページに出す短い紹介(日本語、1〜2 文、60〜100 字目安)。曲の雰囲気・情景が伝わる文にする。**実在のアーティスト名・曲名・固有名詞を含めない**。『AI が生成した』のようなメタな説明は書かない」。`required` は `Object.keys(properties)` なので追加で自動的に必須になる
- `SongPlan` に `intro: string`
- `buildSongPlanPrompt()` の「作り方(厳守)」に 1 行足して **intent との書き分け**を明示する(intent = 開発者向けの根拠、intro = 聴く人向けの紹介。intro には参照曲の話を書かない)

### `server/src/index.ts`

- `GET /site/api/tracks/:id` を追加(無認証)。公開中の曲だけを返し、**非公開・不在・数字でない id は 404**
  - 返すのは一覧のフィールド + `intro`(無ければ null)+ `lyrics`(タグ除去済み。インストゥルメンタル・旧データは null)
  - **参照曲・スタイル・狙い(intent)・リアルワード・`llm_prompt` は返さない**(一覧と同じ原則)
- タグ除去は純関数 `stripLyricSectionTags()` として切り出す(行頭が `[...]` だけの行を落とし、連続する空行を 1 つに畳む)
- 一覧の `publicTrackJson()` は変更しない

## Phase 2: 公開ページと管理画面の表示

### `server/site/`

- `track.js`: 一覧を取って `find` する方式から **`GET /site/api/tracks/:id`** に変更。404 は既存の「曲が見つかりません(非公開になった可能性があります)」に寄せる。「ほかの曲」は引き続き一覧 API を使う(2 リクエストになるが、詳細を個別 API にしておくと将来サーバー側で OGP メタを注入するときにそのまま使える)
- `track.html`: プレイヤーの下に紹介ブロック、その下に歌詞ブロック(`<h2>歌詞</h2>`)。どちらも値が無ければ `hidden`
- `style.css`: 紹介は本文よりやや大きめ、歌詞は `white-space: pre-line` で行間広め。モバイル幅で読める字送りにする

### `server/public/`(管理画面)

- 楽曲一覧の折りたたみに `intro` を表示するだけ(公開されている文面の確認用。編集はしない)

## Phase 3: 既存曲のバックフィル

`server/src/scripts/backfill-intro.ts`(一回きりだが再実行できる形で残す)。

- 対象: `tracks` を持ち `tasks.intro IS NULL` のタスク。**入力は曲名・`style_ja`・`lyrics` のみで、参照曲(`ref_artist_name` / `ref_song_title`)は渡さない**
- モデルは Haiku(`claude-haiku-4-5-20251001`)。生成時と同じ禁止事項(実在の固有名詞を書かない・メタな説明をしない)をプロンプトに置く
- `--dry-run`(生成して表示するだけ)/ `--limit N` / 逐次実行(並列にしない)。途中で落ちても NULL の行だけ拾うので再実行で続きから
- 開発機の DB のコピーで先に流し、**文面を目視確認してから**本番に掛ける

## Phase 4: 本番反映

- 通常フロー(g3plus の clone で `git pull` → `build` → `up -d`)。**新しいディレクトリを足していないので ops 側の Dockerfile 変更は不要**(`server/src/scripts/` は `COPY server/src ./src` に含まれる)
- `tasks.intro` は `ADD COLUMN` のみで冪等 → **DB の退避は不要**
- デプロイ後にバックフィルを実行(まず `--dry-run --limit 3` で文面を見る):
  ```bash
  ssh -i ~/.ssh/id_rsa_nopass ubuntu@g3plus.lan \
    'docker compose --project-directory /home/ubuntu/g3plus-ops/daily-ai-music \
       exec daily-ai-music node src/scripts/backfill-intro.ts --dry-run --limit 3'
  ```
- 確認: `/track/:id` に紹介と歌詞が出る / 公開 API に参照曲・スタイル・狙いが含まれない / 非公開の曲は 404 のまま / 一覧ページが変わっていない / `/api/*` の認証が緩んでいない

## 影響範囲

- `server/src/db.ts` — `tasks.intro` の追加と受け渡し、`getPublishedTrack()`
- `server/src/llm.ts` — 出力スキーマ + プロンプト 1 行
- `server/src/index.ts` — `GET /site/api/tracks/:id`、`stripLyricSectionTags()`
- `server/site/track.html` / `track.js` / `style.css` — 紹介・歌詞の表示
- `server/public/` — 管理画面での intro 表示(読み取りのみ)
- `server/src/scripts/backfill-intro.ts`(新規)
- iOS — **変更なし**(既に楽曲詳細で歌詞・狙いを表示している)
- CLAUDE.md — 公開ページの節に intro と歌詞を追記

## テスト方針

- `npm run typecheck`
- 隔離 DB テストサーバー(`sqlite3 .backup` のコピー + `daily_enabled=false`)で:
  - `GET /site/api/tracks/:id` の追加フィールドが `intro` と `lyrics` だけで、`style` / `intent` / `refArtistName` / `lyricsJa` / `llmPrompt` が含まれないこと
  - 非公開にした曲の id が 404、数字でない id が 404、一覧 API のレスポンスが変わっていないこと
  - `stripLyricSectionTags()` の単体確認(タグ行の除去 / 連続空行の畳み込み / タグの無い歌詞をそのまま返す)
  - インストゥルメンタル(歌詞が空)の曲で `lyrics` が null になり、ページに歌詞ブロックが出ないこと
- 公開ページはヘッドレス Chrome で PC / モバイル幅のスクリーンショット確認
- バックフィルは開発機の DB コピーに対して `--dry-run` → 実行 → 文面確認

## コスト

- 新曲: 既存の 1 回の LLM 呼び出しに項目が 1 つ増えるだけ(誤差)
- バックフィル: 36 曲 ×(歌詞込みの入力 + 100 tokens 程度の出力)を Haiku で 1 回きり。数十円の規模

## Phase 分割

- [ ] Phase 1: サーバー — `tasks.intro` + `GET /site/api/tracks/:id`(intro + タグ除去済み歌詞)
- [ ] Phase 2: 公開ページの曲詳細に紹介・歌詞を表示(+ 管理画面に intro の表示)
- [ ] Phase 3: 既存曲のバックフィルスクリプト(開発機の DB で文面確認まで)
- [ ] Phase 4: 本番反映(デプロイ → バックフィル実行 → 公開・非公開の確認)
