# プロンプト生成で web_search を使って外部情報を積極的に参照する

## 目的・背景

現状 `llm.ts` は `tools` 無しの Claude API 呼び出しで、参照曲について LLM に渡しているのは登録時に iTunes から取った 5 項目(アーティスト・曲名・アルバム・リリース年・ジャンル)だけ。曲を知らなければ「アーティストの一般的な作風からの推定」で書かせている。

**問題は「知らない」ことではなく「知っているつもりで外す」こと**。実測で確認した:

| | 生成した style の記述 | 実際 |
|---|---|---|
| 検索なし(task 8、既存実装) | `mid-tempo 138 BPM shuffle groove` — intent には「**この曲を知っている前提で踏襲した**」 | — |
| 検索あり(今回の実測 2 回) | `91-92 BPM` / `92 BPM`(Tunebat・Musicstax・SongBPM で一致) | **約 92 BPM** |

同じ参照曲(OFFICIAL HIGE DANDISM「Pretender」)で、検索なしの生成はテンポを約 1.5 倍に外したうえで、それを「知っている」と申告した。ユーザーが intent を読んでも誤りに気づけない。web_search で実際の曲情報を調べてから style を書かせる方式に切り替える。

## Phase 0: 事前実測(完了)

`claude-sonnet-5` + `web_search_20260209` + `output_config.format` を実際に叩いて確認した(2026-08-09)。**この結果が以下の設計を決めている**。

| 確認項目 | 結果 |
|---|---|
| **構造化出力と併用できるか** | **できる**。`output_config.format`(json_schema)と server tool `web_search` を同時に指定して `stop_reason: end_turn`、JSON パースも成功。400 にならない |
| **所要時間** | **192.2 秒**(本番と同じスキーマ = 歌詞・訳込み)。style/title/intent だけの軽いスキーマでも 95.1 秒。現状は 44.4 秒 |
| **トークン量** | 入力 **123,899** / 出力 11,086 / `web_search_requests` 5。現状の入力は 1,041 文字(約 700 トークン)なので **入力が約 200 倍** |
| **1 曲あたりのコスト** | 約 **$0.36**(Sonnet 5 の導入価格 $2/$10 per MTok。標準価格なら約 $0.54)+ 検索リクエスト 5 件分。現状は約 $0.04 |
| **`pause_turn`** | 2 回とも発生せず(1 ラウンドで完了)。ただし内部では server tool を 12〜14 回呼んでいるので、`max_uses` を増やせば起こりうる → **実装はしておく** |
| **`code_execution` ブロック** | 応答に `code_execution_tool_result` が混ざる。`_20260209` の動的フィルタリングが内部で使うもので、**`code_execution` を別途宣言してはいけない**(実行環境が 2 つになりモデルが混乱する) |
| **固有名詞の混入** | 2 回とも **なし**。検索結果には「Official髭男dism」「Pretender」が大量に入るが、style / title / lyrics には出なかった |
| **同名異曲** | 掴まなかった。Tunebat / ufret / Shazam / Wikipedia いずれも正しい曲 |
| **出典の申告** | intent で「Tunebat の楽曲データで確認済み」と「この曲を知っている経験則からの推定」を**書き分けた** |

### 実測が決めたこと

**192 秒は本番で通らない**。本番はエッジが Cloudflare で約 100 秒でプロキシがタイムアウトする(この制約は `DONE.md` の「毎日の自動生成 3 曲」の項に既に記録がある)。iOS 側の timeout 180 秒も超える。よって **生成の非同期化が前提条件**になる。

## 対応方針

### 検索を有効にする条件 = `referenceSong` の有無

モード名(`mode === "artist"`)ではなく **参照曲が指定されているかどうか**で判定する。

