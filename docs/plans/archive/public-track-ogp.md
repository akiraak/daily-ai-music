# 公開ページの曲詳細に OGP タグを設定する

作成: 2026-08-12

## 目的・背景

公開ページの曲リンク(`https://music.chobi.me/track/:id`)を SNS(X・LINE・Discord・Slack 等)で共有したときに、その曲のカード(曲名・カバー画像・紹介文)が出るようにする。

`/track/:id` の URL は「同じ URL のままサーバー側の OGP メタ注入に差し替えられる」ことを見込んで選んだもの(2026-08-12 の公開 Web プランで決定)。本タスクはその差し替えの実施。

## 現状チェック(2026-08-12 実施。本番 URL で確認)

「正しく設定されているか」の答えは**未対応(曲別メタが無い)**:

- `/track/:id` の HTML は全曲共通の静的メタのみ — `og:site_name` / `og:type: music.song` / サイト共通の `description`。**`og:title`・`og:image`・`og:url`・曲別の説明が無い**ため、共有カードは全曲同じ(タイトルは「Music Plant」、画像なし)
- 曲名はページ側 JS が `document.title` に入れているが、**SNS クローラーは JS を実行しない**ので効かない
- 一覧 `/` は `og:title` / `og:description` / `og:type: website` あり(`og:image` / `og:url` は無し)
- 不在・非公開 id の `/track/:id` は **HTML が 200 で返る**(ページ内 JS が「曲が見つかりません」を出す方式)。詳細 API `GET /site/api/tracks/:id` は 404 を返すので不整合
- 材料は揃っている — 詳細 API が返す `intro`(公開用紹介文、全曲バックフィル済み・80〜136 字)が og:description にそのまま使える。カバー `/site/images/:file` は無認証 + 公開判定付きなのでクローラーも取得できる

## 対応方針

### `GET /track/:id` をサーバー側メタ注入に差し替える(`server/src/index.ts`)

- ハンドラで曲を DB から引き(詳細 API と同じ公開判定)、`server/site/track.html` を読み込んで `<head>` 内のプレースホルダー(例: `<!-- track-meta -->`)を曲別メタに置換して返す
  - 静的ファイルはこれまで通りリクエストごとに読む(開発時の即時反映を維持。負荷は無視できる規模)
  - 埋め込む値(曲名・intro)は **HTML エスケープ必須**
- 出すタグ:
  - `<title>` / `og:title`: `<曲名> — Music Plant`(JS の `document.title` 差し替えは残してよいが、正はサーバー側)
  - `meta description` / `og:description`: `intro`。無い曲(理論上は無いが保険)はサイト共通文へフォールバック
  - `og:image`: カバーの**絶対 URL**(`<PUBLIC_BASE_URL>/site/images/<file>`)。カバーが無い曲はタグ自体を出さない
  - `og:url`: `<PUBLIC_BASE_URL>/track/<id>`
  - `og:site_name` / `og:type: music.song`: 現状維持
  - `twitter:card: summary`(カバーは正方形なので summary が素直に出る。`summary_large_image` は 2:1 にクロップされるため使わない)
- **絶対 URL のベースは `.env` の `PUBLIC_BASE_URL`**(未設定時は `http://localhost:<PORT>`)。Host ヘッダからの推定はエッジ経由のスキーム判定(x-forwarded-proto)に依存して不確実なので採らない。本番は g3plus-ops 側の `.env` に `PUBLIC_BASE_URL=https://music.chobi.me` を追加する
- **不在・非公開 id は HTML も 404 にする**(現状の 200 + JS 案内から変更)。詳細 API・音源・画像の 404 と整合し、非公開に下げた曲は共有済みリンクも即座に死ぬ(opt-out の趣旨通り)。ページ内 JS の「曲が見つかりません」表示は、閲覧中に非公開化された等のフォールバックとして残る

### スコープ外

- 一覧 `/` の OGP 補強(`og:image` / `og:url`)— 曲の共有カードが本題。一覧用の画像(ロゴ or 最新曲カバー)を持たないと `og:image` を出せないため、必要になったら別途
- 曲別メタの SSR をこれ以上広げること(本文の SSR 化など)は不要。カード表示に必要なメタだけ注入する

### 検証ツールについて(チェック手段の記録)

- クローラーは JS を実行しない = **curl で見た HTML がそのままクローラーの見え方**。ローカル検証は curl で足りる
- 本番反映後の実地確認: https://www.opengraph.xyz/ 等のプレビューア、Discord / Slack / LINE に実リンクを貼る。X は Card Validator が実質廃止のためメタ確認 + 実投稿で代替。SNS 側はスクレイプ結果をキャッシュするので、貼り直しで更新されない場合がある(Facebook は Sharing Debugger で再スクレイプ可)
- Cloudflare は全パス Bypass(`cf-cache-status: DYNAMIC` 確認済み)なので、注入 HTML が旧内容でエッジに固まる心配は無い

## 影響範囲

- `server/src/config.ts` — `PUBLIC_BASE_URL` の追加
- `server/src/index.ts` — `GET /track/:id` をメタ注入 + 公開判定 404 に変更
- `server/site/track.html` — `<head>` の曲別メタをプレースホルダー化(静的な `og:type` 等は残す)
- `.env.example` — `PUBLIC_BASE_URL` を追記
- g3plus-ops の本番 `.env` — `PUBLIC_BASE_URL=https://music.chobi.me`(Phase 2。Dockerfile の変更は無し)
- `CLAUDE.md` — 公開ページ節に OGP 注入の記述を追記

## テスト方針

- `npm run typecheck`
- 隔離 DB テストサーバー(sqlite3 .backup + `daily_enabled=false`)で curl:
  - 公開中の id: 200 で `<title>` / `og:title` / `og:description`(= その曲の intro)/ `og:image`(絶対 URL)/ `og:url` が入ること
  - 曲名・intro に `&` `<` 等を含むケースの HTML エスケープ(実データに無ければ隔離 DB にダミー行を入れて確認)
  - 非公開に落とした id・不在 id・数字でない id: 404。非公開 → 再公開で 200 に戻ること
  - `og:image` の URL が実際に 200 で取れること(公開判定付き配信との整合)
- ブラウザ表示(ヘッドレス Chrome。モバイル幅は CDP の `Emulation.setDeviceMetricsOverride`)が従来と変わらないこと — メタ注入がページ描画を壊していないか
- 本番反映後: `curl https://music.chobi.me/track/<id>` でメタ確認 → opengraph.xyz / Discord 等でカード表示を実地確認

## Phase 分割

- [x] Phase 1: サーバー実装 — `PUBLIC_BASE_URL` + `/track/:id` の曲別メタ注入 + 不在・非公開 id の 404 + ローカル検証(2026-08-12 完了。隔離 DB で curl 検証 — メタ 5 種 + og:image の 200・HTML エスケープ・非公開/不在/非数字 id の 404・再公開で 200・ヘッドレス Chrome で描画無変化を確認)
- [x] Phase 2: 本番反映 — ops 側 `.env` に `PUBLIC_BASE_URL` を追加してデプロイ、SNS プレビューでの実地確認(2026-08-12 完了。本番 curl で曲別メタ・og:image の 200・404 系を確認し、Discord / Twitter / Facebook / Slack のクローラー UA でも HTML・画像とも 200(エッジで bot がブロックされない)。SNS への実投稿での見た目確認は任意で)
