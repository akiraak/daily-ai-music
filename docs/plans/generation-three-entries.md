# 生成を 3 種類にする(おまかせ / アーティストでおまかせ / 曲から生成)

作成: 2026-08-12

## 目的・背景

2026-08-12 の UI 再構築([archive/generation-ui-restructure.md](archive/generation-ui-restructure.md))で生成の経路は「おまかせ / 曲を選んで生成」の 2 本になったが、「このアーティストの曲でつくりたい。曲までは指定しなくていい」という中間の粒度が無い — 現状は参照曲タブで曲一覧を開いて自分で 1 曲選ぶしかない。生成の入口を次の 3 種類にし、生成タブの見た目も 3 つが同格に見えるよう変更する。

1. **おまかせ** — AI がアーティストと曲を選ぶ(既存の daily 経路。今日のニュースも入る)
2. **アーティストでおまかせ** — 人がアーティストを選び、曲はサーバーが選ぶ(新設)
3. **曲から生成** — 人が曲まで選ぶ(既存の「曲を選んで生成」の改名)

## 対応方針

### サーバー: `POST /api/generate` に `artistId` を追加(アーティストでおまかせ)

- body を `{ artistSongId }` **または** `{ artistId }` のどちらか一方にする(両方・どちらも無しは 400)
- `artistId` のときの選曲は **daily の 2 段階選択の「曲を LRU」だけを流用** — `reference.ts` に `selectReferenceSongForArtist(artistId)` を追加し、有効な曲(`listCandidates()`)をそのアーティストで絞って `oldestGroup` + ランダムで 1 曲選ぶ。選択規則が daily と同じなので「同じアーティストで連続しても違う曲になり、一巡する」が自動で成り立つ
- アーティスト不在は 404、有効な曲が 0 件は 409(LLM を呼ぶ前に弾くのでクレジットは消えない)
- 選曲後は既存の `artistSongId` 経路と完全に同じ(`mode: "artist"`・参照曲スナップショット・タスク表示は「<アーティスト>「<曲名>」風」)。**今日のコンテキスト(ニュース)は入れない** — 人が起点の生成には注入しない既存方針のまま
- 新しい mode 値は増やさない(受付後の処理は artist 経路と同一で、区別する表示要件も無いため)

### iOS: 生成タブを「3 つの同格の入口」に再構成

- ヒーロー(おまかせだけ大きい)をやめ、**3 経路を同じ形の大きめの行**(丸地アイコン + 太字タイトル + 説明 + 右端の合図)で縦に並べる。見た目の規則: 押すとすぐ生成に進むもの(おまかせ)は sparkles、画面が開くものは chevron
  - **おまかせ**(sparkles アイコン): 行タップ → 確認ダイアログ → `POST /api/daily/run`。ボタン即実行から確認ダイアログ式に変える(3 行を同じ操作感にするため + 誤タップ課金の防止)
  - **アーティストでおまかせ**(music.mic アイコン): 新画面 `ArtistPickerView` へ push — `GET /api/artists` を有効曲 > 0 で絞った一覧(名前 + 有効 N 曲)。タップ → 確認 → `POST /api/generate { artistId }` → 閉じて戻る
  - **曲から生成**(music.note アイコン): 既存 `SongPickerView` へ push。行と画面の名前を「曲を選んで生成」→「曲から生成」に改名(中身は不変。「登録済みにない曲を探す」もそのまま)
- 生成パラメータ行・進行状況・クレジットピルは現状のまま
- 参照曲タブ・管理画面は変更しない(管理画面は「おまかせ生成」ボタンと参照曲ページの「この曲で生成」で 2 経路が既にある。アーティストでおまかせの追従は必要になったら別途)

### スコープ外

- Web 管理画面への「アーティストでおまかせ」追加
- アーティスト経由生成への今日のコンテキスト注入(既存方針のまま)
- 新しい mode 値・タスク表示の出し分け

## 影響範囲

- `server/src/reference.ts` — `selectReferenceSongForArtist()` の追加
- `server/src/index.ts` — `POST /api/generate` の `artistId` 受付
- `ios/.../Views/GenerateView.swift` — 3 経路の行 + おまかせの確認ダイアログ
- `ios/.../Views/ArtistPickerView.swift` — 新規(アーティストでおまかせ)
- `ios/.../Views/SongPickerView.swift` — 「曲から生成」への改名
- `ios/.../Models/APIModels.swift` — `GenerateRequest` の artistId 対応
- `ios/DailyAIMusicUITests/GenerateUITests.swift` — 3 経路の表示・ダイアログの確認(実行はしない)
- `CLAUDE.md` — 画面構成・API の記述更新

## テスト方針

実生成はコストが掛かるため行わない。`POST /api/generate` の成功経路は **ANTHROPIC_API_KEY を無効値で上書きした隔離サーバー**で受付(201 + タスクの参照曲スナップショット)だけを確認する(バックグラウンドの LLM は即失敗して FAILED になり、費用ゼロ)。

- `npm run typecheck`
- node で `selectReferenceSongForArtist()` の単体確認(有効曲のみ・LRU・0 件で undefined)
- 隔離 DB サーバーで `POST /api/generate` — `artistId` 201(選ばれた曲が有効 + そのアーティストの LRU)・両方指定 400・どちらも無し 400・不在アーティスト 404・有効 0 件 409・既存 `artistSongId` 経路の回帰
- iOS: シミュレータビルド + GenerateUITests(3 経路の行・おまかせ確認ダイアログ・アーティスト選択画面。生成は実行しない)+ スクリーンショット目視

## Phase 分割

- [x] Phase 1: サーバー — `artistId` 受付と選曲(2026-08-12 完了。隔離 DB + 無効 API キーで 201/400/404/409 と LRU(1 曲目使用後は別の曲が選ばれる)・バックグラウンドが費用ゼロで FAILED になることを確認)
- [ ] Phase 2: iOS — 生成タブの 3 経路化・`ArtistPickerView`・改名(+ UI テスト)
- [ ] 後片付け — CLAUDE.md 更新・本番反映 TODO への追記・プランの archive 移動
