# 実装プラン: 歌声の言語を設定で選べるようにし、既定を日本語にする(2026-08-11)

## 目的・背景

現在の生成は **英語歌詞 + 日本語訳(表示用)で固定**されている(`server/src/llm.ts` の出力スキーマ `lyrics` / `lyricsJa`)。
調査([docs/plans/archive/suno-japanese-vocals.md](archive/suno-japanese-vocals.md))で **Suno は日本語歌詞をそのまま受け取って日本語で歌う**ことを実測・聴取で確認したため、歌声の言語を設定項目にし、**既定を日本語に変える**。

参照曲は J-POP が中心になる想定で、日本語で歌う方が参照曲に寄る。英語で作りたい日もあるので設定で戻せるようにする。

## 決めたこと(設計判断)

### 1. `lyrics` / `lyricsJa` の意味

**`lyrics` = Suno に渡す原詞(選ばれた言語)/ `lyricsJa` = 日本語訳(原詞が日本語のときは無し)**。

- 既存データ(英語原詞 + 日本語訳)の意味は変わらない。カラムの移行が要らない
- `lyrics` が「Suno へ送る歌詞」であることは `generation.ts` の `prompt: plan.lyrics` と一致していて、意味がぶれない
- 日本語のときは `lyricsJa` を **LLM の出力スキーマから外す**(空文字列を書かせるより、項目ごと無くす方が明確)
- どちらの言語で書かれた歌詞かは `tasks.lyrics_lang` に記録する(旧データは NULL = 英語扱い)。表示・生成パラメータの記録用で、既存の `llm_model` / `model`(Suno モデル)と同じ位置づけ

### 2. iOS / 管理画面の EN/JA 切替表示

**コードの変更は不要**(既存ロジックがそのまま正しく振る舞う)。

- iOS(`TrackDetailView` / `FullPlayerView`)は `lyrics` と `lyricsJa` が**両方あるときだけ**切替セグメントを出す。日本語原詞では `lyricsJa` が nil なのでセグメントが消え、日本語歌詞だけが出る
- 管理画面(`app.js`)も `addSection` が空をスキップするので「日本語訳」の節が出ない
- セグメントのラベル(`English` / `日本語`)は英語原詞のときにしか現れないので、そのままでよい

### 3. 発音対策(表記ルール)

**軽いルールのみをプロンプトに入れる**。助詞「は」→「ワ」のような表記置換は**しない**。

- 置換すると Suno の読みは安定するが、**保存・表示される歌詞まで「私ワ 街エ」になる**。歌詞は読み物としてアプリに出るので、表示の自然さを優先する
- 実測(V5)で罠込みの歌詞を正しく歌えることを聴いて確認済み。強い対策を先回りで入れる必要が無い
- 入れるルール: 漢字かな交じりの自然な表記(全ひらがな禁止)/ 算用数字を使わない(「7時」ではなく「七時」)/ 読み間違えられやすい語は別の言い回しに置き換える
- 誤読が実際に目立ったら、そのときルールを足す

### 4. Suno モデル

**`SUNO_MODEL` の既定を `V5` → `V5_5` に上げる**。

- V5.5 で漢字の読み精度が大きく改善(調査の Step 1)。料金は同額で、kie.ai で有効な値であることも実測済み
- 英語生成にも影響するが、`.env` の `SUNO_MODEL` でいつでも戻せる

### 5. タイトルの言語

**歌詞の言語に寄せるが、強制しない**。日本語の曲でも英語タイトルは一般的なので、「日本語のタイトルを基本とし、英語のタイトルが自然ならそれでよい」という指示にする(無理に日本語にしない)。

## 非目標

- **ニュースのソース言語は変えない**(Google News 米国版・英語のまま)。2026-08-09 に「歌詞は英語で生成するため」英語版へ切り替えた経緯があるが、LLM は英語の見出しからテーマを汲んで日本語歌詞に落とせる。日本版に戻すかは実生成を見てから別タスクで判断する
- `style` は英語のまま(Suno のスタイルプロンプトは英語が前提)。日本語のときは `Japanese vocals` にあたる指定を style に含めさせる
- `realWorldWords` は英語小文字のまま(重複生成を防ぐキーであって、歌詞の言語とは無関係)
- 過去に生成した楽曲のデータ変換は行わない(`lyrics_lang` が NULL のものは英語扱い)

