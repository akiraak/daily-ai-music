# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- アーティストから生成と曲から生成のUIが分かりにくいので整理して再構築 [plan](docs/plans/generation-ui-restructure.md)
  - [x] Phase 0a: サーバー — `GET /api/reference-songs` の追加
  - [x] Phase 0b: iOS — 共通の新画面 + 案 1 / 案 2 を設定で切り替え(実機比較用)
  - [ ] Phase 0c: 実機で両案を確認して構成を決定(管理画面の追従範囲も)
  - [ ] Phase 1: iOS — 落選案と切り替えトグルの撤去・確定構成への整理
  - [ ] Phase 2: Web 管理画面 — 名前・文言・構成の追従
  - [ ] 後片付け — CLAUDE.md 更新・プランの archive 移動

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする