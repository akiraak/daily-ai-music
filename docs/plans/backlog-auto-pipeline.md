# BACKLOG 自動運用パイプライン(設計)

> **このプランは設計のみ**(2026-08-13 の TODO「BACKLOG.md の自動更新とどのタスクを実行するかの決定方法とコードを修正してコミットからデプロイまでの流れを設計する(実装はしない)」)。
> 実装は本プランを親にした別タスク(`TODO.md` の「BACKLOG 自動運用パイプラインの実装」)で Phase ごとに行う。

## 目的・背景

`/logs`(2026-08-13 導入)で「本番ログ → トリアージ → `BACKLOG.md` に修正項目」までは 1 コマンドになったが、

- `/logs` の起動は手動(気が向いたときにしか回らず、毎日生成の失敗に気づくのが遅れる)
- BACKLOG に溜まった項目の**どれをやるかの決め方**が無い(毎回その場の判断)
- 修正 → コミット → 本番反映は毎回人が段取りしている(push → ssh で pull/build/up → 外形確認 → BACKLOG の `[x]` 化。工程が多く、押し忘れ・確認漏れの余地がある)

このループを「**毎朝 BACKLOG が自動更新され、人は選定の承認だけすれば修正から本番反映まで一気通貫で流れる**」状態にする設計。部品は 3 つ:

- **A. BACKLOG.md の自動更新** — `/logs` の無人定期実行
- **B. 実行タスクの決定方法** — BACKLOG 項目の分類と選定ルール
- **C. 修正 → コミット → デプロイの流れ** — 新スキル `/backlog` + デプロイスクリプト

[docs/plans/archive/log-analysis-command.md](archive/log-analysis-command.md) では定期実行を見送った。当時の理由と今回の解消方法:

| 当時の見送り理由 | 今回の解消 |
|---|---|
| 原因の当たり付けはコード読解で、人が見ながらが安全 | 無人時は「迷う判定を書き込まない」に倒す(下記 A)。書くのは確信できる判定だけ |
| 本番 secret が Mac にしかなく無人実行の環境が要る | クラウドではなく **Mac の launchd** で回す。secret・ssh 鍵の参照は既存の `fetch-logs.sh` のまま |
| ログ量が少なく毎日回す価値がない | `/logs` は新規・再発ゼロなら 1 行サマリで即終了する設計になったので、毎日回してもコストは僅か。毎日生成の失敗(= 曲が欠ける)を同日中に拾える価値が上回る |

## 全体像

```
毎朝 07:30 PT (launchd)
  └─ scripts/auto-logs.sh → claude -p "/logs" (無人)
       └─ BACKLOG.md / docs/error-triage.md 更新 + コミット
            └─ 変更・要確認があれば macOS 通知 ──┐
                                                  ▼
                                        人がセッションを開き /backlog
  ┌───────────────────────────────────────────────┘
  ▼
選定(B のルール)→ プラン作成・コミット → [承認ゲート] → 実装 → 検証
  → 実装コミット → push → scripts/deploy.sh(前チェック → pull/build/up → 後チェック)
  → 変更固有の外形確認 → BACKLOG [x]・プラン archive・g3plus-ops の workflow doc 追記 → 報告

翌朝の A が再発を監視(修正日以降に同 fingerprint が出たら「再発」で再オープン)
  = パイプライン自体が自己検証ループになる
```

## A. BACKLOG.md の自動更新(`/logs` の無人定期実行)

### 決めたこと

| 論点 | 決定 |
|---|---|
| 実行主体 | **Mac の launchd**(plist 例: `com.akiraak.daily-ai-music.auto-logs`)。クラウドのスケジュールエージェントは `g3plus.lan` に到達できず本番 secret も無いため不可 |
| 頻度・時刻 | **毎日 07:30 PT**。毎日生成は 06:00 開始・3 曲逐次(1 曲 LLM 3〜4.5 分 + Suno 数分)で 07:00 過ぎには終わり、失敗時の 30 分後再試行も 1 巡している時間。当日の生成失敗を同日中に拾える |
| 起動方法 | wrapper `scripts/auto-logs.sh`(新規)が `cd` してから `claude -p "/logs"` を headless 実行。timeout を掛け、実行ログを `.logs/auto/` に残す |
| 通知 | BACKLOG・台帳に変更があったとき、要確認(下記)があるとき、実行自体が失敗したときだけ `osascript` で macOS 通知。変更ゼロの日は無音 |
| 権限 | `--dangerously-skip-permissions` は使わない。project `.claude/settings.json` の allowlist に必要コマンド(`scripts/fetch-logs.sh` / `git add·commit` / 読み取り系)を足して通す |
| 無人時の「迷う判定」 | SKILL.md の「迷うものだけユーザーへ確認」は無人では成立しない → **無人実行では迷うものを台帳・BACKLOG に書かず、通知(要確認)に回す**。台帳に無いままなので次回も「新規」として再提示され続け、人がセッションで判断するまで取りこぼさない |
| `--local` | 無人実行は常に本番(既存ルールどおり。台帳を汚さない) |

### 変更対象(実装時)

- `scripts/auto-logs.sh` 新規 + launchd plist(Mac ローカル。リポジトリには plist の雛形とセットアップ手順を置く)
- `.claude/skills/logs/SKILL.md` に「無人実行時の挙動」を 1 節追記(迷う判定は書き込まない・通知に回す)
- `.claude/settings.json` の allowlist 追記

## B. どのタスクを実行するかの決定方法

### 対象と原則

- 対象は **`BACKLOG.md` の未チェック項目だけ**。`TODO.md` は人の管理領域なので、このパイプラインは読みも書きもしない
- **1 回の実行で 1 項目だけ**。デプロイ単位を最小に保ち、翌朝の再発検知(fingerprint 単位)がどの修正の結果か曖昧にならないようにする

### 分類(2 軸)

**軸 1: 影響度**

| クラス | 内容 | 例 |
|---|---|---|
| A | 曲が欠ける・毎日生成が止まる・サービス停止 | Suno の style 語彙拒否、Anthropic クレジット切れ |
| B | 誤データ・サーバーとアプリの契約ずれ | `decode_failed` の反復 |
| C | ノイズ削減・運用改善 | iOS `-999` の報告除外 |

**軸 2: 自動実行可否** — 以下を**すべて**満たす項目だけが自動実行可:

1. 対策が項目内に**一意に**書かれている(「対策候補」が複数ある・「検討」を含む項目は人の意思決定が要る → 選定せず提示のみ)
2. 変更が `server/` か `ios/` の**片方に閉じる**
3. DB 変更なし、または冪等な `ADD COLUMN` のみ(既存行を書き換える 1 回だけの移行を伴うものは不可 = DB バックアップという人の工程が要る)
4. `.env`・Dockerfile・Cloudflare 設定・g3plus-ops 側の変更を伴わない

### 選定ルール

1. 未チェック項目を分類する
2. 自動実行可の中から**影響度の高い順(A > B > C)**、同率は**古い順**(BACKLOG は追記順)に 1 件選ぶ
3. 自動実行不可の項目は「人の判断待ち」として選定結果と一緒に列挙する(放置で埋もれるのを防ぐ)

### iOS 項目の特例

iOS の修正は**コミットまで**(検証はシミュレータビルド)。「デプロイ」に相当する実機への再インストール(`run-ios-device.sh`、iPhone の接続が要る)は物理的に無人化できないため人の工程として報告に残す。BACKLOG の `[x]` 化は実機反映後(人が確認してから)。

### 現 BACKLOG 3 件に当てはめると

| 項目 | 分類 | 扱い |
|---|---|---|
| Suno style 語彙拒否 | 影響度 A・対策候補 3 つ | 自動選定不可 → 承認ゲートで**人が対策を選ぶ**(選べば以降は自動) |
| iOS `-999` 報告除外 | 影響度 C・対策一意・iOS | 自動実行可 → コミットまで自動、実機反映は人 |
| サーバー再起動による生成中断 | 検討系 | 人の判断待ち。ただし対策候補の片方(デプロイ前に進行中タスク確認)は本設計の `deploy.sh` 前チェックが標準装備として吸収する |

## C. 修正 → コミット → デプロイの流れ(新スキル `/backlog`)

`.claude/skills/backlog/SKILL.md`(新規)。手順:

1. **選定**: B のルールで 1 件選び、分類・根拠・「人の判断待ち」項目の一覧を提示
2. **プラン作成**: 作業着手ルールどおり `docs/plans/<name>.md` を作りコミット(BACKLOG 項目は `TODO.md` に入れない既存ルールのまま。プランと実装はコミットを分ける既存ルールも維持)
3. **承認ゲート**: モード 1(下記)ではここで人の GO を待つ。対策候補が複数の項目は必ずここで人が選ぶ
4. **実装 → 検証**: `npm run typecheck` / ローカル起動して `/health`(iOS 変更ならシミュレータビルド)→ 実装コミット
5. **push**: ★ デプロイは g3plus 上での GitHub からの `git pull` 経由なので **push が必須**。現行の CLAUDE.md コミットルールに無い工程なので、実装時に CLAUDE.md へ「本番反映するときは push まで行う」を明文化する
6. **デプロイ**: `scripts/deploy.sh`(下記)
7. **変更固有の外形確認**: プランに書いた確認項目を実施(例: 修正対象のエンドポイントの応答)
8. **後片付け**: BACKLOG を `[x]` 化・プランを `docs/plans/archive/` へ・**g3plus-ops の `docs/workflows/daily-ai-music.md` に変更節を追記して g3plus-ops 側もコミット**(デプロイ内容の記録は従来からこのドキュメントに集約されているため)
9. **報告**: 選定理由・修正内容・デプロイ結果・残る人の工程(iOS 実機反映など)。再発監視は翌朝の A が自動で行う

### `scripts/deploy.sh` の設計(新規)

置き場は daily-ai-music の `scripts/`(`fetch-logs.sh` と同じく、secret・ssh 鍵は `~/Projects/g3plus-ops/daily-ai-music/.env` と `~/.ssh/id_rsa_nopass` を参照するパターン)。

**前チェック(1 つでも落ちたら中断して理由を表示):**

1. working tree が clean で、`main` が `origin/main` に push 済み
2. **進行中タスクなし**: `GET /api/tasks` で status が `COMPLETE` / `FAILED` 以外(`PLANNING` / `PENDING` / `TEXT_SUCCESS` / `FIRST_SUCCESS` / `SUCCESS` = `server/src/db.ts` の `TERMINAL_STATUSES` 以外)のタスクが 0 件。あればポーリングで待つ(上限 15 分、超えたら中断)。**BACKLOG「サーバー再起動による生成中断」の運用側対策をここで機械化する**
3. 時間帯ガード: **PT 06:00〜07:30 は実行しない**(毎日生成 + 失敗再試行のウィンドウ)。`--force` で明示的に上書き可
4. 差分ガード: 前回デプロイ済みコミットとの差分に「`server/` 直下の新ディレクトリ(Dockerfile の COPY 追従が要る)」「`.env.example` の変更(本番 .env の追従が要る)」が無いか。あれば中断して人へ(このクラスは B の自動実行可条件で弾かれているはずの二重チェック)

**本体**(既存の通常フローのまま):

```
ssh: cd /home/ubuntu/daily-ai-music && git pull --ff-only
     → docker tag daily-ai-music-daily-ai-music:latest …:prev   # ロールバック用
     → docker compose --project-directory …/g3plus-ops/daily-ai-music build
     → up -d
```

**後チェック**: `/health` が 200・secret 付き `/api/ping` が 200・`docker logs --tail` にクラッシュ痕なし。失敗したら `:prev` イメージで戻して(compose の image 差し替えではなく `docker tag` で latest に戻して `up -d`)通知。

