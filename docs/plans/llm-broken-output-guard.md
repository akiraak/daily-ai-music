# LLM 構造化出力の破損(思考テキストの混入)への対策

## 目的・背景

2026-08-26 に生成タスク 2 件(task 133 daily / task 138 artist)が、LLM の構造化出力の破損で失敗した。

- 構造化出力(`output_config.format: json_schema`)は **JSON としては valid** だったが、値の中身がモデルの思考テキストになっていた
  - task 138: title 1173 字の英語メタ思考、style・lyrics も思考の断片
  - task 133: title 127 字の壊れた日本語、style・lyrics は空
- どちらも kie.ai の「タイトルは 80 字まで」の 422 で失敗(fingerprint `1548bc85c976` / `11cf439d9b6a`)
- サーバーは Suno 送信前にプランの中身を検証していない。80 字制限が偶然セーフティネットになっただけで、**title が 80 字以内に収まる壊れ方なら、壊れた曲がそのまま生成される**
- 破損した 2 回の出力トークンは約 16k と完走曲(10〜13k)より多め。発生は確率的で、リクエストを作り直せば直る見込み

BACKLOG「LLM 構造化出力の破損(思考テキストの混入)への対策」の実施。

## 対応方針

`server/src/llm.ts` のみ変更。既存の検証リトライ(禁止ワード・固有名詞で 1 回だけ再生成する `planIssues()` の仕組み)に「出力の破損」検査を追加する。

1. **破損検査 `brokenOutputIssues(plan, input)` を追加**(テストから直接叩けるよう export)。機械的に判定できる壊れ方だけを見る:
   - title が空、または 80 字超(kie.ai の上限。定数 `SUNO_TITLE_MAX = 80`)
   - style が空
   - lyrics が空(インストゥルメンタルでない場合のみ。インストでは空が正しい)
2. **`PlanIssue` に `fatal` フラグを追加**し、破損は fatal とする。検出したら既存のリトライに乗せ、「思考の途中経過を値に書かず、完成した値だけを書く」旨の再生成指示を足す
3. **初回検出時に `logWarn`(event `plan_broken_output`)**で error_logs に残す — リトライで救えた場合も発生頻度を /logs で観測できるようにする
4. **リトライ後も fatal な問題が残る場合は Suno に送らず throw**(明確なメッセージでタスク FAILED)。禁止ワード・固有名詞(soft)は従来どおり警告して続行

## 影響範囲

- `server/src/llm.ts` のみ。`generateSongPlan()` は daily / artist 共通なので両経路に効く
- 正常な出力には追加の LLM 呼び出しは発生しない(検査は文字列長チェックのみ)
- 破損検出時のリトライは既存の仕組みの再利用で、リトライ回数の上限(1 回)は変えない

## テスト方針

- `npm run typecheck`
- `brokenOutputIssues()` を node で直接呼んで確認(壊れた title / 空 style / インストの空 lyrics 許容 / 正常プランで空配列)
- 実生成のスモークは行わない(1 曲 3〜4.5 分・実コストが掛かるため)。本番反映後の再発は /logs の fingerprint `1548bc85c976` 監視で確認する
