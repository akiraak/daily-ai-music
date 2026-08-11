# 生成された曲に生成元(リファレンス)の曲名・アーティスト名を一覧で表示する

## 目的・背景

2026-08-10 の参照曲ベース化で、生成される曲はすべて「登録済みの曲(`artist_songs`)を 1 曲選び、それに似た新曲を作る」方式になった。
その参照曲は生成時点のスナップショットとして `tasks.ref_artist_name` / `tasks.ref_song_title` に保存され、
API(`/api/tasks` の `taskJson` と `/api/tracks` の `trackJson`)は既に `refArtistName` / `refSongTitle` を返している。

しかし表示は**詳細画面に閉じている**:

- iOS: 楽曲詳細(`TrackDetailView` の「リファレンス」セクション)にのみ表示
- 管理画面: 楽曲カードの折りたたみ `<details>`「歌詞・生成パラメータ」の中にのみ表示

曲を眺めているとき(ライブラリ一覧・管理画面の楽曲一覧)に「この曲は何を元に作ったのか」が見えないので、
**一覧の 1 行として見えるようにする**。サーバー側は既にデータを返しているので、変更は表示層のみ。

## 対応方針

表示文字列は詳細画面と同じ組み立て(`<アーティスト名>「<曲名>」`)に「リファレンス: 」を前置した 1 行。
既存の用語(iOS 詳細・管理画面の折りたたみとも「リファレンス」)に合わせる。

### Phase 1: 管理画面の楽曲一覧(`server/public/app.js` / `style.css`)

- `trackElement()` のカード内、曲名(`.track-title`)の直下・メタ情報(`.track-meta`)の上に `.track-reference` を追加する
- テキストは `textContent` で設定する(曲名・アーティスト名は iTunes / LLM 由来の外部文字列のため、既存コードと同じく HTML 挿入しない)
- `refArtistName` が無い旧データは行ごと隠す(`hidden`)
- 折りたたみ内の「リファレンス」セクションはそのまま残す
  (リアルワードが「タグ表示 + 折りたたみ内」の二重表示になっている既存の流儀に合わせる。折りたたみは全パラメータのダンプ)
- CSS は `.track-meta` と同じ muted・0.8rem 系で目立ちすぎないようにする

### Phase 2: iOS ライブラリ一覧(`ios/DailyAIMusic/Sources/Views/TrackListView.swift`)

- 行(`TrackRow`): 曲名 → スタイル日本語訳 の下に `リファレンス: …` を `caption2` / secondary / `lineLimit(1)` で追加
- 今日の一曲(`HeroCard`): スタイル日本語訳の下に同じ 1 行を追加
- 表示文字列は `Track.referenceLabel`(既存の computed property)を再利用する。`nil`(参照曲なしの旧データ)のときは行を出さない
- フルプレイヤー・ミニプレイヤー・生成中カードは今回のスコープ外(2026-08-11 に確認済み)

## 影響範囲

- `server/public/app.js` / `server/public/style.css`(管理画面のみ。サーバーの TS・API・DB は変更なし)
- `ios/DailyAIMusic/Sources/Views/TrackListView.swift`(表示のみ。モデル・API 呼び出しは変更なし)
- DB マイグレーション・API スキーマ変更なし。旧データ(参照曲なし)は表示を出さないだけでグレースフルに動く
- 本番反映にはサーバーの再ビルド(`server/public` はイメージに含まれる)と、iOS 実機アプリの再インストールが必要

## テスト方針

- `cd server && npm run typecheck`(TS 変更は無いが回帰確認)
- ローカルサーバー(`./run-server.sh`)を起動し、`http://localhost:3014/admin/` の楽曲一覧で
  - 参照曲ありの曲に「リファレンス: …」が折りたたみを開かずに見えること
  - 参照曲なしの旧データで空行・「undefined」が出ないこと
- iOS シミュレータビルド(`xcodegen generate` + `xcodebuild ... build`)が通ること
- 実生成(Suno クレジット消費)は行わない