**ロールバックの正道**は `git revert` → 再デプロイ(履歴に残る)。`:prev` は即時退避用。

## 運転モード(段階導入)

| モード | A(BACKLOG 更新) | B〜C(選定〜デプロイ) | 移行条件 |
|---|---|---|---|
| 0(現状) | 手動 `/logs` | 全手動 | — |
| **1(まずここへ)** | **無人・毎朝** | 人が `/backlog` を起動。**プラン承認ゲートあり**、以降デプロイまで自動 | Phase 1・2 実装後 |
| 2(慣熟後) | 無人・毎朝 | 自動実行可クラスは承認ゲートなしで A の後続として無人実行(結果通知のみ)。それ以外は従来どおり承認待ち | モード 1 で誤修正ゼロの実績が溜まってから。**導入は別途判断**(自動でモード 2 に上げない) |

## リスクと対策

| リスク | 対策 |
|---|---|
| 誤った修正が本番に出る | 1 項目 1 デプロイ・typecheck / 起動検証・後チェックで即 `:prev` ロールバック・翌朝の A が再発検知(自己検証ループ) |
| 生成中の再起動で曲が失われる | 前チェック 2(進行中タスク 0 件)+ 時間帯ガード |
| デプロイ契約(Dockerfile / .env)とのずれ | B の自動実行可条件 4 + deploy.sh の差分ガードの二重チェック。該当したら人へ |
| 無人 `/logs` が台帳・BACKLOG を汚す | 迷う判定は書かない・`--local` 禁止・書き込みは従来どおり BACKLOG と台帳の 2 ファイルに限定(TODO.md に触らない) |
| launchd 不発(スリープ・Mac 不在) | launchd は起床時に追い実行する。実行失敗は通知。1 日空いても次回の `/logs` が 90 日分を見るので取りこぼしは無い |
| headless Claude の暴走・ハング | wrapper の timeout・allowlist 運用(skip-permissions を使わない) |
| クレジットの意図しない消費 | パイプラインが叩く API は `/api/errors` 系・`/api/tasks`・`/health`・`/api/ping` のみ(生成 API は呼ばない)。LLM 消費は `/logs`・`/backlog` セッション自体の Claude 利用分だけ |

## 見送り(今回やらないこと)

- **GitHub Actions 等の CI/CD**: g3plus は LAN 内で、secret・ssh 鍵を外部に出す必要が生じる。単独開発の規模に過剰。Mac からの ssh フローを機械化するに留める
- **クラウドのスケジュールエージェントでの実行**: `g3plus.lan` に到達できず secret も無い
- **モード 2 を最初から**: 承認ゲート付きの実績を見てから別途判断
- **BACKLOG の優先度を LLM に自由裁量で決めさせる**: 選定は上記の決定的ルール(影響度 → 追記順)に固定し、判断の揺れをなくす

## 実装 Phase(実装は本タスクの範囲外。着手時に TODO へ子タスク展開)

- **Phase 1 — A の実装**: `scripts/auto-logs.sh` + launchd plist(雛形と手順)+ `/logs` SKILL の無人対応 + allowlist
- **Phase 2 — C の実装**: `scripts/deploy.sh` + `.claude/skills/backlog/SKILL.md`(B の選定ルールはこの SKILL に記載)+ CLAUDE.md へ push ルールと `/backlog` の明文化 + g3plus-ops workflow doc への参照追記
- **Phase 3 — モード 2**: 無承認クラスの無人実行(導入判断は実績を見て別途)

## 影響範囲・テスト方針

- 影響はすべて追加(`scripts/` 2 本・スキル 1 本・SKILL 追記・launchd は Mac ローカル)。**サーバーコード・DB・API の変更は無い**
- テスト: Phase 1 は launchd を待たず `scripts/auto-logs.sh` の手動起動で無人挙動(迷う判定を書かない・通知)を確認。Phase 2 の `deploy.sh` は前チェックのみの `--dry-run` を先に作り、初回はドキュメント修正など無害な差分で通しで流す
