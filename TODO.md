# TODO

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする

- [] BACKLOG 自動運用パイプラインの実装(Phase 1: `/logs` の無人定期実行(Mac launchd)→ Phase 2: pull 型自動デプロイ(g3plus-ops の `auto-update.sh` + `/health` に commit SHA。初回反映は手動)→ Phase 3: `/backlog` スキル + push ルールの明文化 → Phase 4: 無承認モードは実績を見て別途判断)— 設計: [plan](docs/plans/backlog-auto-pipeline.md)。着手時に Phase を子タスク展開する。g3plus-ops 側の変更を含む
