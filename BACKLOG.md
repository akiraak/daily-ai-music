# BACKLOG

`/logs`(ログ解析)が見つけた修正・改善項目。`TODO.md` とは独立に管理する(人が直接足してもよい)。

- 着手するときは通常の作業着手ルール(プラン作成 → 実装)に乗せる
- **実施したら削除せず `[x]` にして残す** — 次回の `/logs` が台帳([docs/error-triage.md](docs/error-triage.md))の「修正済み」化に使う
- **`[auto]` タグ**(2026-08-13 追加): 対策が一意で自動修正に回せる項目は `- [ ] [auto] ...` と書く(判定基準は [docs/plans/backlog-auto-pipeline.md](docs/plans/backlog-auto-pipeline.md) の B)。digest メールで承認リンクが付き、クリックすると Mac のランナーが無人で修正 → push まで行う。対策候補が複数・検討系の項目にはタグを付けない(メールには「要判断」で載る)

## 項目

- [ ] Suno(kie.ai)の style 語彙拒否への対策 — style に入った「major7」がアーティスト名(実在の psytrance ユニット "Major7")と誤判定されて生成失敗。**8/12(task 27)・8/13(task 46)と 2 日連続で毎日生成が 1 曲欠けた**(Suno 側の失敗は再試行されず、`last_daily_count` は送信時点で加算済みのためその日の残数にも乗らない)。対策候補: LLM の出力条件にコード名の表記ルールを足す(「maj7」に統一)/ Suno 送信前に style を置換 / `provider_failed` 時に style を直して 1 回だけ再送信(fingerprint `1d5539b99a67`、2026-08-13)。**8/22(task 119)には「skank」(スカのリズム名)も誤判定され 3 例目**(fingerprint `ff93b2cf8532`、2026-08-26)— 語彙は事前に列挙しきれないため、再送信系の対策が有力
- [ ] iOS のリクエストキャンセル(-999)をエラー報告から除外する — 90 日の全エラー発生の過半(41/75 件)がこのノイズ。SwiftUI の画面遷移による正常なキャンセルまで `transport_failed` として報告している。`BackendAPI.send` の catch で `URLError.Code.cancelled` / `CancellationError` を報告対象から外す(fingerprint `c5be6d9bbb28` `342240bb2157` `aedbab76a1a3` `efd0fd0a34c1`、2026-08-13/2026-08-26)
- [ ] サーバー再起動による生成中断への対処を検討 — 8/12 のデプロイで `PLANNING` 中の task 36・39 が「サーバー再起動により中断されました」で FAILED(仕様どおりだが 2 件連続)。中断タスクの自動リトライ、またはデプロイ前に進行中タスクの有無を確認する運用のどちらかを検討(エラーログ外・`tasks.jsonl` の突き合わせで検出、2026-08-13)
- [x] LLM 構造化出力の破損(思考テキストの混入)への対策(2026-08-26 実施) — claude-sonnet-5 の構造化出力(json_schema)が、まれに **JSON としては valid だが値がモデルの思考テキストになる**壊れ方をする。8/26 の task 133(daily。title 127 字の壊れた日本語・style/lyrics 空)と task 138(artist。title 1173 字の英語メタ思考・style/lyrics も断片)の 2 回で、どちらも kie.ai の「title は 80 字まで」の 422 で失敗(この上限が偶然セーフティネットになった — title だけ 80 字以内の壊れ方なら壊れた曲がそのまま生成される)。出力トークンはどちらも約 16k と完走曲(10〜13k)より多め。対策: `planIssues()`(`server/src/llm.ts`)に検証を足して既存の検証リトライに乗せる([plan](docs/plans/archive/llm-broken-output-guard.md)) — title 80 字以内・style/lyrics 非空を最低限、リトライ後も駄目なら明確な理由で FAILED(fingerprint `1548bc85c976` `11cf439d9b6a`、2026-08-26)
- [ ] 残高・使用上限による生成失敗の検知と通知 — 課金起因の失敗が 3 種類立て続けに発生: (1) Anthropic クレジット不足で 8/21〜22 に丸一日 30 分おきの再試行が空振り(計 69 件。fingerprint `82002bae1f42` `61e879eeab14`。入金で解消)、(2) Anthropic の月次使用上限到達で 8/26 の task 135〜137 が失敗(解除は 9/1 00:00 UTC。fingerprint `e5d44813fe9d`。直後の task 138 は LLM を通過しており解消済みに見える)、(3) Suno クレジット不足で 8/21 に 5 件(fingerprint `6ce0336bda63` `1b282399f19f`。チャージで解消)。8/13 の様子見判定「再発したら残高警告を検討」の条件が成立。対策候補: この形のエラーを課金起因と判別して 30 分再試行を止める(または間隔を大きく伸ばす)+ 管理画面・iOS に警告表示 / 残クレジットのしきい値警告(2026-08-26)
