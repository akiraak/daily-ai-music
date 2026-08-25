# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**Music Plant**(リポジトリ名: daily-ai-music)は、Suno を使って音楽を生成し、iPhone から操作・再生できるアプリ。名前は「AI が毎日音楽を製造する無機質な工場」のイメージ。内部識別子(bundle id `com.akiraak.dailyaimusic`、Xcode プロジェクト名 `DailyAIMusic`、リポジトリ名、ドメイン `music.chobi.me`)は旧称のまま。

- **毎日の自動生成**: スケジュール実行で毎日新しい曲を自動生成する
- **手動リクエスト**: iPhone からプロンプトを指定してその都度生成することもできる
- 生成した楽曲は iPhone アプリで一覧・再生できる

## 構成(予定)

| コンポーネント | 技術 | 役割 |
|---|---|---|
| iOS アプリ | ネイティブ(Swift) | 楽曲の一覧・再生、生成リクエストの送信 |
| バックエンド | TypeScript / Node.js | Suno 連携、楽曲メタデータ・音源の管理、毎日の自動生成スケジューラ、iOS アプリ向け API |

## 現状

バックエンド + Web 管理画面(`server/`)と iOS アプリ最小版(`ios/`)が動く。ブラウザ・iPhone から生成リクエスト・進行状況の確認・楽曲の一覧と再生ができる。生成は LLM(Claude API)がスタイル・歌詞を作って Suno に customMode で渡す方式で、毎朝 PT 6:00 に 3 曲(設定 `daily_count` で 1〜10 に変更可)が 1 曲ずつ順次自動生成される。**生成はすべて参照曲ベース**(2026-08-10)— 登録済みの曲(`artist_songs`)から 1 曲を選び、その曲に似た新曲を作る。生成の経路は 2 つで、どちらも必ず参照曲を持つ — おまかせ(`daily`: サーバーが曲を選ぶ)/ **アーティスト経由**(`artist`: ユーザーが曲を選ぶ。2026-08-09 追加。**UI 上の入口は 3 つ**(2026-08-12 の再構築 + 3 経路化)— おまかせ(daily)/ アーティストでおまかせ(`POST /api/generate { artistId }`: 人がアーティストを選び、曲はサーバーが曲 LRU で選ぶ)/ 曲から生成(`{ artistSongId }`)。iOS はタブを 4 つ(ライブラリ / 生成 / 参照曲 / 設定)にして、生成の入口(つくる)と参照曲の管理(登録・有効/無効)を分離した。[docs/plans/archive/generation-ui-restructure.md](docs/plans/archive/generation-ui-restructure.md) / [docs/plans/archive/generation-three-entries.md](docs/plans/archive/generation-three-entries.md))。daily の選択は `server/src/reference.ts` の「アーティストを LRU → その人の曲を LRU」の 2 段階で、受付時点で `artist_song_id` が入るため同じ日の 3 曲は自動的に別アーティストになる。**参照曲は曲ごとに有効/無効を持ち(`artist_songs.enabled`、2026-08-11 追加)、生成は有効な曲からしか行わない** — **取り込みは既定で無効**(1 アーティスト最大 200 曲を機械的に取り込むため、参照曲にする曲は人が選ぶ)で、曲一覧(管理画面・iOS)で有効にした曲だけが候補になる。例外は曲名からの登録で、そこで選んだ 1 曲は生成するために選んだ操作なので自動で有効になる。除外は `enabled` の 1 か所だけなので「一覧では有効なのに生成では選ばれない曲」は無い。**有効な参照曲が 0 件なら生成しない**(スケジューラは 30 分後に再試行、`POST /api/daily/run` は 409)。毎日の自動生成には外部コンテキスト(ニュース)を「今日のコンテキスト」として注入し(曲調は参照曲・歌詞のテーマはニュース)、曲の中心となった語(リアルワード)を保存して直近 30 日で同一ワード 2 回までの使用制限を掛ける(仕様: [docs/specs/music-generation.md](docs/specs/music-generation.md))。参照曲を登録する入口は 2 つ — アーティスト名から(その人の曲を最大 200 曲取り込む)と曲名から(選んだ曲の `artistId` でアーティストを逆引きし、まとめて登録。2026-08-09 追加)。**アーティスト名は日本語表記で表示する**(2026-08-13 追加。`artists.name_ja` = JP ストアの表示名。iTunes の artist 行の `artistName` はローカライズされないため `artistLinkUrl` の slug から取る。`name`(正式表記)は同一性判定・LLM 入力用にそのまま残し、表示・タスクのスナップショット(`ref_artist_name`)だけ `nameJa ?? name`。導入前の登録分は再取得か `src/scripts/backfill-artist-name-ja.ts` で埋める。[docs/plans/archive/artist-name-localization.md](docs/plans/archive/artist-name-localization.md))。LLM は `web_search` で実際の曲情報(BPM・キー・コード進行・編成)を調べてから style を書く(2026-08-09 追加。1 曲あたり 3〜4.5 分かかるため生成は非同期)。**歌声の言語は設定で選べる**(`vocal_language`、既定 `ja`。2026-08-11 追加。それ以前は「英語歌詞 + 日本語訳」で固定)— `lyrics` は Suno に渡す原詞(選んだ言語)、`lyricsJa` は日本語訳で、日本語が原詞のときは訳を作らない(出力スキーマから外す)。原詞の言語は `tasks.lyrics_lang` に記録する。日本語の発音対策はプロンプトの軽い表記ルールのみ(表記置換はしない)で、`SUNO_MODEL` の既定も `V5_5` に上げた。**2026-08-10 に、参照曲ベース化で使われなくなった機能を削除した** — プリセット(要素プール)・評価(👍/👎)とその学習ループ・冒険日・カスタム生成(`manual`)・参照曲 0 件のフォールバック・パラメータ一覧ページ。`presets` / `task_presets` / `profile` テーブルと `tracks.rating` / `rated_at` カラムも DROP 済み。

### コマンド

```bash
./run-server.sh        # サーバー起動 → 管理画面 http://localhost:3014/admin/(PORT 環境変数で変更可)
                       # 初回の npm install と、ポートを掴んでいる既存プロセスの停止も行う
./scripts/fetch-logs.sh    # 本番のログ・運用データ(エラー・タスク・楽曲・設定・クレジット)を
                           # .logs/<env>-<日時>/ に取得(--local / --since 7d / --raw)。/logs の入力
./run-ios-device.sh    # iOS アプリを実機にインストール・起動(既定は本番 https://music.chobi.me へ接続、
                       # --local でMacのLAN IP自動検出。.env の API_SECRET 注入)

# 個別に実行する場合
cd server
npm run dev        # --watch 付き起動(開発用)
npm run typecheck  # tsc --noEmit

cd ios
xcodegen generate  # project.yml から .xcodeproj を生成(gitignore 対象)
xcodebuild -project DailyAIMusic.xcodeproj -scheme DailyAIMusic \
  -destination 'platform=iOS Simulator,name=iPhone 17' build   # シミュレータビルド
# UI テスト(要: サーバー起動 + BACKEND_API_SECRET=<.env の API_SECRET> を引数に付与)
xcodebuild test -project DailyAIMusic.xcodeproj -scheme DailyAIMusic \
  -destination 'platform=iOS Simulator,name=iPhone 17' BACKEND_API_SECRET=...
```

- Node 24 の TS 直接実行(型ストリップ)を使うためビルドステップは無い。`erasableSyntaxOnly` な構文のみ使用可(enum・パラメータプロパティ不可)。import は `.ts` 拡張子付きで書く
- API キーはリポジトリ直下の `.env`(`SUNOAPI_ORG_KEY` / `SUNOAPI_BASE_URL` / `API_SECRET`)から読む。`.env.example` 参照

### API 認証

