# TODO

## 準備

- [ ] Suno 公式 API の早期アクセスに応募する(CPO Jack Brody の LinkedIn 投稿経由の Typeform。ユーザー操作が必要)

## 次の実装

- [ ] 音楽生成エンジンの実装 [plan](docs/plans/music-generation-engine.md) / [spec](docs/specs/music-generation.md)
  - [ ] Phase 1: 評価基盤(👍/👎/★ カラム・API・管理画面 UI)
  - [ ] Phase 2: プリセット管理(テーブル・CRUD API・初期データ・管理画面 UI)
  - [ ] Phase 3: LLM 生成パイプライン(Claude API 連携、好みプロファイル、customMode 対応、歌詞・訳の保存と表示)
  - [ ] Phase 4: 毎日の自動生成(settings・スケジューラ・冒険日判定・手動トリガ)
- [ ] Web 管理画面を `/` 配信から `/admin` 配下へ移動する(Cloudflare Access をパス限定で掛けるため)[plan](docs/plans/admin-path.md)
  - 背景: 本番公開済み(https://music.chobi.me/ = g3plus。デプロイ設定は g3plus-ops リポジトリ `daily-ai-music/` と `docs/workflows/daily-ai-music.md`)。管理画面が `/` 配信のままだと Access(Google 認証)をドメイン全体に掛けるしかなく、`X-API-Secret` しか送らない iOS アプリ(`/api/*` `/audio/*` `/images/*`)が壊れる。当面は Access アプリのパス分割(`/api` `/audio` `/images` を Bypass、root を Google Allow)で回避中
  - [x] `server/public/` の静的配信を `/admin` 配下にマウントし直す(esl-learning-assistant と同型)。管理画面内のアセット参照・fetch 先パスも追従(2026-08-06 実装済み)
  - [x] `/` は `/admin/` へリダイレクト(`/admin`(末尾スラッシュ無し)も `/admin/` へ)(2026-08-06 実装済み)
  - [ ] デプロイ後、Cloudflare Access を `music.chobi.me/admin` の 1 アプリ(Google Allow)に整理して Bypass アプリ 3 つを削除(**g3plus-ops 側の作業**。workflow doc・CLAUDE.md も追従。完了したらこの親タスクを DONE.md へ移し、プランを archive する)
## 将来課題

- [ ] `/audio/*` `/images/*` の認証(2026-08-06 に music.chobi.me で公開済み。現状は無認証で、ファイル名が UUID 的 track id + 一覧取得に要 secret という「推測不能 URL」保護のみ。iOS の AVPlayer 再生と両立する認証方式を検討する)
