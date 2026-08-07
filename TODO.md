# TODO

- [ ] 曲の歌詞や曲調を外部リソース(ニュース・天気)を参考にして作るようにする [plan](docs/plans/external-context-generation.md)
  - [ ] Phase 1: 注入基盤 + ニュース(Google News RSS)+ パラメータ設定画面新設(ニュース ON/OFF・毎日の自動生成設定)
  - [ ] Phase 2: 天気(Open-Meteo)+ 設定画面に天気 ON/OFF・位置設定を追加
- [ ] 生成に使ったアイデアワードを保存し、似た曲の連続生成を防ぐ(同一ワードは直近 30 日で 2 回まで、古いワードは自動で再利用可能に)[plan](docs/plans/idea-word-usage-limit.md)
  - [ ] Phase 1: keywords の生成・保存(idea_words テーブル)+楽曲詳細に表示
  - [ ] Phase 2: 使用回数の集計とプロンプトでの制限+検証リトライ
  - [ ] Phase 3: パラメータ一覧ページに使用ワードと残り回数を表示(任意)
  - [ ] 稼働後チェック: Sonnet 5 のパラメータ(keywords 等)生成精度を確認し、悪ければ `.env` の `LLM_MODEL` を claude-opus-5 に変更
