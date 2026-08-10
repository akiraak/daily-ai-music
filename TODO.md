# TODO

- [ ] 毎日作成をアーティストと曲から選択して生成するのに変更 [plan](docs/plans/daily-reference-song.md)
  - [ ] Phase 1: 参照曲の選択(`db.listReferenceCandidates()` + `reference.ts` の純関数 + 分布確認)
  - [ ] Phase 2: プロンプト分岐を「モード名」から「参照曲の有無」へ一般化(`llm.ts`)
  - [ ] Phase 3: `runDaily` の分割と `POST /api/daily/run` の非同期化(サーバー + 管理画面 + iOS)
  - [ ] Phase 4: 生成パラメータ(API のキー追加 + iOS の参照曲候補節)
  - [ ] Phase 5: ドキュメント更新 + 総合検証(実生成・ヘッドレス目視・UI テスト)
- [ ] 毎日更新が曲参照になったのでそれ以外の機能を洗い出して削除する