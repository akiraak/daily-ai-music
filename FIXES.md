# FIXES

`/logs`(ログ解析)が見つけた修正・改善項目。`TODO.md` とは独立に管理する(人が直接足してもよい)。

- 着手するときは通常の作業着手ルール(プラン作成 → 実装)に乗せる
- **実施したら削除せず `[x]` にして残す** — 次回の `/logs` が台帳([docs/error-triage.md](docs/error-triage.md))の「修正済み」化に使う

## 項目

- [ ] Suno(kie.ai)の style 語彙拒否への対策 — style に入った「major7」がアーティスト名(実在の psytrance ユニット "Major7")と誤判定されて生成失敗。**8/12(task 27)・8/13(task 46)と 2 日連続で毎日生成が 1 曲欠けた**(Suno 側の失敗は再試行されず、`last_daily_count` は送信時点で加算済みのためその日の残数にも乗らない)。対策候補: LLM の出力条件にコード名の表記ルールを足す(「maj7」に統一)/ Suno 送信前に style を置換 / `provider_failed` 時に style を直して 1 回だけ再送信(fingerprint `1d5539b99a67`、2026-08-13)
- [ ] iOS のリクエストキャンセル(-999)をエラー報告から除外する — 90 日の全エラー発生の過半(41/75 件)がこのノイズ。SwiftUI の画面遷移による正常なキャンセルまで `transport_failed` として報告している。`BackendAPI.send` の catch で `URLError.Code.cancelled` / `CancellationError` を報告対象から外す(fingerprint `c5be6d9bbb28` `342240bb2157` `aedbab76a1a3`、2026-08-13)
- [ ] サーバー再起動による生成中断への対処を検討 — 8/12 のデプロイで `PLANNING` 中の task 36・39 が「サーバー再起動により中断されました」で FAILED(仕様どおりだが 2 件連続)。中断タスクの自動リトライ、またはデプロイ前に進行中タスクの有無を確認する運用のどちらかを検討(エラーログ外・`tasks.jsonl` の突き合わせで検出、2026-08-13)