- 検索して意味があるのは「実在の曲」が指定されたときだけ。daily は既に「今日のコンテキスト」(ニュース)があり、manual はユーザーの自由記述なので、調べる対象が無い
- 現状 `referenceSong` が入るのは artist モードだけだが、`TODO.md` の別項目「毎日作成をアーティストと曲から選択して生成するのに変更」が入れば daily でも参照曲が付く。そのとき**自動的に検索が有効になる**
- コストも手動トリガ時に限定される(1 日 3 曲の自動生成に掛けると月 $30 程度の追加になる)

### Phase 1: 生成の非同期化(スキーマ変更なし)

`POST /api/generate` が LLM 完了まで待つのをやめ、**先に task 行を作って即座に返す**。

```
現状:  POST /api/generate ─→ LLM 192s ─→ Suno 送信 ─→ createTask ─→ 201
                              ✗ Cloudflare 100s で 524

変更後: POST /api/generate ─→ createTask(PLANNING) ─→ 201 即返却
                                    ↓ バックグラウンド
                              LLM ─→ Suno 送信 ─→ provider_task_id を埋めて PENDING
```

**スキーマ変更はしない**。`tasks.provider_task_id` は `TEXT NOT NULL` だが、Suno 送信前は空文字列を入れて `status = 'PLANNING'` で区別する。

- `db.createTask()`: `providerTaskId` と `status` を省略可能にする(既定は現状どおり)
- `db.listActiveTasks()`: `PLANNING` を除外する — **ポーラーが `sunoClient.getTask("")` を叩かないようにするため**
- `db.updateTaskPlan(id, {...})` を新設: LLM 完了後に style / lyrics / title / intent / llm_prompt を埋める
- `db.attachProviderTask(id, providerTaskId)`: Suno 送信後に ID を埋めて `PENDING` にする
- LLM か Suno が失敗したら `updateTaskStatus(id, 'FAILED', err)`。**エラーが握り潰されず必ずタスクに残る**
- 起動時に `PLANNING` のまま残っているタスクを `FAILED` にする(LLM 呼び出しは再開できないため)
- `generation.ts` に `runGeneration(taskId, input)` を新設し、`index.ts` は `void runGeneration(...)` で投げっぱなしにする

**スケジューラ(`runDaily`)は同期のまま**。サーバー内で動くので Cloudflare を経由せず、タイムアウトの制約が無い。`POST /api/daily/run`(管理画面と iOS のおまかせ生成ボタン)は参照曲が無いため 44 秒のままで、今回は変更しない。

### Phase 2: web_search の導入(`llm.ts`)

```ts
// referenceSong があるときだけ検索を有効にする
const tools = input.referenceSong
  ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 5 }]
  : undefined;
```

- **`pause_turn` ループを実装する**(server tool がサーバー側の反復上限に達したときの再送。実測では出なかったが `max_uses` 次第で起こる)。再送は「同じ user メッセージ + 直前の assistant 応答」を送るだけで、`Continue.` のような追加メッセージは付けない
- **検索エラーは例外にならない**。HTTP 200 で `web_search_tool_result.content` がエラーオブジェクト(配列ではない)で返る。検索できなくても従来どおり推定で書けるので、**警告ログのみで続行する**
- `firstText()` は `content.find(b => b.type === "text")` なので `server_tool_use` / `web_search_tool_result` / `code_execution_tool_result` が混ざっても壊れない(確認済み・変更不要)
- プロンプトの「作り方(厳守)」を書き換える:
  - まず web_search で音楽的特徴(BPM・キー・コード進行・楽器編成・ボーカルの音域と質感・プロダクション)を調べる
  - **同名異曲を掴まないよう、渡したアーティスト・アルバム・リリース年と一致することを確認する**
  - 固有名詞の禁止は現状の指示をそのまま維持する(検索結果に固有名詞が大量に入るため、むしろ重要度が上がる)
  - intent には「検索で確認 / 曲を知っている / 作風からの推定」を**項目ごとに書き分ける**