## 対応方針(Phase 構成)

### Phase 1: サーバー(設定・LLM・DB・API)

- `server/src/config.ts`: `SUNO_MODEL` の既定を `V5_5` に
- `server/src/llm.ts`:
  - `VOCAL_LANGUAGES = ["ja", "en"]` / `getVocalLanguage()` を追加(既定 `ja`。`settings` の `vocal_language` から生成のたびに読む — `llm_effort` と同じ流儀でキャッシュしない)
  - `SONG_PLAN_SCHEMA` を `songPlanSchema(lang)` に(日本語なら `lyricsJa` を properties / required から外し、`lyrics` と `title` の description を日本語向けに差し替える)
  - `SongPlan.lyricsJa` を optional に
  - `buildSongPlanPrompt(input, limits, lang)`: 「出力条件」節に歌詞の言語・表記ルール・style への `Japanese vocals` 指定を追加(純関数のまま。言語は `limits` と同じく `generateSongPlan` が読んで渡す)
- `server/src/db.ts`: `tasks.lyrics_lang` を `addColumnIfMissing` で追加。`updateTaskPlan` で保存し、`TrackWithTaskRow` / `TRACK_TASK_COLUMNS` に載せる
- `server/src/generation.ts`: `updateTaskPlan` に `lyricsLang` を渡す
- `server/src/index.ts`: `allSettings()` に `vocalLanguage`、`PUT /api/settings` に検証付きの受け口、`taskJson` / トラック JSON に `lyricsLang`、`GET /api/generation-params` に `vocalLanguage`

### Phase 2: Web 管理画面

- `server/public/settings.html`: 「曲の生成(LLM)」パネルに「歌声の言語」の select(日本語 / English)を追加
- `server/public/app.js`: 楽曲詳細の生成パラメータに「歌声の言語」を追加

### Phase 3: iOS アプリ

- `Models/APIModels.swift`: `ServerSettings` / `SettingsUpdateRequest` に `vocalLanguage`、`Track` に `lyricsLang`、`GenerationParams` に `vocalLanguage`
- `Views/SettingsView.swift`: 「曲の生成」セクションを追加して言語 Picker を置く
- `Views/GenerationParamsView.swift`: 「生成の設定」に歌声の言語を追加
- `Views/TrackDetailView.swift`: メタ情報に歌声の言語を追加
- 歌詞の表示・切替セグメントは変更しない(上記「決めたこと 2」)

### Phase 4: 実生成での確認とドキュメント

- 実際に日本語で 1 曲生成して、歌詞・タイトル・style・Suno への送信・アプリ表示を確認する
- `CLAUDE.md` / `docs/specs/music-generation.md` / `docs/specs/music-generation-flow.md` を更新
- `TODO.md` → `DONE.md`、プランを `docs/plans/archive/` へ

## 影響範囲

| 箇所 | 変更 |
|---|---|
| `server/src/config.ts` | `SUNO_MODEL` 既定 V5 → V5_5 |
| `server/src/llm.ts` | 言語設定の読み出し・スキーマの動的化・プロンプトの出力条件 |
| `server/src/db.ts` | `tasks.lyrics_lang` の追加(後方互換マイグレーション) |
| `server/src/generation.ts` | プラン保存に言語を渡す |
| `server/src/index.ts` | 設定 API・トラック/タスク JSON・生成パラメータ |
| `server/public/` | 設定ページ・楽曲詳細 |
| `ios/` | API モデル・設定画面・生成パラメータ画面・楽曲詳細 |
| ドキュメント | `CLAUDE.md` / spec 2 本 |

**互換性**: 旧 iOS アプリは増えたキーを無視するだけでデコードが通る(`ServerSettings` に未知キーが増えても Decodable は無視する)。新アプリ+旧サーバーの組み合わせは `vocalLanguage` が欠けるため、iOS 側は optional で受けてフォールバックする。

