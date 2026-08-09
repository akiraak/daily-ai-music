# 使用プリセットの保存と評価による優先度付け+プロファイル文書の廃止

## 目的・背景

現状、どのプリセットが曲に使われたかはタスクに記録されておらず、`llm_prompt`・`style` から推定するしかない。また評価(👍/👎)の反映先が好みプロファイル文書(LLM が育てるテキスト)だけで、プリセット(要素プール)の側には何もフィードバックされない。

**方針転換(2026-08-08)**: 当初はプリセットとプロファイルの役割分離(プリセット次元はプリセット側・細部はプロファイル側)を検討したが、**好みの管理をプリセット側の評価集計に一本化し、プロファイル文書は一度廃止する**。理由: 好みの表現をデータ(プリセット+集計)に寄せた方が挙動が追跡・制御しやすく、LLM が育てる自由文書は中身の妥当性を検証しにくい。プリセットで表せない細部の好みが必要になったら、役割を絞った形で将来復活を検討する。

対応は次の 3 点。

1. **使用プリセットの記録**: LLM の構造化出力に「採用したプリセット」を追加し、タスク単位で保存する
2. **評価による優先度付け**: プリセット別の 👍/👎 集計を毎日の自動生成プロンプトに注入し、👍 の多い要素を優先・👎 の多い要素を回避させる。以後、評価の反映先はこれのみ
3. **プロファイル文書の廃止**: 生成プロンプトへの注入・毎朝の更新 LLM コール・API・管理画面の閲覧パネルを削除する(DB のテーブルと過去データは残す)

## 対応方針(決定事項)

### 1. LLM 出力への採用プリセット追加

- `SONG_PLAN_SCHEMA` に `usedPresets` を追加(required):
  - `{ category: string, value: string }` の配列
  - description で「プロンプトに提示されたプリセットの `[category]` と value を一字一句そのまま写す。プールに無い独自要素は含めない」と指示する
- サーバー側で `presets` テーブルと照合して解決する(category は完全一致、value は trim + 小文字化で比較)。一致しないものは**保存せず警告ログのみ**(LLM の写し間違い・独自要素は捨てる)
- モード別の扱い:
  - **daily / daily_adventure**: LLM 出力を照合して記録(プールを提示しているので正確に写せる)
  - **manual**: ユーザーが選んだ `selectedPresets` を必ず記録し、LLM 出力の照合結果と**和集合**を取る(自由テキスト経由でプリセットと一致する要素が使われた場合も拾える。manual のプロンプトにはプールを出さないので LLM 出力は当てにしすぎない)
- 過去タスクへの遡及推定は行わない(集計はこの変更以降の生成分から効き始める)

### 2. 保存: `task_presets` テーブル(新規)

```sql
CREATE TABLE IF NOT EXISTS task_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  preset_id INTEGER,           -- 集計用。プリセット削除後も行は残す(参照強制なし。既存テーブルと同じ緩さ)
  category TEXT NOT NULL,      -- 使用時点のスナップショット(プリセットが編集・削除されても表示できる)
  value TEXT NOT NULL,
  label_ja TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_task_presets_task ON task_presets(task_id);
```

- 挿入前に preset_id で重複除去(manual の和集合で二重になり得るため)
- 集計は preset_id ベース(編集で意味が変わるケースは割り切る。削除済みプリセットは集計対象から自然に外れる)

### 3. 評価集計のプロンプト注入

- 集計クエリ(全期間。1 日 1 曲ペースで評価は疎なのでウィンドウは切らない。直近重み付けは将来の拡張):

```sql
SELECT tp.preset_id,
       SUM(CASE WHEN tr.rating = 1  THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN tr.rating = -1 THEN 1 ELSE 0 END) AS down
FROM task_presets tp JOIN tracks tr ON tr.task_id = tp.task_id
WHERE tr.rating IS NOT NULL AND tp.preset_id IS NOT NULL
GROUP BY tp.preset_id
```

- `buildSongPlanPrompt` の要素プール行に併記する(👍/👎 とも 0 の要素は無印のまま):
  `- [genre] jazz(ジャズ)👍 3 / 👎 1`
