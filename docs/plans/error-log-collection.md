# エラーログの生成と取得の仕組み

## 目的・背景

最終ゴールは「エラーログを解析して修正タスクを生成する」ことだが、**今回は手前の 2 つ(ログの生成と取得)だけを決めて実装する**。解析・タスク生成のやり方は、実際にログが溜まってから別途決める(Phase 4)。

現状の問題:

- サーバーのエラーは `console.error` / `console.warn`(19 箇所)に出るだけで、**構造も保存も無い**。生成失敗の痕跡が残るのは `tasks.error`(1 行の文字列)のみ
- 本番は g3plus 上の Docker コンテナなので、ログを見るには毎回 `ssh ubuntu@g3plus.lan 'docker logs daily-ai-music'`。**docker のログはローテートで消える**うえ、生テキストなので集計も差分確認もできない
- iOS アプリのエラーは `os.Logger` に出るだけで、実機を Mac に繋がない限り観測できない
- 結果として「昨日の毎日生成がなぜ落ちたか」を後から調べる手段が事実上無い

## 決めたこと(方針)

| 論点 | 決定 |
|---|---|
| どこに保存するか | 本番 DB(`data/db.sqlite`)の **`error_logs` テーブル**。既存の `settings` / `real_world_words` と同じ node:sqlite で完結させる |
| どうやって Mac に持ってくるか | **`GET /api/errors`**(X-API-Secret)+ **`scripts/fetch-error-logs.sh`** で `.logs/` に JSONL 保存。DB に届かない事象(起動失敗・クラッシュ)用に `--raw` で `docker logs` も取れるようにする |
| ログの内容 | 下記「ログの内容」の 12 カラム。**イベント名(`event`)を安定した識別子で持つ**のが肝(後の解析で分類・差分が取れる) |
| console 出力 | **やめない**。`logError()` は必ず `console.error` / `console.warn` にも出す(docker logs は最後の砦として維持) |

### なぜ SQLite か(ファイル JSONL や docker logs でなく)

- 保存先が `data/` = **唯一の永続化対象**(g3plus-ops のバックアップ対象)に自然に乗る。ファイルを増やすとバックアップ手順の追従が要る
- `task_id` で生成ジョブと結合できる(「落ちたタスクの詳細」を 1 クエリで出せる)
- 同一エラーの連発を `repeat_count` に畳める(下記)。ファイル追記だと同じ行が無限に増える
- 取得が **HTTPS + secret** で済む。ssh 鍵や Access の Google ログインを挟まずに Claude Code から取れる

## ログの内容

### テーブル

```sql
CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at   TEXT NOT NULL,   -- 発生時刻(iOS はクライアントの時計)
  received_at   TEXT NOT NULL,   -- サーバーが記録した時刻(iOS の時計ずれの検出用)
  last_seen_at  TEXT NOT NULL,   -- 畳み込み中の最後の発生時刻
  repeat_count  INTEGER NOT NULL DEFAULT 1,
  level         TEXT NOT NULL,   -- 'error' | 'warn'
  origin        TEXT NOT NULL,   -- 'server' | 'ios'
  source        TEXT NOT NULL,   -- 'generation' | 'llm' | 'suno' | 'api' | 'scheduler' | 'context' | 'itunes' | 'process' | 'ios-api' | 'ios-player'
  event         TEXT NOT NULL,   -- 安定した識別子(スネークケース)。解析の分類キー
  message       TEXT NOT NULL,   -- 1 行の要約(1000 文字で切る)
  detail        TEXT,            -- JSON 文字列(8000 文字で切る)
  fingerprint   TEXT NOT NULL,   -- source + event + 正規化した message の sha1 先頭 12 桁
  task_id       INTEGER          -- 生成ジョブに紐づくものだけ(FK 制約は張らない: タスク削除で消したくない)
);
CREATE INDEX IF NOT EXISTS idx_error_logs_occurred ON error_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_error_logs_fingerprint ON error_logs(fingerprint);
```