`properNounsIn()` による混入チェックと 1 回だけの再生成は**そのまま維持する**。実測 2 回では混入しなかったが、n=2 では判断できないので運用で観測する。

### Phase 3: 出典の記録と表示

`intent` に根拠を書かせるだけでは、どのサイトを見たのかが残らない。

- `SONG_PLAN_SCHEMA` に `sources: string[]` を追加(参照した情報源の URL またはタイトル。検索していなければ空配列)
- `tasks` に `llm_sources TEXT`(JSON 配列)を追加(既存の `addColumnIfMissing` パターン。後方互換)
- `GET /api/tracks` / `GET /api/tasks` の応答に `sources` を追加(**追加のみで既存キーの形状は不変** → 旧アプリ × 新サーバーは互換)
- 管理画面の楽曲詳細と iOS の楽曲詳細に「参照した情報源」として表示する

### Phase 4: クライアント対応

- 管理画面 `app.js` の `STATUS_LABELS` に `PLANNING`(「曲を考えています…」)を追加
- iOS `GenerationTask.statusLabel` / `progressFraction` に `PLANNING` を追加。`isActive` は `!= COMPLETE && != FAILED` なので変更不要
- iOS の生成 POST は待たなくてよくなるので `timeout: 180` を既定に戻す
- `ArtistSongsView` / `SongSearchView` の「AI がスタイルと歌詞を作っています…」は、送信完了までの短い表示に変わる(進行状況は生成タブが引き継ぐ)

**旧アプリ × 新サーバー**: iOS の `statusLabel` は `default: status` なので `PLANNING` が生のまま出る(表示が英語になるだけで機能は壊れない)。実機の再インストールで解消する。

### Phase 5: ドキュメント更新と総合検証

- `docs/specs/music-generation.md`: 非目標「Web 検索・音源解析による参照曲の特徴補強」の記述を**決定の記録に書き換える**(Phase 0 の実測値を含めて)
- `docs/specs/music-generation-flow.md`: 生成フローの図と入力表を非同期化・検索ありに更新
- `CLAUDE.md`: `llm.ts` の説明と生成フローの記述を更新
- `TODO` → `DONE` 移動 + プランを `docs/plans/archive/` へ

## 影響範囲

- **`POST /api/generate` の応答が変わる**: 従来は Suno 送信済み(`status: PENDING`、`provider_task_id` あり)の task を返していたが、これからは `PLANNING` の task を返す。応答の**キーの形状は不変**で `status` の値が増えるだけなので、旧アプリでもデコードは通る
- **DB スキーマ**: `tasks.llm_sources` の 1 カラム追加のみ(Phase 3)。非同期化自体はスキーマ変更なし
- **`scheduler.ts` は不変更**(サーバー内実行なのでタイムアウト制約が無い)
- **daily / manual の生成内容は変わらない**(検索は `referenceSong` があるときだけ)
- 評価学習(👍/👎 のプリセット集計)・リアルワード制限には触れない

## 非目標(今回はやらない)

- 検索結果の `artist_songs` へのキャッシュ(同じ曲で再生成するときに検索を省く。効果は大きいが、非同期化でタイムアウト問題が解けたあとに、実際の再生成頻度を見てから判断する)
- daily / manual への検索の拡大
- `POST /api/daily/run` の非同期化(参照曲が付いていないので現状 44 秒。「毎日作成を曲から選択」が入るときに一緒にやる)
- 音源そのものの解析(Gemini 等)

## テスト方針

**サーバー(隔離 DB + curl)** — `sqlite3 .backup` で複製し `daily_enabled=false`、ポート 3015 で起動する。

