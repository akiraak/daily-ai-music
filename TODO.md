# TODO

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする

- [] BACKLOG 自動運用パイプラインの実装 — 設計: [plan](docs/plans/backlog-auto-pipeline.md)。g3plus-ops 側の変更を含む。実施順は「自動デプロイ → BACKLOG 修正プロセス」(2026-08-13 決定)
  - [ ] pull 型自動デプロイ(設計 Phase 2): `g3plus-ops/daily-ai-music/auto-update.sh`(flock・前チェック・検証・ロールバック)+ `/health` の commit SHA + CLAUDE.md の push ルール明文化 + 初回手動反映 + crontab 登録
  - [ ] `/logs` の無人定期実行(設計 Phase 1): `scripts/auto-logs.sh` + launchd + SKILL 無人対応 + fetch-logs.sh の auto-update.log 取得
  - [ ] `/backlog` スキル(設計 Phase 3): 選定ルール + 承認ゲート + push 後の反映監視
  - [ ] 無承認モード(設計 Phase 4。モード 1 の実績を見て導入を別途判断)
