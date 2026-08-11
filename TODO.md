# TODO

- [ ] 毎日作成を参照曲ベースに変更した件の本番反映(サーバーのデプロイ + 実機アプリの更新と動作確認)
- [ ] 毎日更新が曲参照になったのでそれ以外の機能を洗い出して削除する [plan](docs/plans/remove-unused-generation-features.md)
  - [x] Phase 0: 削除候補の洗い出しと方針決定(すべて削除。フォールバック・👍/👎・カスタム生成・パラメータ一覧ページ・テーブルまで)
  - [ ] Phase 1: 冒険日(daily_adventure)の削除
  - [ ] Phase 2: カスタム生成(mode = manual)の削除と /api/generate の artistSongId 必須化
  - [ ] Phase 3: フォールバック経路の削除と llm.ts の直線化(referenceSong 必須化)
  - [ ] Phase 4: プリセットの削除(API・シード・管理ページ・出力スキーマの usedPresets)
  - [ ] Phase 5: 評価(👍/👎)の削除(UI・API・tracks.rating / rated_at)
  - [ ] Phase 6: 生成パラメータ API / 画面の整理
  - [ ] Phase 7: DB の整理(presets / task_presets / profile の DROP。要バックアップ)
  - [ ] Phase 8: ドキュメント(CLAUDE.md / spec 2 本 + 図)と総合検証
