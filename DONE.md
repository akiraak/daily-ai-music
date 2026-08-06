# DONE

- [x] 2026-08-06 Web管理画面の作成と音楽の生成と再生 — `server/`(Hono + node:sqlite)に生成 API・ポーリングジョブ・管理画面を実装。E2E で実生成 1 回(2 曲保存・再生)を確認。起動: `cd server && npm start` → http://localhost:3014。プラン: [docs/plans/archive/web-admin-music-generation.md](docs/plans/archive/web-admin-music-generation.md)

- [x] 2026-08-06 Suno との連携方式(公式 API の可否、認証方法、MCP サーバ)を調査する — 結果: [docs/specs/suno-api.md](docs/specs/suno-api.md)
- [x] 2026-08-06 サードパーティ Suno API のアカウントを作成して API キーを発行し、少額クレジットで生成フローを検証する — sunoapi.org は Google ログイン不可のため同一運営の kie.ai で検証。スクリプト: `scripts/verify-sunoapi.mjs`、実測値: [docs/specs/suno-api.md](docs/specs/suno-api.md)、プラン: [docs/plans/archive/sunoapi-org-verification.md](docs/plans/archive/sunoapi-org-verification.md)
