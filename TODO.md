# TODO

- エラーログのトリアージを 1 コマンド化する(`/errors`)[plan](docs/plans/error-triage-command.md)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。溜まったログを「見て・判断して・タスク化する」側を作る(error-log-collection の Phase 4)
  - [ ] Phase 1: `/errors` スキル(`.claude/skills/errors/SKILL.md`)と台帳(`docs/error-triage.md`)を作る
  - [ ] Phase 2: 現在の本番ログで初回トリアージを実走し、手順・台帳を調整(CLAUDE.md 追記・後片付け)

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする