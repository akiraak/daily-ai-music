# TODO

- ログ解析を 1 コマンド化する(`/logs`。旧称 `/errors` から 2026-08-13 改名 — エラー修正に加えアプリ改善の分析にも使う)[plan](docs/plans/log-analysis-command.md)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。溜まったログを「見て・判断して・タスク化する」側を作る(error-log-collection の Phase 4)
  - [x] Phase 1: `/logs` スキル(`.claude/skills/logs/SKILL.md`)と台帳(`docs/error-triage.md`)を作る
  - [ ] Phase 2: 現在の本番ログで初回トリアージを実走し、手順・台帳を調整(CLAUDE.md 追記・後片付け)

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする

- 利用データの収集を設計する — `/logs` の改善分析の入力を増やす。iOS の再生・画面利用や公開ページのアクセスは今どこにも記録されていない(タスク・楽曲などの生成系データは `scripts/fetch-logs.sh` で取得済み)。何をどう計測するかの設計から必要なので別プランで決める