esl-learning-assistant と同方式。`/api/*` は `X-API-Secret` ヘッダ必須(`.env` の `API_SECRET`。16 文字以上 `[A-Za-z0-9_-]`、未設定はサーバーが起動時 fail-fast)。sha256 で固定長に揃えた timing-safe 比較。無認証経路は `/health` と**公開ページ関連(`/` の静的ファイル・`GET /site/api/tracks`・`GET /site/api/tracks/:id`・`/site/audio|images/*`。2026-08-12 追加)**のみで、公開側の音源・画像は配信前に DB で `tracks.published = 1` を確認する(非公開・不明なファイル名は 404)。`/api/ping` が接続テスト用。音源・カバー画像も API と同じ二重マウントで認証付き配信 — iOS は `/api/audio/*` `/api/images/*`(secret 必須。AVPlayer は `AVURLAsset` のヘッダ注入、画像は `CoverImageView` の自前ローダー)、管理画面は `/admin/audio/*` `/admin/images/*`(`<audio>/<img>` タグは Cookie 自動送信なので Access の認証 Cookie が効く)。`/api/tracks` の `audioUrl`/`imageUrl` はマウント先に応じたプレフィックス付きで返る。Web 管理画面は secret 不要 — 同居サーバーの `/admin/api/*`(同じ API ルートをアプリ層無認証でマウント。本番はエッジの Cloudflare Access が `/admin` ごと保護)を使う。iOS アプリはビルド時注入(Info.plist)+ 設定画面で上書き。

### バックエンド構成(`server/`)