1. 非同期化: `POST /api/generate` が **1 秒以内**に 201 を返し、`status: PLANNING` であること
2. `GET /api/tasks` をポーリングして `PLANNING` → `PENDING` → `COMPLETE` と遷移すること
3. LLM が失敗したときにタスクが `FAILED` になり `error` にメッセージが入ること(不正な API キーで再現)
4. `PLANNING` のタスクをポーラーが叩かないこと(`getTask("")` のエラーがログに出ないこと)
5. サーバー再起動で `PLANNING` のまま残ったタスクが `FAILED` になること
6. 検索の有効条件: `artistSongId` 無しの生成(manual)で `web_search_requests` が 0 であること
7. 通しの実生成 1 曲(参照曲あり)— style に具体的な BPM・キーが入り、`sources` が記録され、style / title / 歌詞に固有名詞が無いこと
8. `npm run typecheck`

**管理画面** — ヘッドレス Chrome の CDP 操作で、生成ボタン → 即座に進行状況カードが「曲を考えています…」で出ること、楽曲詳細に出典が出ることを目視。

**iOS** — シミュレータビルド + 既存 UI テストに回帰が無いこと。生成タブの進行状況に `PLANNING` が日本語で出ることを確認。サーバーは同じ隔離 DB(ポート 3014)。

**コストの上限** — 実生成は検証全体で 2 曲まで(1 曲あたり約 $0.36 + Suno 12 クレジット)。

## 実施結果(2026-08-09)

全 Phase 完了。テスト方針の全項目を実施した。

| # | 検証 | 結果 |
|---|---|---|
| 1 | `POST /api/generate` の即返却 | **0.005〜0.008 秒**で 201 / `status: PLANNING`(従来 44 秒) |
| 2 | 状態遷移 | `PLANNING` → `PENDING` → `TEXT_SUCCESS` → `FIRST_SUCCESS` → `COMPLETE` |
| 3 | LLM 失敗の記録 | 無効な API キーでタスクが `FAILED` になり `error` に 401 の本文が入る。管理画面の進行中カードにも赤字で出る |
| 4 | ポーラーが `PLANNING` を叩かない | ポーリングエラー 0 件 |
| 5 | 再起動時の後始末 | `PLANNING` のまま残った 1 件が「サーバー再起動により中断されました」で `FAILED` |
| 6 | 参照曲なしは検索しない | manual の生成が `sources: 0` 件で完了し、`[llm] web_search で…` のログも出ない |
| 7 | 通しの実生成(参照曲あり) | `92 BPM felt as double-time 184 pulse, key of A-flat major` — **検索で確認した事実が style に入った**。`sources` に songbpm.com の URL 2 件、intent は根拠を書き分け(「songbpm.com の検索結果で確認」/「この曲を知っている記憶に基づく」)。**固有名詞の混入なし**。2:57 の曲が COMPLETE |
| 8 | `npm run typecheck` | 通過 |

**管理画面** — 進行中カードに「曲を考えています…」+ アーティストバッジ、楽曲詳細に「参照した情報源」が URL 2 件で表示されることをヘッドレス Chrome の CDP 操作で確認。

**iOS** — シミュレータビルド + UI テスト 9 件すべて成功。楽曲詳細に「参照した情報源」が出ることをスクリーンショットで確認。

### 想定と違ったこと

- **実生成は 192 秒ではなく約 255 秒かかった**(Phase 0 の実測より遅い)。ログでは server tool の呼び出しが 20 回(実測時は 12〜14 回)で、検索の深さは実行ごとにぶれる。非同期化していなければ本番では確実にタイムアウトしていた
- **`ScreenshotUITests` が 1 度失敗した**。楽曲詳細に「参照した情報源」を足したことで画面が縦に伸び、`app.swipeUp()` 1 回では `detail.prompt` がミニプレイヤーの下に隠れたまま残り、そこへの `tap()` が座標としてミニプレイヤーに当たってフルプレイヤーのシートが開き、以降の操作がすべてシートに吸われていた。**製品側の不具合ではなくテストの前提の脆さ**なので、押せるようになるまでスクロールする形に直した(`git stash` で変更を外すと成功することを確認して切り分けた)
