# TODO

## 準備

- [ ] Suno 公式 API の早期アクセスに応募する(CPO Jack Brody の LinkedIn 投稿経由の Typeform。ユーザー操作が必要)

## 次の実装

- [ ] 音楽生成エンジンの実装 [plan](docs/plans/music-generation-engine.md) / [spec](docs/specs/music-generation.md)
  - [ ] Phase 1: 評価基盤(👍/👎/★ カラム・API・管理画面 UI)
  - [ ] Phase 2: プリセット管理(テーブル・CRUD API・初期データ・管理画面 UI)
  - [ ] Phase 3: LLM 生成パイプライン(Claude API 連携、好みプロファイル、customMode 対応、歌詞・訳の保存と表示)
  - [ ] Phase 4: 毎日の自動生成(settings・スケジューラ・冒険日判定・手動トリガ)
- [ ] `/audio/*` `/images/*` を認証付き配信にする(iOS は X-API-Secret 付き `/api/audio` 等、管理画面は Access Cookie の効く `/admin/audio` 等。無認証経路を `/health` だけにする)[plan](docs/plans/media-auth.md)
  - [x] Step 1: サーバー — 4 マウント化 + `/api/tracks` の URL をマウント先プレフィックス付きに(2026-08-06 実装済み。curl で旧経路 404・secret 無し 401・secret 付き 200/206・`/admin` 側 200・URL 出し分けを確認)
  - [x] Step 2: iOS — AVURLAsset ヘッダ注入 + カバー画像の自前ローダー(2026-08-06 実装済み。シミュレータビルド + 再生 UI テスト通過)
  - [x] Step 3: ドキュメント追従(2026-08-06 CLAUDE.md 更新・g3plus-ops TODO にデプロイタスク追加)
  - [ ] 本番デプロイ(**g3plus-ops 側の作業**。`audioUrl` の形が変わる破壊的変更のため iOS アプリの再ビルド・インストールも同時に行う。g3plus-ops の workflow doc・CLAUDE.md の「`/audio/*` `/images/*` は無認証」記述も追従。完了したらこの親タスクを DONE.md へ移し、プランを archive する)
