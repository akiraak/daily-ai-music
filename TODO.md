# TODO

- [ ] 曲名を登録できるようにする（曲名からアーティストも逆引き） [plan](docs/plans/song-title-registration.md)
  - [ ] Phase 1: サーバー基盤（itunes.ts の曲名検索・trackId lookup、`GET /api/artist-songs/search`・`POST /api/artist-songs`）
  - [ ] Phase 2: 管理画面（登録パネルにアーティスト名／曲名の切り替え、登録後にその曲まで開く）
  - [ ] Phase 3: iOS（追加シートに曲名モード、登録後に曲一覧へ push）
  - [ ] Phase 4: ドキュメント更新と総合検証
- [ ] 毎日作成をアーティストと曲から選択して生成するのに変更