- **fingerprint**: `message` から数値・UUID・URL・引用符内の曲名などを `<n>` `<id>` `<url>` `<str>` に正規化してから sha1。同じ種類のエラーが同じ値になるので、後の解析で「新規か既知か」を機械的に判定できる
- **畳み込み**: 直近 **10 分**以内に同じ fingerprint の行があれば、新しい行を作らず `repeat_count += 1` / `last_seen_at` を更新する。10 秒ポーラーが同じ API エラーを吐き続けても DB が膨れない
- **保持**: 挿入時に **90 日より古い行**を削除。加えて **上限 5000 行**を超えたら古い順に削除(どちらも軽い DELETE 1 発)
- **秘匿情報**: `API_SECRET` / `ANTHROPIC_API_KEY` / `SUNOAPI_ORG_KEY` は絶対に載せない。LLM のプロンプト全文も載せない(`tasks.llm_prompt` にある)。レスポンス body は 500 文字まで

### 拾うイベント(初期セット)

**サーバー(`origin = 'server'`)**

| source | event | level | 発生箇所 | detail に入れるもの |
|---|---|---|---|---|
| generation | `task_failed` | error | `completeGeneration` の catch | taskId, mode, refArtistName/refSongTitle, stack |
| generation | `provider_failed` | error | `pollTask`(Suno が FAILED) | taskId, providerTaskId, providerStatus, providerError |
| generation | `poll_error` | warn | `pollOnce` の catch | taskId, stack |
| generation | `task_timeout` | error | 30 分超過 | taskId, providerStatus, elapsedMs |
| generation | `download_failed` | warn/error | 音源(error)・画像(warn)の DL 失敗 | taskId, httpStatus, urlHost |
| llm | `web_search_failed` | warn | `logSearchOutcome` | errorCodes |
| llm | `plan_issue_remains` | warn | 再生成後も禁止ワード・固有名詞が残る | issues, title |
| scheduler | `daily_failed` | error | `runDaily` の catch(30 分後再試行) | localDate, generatedCount, stack |
| scheduler | `no_reference_song` | error | 参照曲 0 件 | localDate, artistCount |
| context | `fetch_failed` | warn | ニュース取得失敗 | sourceName, stack |
| api | `route_failed` | error | 各ルートの catch(アーティスト検索/登録/曲名検索/曲登録/daily run) | method, path, httpStatus, stack |
| api | `unhandled` | error | Hono の `app.onError`(500) | method, path, stack |
| api | `unauthorized` | warn | X-API-Secret 不一致 | method, path |
| process | `uncaught_exception` / `unhandled_rejection` | error | `process.on(...)` | stack |

**iOS(`origin = 'ios'`、Phase 3)**

| source | event | 発生箇所 |
|---|---|---|
| ios-api | `transport_failed` | `BackendAPI.send` の URLSession 例外(オフライン・タイムアウト) |
| ios-api | `http_error` | 4xx / 5xx(401 含む) |
| ios-api | `decode_failed` | JSON デコード失敗(= サーバーとアプリの契約ずれ。過去に実害あり) |
| ios-player | `playback_failed` | AVPlayer の再生失敗 |

detail: `path`, `method`, `httpStatus`, `bodySnippet`(500 文字), `appVersion`, `build`, `iosVersion`, `deviceModel`, `baseURLHost`(URL 全体は載せない)

**拾わないもの**: 起動時の fail-fast(`config.ts`。DB 初期化より前なので書けない)、404 や 400 のような**クライアント起因の妥当な失敗**(ノイズになる)。前者は `--raw` の docker logs で見る。

## 対応方針(Phase)

### Phase 1: サーバーのエラーを構造化して保存する

1. `server/src/db.ts`: `error_logs` テーブル + `insertErrorLog()`(畳み込み・トリム込み) / `listErrorLogs(filter)`
2. `server/src/errorlog.ts`(新規): `logError()` / `logWarn()` — 引数は `{ source, event, message, detail?, taskId? }`。fingerprint の生成と正規化、`console.error` / `console.warn` への出力、**記録自体の失敗を握りつぶす**(ログ機構がアプリを落とさない)
3. 既存の `console.error` / `console.warn`(19 箇所)を上表に沿って置き換え。**`console.log`(正常系)は触らない**
4. `server/src/index.ts`: `app.onError` と `process.on('uncaughtException' | 'unhandledRejection')` を追加

### Phase 2: Mac から取得できるようにする

1. `GET /api/errors`(既存の二重マウントでそのまま `/admin/api/errors` にも載る)
   - クエリ: `since`(`24h` / `7d` / ISO8601、既定 `24h`)、`level`、`origin`、`source`、`limit`(既定 200 / 最大 1000)
   - 応答: `{ errors: [...], total, since }`。新しい順
