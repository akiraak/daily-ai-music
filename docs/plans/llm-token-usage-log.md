# 生成の記録に LLM のモデルとトークン使用量を残す

作成: 2026-08-12

## 目的・背景

TODO「ログに追加:AIのモデルとトークン使用量」の実施。生成コストの大半は LLM(web_search 込みで 1 曲約 $0.36)だが、トークン使用量は現状 `console.log` にしか出ておらず、docker logs は 10MB×3 のローテートで消える(エラーログ導入時に「DB が正本」と決めた経緯と同じ問題)。曲ごとに「どのモデルで・何トークン使ったか」を後から確認できるようにする。

- モデル名は `tasks.llm_model` に記録済み。**足りないのはトークン使用量の永続化**
- 1 回の生成は LLM を複数回呼ぶことがある — pause_turn の再開(最大 3 回)と検証リトライ(禁止ワード・固有名詞の混入時に 1 回)。コストの実態は**全呼び出しの合算**

## 対応方針

### `tasks` にトークン使用量を記録する(全呼び出しの合算)

- `tasks` に 3 カラム追加(いずれも冪等な `ADD COLUMN`。旧データは NULL のまま): 
  - `llm_input_tokens` — 入力トークン合計(web_search の検索結果もここに乗る。実測 1 曲 12 万前後)
  - `llm_output_tokens` — 出力トークン合計(思考 + 本文)
  - `llm_web_searches` — web_search の実行回数合計(`usage.server_tool_use.web_search_requests`。$10/1000 件なのでコストの一部)
- `src/llm.ts`: `requestSongPlan()` が呼び出しごとの `message.usage` を集計して plan と一緒に返し、`generateSongPlan()` が初回 + リトライを合算して `SongPlanResult.llmUsage` に載せる
- `src/generation.ts`: `updateTaskPlan()` に渡して記録(Suno 送信の直前 = LLM が成功した生成はすべて記録される。**Suno 側で FAILED になった曲も LLM 費用は掛かっているので、tracks ではなく tasks に持つ**)
- LLM 呼び出し自体が例外で失敗したときは記録しない(usage が取れないため。console と error_logs で追う従来どおり)

### API と管理画面に表示

- `GET /api/tasks` / `GET /api/tracks` に `llmInputTokens` / `llmOutputTokens` / `llmWebSearches`(旧データは null)。**フィールド追加のみなので iOS は無変更で安全**(未知フィールドは無視される。iOS 側の表示は必要になったら別途)
- 管理画面の楽曲一覧: 折りたたみの「生成パラメータ」に「LLM トークン: 入力 x / 出力 y(web_search z 回)」を追記(旧データでは行ごと出ない — 既存の欠損項目と同じ扱い)

### スコープ外

- 過去データのバックフィル — 使用量はどこにも残っていないので不可能(NULL のまま)
- `backfill-intro.ts`(Haiku)の使用量記録 — 一度きりのスクリプトで全件実施済み
- 金額換算(単価はモデル・時期で変わるのでトークン数だけ持つ)・集計画面 — 必要になったら別途
- iOS の楽曲詳細への表示(サーバー先行。アプリ再インストールが要るため必要になったら別途)

## 影響範囲

- `server/src/db.ts` — カラム追加・型・`TRACK_TASK_COLUMNS`・`updateTaskPlan()`
- `server/src/llm.ts` — usage の集計と `SongPlanResult` への追加
- `server/src/generation.ts` — `updateTaskPlan()` への受け渡し
- `server/src/index.ts` — `taskJson()` / `trackJson()` にフィールド追加
- `server/public/app.js` — 生成パラメータ欄に表示
- `CLAUDE.md` — 記録の追記

## テスト方針

実生成での確認は LLM $0.36 + Suno 12 クレジットを消費するためローカルでは行わない。

- `npm run typecheck`
- 隔離 DB(`sqlite3 .backup` + `daily_enabled=false`)で: 
  - マイグレーション(カラム追加)が通ること
  - `updateTaskPlan()` を node で直接呼び、3 カラムが書き込まれ `GET /api/tracks` に出ること(SQL のプレースホルダ数ずれはここで捕まえる)
  - 管理画面の折りたたみで「LLM トークン」行の表示、旧データ(NULL)では行が出ないこと
- 本番反映後、次の毎日の自動生成(PT 6:00)で実際の値が記録されることを確認

## Phase 分割

- [x] Phase 1: サーバー実装 + 管理画面表示 + 隔離 DB での検証(2026-08-12 完了。隔離 DB でマイグレーション・`updateTaskPlan()` の書き込み(3 カラム + 既存フィールド無変化 + 省略時 null)・`GET /api/tracks` のフィールド・管理画面の「LLM トークン」行(記録あり行のみ表示、旧データは行なし)を確認)
- [ ] Phase 2: 本番反映(env・Dockerfile 変更なし、DB は冪等な ADD COLUMN のみ = 退避不要。通常フロー)+ 翌朝の自動生成での記録確認
