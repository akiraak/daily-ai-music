# 管理画面に生成パラメータを全て表示する

## 目的・背景

生成された各楽曲について、生成に使用したパラメータの全体を管理画面で確認できるようにする。
現状の楽曲詳細は 狙い・歌詞・日本語訳・スタイル のみで、以下が見えない。

- DB にあるが未表示: モード(手動/毎日/冒険日)、リクエスト内容(prompt)、Suno モデル、インストゥルメンタル有無
- そもそも未保存: LLM モデル名、LLM への入力全文(好みプロファイル・プリセット・直近スタイル・モード指示を含む)

LLM への入力全文は生成のたびに変わる実質的なパラメータの本体なので、保存して表示できるようにする。

## 対応方針

1. **保存**(`server/src/llm.ts` / `generation.ts` / `db.ts`)
   - `generateSongPlan` の戻り値を `{ plan, llmModel, llmPrompt }` に変更(`llmPrompt` = LLM に送った user メッセージ全文)
   - `startGeneration` が受け取って `tasks` に保存。`tasks` に `llm_model` / `llm_prompt` カラムを後方互換マイグレーション(`addColumnIfMissing`)で追加
2. **API**(`server/src/index.ts` / `db.ts`)
   - `TrackWithTaskRow` の JOIN に `instrumental` / `model` / `prompt` / `llm_model` / `llm_prompt` を追加
   - `taskJson` に `llmModel` / `llmPrompt`、`trackJson` に `mode`(既存)+ `instrumental` / `sunoModel` / `prompt` / `llmModel` / `llmPrompt` を追加
3. **管理画面**(`server/public/app.js`)
   - 楽曲詳細(details)に「生成パラメータ」(モード・リクエスト内容・Suno モデル・LLM モデル・インストゥルメンタル)と「LLM への入力全文」(pre)を追加。summary は「歌詞・生成パラメータ」に変更
   - 生成中タスクにモードバッジ(毎日/冒険日)を追加
4. 既存レコードは新カラムが NULL → その項目だけ出さない(グレースフル)

## 影響範囲

- `server/src/llm.ts`(戻り値の型変更)、`scheduler.ts` / `index.ts`(呼び出し側)、`generation.ts`(保存)、`db.ts`(カラム追加・SELECT 拡張)、`public/app.js`(表示)
- iOS アプリ: API レスポンスへのフィールド追加のみで既存デコードに影響なし(iOS 側の表示追加はスコープ外)
- 実 DB: `ALTER TABLE ADD COLUMN` のみで破壊的変更なし

## テスト方針

- `npm run typecheck`
- 一時 DB(`DB_PATH` を差し替え)で `createTask` → `listTracks` の往復により新カラムの保存・取得を確認
- サーバ起動 → `/admin/api/tracks` に新フィールドが含まれること、既存データ(新カラム NULL)で管理画面の表示が崩れないことを確認
- 実生成(クレジット消費)は行わない。次回の生成から `llm_model` / `llm_prompt` が保存・表示される
