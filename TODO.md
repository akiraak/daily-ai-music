# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- 生成 UI 再構築の本番反映 — サーバーを通常フロー(`git pull` → `build` → `up -d`)で反映(`GET /api/reference-songs` の追加のみ・DB 変更なし)し、iOS アプリを実機へ再インストール。**反映まで実機の「曲を選んで生成」の一覧はエラー表示になる**(他の画面は旧サーバーでも動く)[plan](docs/plans/archive/generation-ui-restructure.md)

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする