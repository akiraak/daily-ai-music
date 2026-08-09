# TODO

- [] 音楽生成の経路アーティスト経由を追加 — [plan](docs/plans/artist-based-generation.md)
  - アーティスト名を登録する
  - アーティスト名から楽曲名を検索して自動で登録する
  - 生成時にアーティストと楽曲を選択し、その楽曲に似た曲を生成するプロンプトをAIで生成してSunoで曲生成
  - [ ] Phase 1: サーバー基盤 — `itunes.ts` 新設(検索・楽曲取得・重複除去)+ DB(`artists` / `artist_songs` / `tasks` へ参照カラム)+ アーティスト管理 API(search / 登録 / 一覧 / 曲一覧 / refresh / 削除)
  - [ ] Phase 2: 生成経路 — `llm.ts` に artist モード(固有名詞を落として音楽的特徴に翻訳させる指示+混入検査の再生成)、`POST /api/generate` に `artistSongId`、`generation.ts` で参照曲を記録
  - [ ] Phase 3: 管理画面 — `artists.html` / `artists.js` 新設(登録・一覧・曲選択から生成)+ 全ページのサイドバーにリンク追加
  - [ ] Phase 4: iOS — モデル追加 + `ArtistsView` / `ArtistSongsView` 新設 + 生成タブの導線 + 楽曲詳細のリファレンス表示
  - [ ] Phase 5: ドキュメント更新(spec 2 本・CLAUDE.md)と総合検証(実生成 1 曲で Suno の受理と類似度を確認)