- プロファイル廃止後は**この集計が好みの唯一の表現**になるため、プールのセクション見出しを「評価(👍/👎 の集計)を踏まえて自由に選ぶ」に改める。モード別の指示:
  - **daily**: 「👍/👎 はその要素を使った曲への評価。👍 の多い要素を優先し、👎 の多い要素は避ける」を追記。既存の「1 要素だけは普段と違うものを入れる」ルールは維持し、「普段」の基準は 👍 集計上位と読み替える(優先に従いすぎてマンネリ化しないよう明記)
  - **daily_adventure**: 集計は表示するが「冒険日は評価集計に従わなくてよい(むしろ未評価・低評価の要素への挑戦も歓迎)」と明記(現行の「プロファイルに無い要素を大胆に」は「普段選ばれない要素を大胆に」へ書き換え)
  - **manual**: 注入しない(ユーザー指定が最優先。集計で誘導しない)
- 優先度は保存値を持たず毎回クエリで算出する(ステートレス。評価変更が次の生成に即反映)

### 4. プロファイル文書の廃止

- **生成側**: `buildSongPlanPrompt` / `SongPlanInput` から `profile` を削除(プロファイルセクションを出さない)。呼び出し元(`index.ts` の `/generate`、`scheduler.ts`)からも渡さない
- **更新側**: `runDaily` の手順 1(プロファイル更新)を削除し、`llm.ts` の `updateProfile` と `db.ts` の `listRatedTracks` を削除(他に用途なし)。毎朝の LLM コールが 1 回減る
- **API**: `GET /api/profile` を削除。`POST /api/daily/run` の応答から `profileUpdated` を削除
- **管理画面**: index.html のプロファイルパネル(`profile-panel`)と app.js の `loadProfile` を削除
- **iOS**: `DailyRunResponse` から `profileUpdated` を削除(non-optional デコードのためサーバー変更と同時に行い、実機アプリを再インストールする。サーバー更新〜再インストールの間は旧ビルドのおまかせ生成が失敗するが、利用者は開発者本人のみなので許容)
- **DB**: `profile` テーブルと過去データは削除しない(履歴として無害。将来「プリセットで表せない細部」用に復活の余地)。`tracks.rated_at` カラムも残す(集計・表示で使い得る)
- **移行期の注意**: 廃止直後は `task_presets` の集計もまだ無いため、好みの信号が無い状態から再スタートになる(評価が溜まるにつれ効き始める)。直近スタイルの重複回避・今日のコンテキスト・冒険日は従来どおり働く。これを緩和するため **Phase 1(記録)→ 評価を数日分溜めてから Phase 3(廃止)** の順で進めても良いが、一気に進めても壊れはしない

### 5. API・管理画面・iOS への露出

- `taskJson` / `trackJson` に `usedPresets: [{category, value, labelJa}]` を追加(realWorldWords と同様にタスク単位で引く)
- `GET /api/presets` の各プリセットに `upCount` / `downCount` を追加(iOS 既存コードは未知キーを無視するので後方互換)
- 管理画面:
  - `app.js` 楽曲詳細に「使用プリセット」セクション(`[カテゴリ] 表示名` の列挙。リアルワードの隣)
  - `presets.js` のプリセット表に 👍/👎 列
- iOS 楽曲詳細への使用プリセット表示は任意 Phase(モデルは optional デコードで後方互換)

### 6. 生成プロンプトの分かりやすい表示(管理画面+iOS)

生成に使用した LLM への入力全文(`llm_prompt`)を、管理画面・iOS の両方で読みやすく表示する。

- 現状: 管理画面は「LLM への入力全文」として生テキストを `<pre>` 一発で表示していて読みにくい。iOS は `llmPrompt` を取得すらしていない(モデルに無い)
- `llm_prompt` は `buildSongPlanPrompt` が `## 見出し` 付きセクションを `\n\n` で連結した自家製フォーマットなので、**クライアント側で `## ` 行を境にセクション分解して表示する**(サーバー変更不要 — `taskJson`/`trackJson` は既に `llmPrompt` を返している)。分解できない場合(`## ` が無い旧データ等)は従来どおり全文表示にフォールバック
- **管理画面(app.js)**: 「LLM への入力全文」の単一 `<pre>` を、セクションごとの小見出し+本文の表示に置き換える(折りたたみ `<details>` 内は現状踏襲)。検証リトライで追記される「## 再生成の指示(厳守)」も 1 セクションとして自然に表示される
- **iOS**: `Track` モデルに `llmPrompt: String?` を追加(optional デコードで旧データ・旧サーバーと後方互換)し、楽曲詳細に折りたたみ(DisclosureGroup、既定は閉)で「生成プロンプト」セクションを追加。セクション見出し+本文で整形表示し、`llmPrompt` が無い旧データではセクションごと出さない
- セクション分解のルールは両クライアントで同じ(行頭 `## ` を見出しとする。フォーマットは `buildSongPlanPrompt` の管理下なのでこの単純規則で足りる)