- 管理画面のページ: 楽曲一覧(`index.html`。行末に公開ページへの公開/非公開トグル)/ 参照曲(`artists.html`。旧称アーティスト、2026-08-12 に改名(ファイル名はそのまま)。アーティスト名または曲名で検索して登録・曲一覧・曲を選んで生成・曲ごとの有効/無効と一括操作)/ 設定(`settings.html`。歌声の言語・生成モデルの表示と effort の切り替え・毎日の自動生成・外部コンテキスト)
- **公開ページ(`server/site/`、2026-08-12 追加)**: 誰でも見られる公開 Web(`/` にマウント。デザインは案A ギャラリー・ミニマル)。曲一覧(`index.html`。カバーグリッド、カードで詳細へ、▶ で行内再生)+ 曲詳細(URL は **`/track/:id`**(共有される恒久 URL)。実体は `track.html` で、id はページ側 JS がパスから取る。大カバー+シークバー付きプレイヤー+**紹介**+**歌詞**+ほかの曲)。**曲詳細は OGP メタ注入済み(2026-08-12)** — SNS クローラーは JS を実行しないため、`/track/:id` のハンドラが `track.html` の `<!-- track-meta -->` ブロックを曲別メタ(`<title>`・description・`og:title/description/url/image`・`twitter:card: summary`。値は HTML エスケープ)に置換して返す。絶対 URL のベースは `.env` の `PUBLIC_BASE_URL`(未設定は `http://localhost:<PORT>`。本番は `https://music.chobi.me`)。**非公開・不在・数字でない id は HTML も 404**(詳細 API・音源・画像と整合。非公開に下げた曲は共有済みリンクも即座に死ぬ)。**全曲自動公開の opt-out 方式**(`tracks.published`、既定 1)で、公開 API は 2 つ — 一覧 `GET /site/api/tracks` が id・title・duration・audioUrl・imageUrl・sunoModel・llmModel・**intro**・createdAt、曲詳細 `GET /site/api/tracks/:id` がそれ + **`lyrics`**(セクションタグ除去済み。非公開・不在・数字でない id は 404)。**歌詞は 1 曲で数千字になるため一覧には載せず詳細だけ**(参照曲・スタイル・狙い・リアルワード・LLM 入力はどちらのレスポンスにも含めない。経緯と公開条件は [docs/plans/archive/public-tracks-web.md](docs/plans/archive/public-tracks-web.md) の Phase 0 参照)。フッターに AI 生成の明記、管理画面へのリンクは置かない
- **紹介文(`tasks.intro`、2026-08-12 追加)**: 公開ページ用の短い紹介(日本語 2 文まで・120 字以内)。**開発者向けの `intent`(狙い)は参照曲に触れるので公開には使えず**、聴く人向けの文を LLM の出力に別項目として足している。**生成の入力に参照曲は渡さない**(入力に入れなければ実在アーティスト名が混ざりようがない)。導入前の曲は `server/src/scripts/backfill-intro.ts`(Haiku・逐次・`--dry-run` / `--limit N`・再実行可)で埋める。編集 UI は作らない — 文面に問題があれば曲ごと非公開にする(opt-out と同じ考え方)。管理画面の楽曲一覧では折りたたみに表示だけする
- **Hono + @hono/node-server**: API・静的配信(`public/` の管理画面は `/admin` 配下。本番で Cloudflare Access をこのパスだけに掛けるため。`/` 配下は公開ページ(`server/site/`)。音源・画像は `/api/audio/*` 等 + `/admin/audio/*` 等の二重マウントで Range 対応配信、公開側は公開判定付きの `/site/audio|images/*` — 上記「API 認証」参照)
- **node:sqlite**(`data/db.sqlite`): `tasks`(生成ジョブ)/ `tracks`(完成楽曲)/ `artists`・`artist_songs`(参照曲)/ `real_world_words` / `settings` / `error_logs`(エラーログ)。`data/` は gitignore
- **`src/errorlog.ts`**: エラーログ。`logError()` / `logWarn()` が `console` 出力に加えて `error_logs` テーブルへ構造化して残す(`level` / `origin`(server・ios)/ `source` / `event`(`task_failed` 等の安定した識別子)/ `message` / `detail`(JSON)/ `fingerprint` / `task_id`)。同じ `fingerprint` が 10 分以内に再発したら行を増やさず `repeat_count` に畳み、90 日 or 5000 行で古い順に落とす。fingerprint は message の可変部分(URL・ID・「曲名」・数値)を伏せて計算する。API キー・secret・LLM プロンプト全文は `detail` に載せない。取得は `GET /api/errors` + `scripts/fetch-logs.sh`(旧 fetch-error-logs.sh。エラーに加えタスク・楽曲などの運用データもまとめて取る。本番は Cloudflare Access のため `/admin` を curl できず、`/api` + secret 経路を使う。secret は `g3plus-ops/daily-ai-music/.env` から読む)。`docker logs` は 10MB×3 でローテートされるので DB が正本、生ログは `--raw` で ssh 取得する保険。**解析は `/logs`**(`.claude/skills/logs/SKILL.md`。2026-08-13 追加)— エラーを台帳 `docs/error-triage.md`(fingerprint ごとの判断: 無視/様子見/対応中/修正済み + 再浮上ルール)と突き合わせて新規・再発だけ調査し、修正項目を `BACKLOG.md` に記録する
- **`src/itunes.ts`**: iTunes Search API クライアント(アーティスト経由生成の楽曲データソース。API キー不要)。アーティスト候補の検索・曲候補の検索(曲名からの登録用。track 行の `artistId` でアーティストを逆引き)・楽曲一覧の取得(最大 200 曲・同名の重複は最古を残して除去)を行う
- **`src/suno/client.ts`**: Suno 連携の抽象化インターフェース。実装は `kieai.ts`(kie.ai / sunoapi.org 互換)。公式 API が出たらここを差し替える
- **`src/generation.ts`**: 生成ジョブ管理。**受付(`acceptGeneration`)と本体(`completeGeneration`)を分けた非同期方式** — 受付は LLM を呼ぶ前に `status = 'PLANNING'` のタスク行を作って即返し、本体がバックグラウンドで LLM → Suno 送信まで進める(参照曲ありの生成は web_search で 3 分ほどかかり、同期のままだと本番エッジのプロキシタイムアウトに掛かるため)。失敗は必ずタスクの `FAILED` として記録される。10 秒間隔のポーラーが未完了タスク(`PLANNING` を除く)を照会し、完了したら音源・カバー画像を即 `data/` へダウンロード(プロバイダの URL は一時ファイルのため)。サーバー再起動時も DB から未完了タスクを拾って自動再開する(`PLANNING` は再開できないので `FAILED` にする)
- **`src/llm.ts`**: Claude API(既定 `claude-sonnet-5`、`.env` の `LLM_MODEL` で変更可)。生成リクエストからスタイル・英語歌詞・日本語訳・タイトル・狙い・**公開ページ用の紹介(`intro`)**・リアルワード・参照した情報源を構造化出力で生成し、Suno へ `customMode: true` で送信する。思考の深さは `output_config.effort`(`low`〜`max` の 5 段階、既定 `high`)で、設定 `llm_effort` から生成のたびに読む(管理画面の設定ページで変更でき、モデル名は同ページに読み取り専用で表示)。**呼び出しはストリーミング**(`messages.stream().finalMessage()`) — `max_tokens` は思考と本文の合算で 32000 取っており(effort=max の実測が 15,639〜20,139 と振れるため)、この値は SDK の非ストリーミング上限 21,333 を超えるため。**`SongPlanInput.referenceSong` は必須で、`buildSongPlanPrompt()` は分岐の無い直線**(リファレンス → 作り方 → 追加の要望 → 今日のコンテキスト → 禁止ワード → 残り 1 回 → 出力条件。2026-08-10 に分岐を撤去)。歌詞の言語は設定 `vocal_language`(`getVocalLanguage()`、既定 `ja`)から生成のたびに読み、出力スキーマ(`songPlanSchema(lang)`)と「出力条件」節を切り替える。`web_search` サーバーツールは常時有効で、実際の曲情報(BPM・キー・コード進行・編成・ボーカル)を調べさせ、固有名詞の混入チェック(`properNounsIn()`)を無条件に掛ける。**トークン使用量を `tasks` に記録する**(2026-08-12 追加。`llm_input_tokens` / `llm_output_tokens` / `llm_web_searches`。pause_turn 再開・検証リトライを含む全呼び出しの合算で、`/api/tasks`・`/api/tracks` が `llmInputTokens` 等で返し、管理画面の折りたたみ「生成パラメータ」に表示。旧データと LLM 前に失敗したタスクは null)。`.env` に `ANTHROPIC_API_KEY` 必須(起動時 fail-fast)
- **`src/reference.ts`**: 参照曲の選択(候補取得 + 純関数)。毎日の自動生成の 2 段階選択に加え、「アーティストでおまかせ」用の `selectReferenceSongForArtist()`(アーティスト固定で曲だけ LRU)もここ。候補は有効な曲だけ(絞り込みは `listReferenceCandidates()` の `WHERE enabled = 1`)で、そこからアーティストを LRU(未使用 → 最終使用が古い順のグループから一様ランダム)→ その人の曲を LRU、の 2 段階。曲一様ではなくアーティスト一様にするのは取り込み曲数がアーティストごとに桁違いのため。`referenceCandidateSummary()` は生成パラメータ画面の表示にも使う
- `artist_songs.enabled` は既定 0(無効)で、`insertArtistSongs()` は常に既定のまま入れる(再取得でも既存曲の値は変えない)。導入時の既存データは起動時の 1 回だけの移行で全曲無効に寄せる(`settings` の `migration_disable_all_songs` が実施記録。人が有効にした曲を毎起動で無効に戻さないために要る)
- **`src/scheduler.ts`**: 毎日の自動生成。1 分間隔で設定タイムゾーン(既定 America/Los_Angeles)の現在時刻をチェックし、当日の実行時刻(既定 6 時)以降で 1 日の曲数(`daily_count`、既定 3)に達していなければ「参照曲の選択(0 件なら `NoReferenceSongError`)→ LLM 生成 → Suno 送信」を 1 曲ずつ順次実行。受付(`startDailyRun()`)と本体(その戻り値の `complete()`)を分けてあり、**スケジューラは `await complete()`、`POST /api/daily/run` は受付だけで 201 を返して本体を投げっぱなしにする**(前者は HTTP を経由せずタイムアウト制約が無いため)。最終生成日とその日の生成済み数は `settings`(`last_daily_date` / `last_daily_count`)に記録し、停止中に跨いだ場合や途中失敗時は残数だけ追い生成(初回起動は当日を生成済み扱い)。失敗時は 30 分後に再試行。設定は `settings` テーブル(key-value)で `GET/PUT /api/settings` から変更可
- API: `POST /api/generate`(**`artistSongId` か `artistId` のどちらか一方**(2026-08-12 に `artistId` 追加)— `artistId` は「アーティストでおまかせ」で、曲はサーバーが有効な曲から LRU で選ぶ(不在 404・有効 0 件 409)。無効な曲の指定・有効 0 件は LLM を呼ぶ前に 409。任意で `prompt`(追加の要望)と `instrumental`。**受付だけ済ませて `status: PLANNING` のタスクを即返し、LLM → Suno はバックグラウンド**。進行状況は `GET /api/tasks`)/ `GET /api/tasks` / `GET /api/tracks` / `PATCH /api/tracks/:id`(公開ページからの除外・再公開。body `{ published }`)/ `GET /api/artists/search`・`GET|POST /api/artists`・`GET /api/artists/:id/songs`・`POST /api/artists/:id/refresh`・`PATCH /api/artists/:id/songs`(曲の有効/無効を一括更新。body `{ enabled, ids? }` で `ids` 省略は全曲)・`DELETE /api/artists/:id`(アーティスト管理)/ `GET /api/artist-songs/search`・`POST /api/artist-songs`(曲名からの登録。曲を選ぶとアーティストを逆引きしてまとめて登録する。既存の無効曲を選び直したときは有効に戻す)・`PATCH /api/artist-songs/:id`(曲 1 件の有効/無効。body `{ enabled }`)/ `GET /api/reference-songs`(有効な参照曲の全アーティスト横断一覧。iOS の「曲を選んで生成」用。2026-08-12 追加)/ `GET|PUT /api/settings` / `GET /api/generation-params`(おまかせ生成が LLM に注入する入力の一覧。iOS の生成パラメータ画面用 — runDaily と同じ関数群から組み立てて表示と生成入力のずれを防ぐ。参照曲の候補・直近に参照した曲・歌声の言語・ニュース ON/OFF・リアルワード制限を返す)/ `POST /api/daily/run`(自動生成の手動トリガ。管理画面・iOS のおまかせ生成が使用。**受付だけで 201 を返す**。参照曲が 0 件なら 409。`last_daily_date` は更新しない)/ `GET /api/credits` / `GET /api/errors`(エラーログの取得。`since`(`24h` / `7d` / ISO8601、既定 24h)・`level`・`origin`・`source`・`limit`)/ `POST /api/client-errors`(iOS からのエラー報告。1 回 20 件まで。`origin` は `ios` 固定で `source` は `ios-*` のみ許可)/ `GET /api/ping`(同じルートを `/admin/api/*` にも無認証でマウント — 管理画面用)