2. `scripts/fetch-error-logs.sh`(新規)
   - 既定は**本番**: `https://music.chobi.me/api/errors` に `X-API-Secret` で curl。secret は `~/Projects/g3plus-ops/daily-ai-music/.env` から読む(`ERROR_LOG_ENV_FILE` で上書き可)
   - `--local`: `http://localhost:3014/admin/api/errors`(無認証)
   - `--since 7d`(既定 24h) / `--out <path>`(既定 `.logs/errors-<env>-<yyyymmdd-hhmm>.jsonl`)
   - 標準出力に **fingerprint ごとの件数サマリ**を出す(Claude Code が読む最初の 1 画面)
   - `--raw`: `ssh -i ~/.ssh/id_rsa_nopass ubuntu@g3plus.lan 'docker logs daily-ai-music --since <since>'` を `.logs/docker-<...>.log` に保存(起動失敗・クラッシュ用の保険)
3. `.gitignore` に `.logs/` を追加

> Cloudflare Access(Google ログイン)が掛かる `/admin` 経由では curl できないため、取得は `/api` + secret 経路を使う。本番 secret は開発用 `.env` とは別値。

### Phase 3: iOS アプリのエラーをサーバーへ送る

1. `POST /api/client-errors`: `{ errors: [{ occurredAt, source, event, message, detail }] }`(1 リクエスト最大 20 件)を `origin = 'ios'` で保存
2. `BackendAPI.swift`: `send()` / `makeRequest()` / デコード箇所を choke point にして送信。**送信自体の失敗は無視**(無限ループ防止に `/api/client-errors` 自身のエラーは報告しない)。オフライン時のバッファはメモリ上のみ(最大 20 件、アプリ終了で捨てる)
3. `PlayerService.swift`: 再生失敗を報告

### Phase 4(今回はやらない): 解析 → 修正タスク生成

ログが 2〜3 週間溜まってから、`.logs/` の JSONL を入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組み(スラッシュコマンド or 定期実行)を別プランで決める。

## 影響範囲

- `server/src/db.ts`(テーブル + 3 関数)、`server/src/errorlog.ts`(新規)
- `server/src/index.ts`(onError / process ハンドラ / `GET /api/errors` / `POST /api/client-errors`)
- `server/src/generation.ts` / `llm.ts` / `scheduler.ts` / `context.ts`(console → logError/logWarn の置換)
- `scripts/fetch-error-logs.sh`(新規)、`.gitignore`
- `ios/DailyAIMusic/Sources/Services/BackendAPI.swift` / `PlayerService.swift`(Phase 3)
- `CLAUDE.md`(エラーログの節)、`TODO.md` / `DONE.md`
- **DB は `CREATE TABLE IF NOT EXISTS` のみで既存データに触らない**ため、本番反映で DB の退避は不要
- API は追加のみ(既存キーの変更なし)なので、**サーバー先行デプロイでよい**(旧アプリは新エンドポイントを呼ばないだけ)

## テスト方針

- `cd server && npm run typecheck`
- **隔離 DB のテストサーバー**(`sqlite3 .backup` でコピー、`daily_enabled=false`、ポート 3014)を立てて実測:
  - `ANTHROPIC_API_KEY` を無効値にして `POST /admin/api/daily/run` → `generation.task_failed` が 1 行入る / 同じものを 2 回起こして `repeat_count = 2` になる(畳み込み)
  - 不正な `X-API-Secret` で `/api/ping` → `api.unauthorized` が warn で入る
  - `GET /admin/api/errors?since=1h` が入れた行を返す
  - fingerprint がタスク ID 違いで一致すること(正規化の確認)
- `bash -n scripts/fetch-error-logs.sh` + `--local` で実行して `.logs/*.jsonl` とサマリが出ること
- 本番(g3plus)への反映は通常フロー(`git pull` → `build` → `up -d`)。反映後に `scripts/fetch-error-logs.sh --since 24h` が本番から取れることを確認する

## 未確定事項

- 管理画面へのエラー一覧表示 — 今回は付けない(取得は Mac 側スクリプトで足りる)。欲しくなったら Phase 4 と一緒に検討
- 保持期間 90 日 / 5000 行の閾値 — 運用してみて多すぎ・少なすぎなら調整
