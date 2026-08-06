# Suno 連携方式の調査結果(2026-08-06)

## 結論(推奨方針)

1. **Suno 公式 API の早期アクセスに応募する**(無料・ダメ元)。ただし提供時期未定のため当てにしない
2. **当面の実装はサードパーティ API(第一候補: sunoapi.org)** を使う。API キー(Bearer)認証で、毎日の自動生成にも耐える
3. バックエンドでは Suno 連携を **`SunoClient` 的なインターフェースで抽象化**し、公式 API が出たら差し替えられるようにする
4. Cookie ベースの非公式 OSS(gcui-art/suno-api)は BAN リスクと運用の脆さから**自動生成用途には非推奨**
5. MCP サーバは**アプリのバックエンド連携には不要**(開発時に Claude Code から曲生成を試す用途では有用)

## 1. 公式 API の可否

- **2026-08 時点で公式の公開 API は存在しない**。OpenAI のようなセルフサーブの API キー発行は無い
- 2026-07-01、CPO の Jack Brody が LinkedIn で **開発者 API の検討開始**を発表。「curated group of partners」から始めるとして、早期アクセス応募用の **Typeform の intake form** を公開(Brody の LinkedIn 投稿経由でアクセス)
- 公開時期・料金・セルフサーブポータルは未発表。8月時点で承認パートナーの公表も無し
- 出典: [Music Business Worldwide](https://www.musicbusinessworldwide.com/suno-explores-developer-api-seeking-apps-that-unlock-experiences-generative-music-makes-possible-for-the-first-time/) / [Digital Music News](https://www.digitalmusicnews.com/2026/07/03/suno-is-opening-an-api-partner-program/)

## 2. MCP サーバ

公式 MCP サーバは無い。コミュニティ製は複数あり、いずれも**サードパーティ API のラッパー**。

- **[AceDataCloud/SunoMCP](https://github.com/AceDataCloud/SunoMCP)**(最有力): 生成・歌詞・拡張・カバー・ペルソナ・MP4/WAV/MIDI 変換など 30+ ツール。AceDataCloud の API を Bearer トークンで利用。ホスト版(`https://suno.mcp.acedata.cloud/mcp`)と ローカル版(`pip install mcp-suno`、Python 3.10+、Docker あり)
- その他: [Roo の Suno Music Generator](https://www.pulsemcp.com/servers/suno-music-generator)、[CodeKeanu/suno-mcp](https://github.com/CodeKeanu/suno-mcp) 等

**評価**: MCP はエージェント(Claude 等)から使うためのプロトコルなので、iOS アプリ → バックエンドの本番経路には不適。本番は REST API を直接叩く。開発中に Claude Code から生成を実験する用途なら AceDataCloud/SunoMCP が使える。

## 3. サードパーティ API / 非公式 OSS

### sunoapi.org(第一候補)

- 認証: **API キー(`Authorization: Bearer`)**。管理画面でキー発行
- 機能: 生成 / 延長 / カバー / ボーカル・インスト分離 / アップロード。**V4〜V5.5 対応**。コールバック(webhook)通知あり、20 秒でストリーミング出力開始を謳う
- 料金: **$5 / 1,000 クレジット〜**(1 生成 ≈ 10 クレジット前後 = 数円〜十数円)。毎日 1 リクエスト(通常 2 曲生成)なら**月数百円以下**
- 99.9% アップタイムを謳う。[kie.ai](https://kie.ai) と同一インフラとの分析あり
- ドキュメント: https://docs.sunoapi.org/

### その他のプロバイダ

[PiAPI](https://piapi.ai/suno-v5)、[302.AI](https://302.ai/product/detail/suno-suno-v5)、[musicapi.ai](https://musicapi.ai/suno-api)、[Apiframe](https://apiframe.ai/suno-api-for-ai-music-generation)、AI/ML API、useapi.net、Crazyrouter(OpenAI 互換エンドポイント)など多数。どれも API キー制で機能はほぼ同等(バックは同じ Suno モデル)。障害時の乗り換え先として控えておく。

### gcui-art/suno-api(非推奨)

- [OSS](https://github.com/gcui-art/suno-api)。自分の Suno アカウントの **ブラウザ Cookie** を使ってリバースエンジニアリングした API を叩く。追加費用なし(自分の Suno サブスクのクレジットを消費)
- ただし: Cookie/Clerk の仕様変更で度々壊れる(2026 年 1 月にも認証系 issue 多数)、CAPTCHA 回避に 2Captcha + Playwright が必要、**Suno ToS 違反でアカウント BAN のリスク**。README 自体が「学習・研究用」と明記
- 毎日の無人自動生成に使うには運用が脆すぎる

### 共通の注意点

サードパーティ API はいずれも Suno 非公認(アカウントプール/リバースエンジニアリング)。公式 API の登場や Suno 側の対策で**将来使えなくなる可能性がある**前提で、連携層を抽象化しておくこと。

## バックエンド設計への示唆

- 生成は非同期(数十秒〜数分)。**リクエスト → task_id → コールバック or ポーリングで完了検知 → audio URL 取得** の流れになるため、バックエンドにジョブ管理(生成タスクの状態遷移)が必要
- 生成された audio URL はプロバイダ側ストレージにあるため、**自前ストレージ(S3 等)へのダウンロード保存**を前提にする(プロバイダ乗り換え・リンク切れ対策)
- API キーは環境変数 / `.secrets/` で管理し、コミットしない