## テスト方針

- `npm run typecheck` / iOS シミュレータビルドを Phase ごとに
- **隔離 DB のテストサーバー**(`DB_PATH` を分け、`daily_enabled=false`)で:
  - 既存 DB を開いて `lyrics_lang` が追加されること、旧タスクが NULL のままであること
  - `GET /api/settings` の既定が `vocalLanguage: "ja"`、`PUT` で `en` / 不正値(400)を確認
  - `buildSongPlanPrompt()` の出力を ja / en それぞれで目視(出力条件の節が言語で切り替わること)
- **実生成**: 日本語で 1 曲(参照曲は J-POP)。歌詞が日本語・`lyricsJa` が空・style に日本語ボーカル指定・固有名詞の混入なし・Suno が受理することを確認。英語に戻して 1 曲も確認する
- 管理画面はヘッドレス Chrome で設定ページと楽曲詳細を目視
- iOS は UI テスト(設定画面の言語 Picker)+ シミュレータのスクリーンショット

## 実施結果(2026-08-11)

すべて実施し、プランどおりに動いた。

- **サーバー**: `npm run typecheck` 通過。隔離 DB(本番 DB を `sqlite3 .backup` で複製・`daily_enabled=false`)で `tasks.lyrics_lang` が追加され旧 5 タスクが NULL のままであること、`GET /api/settings` の既定が `vocalLanguage: "ja"` / `sunoModel: "V5_5"`、`PUT` で `en` に切り替わり不正値が 400、`GET /api/generation-params` に `vocalLanguage` が乗ることを確認
- **プロンプト**: `buildSongPlanPrompt()` を ja / en で突き合わせ。ja では「歌詞の言語: 日本語」「日本語の表記」「style に日本語ボーカル指定」の 3 行が増え、インストの注記も `lyrics は空文字列`(en は `lyrics / lyricsJa`)に切り替わる。設定が不正値・未設定なら `ja` にフォールバック
- **実生成 2 曲**(kie.ai。クレジット 516 → 492):
  - **日本語**(YOASOBI「Biri-Biri (English Version)」参照)→ タイトル「震える光」・`lyricsLang=ja`・`lyricsJa` は NULL・歌詞は漢字かな交じりの日本語(算用数字なし、セクションタグは英語のまま)・style 末尾に `natural Japanese pronunciation, Japanese vocals`・固有名詞の混入なし・Suno(V5_5)が受理して完了
  - **英語**(設定を `en` に戻して生成)→ タイトル「Between the Tremors」・`lyricsLang=en`・英語歌詞+日本語訳あり。回帰なし
- **管理画面**: 設定ページに「歌声の言語」(既定 日本語)と Suno モデル `V5_5` が出ること、楽曲詳細の生成パラメータに「歌声の言語: 日本語」が出ること、日本語原詞の曲だけ「日本語訳」の節が出ないこと(DOM 上の節数 7 = API で `lyricsJa` を持つ曲数 7)を確認
- **iOS**: シミュレータビルド + UI テスト 8 件成功。設定画面の「曲の生成 > 歌声の言語」、生成パラメータ画面の「歌声の言語」、楽曲詳細のメタ情報(`2026-08-11 16:12 生成 · おまかせ生成 · 日本語歌唱 · V5_5 · claude-sonnet-5`)、日本語原詞では EN/JA 切替セグメントが出ず歌詞だけが出ることをスクリーンショットで確認
- **副産物**: `ScreenshotUITests` がフルスイート実行時にだけ落ちるようになった。原因は本機能ではなく既存の脆さで、生成プロンプトの折りたたみをタップする座標がミニプレイヤーに当たってフルプレイヤーのシートが開き、以降の操作がすべてシートに吸われていた(テスト自身のコメントが警告していた罠)。シートを閉じる処理を `dismissPlayerSheet()` に切り出し、①プロンプトのタップ後 ②タブへ移る前 に開いていたら閉じるようにした
