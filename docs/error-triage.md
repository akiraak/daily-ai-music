# エラートリアージ台帳

`/logs`(`.claude/skills/logs/SKILL.md`)が使う、エラー fingerprint ごとの判断記録。
手で直してもよい。判断の履歴は git に残る。

状態と再浮上のルール:

- **無視** — 再提示しない(件数だけサマリに出る)
- **様子見** — 判定日より後に発生があれば再提示
- **対応中** — `BACKLOG.md` の対応項目が実施済み(`[x]`)になったら修正済み化を提案
- **修正済み** — 修正日より後に発生があれば「再発」として再オープン提案

| fingerprint | 状態 | 判定日 | 修正日 | 分類 | 内容 | メモ |
|---|---|---|---|---|---|---|
| 1d5539b99a67 | 対応中 | 2026-08-13 | | server/generation/provider_failed | kie.ai が style の「major7」をアーティスト名と誤判定 | BACKLOG「style 語彙拒否への対策」。8/12(task 27)・8/13(task 46)の 2 回発生 |
| ff93b2cf8532 | 対応中 | 2026-08-26 | | server/generation/provider_failed | kie.ai が style の「skank」(スカのリズム名)をアーティスト名と誤判定 | 「style 語彙拒否への対策」の 3 例目(8/22、task 119)。同じ BACKLOG 項目で対応 |
| 1548bc85c976 | 対応中 | 2026-08-26 | | server/generation/task_failed | LLM 構造化出力の破損で title が 80 字超過 → kie.ai 422 | BACKLOG「LLM 構造化出力の破損への対策」。task 133(daily)・138(artist)。JSON は valid だが値に思考テキストが混入(title 1173 字/127 字) |
| 11cf439d9b6a | 対応中 | 2026-08-26 | | server/scheduler/daily_failed | 同上(daily 経路の同じ失敗) | task 133。同じ BACKLOG 項目で対応 |
| 82002bae1f42 | 対応中 | 2026-08-26 | | server/generation/task_failed | Anthropic クレジット不足で LLM 失敗 | 8/13 に様子見(単発)→ 8/21〜22 に 35 件再発(入金で解消)。様子見条件が成立し BACKLOG「残高・使用上限による生成失敗の検知と通知」へ昇格 |
| 61e879eeab14 | 対応中 | 2026-08-26 | | server/scheduler/daily_failed | Anthropic クレジット不足(スケジューラ側。34 件) | 82002bae1f42 と同一エピソード(8/21〜22)。同じ BACKLOG 項目で対応 |
| e5d44813fe9d | 対応中 | 2026-08-26 | | server/generation/task_failed | Anthropic の月次使用上限に到達(解除は 9/1 00:00 UTC) | 8/26 の task 135〜137。直後の task 138 は LLM を通過しており上限は解消済みに見える(上限引き上げか)。同じ BACKLOG 項目で対応 |
| 6ce0336bda63 | 対応中 | 2026-08-26 | | server/scheduler/daily_failed | Suno(kie.ai)クレジット不足(402) | 8/21 に 5 件。チャージで解消(8/26 時点の残高 796)。同じ BACKLOG 項目で対応 |
| 1b282399f19f | 対応中 | 2026-08-26 | | server/generation/task_failed | 同上(タスク側の記録) | 同上 |
| adb13b63ac1a | 様子見 | 2026-08-26 | | server/scheduler/daily_failed | Anthropic overloaded_error | 8/18 に 2 件。一過性。30 分後の再試行で回復 |
| 2b9f14dc774d | 様子見 | 2026-08-26 | | server/generation/task_failed | 同上(タスク側の記録) | 同上 |
| 51e913cfcf0c | 様子見 | 2026-08-26 | | server/scheduler/daily_failed | Anthropic api_error(Internal server error) | 8/24 に単発。一過性 |
| c87faa01618d | 様子見 | 2026-08-26 | | server/generation/task_failed | 同上(タスク側の記録) | 同上 |
| 0d04f1a3e255 | 様子見 | 2026-08-26 | | server/scheduler/daily_failed | Anthropic の content filtering で出力ブロック | 8/16 に単発。再発したらニュース由来の歌詞テーマとの関係を調査 |
| dd7e525556b6 | 様子見 | 2026-08-26 | | server/generation/task_failed | 同上(タスク側の記録) | 同上 |
| d40c2d04f596 | 様子見 | 2026-08-26 | | server/context/fetch_failed | news の取得に失敗(スキップして続行) | 8/21 に単発。ニュース無しで生成は続くので実害小 |
| 80df47e3f7aa | 様子見 | 2026-08-26 | | server/llm/web_search_failed | web_search が max_uses_exceeded(推定で続行) | 8/18 に単発。フォールバックが効いており実害小 |
| c5be6d9bbb28 | 無視 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tasks: 通信に失敗: cancelled | SwiftUI の画面遷移による正常キャンセル(-999)。報告除外を BACKLOG に追加済み |
| 342240bb2157 | 無視 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tracks: 通信に失敗: cancelled | 同上(-999) |
| aedbab76a1a3 | 無視 | 2026-08-13 | | ios/ios-api/transport_failed | /api/credits: 通信に失敗: cancelled | 同上(-999) |
| efd0fd0a34c1 | 無視 | 2026-08-26 | | ios/ios-api/transport_failed | /api/images/…: 通信に失敗: cancelled | 同上(-999)。BACKLOG の除外項目に fingerprint を追記 |
| 441b5c373f4b | 無視 | 2026-08-26 | | ios/ios-player/playback_failed | 端末オフライン時の再生失敗 | 圏外の正常系。復帰不能の問題は 8/25 の再生復帰修正(b8c1e93)で対応済み |
| b128a88df07d | 無視 | 2026-08-26 | | ios/ios-api/transport_failed | /api/tasks: 端末オフライン | 同上(圏外の正常系) |
| ccc61802db9b | 修正済み | 2026-08-13 | 2026-08-13 | ios/ios-api/http_error | POST /api/generate: HTTP 400 | 新アプリ→旧サーバーのデプロイ順序ずれ(artistId 未対応の旧サーバーに投げた)。d721aed の本番反映で解消 |
| 6ac96d85546e | 様子見 | 2026-08-26 | | ios/ios-api/transport_failed | /api/tasks: The network connection was lost. | モバイル回線の一過性。累計 23 件だが分散しており急増ではない。8/25 の再生復帰修正で体感への影響は減る見込み |
| 88d7cc5af112 | 様子見 | 2026-08-26 | | ios/ios-api/transport_failed | /api/tasks: The request timed out. | 同上(累計 13 件) |
| 9a3e2889fb58 | 様子見 | 2026-08-13 | | ios/ios-api/transport_failed | /api/images/…: The network connection was lost. | 同上 |
| 7bf6b053dd21 | 様子見 | 2026-08-13 | | ios/ios-api/transport_failed | /api/tracks: The network connection was lost. | 同上 |
| b2e20e3e0330 | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/tracks(secret 無し) | 発生時刻が開発・デプロイ検証の時間帯と一致。自分の curl か外部スキャナ。実害なし |
| a05b5a41ba61 | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/artists(secret 無し) | 同上 |
| 84413f691b18 | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/reference-songs(secret 無し) | 同上(新設パスなので外部は知り得ない = 自分の curl) |
| cfcb70c64d4f | 無視 | 2026-08-13 | | server/api/unauthorized | GET /api/errors(secret 無し) | 2026-08-11 のフェッチスクリプト検証時の自分のアクセス |
