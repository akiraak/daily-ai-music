# TODO

- [ ] リアルワード: 外部リソース(ニュース・天気)から曲の着想ワードを作り、保存・使用制限で似た曲の連続生成を防ぐ(同一ワードは直近 30 日で 2 回まで、古いワードは自動で再利用可能に)[plan](docs/plans/real-world-words.md)
  - [x] Phase 1: 注入基盤 + ニュース(Google News RSS)+ パラメータ設定画面新設(ニュース ON/OFF・毎日の自動生成設定)
  - [x] Phase 2: リアルワードの生成・保存(real_world_words テーブル)+楽曲詳細に表示
  - [x] Phase 3: 使用回数の集計とプロンプトでの制限+検証リトライ
  - [x] Phase 4: 天気(Open-Meteo)+ 設定画面に天気 ON/OFF・位置設定を追加
  - [x] Phase 5: パラメータ一覧ページに使用ワードと残り回数を表示(任意)
  - [ ] 稼働後チェック: Sonnet 5 のパラメータ(realWorldWords 等)生成精度を確認し、悪ければ `.env` の `LLM_MODEL` を claude-opus-5 に変更

- アプリ名の変更
- アプリアイコンを作成
- iOSアプリデザインをする
