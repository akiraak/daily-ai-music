# 音楽生成エンジンの実装プラン

## 目的・背景

[docs/specs/music-generation.md](../specs/music-generation.md) で決定した仕組み(LLM がプリセット+好みプロファイルからスタイル・英語歌詞・日本語訳を生成し、評価で毎日良くなり、毎朝自動生成される)を `server/` に実装する。

## 対応方針

仕様書のとおり。実装は 4 Phase に分け、各 Phase 単体で動作確認できる順序にする。

### Phase 1: 評価基盤

- `tracks` に `rating`(NULL/1/-1)・`favorite`(0/1)カラムを追加(`ALTER TABLE` によるマイグレーション)
- `POST /api/tracks/:id/rating` を追加
- 管理画面の楽曲一覧に 👍/👎/★ ボタンを追加(トグル式)

### Phase 2: プリセット管理

- `presets` テーブル(`category` / `value` / `label_ja`)+ CRUD API(`/api/presets`)
- 初期プリセット投入(ジャンル・楽器・ムードなど。起動時に空なら seed)
- 管理画面にプリセット管理 UI を追加

### Phase 3: LLM 生成パイプライン

- `.env` に `ANTHROPIC_API_KEY` を追加し、`config.ts` で読む
- `src/llm.ts`: Claude API(`claude-sonnet-5`)クライアント。①プロファイル更新 ②スタイル+歌詞+訳+タイトル+狙いの生成(JSON 出力)
- `profile` テーブル(版を積む)+ `GET /api/profile`
- `SunoClient` の `GenerateParams` を拡張し、kie.ai 実装で `customMode: true`(style / prompt=歌詞 / title)に対応
- `tasks` に `mode` / `style` / `lyrics` / `lyrics_ja` / `title` / `intent` カラムを追加
- `POST /api/generate` を LLM 経由のフローに刷新(プリセット選択+自由テキスト受け付け)
- 管理画面: 生成フォームのプリセット選択化、タスク・楽曲詳細に歌詞・訳・狙いを表示

### Phase 4: 毎日の自動生成

- `settings` テーブル(key-value: `adventure_probability`=0.2、`daily_enabled`、実行時刻・タイムゾーン)+ `GET/PUT /api/settings`
- スケジューラ: 1 分間隔で現在時刻(America/Los_Angeles)をチェックし、当日 6:00 以降で未生成なら実行。最終生成日を DB に記録し、サーバー停止中に跨いだ場合は起動時に追い生成
- 冒険日判定(確率は settings から)→ LLM コール(プロファイル更新 → 生成)→ Suno 送信
- `POST /api/daily/run`(手動トリガ、検証用)

## 影響範囲

- `server/src/db.ts`(スキーマ追加・マイグレーション)、`index.ts`(API 追加)、`generation.ts`(生成フロー)、`suno/client.ts`・`suno/kieai.ts`(customMode)、`public/`(管理画面)
- 新規: `server/src/llm.ts`、`server/src/scheduler.ts`、`server/src/presets.ts`(seed データ)
- `.env`(`ANTHROPIC_API_KEY` 追加)
- 既存データ(`data/db.sqlite`)は ALTER TABLE で後方互換に保つ

## テスト方針

- 各 Phase で `npm run typecheck` を通す
- Phase 1〜2: 管理画面から評価・プリセット編集を手動確認
- Phase 3: 実際に 1 回生成し(12 クレジット消費)、customMode で歌詞どおりの曲が返ること・歌詞/訳が保存されることを確認
- Phase 4: `POST /api/daily/run` で全フロー(プロファイル更新 → 冒険判定 → 生成)を確認。スケジューラの時刻判定はロジックを関数に切り出して確認する
