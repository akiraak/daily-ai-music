# iOS アプリに評価ボタン(👍/👎)を追加する

## 目的・背景

評価(👍/👎)は好みプロファイルに反映され、毎日の自動生成の質を左右する。現状 Web 管理画面でしか評価できず、普段いちばん聴く iPhone アプリから評価できないため、楽曲一覧の各行に管理画面と同じトグル式の 👍/👎 ボタンを追加する。

サーバ側は実装済みで変更不要:

- `GET /api/tracks` が `rating: 1 | -1 | null` を返す
- `POST /api/tracks/:id/rating`(body `{ rating: 1 | -1 | null }`、null で解除)が更新後の track を返す

## 対応方針

1. **モデル**(`ios/DailyAIMusic/Sources/Models/APIModels.swift`)
   - `Track` に `rating: Int?` を追加
   - `RatingRequest`(`rating: Int?`)を追加。JSONEncoder は nil キーを省略するので、カスタム `encode(to:)` で `"rating": null` を明示的に出す(サーバは `rating` キー必須)
   - `RatingResponse`(`{ track: Track }`)を追加
2. **一覧 UI**(`ios/DailyAIMusic/Sources/Views/TrackListView.swift`)
   - 行の構成を「再生ボタン(既存の行内容、`track.row` 識別子は維持)+ 👍/👎 ボタン」に分割。評価ボタンは `.borderless` で独立タップ領域にする
   - トグル仕様は管理画面と同じ: アクティブな方をもう一度押すと解除。リクエスト中はボタンを無効化し、レスポンスの track で一覧の該当要素を置き換える
   - アクティブ状態は SF Symbols の `.fill` + tint で表現。UI テスト用に `track.rate.up` / `track.rate.down` の識別子と on/off の accessibilityValue を付ける

## 影響範囲

- iOS アプリのみ(`APIModels.swift` / `TrackListView.swift` / UI テスト)。サーバ・管理画面は変更なし
- 既存 UI テスト(`PlaybackUITests`)は `track.row` ボタンのタップに依存 → 識別子とボタン要素を維持して互換を保つ

## テスト方針

- シミュレータビルドが通ること
- UI テストを追加: 👍 をタップ → on になる → もう一度タップ → off に戻る(2 回タップで評価はもとに戻るのでデータを汚さない)。既存の再生スモークテストも通ること
