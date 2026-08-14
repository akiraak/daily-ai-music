# エラートリアージ台帳

`/logs`(`.claude/skills/logs/SKILL.md`)が使う、エラー fingerprint ごとの判断記録。
手で直してもよい。判断の履歴は git に残る。

状態と再浮上のルール:

- **無視** — 再提示しない(件数だけサマリに出る)
- **様子見** — 判定日より後に発生があれば再提示
- **対応中** — `FIXES.md` の対応項目が実施済み(`[x]`)になったら修正済み化を提案
- **修正済み** — 修正日より後に発生があれば「再発」として再オープン提案

| fingerprint | 状態 | 判定日 | 修正日 | 分類 | 内容 | メモ |
|---|---|---|---|---|---|---|
| 1d5539b99a67 | 対応中 | 2026-08-13 | | server/generation/provider_failed | kie.ai が style の「major7」をアーティスト名と誤判定 | FIXES「style 語彙拒否への対策」。8/12(task 27)・8/13(task 46)の 2 回発生 |
| c5be6d9bbb28 | 無視 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tasks: 通信に失敗: cancelled | SwiftUI の画面遷移による正常キャンセル(-999)。報告除外を FIXES に追加済み |
| 342240bb2157 | 無視 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tracks: 通信に失敗: cancelled | 同上(-999) |
| aedbab76a1a3 | 無視 | 2026-08-13 | | ios/ios-api/transport_failed | /api/credits: 通信に失敗: cancelled | 同上(-999) |
| ccc61802db9b | 修正済み | 2026-08-13 | 2026-08-13 | ios/ios-api/http_error | POST /api/generate: HTTP 400 | 新アプリ→旧サーバーのデプロイ順序ずれ(artistId 未対応の旧サーバーに投げた)。d721aed の本番反映で解消 |
| 82002bae1f42 | 様子見 | 2026-08-13 | | server/generation/task_failed | Anthropic クレジット不足で LLM 失敗 | 単発(task 37)・入金で解消済み。再発したら残高警告の仕組みを検討 |
| 6ac96d85546e | 様子見 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tasks: The network connection was lost. | モバイル回線の一過性。急増したら要調査 |
| 88d7cc5af112 | 様子見 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tasks: The request timed out. | 同上 |
| 9a3e2889fb58 | 様子見 | 2026-08-13 | | ios/ios-api/transport_failed | /api/images/…: The network connection was lost. | 同上 |
| 7bf6b053dd21 | 様子見 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tracks: The network connection was lost. | 同上 |
| b2e20e3e0330 | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/tracks(secret 無し) | 発生時刻が開発・デプロイ検証の時間帯と一致。自分の curl か外部スキャナ。実害なし |
| a05b5a41ba61 | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/artists(secret 無し) | 同上 |
| 84413f691b18 | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/reference-songs(secret 無し) | 同上(新設パスなので外部は知り得ない = 自分の curl) |
| cfcb70c64d4f | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/errors(secret 無し) | 2026-08-11 のフェッチスクリプト検証時の自分のアクセス |
