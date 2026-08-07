# 音楽生成プロンプト(スタイル)の日本語訳を管理画面に表示する

## 目的・背景

管理画面の楽曲詳細で、Suno に渡すスタイルプロンプト(英語)は原文のみ表示されており、内容が把握しづらい。
歌詞には日本語訳(`lyrics_ja`)があるので、スタイルにも日本語訳を付けて表示する。

## 対応方針

1. **生成**(`server/src/llm.ts`): `SONG_PLAN_SCHEMA` / `SongPlan` に `styleJa`(スタイルプロンプトの日本語訳)を追加。
   LLM がスタイル生成と同時に訳も出力する(追加の LLM コールは不要)
2. **保存**(`server/src/db.ts` / `generation.ts`): `tasks` に `style_ja` カラムを後方互換マイグレーションで追加し、
   `startGeneration` → `createTask` で保存。`TrackWithTaskRow` / JOIN 列にも追加
3. **API**(`server/src/index.ts`): `taskJson` / `trackJson` に `styleJa` を追加
4. **管理画面**(`server/public/app.js`): 楽曲詳細の「スタイル」の下に「スタイル(日本語訳)」を表示
5. 既存レコードは `style_ja` NULL → 非表示(グレースフル)。バックフィルはしない

## 影響範囲

- `server/src/llm.ts` / `db.ts` / `generation.ts` / `index.ts` / `public/app.js`
- iOS アプリ: フィールド追加のみで影響なし(iOS 側の表示追加はスコープ外)
- 実 DB: `ALTER TABLE ADD COLUMN` のみで破壊的変更なし

## テスト方針

- `npm run typecheck`
- 一時 DB での `createTask` → `listTracks` 往復で `style_ja` の保存・取得を確認
- サーバー再起動 → `/admin/api/tracks` に `styleJa` が含まれ、既存データ(NULL)で表示が崩れないことを確認
- 実生成(クレジット消費)は行わない。次回の生成から訳が保存・表示される
