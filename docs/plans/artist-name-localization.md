# アーティスト名を日本語表記で表示する

## 目的・背景

参照曲のアーティスト名が iOS・管理画面のすべての画面で英語表記になる(米津玄師 → "Kenshi Yonezu"、クイーン → "Queen")。日本のユーザーには日本語表記(JP ストアの表示名)で見せたい。

## 調査結果(2026-08-13)

### 原因

`artists.name` は iTunes lookup 応答の **artist 行(`wrapperType: "artist"`)の `artistName`** から採っている(`itunes.ts` の `fetchSongs()` → `index.ts` の登録 2 経路)。この artist 行の `artistName` は **`country=JP` でも `lang=ja_jp` でもローカライズされず、常に正式表記(ローマ字)** で返る。curl で実測済み:

| 応答の行 | `artistName` | 備考 |
|---|---|---|
| artist 行(lookup / search とも) | `Kenshi Yonezu` / `Queen` | `lang=ja_jp` を付けても変わらない(実測) |
| track 行(`country=JP`) | `米津玄師` / `クイーン & デヴィッド・ボウイ` | ローカライズ済みだがコラボ連名が混ざる |
| artist 行の `artistLinkUrl` | `…/jp/artist/%E7%B1%B3%E6%B4%A5%E7%8E%84%E5%B8%AB/530814268` | **slug が JP ストア表示名**(米津玄師・クイーン) |

日本語名の取得元は 2 候補あり、**artist 行の `artistLinkUrl` の slug をデコードする方式が確実**:

- **slug 方式(採用)**: `decodeURIComponent()` で「米津玄師」「クイーン」がそのまま取れる。lookup・search どちらの artist 行にもあり、追加リクエスト不要。ただし表示名が ASCII のアーティストは slug が小文字化される(DAOKO → `daoko`)ため、**デコード結果が非 ASCII を含むときだけ日本語名として採用**し、それ以外は従来の正式表記を使う

  slug の追加の制約(2026-08-13 実測):

  | 表示名(JP ストア) | slug のデコード結果 | 対応 |
  |---|---|---|
  | フレディ・マーキュリー / デヴィッド・ボウイ | `フレディ-マーキュリー`(中黒・空白が `-` になる) | **カタカナに挟まれた `-` は `・` に戻す**(この文脈の `-` はほぼ中黒・空白由来のため) |
  | Official髭男dism | `official髭男dism`(ASCII 部分が小文字化) | そのまま採用(非 ASCII を含むので採用対象。小文字化は許容 — ローマ字正式表記よりは近い) |
  | ずっと真夜中でいいのに。 | `ずっと真夜中でいいのに`(末尾の記号が落ちる) | そのまま採用(許容) |
- track 行方式(不採用): コラボ連名(「クイーン & アダム・ランバート」)が混ざり、単独名の行を選ぶロジックが要る割に、本人単独の track が JP ストアに無いと取れない

### 単純に `artists.name` を置き換えられない理由(現行コードの意図)

`index.ts` の登録コード(曲名からの登録)に明記されている通り、正式表記の保存は意図的:

1. **二重登録の防止**: アーティスト名検索経路(`searchArtists` の候補 = 正式表記)と名前が食い違うと、同じアーティストが「Kenshi Yonezu」と「米津玄師」で 2 行できる
2. **`properNounsIn()`(llm.ts)の混入チェック**: Suno はプロンプト内のアーティスト名をモデレーションで弾くため、送信前に参照アーティスト名の混入を検査している。LLM に渡す名前と DB の名前が一致している必要がある
3. **LLM の web_search**: `referenceArtist` として英語正式表記を渡しており、検索の安定性はこちらが上

→ **`artists.name`(正式表記)は同一性・LLM 用としてそのまま残し、表示用の日本語名を別カラムで持つ**。

## 対応方針

`artists` テーブルに `name_ja TEXT`(NULL 可)を追加し、表示だけ `name_ja ?? name` に切り替える。

1. **itunes.ts**: artist 行の `artistLinkUrl` から slug をデコードするヘルパーを追加。`fetchSongs()` の戻り値に `artistNameJa: string | null`(非 ASCII を含むときだけ値、それ以外 null)を追加。`searchArtists()` の候補にも表示用 `nameJa` を足す(登録前の候補一覧も日本語で見せるため。登録用の `name` は従来どおり正式表記)
2. **db.ts**: `artists.name_ja` カラム追加(`addColumnIfMissing`)。`createArtist` で保存。同一性判定(`getArtistByName` / UNIQUE)は従来どおり `name` のみ
3. **index.ts**:
   - 登録 2 経路(`POST /api/artists` / `POST /api/artist-songs`)で `name_ja` を保存
   - `POST /api/artists/:id/refresh` で `name_ja` を更新(既存アーティストの追い付き経路を兼ねる)
   - `artistJson()` 等の API レスポンスに `nameJa` を追加(`name` は従来どおり)。クライアント表示は `nameJa ?? name`
   - 生成時のスナップショット `tasks.ref_artist_name` は「表示用」なので `name_ja ?? name` を入れる(LLM へ渡す `referenceSong.artist` は従来どおり `name`)
4. **llm.ts**: `properNounsIn()` は従来の `name` チェックを維持。LLM 入力は英語名のみなので日本語名の混入リスクは低いが、念のため `name_ja` も検査対象に足す(任意・低コスト)
5. **表示側**: 管理画面 `artists.html` / iOS(参照曲タブ・アーティストの曲一覧・アーティストでおまかせ・曲から生成・生成パラメータ・楽曲詳細のリファレンス)を `nameJa ?? name` に
6. **既存データの backfill**: 登録済みアーティストを lookup し直して `name_ja` を埋める一括スクリプト(`src/scripts/backfill-artist-name-ja.ts`。逐次 + レート制限約 20 req/分に配慮、`--dry-run` 対応。backfill-intro.ts と同型)。件数が少ないうちは refresh でも代替可

### 検討したが採らない案

- `lang=ja_jp` パラメータ: artist 行には効かない(実測)
- `artists.name` をローカライズ名で上書き: 上記「置き換えられない理由」の 1〜3 が壊れる

## 影響範囲

- サーバー: `itunes.ts` / `db.ts`(カラム追加)/ `index.ts`(登録・refresh・JSON)/ `llm.ts`(任意)/ `scheduler.ts`(ログ・prompt ラベルの表示名)
- クライアント: 管理画面 `artists.html`、iOS の参照曲・生成まわりの各画面(表示のみ、`nameJa ?? name` へのフォールバック付きなので旧サーバーとの互換も保たれる)
- DB: `artists.name_ja` 追加のみ(既存行は NULL = 従来表示)。破壊的変更なし
- 過去タスクの `ref_artist_name` は英語のまま残る(スナップショットなので許容)

## テスト方針

- `itunes.ts` の slug デコード: 米津玄師(日本語 slug)・Queen(クイーン)・DAOKO(ASCII slug → null)を実 API で確認
- 登録 → 一覧表示(管理画面・iOS)で日本語名が出ること、`name` 検索経路の二重登録防止が壊れていないこと
- refresh で既存アーティストに `name_ja` が付くこと
- 生成 1 回通し(曲から生成)で `ref_artist_name` に日本語名が入り、LLM への入力・`properNounsIn` は英語名のままであること
- `npm run typecheck` + iOS シミュレータビルド

## Phase 分割

- Phase 1: サーバー(itunes.ts / db.ts / index.ts / backfill スクリプト)+ 管理画面
- Phase 2: iOS 表示(`nameJa ?? name`)