### iOS アプリ構成(`ios/`)

- **XcodeGen + SwiftUI**(iOS 17+、Swift 6)。`project.yml` が真実源で `.xcodeproj` は生成物(gitignore)。esl-learning-assistant と同じ構成
- 画面(デザインは案A ミニマル。経緯・実装メモ: [docs/plans/archive/ios-app-design.md](docs/plans/archive/ios-app-design.md)): ライブラリ(今日の一曲ヒーロー・進行中ジョブカード・日付グループ・行内再生)/ 楽曲詳細(公開ページへの表示トグル(PATCH /api/tracks/:id。楽観更新)・リファレンス・歌詞 EN/JA 切替(訳がある英語原詞のみ。日本語原詞では切替が出ず歌詞だけ)・狙い・情報源・スタイル・リアルワード・メタ情報)/ フルプレイヤー(シート。キュー連続再生・**ランダム再生**(2026-08-25 追加。トグルは歌詞リンクと同じ行。再生順は `queue` のインデックス列 `order` で持ち、ON は現在曲を先頭に残りをシャッフル・OFF は表示順。状態は UserDefaults `playerShuffleEnabled` に残る)・ロック画面 Now Playing、AVPlayer ストリーミング+バックグラウンド再生)/ 生成(3 つの入口を同じ形の行で同格に並べる — おまかせ(行タップ → 確認 → POST /api/daily/run)/ アーティストでおまかせ / 曲から生成。ほかに生成パラメータ画面への導線+残クレジット表示。管理への導線は置かない)/ 生成パラメータ(GET /api/generation-params の読み取り専用表示 — 設定値・参照曲の候補・直近に参照した曲・リアルワード制限)/ アーティストでおまかせ(有効な参照曲を持つアーティスト一覧から選ぶと確認 → POST /api/generate { artistId }。曲はサーバーが選ぶ)/ 曲から生成(GET /api/reference-songs の横断一覧を絞り込んで 1 曲選ぶと確認 → 生成。リストに無い曲は「曲名から探す」— 曲名で iTunes 検索 → 候補を選ぶと登録(アーティストは逆引き)からその曲での生成まで一気に進む)/ 参照曲タブ(登録済みアーティスト一覧・追加シート(アーティスト名 / 曲名の 2 経路を統合。曲名経路はここでは登録のみで生成に進まない)・行メニューで再取得/削除)/ アーティストの曲一覧(絞り込み+表示フィルタ(すべて / 有効のみ)+行タップ・行末トグルで有効/無効・有効な曲だけに出る「生成」ボタンで確認 → その曲に似た曲を生成・右上メニューで一括操作(表示中を全て有効/無効。対象は絞り込みと表示フィルタを通した曲))/ 設定(サーバー設定 GET/PUT /api/settings の閲覧・編集 — 曲の生成(歌声の言語)・毎日の自動生成・今日のコンテキスト+サーバー URL・API Secret・接続テスト)
- `Services/BackendAPI.swift`: `/api/*` 共通処理(UserDefaults → Info.plist 埋め込み値の順で URL/secret を解決、`X-API-Secret` 付与、os.Logger)。`path` は `/api/...` まで含めて渡す規約
- `Services/ErrorReporter.swift`: アプリ側のエラーをサーバーへ送る(`POST /api/client-errors`)。通信失敗(`transport_failed`)・HTTP エラー(`http_error`)・デコード失敗(`decode_failed`。サーバーとの契約ずれ)・再生失敗(`playback_failed` / `playback_interrupted`)を拾う。同じ内容は 60 秒に 1 回、送れなかった分はメモリに最大 20 件だけ保持(アプリ終了で破棄)。報告の送信は `BackendAPI.send` を通さない(報告の失敗がまた報告を生む無限ループを避けるため)
- 接続先の既定はビルド時に Info.plist へ埋め込む(`run-ios-device.sh` が本番 `https://music.chobi.me` を注入。`--local` で Mac の LAN IP。空ならシミュレータ向けに `http://localhost:3014` へフォールバック)
- UI テスト(`DailyAIMusicUITests`): 一覧 → タップ → 再生開始のスモークテスト