## 影響範囲

- `server/src/llm.ts` — スキーマ・`SongPlan`・`SongPlanInput`(profile 削除)・`buildSongPlanPrompt`(集計併記+モード別指示+プロファイルセクション削除)・`updateProfile` 削除
- `server/src/db.ts` — `task_presets` テーブル+insert/list/集計関数、`listPresets` の集計 join(または別関数)、`listRatedTracks` 削除
- `server/src/generation.ts` — `startGeneration` で usedPresets の解決・保存(realWorldWords と同様の位置)
- `server/src/scheduler.ts` — `runDaily` からプロファイル更新手順を削除、`profileUpdated` を返さない
- `server/src/index.ts` — `/generate` の profile 受け渡し削除、`GET /profile` 削除、`taskJson`/`trackJson`/presets API の応答拡張
- `server/public/index.html` / `app.js` — プロファイルパネル削除、楽曲詳細に使用プリセット表示+LLM 入力全文のセクション分解表示
- `server/public/presets.js` — 集計列追加
- `ios/DailyAIMusic/Sources/Models/APIModels.swift` — `DailyRunResponse.profileUpdated` 削除、`Track` に `llmPrompt` 追加(+任意 Phase で usedPresets)
- `ios/DailyAIMusic/Sources/Views/TrackDetailView.swift` — 生成プロンプトの折りたたみ表示(+任意 Phase で使用プリセット表示)
- 完了時に `docs/specs/music-generation.md`(決定の記録: 評価の反映方式の変更)と `CLAUDE.md` の現状説明(「評価がプロファイルに反映され」の箇所)を更新する

## Phase 構成

- **Phase 1: 使用プリセットの記録** — スキーマに `usedPresets` 追加、照合・`task_presets` 保存、`taskJson`/`trackJson` に露出、管理画面の楽曲詳細に表示
- **Phase 2: 評価集計の優先度付け** — 集計クエリ、プール行への 👍/👎 併記+モード別指示、`GET /api/presets` に集計、presets 管理ページに集計列
- **Phase 3: プロファイル文書の廃止** — 生成プロンプト・`runDaily`・`updateProfile`・API・管理画面パネル・iOS `profileUpdated` の削除(DB テーブルは残す)。実機アプリ再インストール
- **Phase 4: 生成プロンプトの分かりやすい表示** — 管理画面の「LLM への入力全文」をセクション分解表示に置き換え、iOS の `Track` に `llmPrompt` を追加して楽曲詳細に折りたたみで整形表示(プロンプト構成が確定する Phase 2〜3 の後に実施)
- **Phase 5(任意): iOS 楽曲詳細に使用プリセット表示**
- 完了時: spec・CLAUDE.md 更新・TODO → DONE・本プランをアーカイブ

## テスト方針

サーバーにテストフレームワークは無いので、typecheck +スクリプト検証+実画面確認で行う。

1. `npm run typecheck`
2. **プロンプト組み立て**(API 呼び出し不要): scratchpad のスクリプトから `buildSongPlanPrompt` を直接呼び、集計併記・モード別指示・manual 非注入・プロファイルセクションが無いことを出力目視で確認(純関数として分離してある)
3. **LLM 出力の写し精度**(Claude API のみ、Suno に送らない): scratchpad から `generateSongPlan` を daily モードで 1 回呼び、`usedPresets` がプールの値を正確に写しているか・照合が通るかを確認(数円)
4. **DB**: サーバー起動で `task_presets` 作成を確認。sqlite3 でダミーの task_presets + rating を入れ、集計がプロンプトと presets API に出ることを確認
5. **管理画面**: ヘッドレス Chrome スクショで楽曲詳細の使用プリセット・LLM 入力のセクション分解表示(`## ` 無し旧データのフォールバック含む)・presets ページの集計列・プロファイルパネルが消えたことを目視(狭幅指定は 500px 以上)
6. **iOS**: シミュレータビルド+既存 UI テストで `/daily/run` 応答のデコード(profileUpdated 削除後)とおまかせ生成画面を確認。楽曲詳細の生成プロンプト表示は ScreenshotUITests にスクショを追加してライト/ダーク目視(`llmPrompt` 無し旧データで出ないことも確認)
7. **通し確認**: 管理画面の生成ボタン(/daily/run)で 1 曲生成し、usedPresets の保存〜表示を実データで確認(12 クレジット消費。実施タイミングは要相談)
