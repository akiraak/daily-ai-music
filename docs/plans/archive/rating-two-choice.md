# 評価を良い悪いの2択にする

## 目的・背景

現状の楽曲評価は 👍/👎(rating: 1 / -1 / NULL)+ ★(favorite: 0/1)の 2 軸。
評価をシンプルにするため ★(お気に入り)を廃止し、👍/👎 の 2 択(+未評価)に統一する。

## 対応方針

- **DB**(`server/src/db.ts`)
  - 既存データ移行: `favorite = 1` かつ `rating IS NULL` の行は `rating = 1` に変換(★ = 強い好きなので 👍 として引き継ぐ)
  - その後 `tracks.favorite` カラムを DROP(Node 24 同梱 SQLite は DROP COLUMN 対応)
  - `CREATE TABLE` / `addColumnIfMissing` / `TrackRow` / `updateTrackRating` / `listRatedTracks` から favorite を除去
- **API**(`server/src/index.ts`)
  - `trackJson` から `favorite` を除去
  - `POST /api/tracks/:id/rating` は `{ rating: 1 | -1 | null }` のみ受け付ける
- **LLM**(`server/src/llm.ts`)
  - `updateProfile` の入力・プロンプトから ★ を除去
- **スケジューラ**(`server/src/scheduler.ts`)
  - `runDaily` の ratedTracks マッピングから favorite を除去
- **管理画面**(`server/public/app.js`)
  - ★ ボタンと favorite トグル処理を削除(CSS は汎用スタイルのみなので変更不要)
- **ドキュメント**
  - `docs/specs/music-generation.md` と `CLAUDE.md` の「👍/👎/★」記述を「👍/👎」に更新

## 影響範囲

- iOS アプリ: 評価 UI 未実装・`favorite` フィールドも未デコードのため影響なし(評価ボタン追加は別タスク)
- 既存 DB: 起動時マイグレーションで自動移行(favorite → 👍 変換後カラム削除)

## テスト方針

- `npm run typecheck` が通ること
- サーバーを起動し、既存 DB のマイグレーション(favorite カラム削除)が正常に走ること
- `POST /api/tracks/:id/rating` に `favorite` を送ると 400、`rating` の付与・解除が動くこと
- 管理画面で 👍/👎 のトグルが動き、★ ボタンが表示されないこと