## 未確定事項(決まり次第このファイルを更新)

- ~~Suno との連携方式~~ — 調査・検証済み([docs/specs/suno-api.md](docs/specs/suno-api.md))。当面はサードパーティ API を抽象化レイヤ越しに使い、公式 API(早期アクセス応募中)が出たら差し替える方針。**kie.ai**(sunoapi.org と同一運営・同一 API 構造、Bearer 認証)で生成フローを検証済み(sunoapi.org は Google ログイン不可だったため kie.ai を採用)。検証スクリプト: `scripts/verify-sunoapi.mjs`
- ~~バックエンドのフレームワーク~~ — Hono(Node.js 24)に決定。ホスティング先は未定(ランタイム可搬性の高い Hono を選んだのはこのため)
- 音源ファイルの保存先 — 当面はローカル `data/`。オブジェクトストレージ(S3 等)への移行は未定
- ~~iOS アプリの UI フレームワーク(SwiftUI を想定)と API 認証方式~~ — SwiftUI(XcodeGen、iOS 17+)と `X-API-Secret` ヘッダ認証に決定(上記「API 認証」参照)

<!-- vibeboard:begin -->
## 開発管理画面 (vibeboard)

ローカル開発時のタスク・プラン管理は [vibeboard](https://github.com/akiraak/vibeboard) で行う。
プロジェクト直下に degit で vendor してある（`./vibeboard/`）。

```bash
# 親プロジェクト直下から
node vibeboard/dist/cli.js --root .
```

`http://localhost:3010` でプロジェクト直下の `docs/plans/`・`docs/specs/`・`TODO.md`・`DONE.md`・`CLAUDE.md`・`README.md` を閲覧・編集できる。

- `Root` タブで `TODO.md` / `DONE.md` / `CLAUDE.md` / `README.md` をプレビュー表示・編集できる
  - 編集は楽観ロック（mtime チェック）付き。外部で先に更新されていた場合は保存時に 409 を返し、リロード / 手元維持 / 強制上書き を選べる
  - `fs.watch` + 2 秒ポーリングで外部変更を検知し、SSE でクライアントへ即時反映する
- ローカル開発専用（本番管理画面とは独立）
- ポート変更は `--port` または `VIBEBOARD_PORT` 環境変数で指定可能

## タスク管理ルール

- タスクは `TODO.md` で管理する
- タスクが完了したら `TODO.md` から該当項目を削除し、`DONE.md` に移動する
- `DONE.md` には完了日を `YYYY-MM-DD` 形式で付けて記録する
- 新しいタスクが発生したら `TODO.md` の適切なセクションに追加する
- タスクの実施前に `TODO.md` を確認し、優先度の高いものから着手する
- コミット時に `TODO.md` を確認し、実装した機能に対応するタスクがあれば `DONE.md` に移動する
- **ログ解析(`/logs`)が見つけた修正・改善項目は `BACKLOG.md` で管理する**(`TODO.md` には入れない)。実施したら削除せず `[x]` にする(`/logs` が台帳 `docs/error-triage.md` の「修正済み」化に使う)。着手時は通常の作業着手ルールに乗せる

## コミットのルール

- **コミットは `main` に直接行う。作業ブランチは切らない**(単独開発のリポジトリで、履歴も `main` 一本のため)
- プラン作成と実装は別のコミットに分ける(例: `488c910` プラン作成 → `0cceecb` 実装)
- **push = 本番反映**(2026-08-13 以降): g3plus 側の `auto-update.sh`(cron 5 分おき)が origin/main を検知して自動デプロイする。`server/` に変更が無い push は再ビルドされない(iOS・ドキュメントだけなら安全)。**まだ本番に出したくないコミットは push しない**(ローカルに積んでおく)。移行・`.env`・Dockerfile 変更を伴う反映は従来の手動フロー + `deploy-hold`(手順の正本: g3plus-ops の [docs/workflows/daily-ai-music.md](../g3plus-ops/docs/workflows/daily-ai-music.md)。設計: [docs/plans/backlog-auto-pipeline.md](docs/plans/backlog-auto-pipeline.md))

## 作業着手ルール

作業（実装・調査いずれも）を始めるときは、コードに手を入れる前に以下を行う。

1. **プランファイルを作成する**: `docs/plans/<task-name>.md` に実装プラン or 調査プランを作成する
   - 目的・背景、対応方針、影響範囲、テスト方針を最低限記載する
   - 複数 Phase / Step に分かれる場合はファイル内でも Phase / Step を明示する
2. **`TODO.md` に該当項目があるか確認する**
   - 無ければ適切なセクションに追加する
   - 既存項目があれば、その項目に作成したプランファイルへのリンクを追記する（例: `[plan](docs/plans/<task-name>.md)`）
3. **複数 Phase / Step がある場合は `TODO.md` に子タスクとして追加する**
   - 親項目の下にインデントしたチェックボックスで Phase / Step を列挙する
   - Phase / Step が完了するごとにチェックを入れ、全完了で親項目を `DONE.md` に移す
4. **作業完了時の後片付け**
   - 親タスクを `DONE.md` に移動する
   - 対応するプランファイルは `docs/plans/archive/` に移動する
<!-- vibeboard:end -->

### このプロジェクト固有の vibeboard 設定

ポート 3010〜3012 は別プロジェクトが使用しているため、`vibeboard.config.json` でポートを **3013** に固定している。管理画面は `http://localhost:3013` で開く。起動は `./run-vibeboard.sh`(既存プロセスがポートを掴んでいれば停止してから起動する)。
