# TODO

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする

- [] iOS 再生の復帰不全を直す(音楽が復帰しない: iPhone の画面を消してアプリに戻ると「再生中」表示のまま・電波が一度途切れて復活しても再生ができない)— [plan](docs/plans/ios-playback-recovery.md)
  - [x] Phase 1: `isPlaying` を AVPlayer の実状態(`timeControlStatus` KVO)から導出 + ロック画面同期
  - [x] Phase 2: 失敗した AVPlayerItem を再生操作で作り直す(位置復元付き)
  - [ ] Phase 3: オーディオセッション割り込み対応(実装済み)+ 実機での通し確認(機内モード・画面ロック・アラーム)← 実機確認のみ残り

- [] BACKLOG 自動運用パイプラインの実装 — 設計: [plan](docs/plans/backlog-auto-pipeline.md)。g3plus-ops 側の変更を含む。実施順は「自動デプロイ → BACKLOG 修正プロセス」(2026-08-13 決定)
  - [x] pull 型自動デプロイ(設計 Phase 2): `g3plus-ops/daily-ai-music/auto-update.sh`(flock・前チェック・検証・ロールバック)+ `/health` の commit SHA + CLAUDE.md の push ルール明文化 + 初回手動反映 + crontab 登録(2026-08-13 完了。esltext 側の flock 追従のみ保留)
  - [ ] `/logs` の無人定期実行(設計 Phase 1): `scripts/auto-logs.sh` + launchd + SKILL 無人対応 + fetch-logs.sh の auto-update.log 取得
  - [ ] メール承認ループ(設計 E。旧 Phase 3 を置き換え): サーバー(`ops_approvals` + `/ops/approve` + `/api/ops/approvals`)→ g3plus-ops(`backlog-mail.sh` + crontab)→ Mac(`ops-runner.sh` + launchd + `/backlog` スキル)+ BACKLOG の `[auto]` タグ書式
  - [ ] 無承認モード(設計 Phase 4。モード 1 の実績を見て導入を別途判断)
