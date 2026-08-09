# プリセットから楽器カテゴリを削除する

## 目的・背景

TODO「プリセットから楽器を削除するのを検討 — 他のプリセットのジャンルと喧嘩しそう」の検討と実施。

本番データ(music.chobi.me の API 経由で確認)による判断材料:

- **喧嘩の実例が既に出ている**: usedPresets が記録されている直近 2 曲は、どちらも楽器プリセットを 3〜4 個採用しており、「acoustic folk + rock」に synthesizer、「rock + orchestral」に synthesizer + trumpet など、ジャンルの編成と馴染まない組み合わせが実際に発生している。プールに提示されると LLM は各カテゴリから律儀に拾う傾向があり、楽器はジャンルという「編成をほぼ決める軸」と独立に選ばれるため衝突しやすい。「1 要素は普段と違うものを入れる」指示や冒険日がここに当たると、ムード・テンポのようなジャンル非依存の軸と違い、編成として成立しない組み合わせが出やすい
- **楽器の具体性は失われない**: 楽器プリセットが記録されていない曲でも style には「solo acoustic grand piano」「analog arpeggiated synthesizer lines」など LLM が自前で具体的な楽器を書いている。構造化出力スキーマの style 説明が楽器を含むよう指示しており、プールが無くてもジャンルに合う楽器を LLM が自由に選ぶ
- **評価の帰属がシャープになる**: 現状は 1 曲の 👍/👎 が最大 8 前後のプリセットに等分される。カテゴリが減るほど 1 要素あたりの帰属が濃くなる
- **いま失うものが無い**: 楽器プリセットの 👍/👎 集計は全て 0(プリセット投入は 2026-08-07 でデータが若い)。「サックスが好き」のような楽器単位の好み学習は失うが、これは音源解析によるプリセット自動追加(Gemini)タスクなど、実測ベースの仕組みで将来必要になれば再導入すればよい

**結論: 楽器(instrument)カテゴリを廃止する。**

## 対応方針

コード変更はサーバーのみ。管理画面(presets.js)と iOS(GenerationParamsView)はカテゴリを API 応答から動的に組み立てているため変更不要。API 形状も不変更(presets 配列から instrument 行が消え、categoryLabels から instrument キーが消えるだけ)で、旧アプリ×新サーバーは完全互換。

1. `server/src/presets.ts` — SEED_PRESETS から楽器 11 件と CATEGORY_LABELS の `instrument` を削除
2. `server/src/db.ts` — `deletePresetsByCategory(category)` ヘルパーを追加
3. `server/src/index.ts` — 起動時の一回限りマイグレーション(シード投入の直前)。既存 DB の instrument プリセットを削除し、実施済みを `settings` の `migration_drop_instrument_presets` に記録する(ユーザーが後から手動で instrument カテゴリを再追加した場合に再起動で消さないため一回限り。settings API は明示キーのみ返すためフラグは UI に漏れない)。`task_presets` のスナップショット・評価履歴は設計どおり残置
4. `llm.ts` は不変更 — SONG_PLAN_SCHEMA の style 説明「ジャンル・楽器・ムード・テンポ・ボーカルスタイルを…」は維持(楽器は LLM がジャンルに合わせて自由に書く)

## 影響範囲

- サーバー: `presets.ts` / `db.ts` / `index.ts`
- ドキュメント: `docs/specs/music-generation.md`(決定の記録 — 日付付き追記)、`docs/specs/music-generation-flow.md`(挙動の説明 — カテゴリ列挙の書き換え。SVG 3 枚は楽器の記載なしで不変更)、`TODO.md` の Gemini タスク(抽出対象から楽器を除外する注記)
- 管理画面・iOS: 変更なし(動的レンダリング)。CLAUDE.md はカテゴリ列挙が無く不変更
- 本番反映: サーバーデプロイのみ必須(デプロイ後の初回起動でマイグレーションが instrument 11 件を削除する)。アプリ再インストール不要

## テスト方針

- `npm run typecheck`
- 隔離 DB(`DB_PATH` 指定)で検証:
  - フレッシュ DB → シードに instrument が無い+マイグレーションフラグが立つ
  - instrument プリセット入りの DB(本番相当を再現)→ 初回起動で instrument 全削除+フラグ記録+他カテゴリ・task_presets 不変
  - フラグ記録後に instrument カテゴリを手動追加 → 再起動しても消えない(一回限りの確認)
- 隔離 DB サーバー(`daily_enabled=false`)で `/admin/api/presets`・`/admin/api/generation-params` に instrument が無いことを curl 確認+管理画面プリセットページをヘッドレス Chrome 目視
