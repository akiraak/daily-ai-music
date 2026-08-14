# BACKLOG 自動運用パイプライン(設計)

> **このプランは設計のみ**(2026-08-13 の TODO「BACKLOG.md の自動更新とどのタスクを実行するかの決定方法とコードを修正してコミットからデプロイまでの流れを設計する(実装はしない)」)。
> 実装は本プランを親にした別タスク(`TODO.md` の「BACKLOG 自動運用パイプラインの実装」)で Phase ごとに行う。
>
> **2026-08-13 改訂**: 初版はデプロイを「Mac からの ssh 一括スクリプト(push 型)」で設計したが(初版: 688d2fb)、
> デプロイ先とデプロイ情報の正本が **g3plus-ops リポジトリ**に集まっていること、そこに既に
> **pull 型自動更新の家内規約**(`esltext/auto-update.sh`・`minecraft/auto-update.sh` + host crontab)が
> あることを踏まえ、**デプロイの脚をサーバー側 pull 型(g3plus-ops 主導)に変更**した。
> Mac は「正しいコミットを git に積むまで」に純化し、push = デプロイになる。

## 目的・背景

`/logs`(2026-08-13 導入)で「本番ログ → トリアージ → `BACKLOG.md` に修正項目」までは 1 コマンドになったが、

- `/logs` の起動は手動(気が向いたときにしか回らず、毎日生成の失敗に気づくのが遅れる)
- BACKLOG に溜まった項目の**どれをやるかの決め方**が無い(毎回その場の判断)
- 修正 → コミット → 本番反映は毎回人が段取りしている(push → ssh で pull/build/up → 外形確認 → BACKLOG の `[x]` 化。工程が多く、押し忘れ・確認漏れの余地がある)

このループを「**毎朝 BACKLOG が自動更新され、人は選定の承認だけすれば、修正は push した時点で本番まで自動で流れる**」状態にする設計。

[docs/plans/archive/log-analysis-command.md](archive/log-analysis-command.md) では `/logs` の定期実行を見送った。当時の理由と今回の解消方法:

| 当時の見送り理由 | 今回の解消 |
|---|---|
| 原因の当たり付けはコード読解で、人が見ながらが安全 | 無人時は「迷う判定を書き込まない」に倒す(下記 A)。書くのは確信できる判定だけ |
| 本番 secret が Mac にしかなく無人実行の環境が要る | 解析はクラウドではなく **Mac の launchd** で回す。secret・ssh 鍵の参照は既存の `fetch-logs.sh` のまま |
| ログ量が少なく毎日回す価値がない | `/logs` は新規・再発ゼロなら 1 行サマリで即終了する設計になったので、毎日回してもコストは僅か。毎日生成の失敗(= 曲が欠ける)を同日中に拾える価値が上回る |

## 環境と役割分担

一般解(解析 = ログが集まる場所 / 修正 = 再現可能な環境 / デプロイ = git 駆動で人のマシンに依存しない)を、この家の実態に写像する。

| 環境 | 役割 | 根拠 |
|---|---|---|
| **Mac(開発機)** | ログ解析(`/logs` 無人実行)と選定・修正・検証・コミット・**push まで** | 判断にリポジトリのコード読解と Claude Code が要る。本番 secret・ssh 鍵の参照も既存の `fetch-logs.sh` 経路のまま |
| **GitHub(akiraak/daily-ai-music、public)** | 唯一の正。**push = デプロイトリガ** | サーバーは public リポジトリを鍵なしで fetch できる |
| **g3plus-ops リポジトリ** | デプロイ機構の正本(`daily-ai-music/auto-update.sh`・crontab 定義・手順書)。サーバーへは既存規約どおり scp 配布 | デプロイ先情報(compose / Dockerfile / .env / workflow doc)が既にここに集約。`esltext` / `minecraft` の auto-update.sh と同じ置き方 |
| **g3plus サーバー** | **デプロイの実行主体(pull 型)**。cron が新コミットを検知して自前でチェック → pull → build → up → 検証 | 家内規約(esltext: 15 分おき cron)の拡張。本番 `API_SECRET` は `/home/ubuntu/g3plus-ops/daily-ai-music/.env` に既にあり、自分の `/api/tasks` を叩ける |

初版の「Mac から ssh で pull/build/up を叩く deploy.sh」は**廃止**(見送りへ)。Mac が寝ていても・不在でもデプロイは動き、逆に止まって困る度合いが低い解析だけが Mac に残る。

## 全体像

```
毎朝 07:30 PT (Mac launchd)
  └─ scripts/auto-logs.sh → claude -p "/logs" (無人)
       └─ BACKLOG.md / docs/error-triage.md 更新 + コミット
            └─ 変更・要確認があれば macOS 通知 ──┐
                                                  ▼
                                        人がセッションを開き /backlog
  ┌───────────────────────────────────────────────┘
  ▼
選定(B)→ プラン作成・コミット → [承認ゲート] → 実装 → 検証 → 実装コミット → push ──┐
                                                                                      ▼
g3plus (host cron, 5 分おき)                                                     GitHub main
  └─ g3plus-ops/daily-ai-music/auto-update.sh (pull 型)◄─────────────────────────┘
       新コミット検知 → 前チェック(進行中タスク 0 件・時間帯・差分ガード・hold 無し)
       → pull → :prev タグ → build → up -d → /health 検証(失敗なら :prev へ戻す)
                  │
  Mac の /backlog は /health の commit SHA を監視して反映を確認 → 変更固有の外形確認
  → BACKLOG [x]・プラン archive → 報告

翌朝の A が再発を監視(修正日以降に同 fingerprint が出たら「再発」で再オープン)
+ fetch-logs.sh が auto-update.log も取得し、デプロイの失敗・hold を /logs が報告
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
| デプロイ側の監視(改訂で追加) | `scripts/fetch-logs.sh` が ssh で **`auto-update.log` も取得**し(`--raw` と同じ経路)、`/logs` がデプロイの失敗・自動ロールバック・hold を報告項目に含める。自動デプロイの失敗は本番 DB の error_logs に残らないため、この経路が事後検知の正本 |

### 変更対象(実装時)

- `scripts/auto-logs.sh` 新規 + launchd plist(Mac ローカル。リポジトリには plist の雛形とセットアップ手順を置く)
- `.claude/skills/logs/SKILL.md` に「無人実行時の挙動」を 1 節追記(迷う判定は書き込まない・通知に回す)
- `scripts/fetch-logs.sh` に auto-update.log の取得を追加
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
4. `.env`・Dockerfile・Cloudflare 設定・g3plus-ops 側の変更を伴わない(= 自動デプロイ不可のクラス。下記 D の「手動デプロイ枠」)

### 選定ルール

1. 未チェック項目を分類する
2. 自動実行可の中から**影響度の高い順(A > B > C)**、同率は**古い順**(BACKLOG は追記順)に 1 件選ぶ
3. 自動実行不可の項目は「人の判断待ち」として選定結果と一緒に列挙する(放置で埋もれるのを防ぐ)

### iOS 項目の特例

iOS の修正は**コミットまで**(検証はシミュレータビルド)。「デプロイ」に相当する実機への再インストール(`run-ios-device.sh`、iPhone の接続が要る)は物理的に無人化できないため人の工程として報告に残す。BACKLOG の `[x]` 化は実機反映後(人が確認してから)。なお iOS だけの push はサーバー側で build キャッシュが効いてイメージが変わらず、コンテナは再作成されない(無害)。

### 現 BACKLOG 3 件に当てはめると

| 項目 | 分類 | 扱い |
|---|---|---|
| Suno style 語彙拒否 | 影響度 A・対策候補 3 つ | 自動選定不可 → 承認ゲートで**人が対策を選ぶ**(選べば以降は自動) |
| iOS `-999` 報告除外 | 影響度 C・対策一意・iOS | 自動実行可 → コミットまで自動、実機反映は人 |
| サーバー再起動による生成中断 | 検討系 | 人の判断待ち。ただし対策候補の片方(デプロイ前に進行中タスク確認)は D の auto-update.sh 前チェックが標準装備として吸収する |

## C. 修正 → コミット → push(新スキル `/backlog`)

`.claude/skills/backlog/SKILL.md`(新規)。デプロイが pull 型になったので、このスキルは **push で仕事が終わり、あとは反映を「観測」するだけ**になる(初版の ssh デプロイ実行は無くなった)。手順:

1. **選定**: B のルールで 1 件選び、分類・根拠・「人の判断待ち」項目の一覧を提示
2. **プラン作成**: 作業着手ルールどおり `docs/plans/<name>.md` を作りコミット(BACKLOG 項目は `TODO.md` に入れない既存ルールのまま。プランと実装はコミットを分ける既存ルールも維持)
3. **承認ゲート**: モード 1(下記)ではここで人の GO を待つ。対策候補が複数の項目は必ずここで人が選ぶ
4. **実装 → 検証**: `npm run typecheck` / ローカル起動して `/health`(iOS 変更ならシミュレータビルド)→ 実装コミット
5. **push**: ★ ここが本番反映のトリガ。**push = デプロイ**になるため、CLAUDE.md に「main へ push した server/ の変更は自動で本番に出る。まだ出したくないコミットは push しない(ローカルに積んでおく)」を明文化する(実装時)
6. **反映の監視**: `https://music.chobi.me/health` が返す **commit SHA**(下記 D)をポーリングし、自分のコミットが本番に出たことを確認(cron 周期 5 分 + build 数分なので上限 ~15 分。時間帯ガード中や進行中タスク待ちならその旨を報告して監視を打ち切り、翌朝の A に引き継ぐ)
7. **変更固有の外形確認**: プランに書いた確認項目を実施(例: 修正対象のエンドポイントの応答)
8. **後片付け**: BACKLOG を `[x]` 化・プランを `docs/plans/archive/` へ。**g3plus-ops の workflow doc への追記は「デプロイ契約が変わる変更」だけ**に純化する(定常修正の記録はアプリ側の BACKLOG・プランと auto-update.log で足りる。従来の「デプロイごとに節を足す」運用は自動デプロイと両立しない)
9. **報告**: 選定理由・修正内容・デプロイ結果・残る人の工程(iOS 実機反映など)。再発監視は翌朝の A が自動で行う

## D. デプロイ(g3plus-ops 主導の pull 型 `auto-update.sh`)

### 家内規約との関係

`esltext/auto-update.sh`(15 分おき、GitHub の新コミット検知 → `git merge --ff-only` → `docker compose build` → `up -d`、ログは ops ディレクトリに append)が原型。daily-ai-music は**生成ジョブを持つ常駐 API サーバー**なので、これに前チェックと検証・ロールバックを足した拡張版を作る。置き場・配布は同規約:

- 正本: **g3plus-ops リポジトリの `daily-ai-music/auto-update.sh`**(compose / Dockerfile / .env と同じディレクトリ)
- 配布: scp で `/home/ubuntu/g3plus-ops/daily-ai-music/` へ(サーバーの g3plus-ops は clone ではないため。既存規約のまま)
- 起動: ubuntu の **host crontab に 1 行**(`*/5 * * * *`。esltext と同居)。crontab の変更は手動 + workflow doc に記録(minecraft・esltext と同じ)

### auto-update.sh の設計

```
1. 新コミット検知      cd /home/ubuntu/daily-ai-music && git fetch origin main
                       HEAD == origin/main なら即終了(esltext と同じ)
2. hold ゲート         /home/ubuntu/g3plus-ops/daily-ai-music/deploy-hold があれば
                       スキップ(ログに記録)。人が手動デプロイ・移行作業をする間の停止弁
3. 時間帯ガード        TZ=America/Los_Angeles で 06:00〜07:30 はスキップ
                       (毎日生成 + 失敗再試行のウィンドウ。host の TZ に依存しない)
4. 進行中タスクゲート  curl localhost:3010/api/tasks(secret は同居の .env から読む)で
                       status が COMPLETE / FAILED 以外のタスクが 1 件でもあればスキップ
                       (待たない。次の cron 周期がリトライになる)
                       → BACKLOG「サーバー再起動による生成中断」の運用側対策を機械化
5. 差分ガード          HEAD..origin/main の差分に「server/ 直下の新ディレクトリ
                       (Dockerfile の COPY 追従が要る)」「server/.env.example の変更
                       (本番 .env の追従が要る)」があれば デプロイせず hold 相当で停止
                       + ログに WARN(B の条件 4 で弾かれているはずの二重チェック)
6. 反映                git merge --ff-only origin/main
                       docker tag daily-ai-music-daily-ai-music:latest …:prev
                       docker compose build → up -d
                       ※ build〜up の区間は flock(/home/ubuntu/g3plus-ops/.deploy.lock)で
                       全サービス共通の排他を掛ける(4 コアのサーバーで esltext 等の cron と
                       docker build が同時に走らないように。取れなければスキップ → 次周期)
7. 検証                /health が 200 かつ返却 SHA が新コミットに一致(数回リトライ)。
                       失敗したら docker tag …:prev → latest に戻して up -d(ロールバック)
                       + ログに ERROR
8. 記録                auto-update.log に append(esltext と同形式 + 判定理由)。
                       普段は無音。失敗・ロールバック・hold は Mac 側の /logs が
                       auto-update.log 経由で翌朝報告(A 参照)、即時性が要る場面は
                       /backlog の監視(C-6)が担う
```

### `/health` に commit SHA(アプリ側の小変更)

push が反映されたことを **ssh なしで外形確認**できるよう、`/health` の応答に稼働中コミットを足す(`{"status":"ok","commit":"<sha>"}`)。Dockerfile(g3plus-ops)に `ARG GIT_SHA` → env 注入、auto-update.sh が `docker compose build --build-arg GIT_SHA=$(git rev-parse HEAD)` で渡す。`/backlog` の監視(C-6)と auto-update.sh の検証(D-7)の両方がこれを使う。

### 手動デプロイ枠(残すもの)

自動デプロイは「通常フロー」クラス専用。以下は従来どおり人の手順(workflow doc が正本)で、**作業前に `deploy-hold` を置き、終わったら消す**:

- 既存行を書き換える移行を含む更新(DB バックアップが要る)
- `.env` の変更・ローテーション(scp + 再起動)
- Dockerfile・compose の変更(g3plus-ops 側の scp 追従が要る)
- バックフィルスクリプトの実行(backfill-intro 等)

### 多サービスへの一般化(2026-08-13 調査で確定)

「1 プロセスで全サービスをまとめてデプロイするか、プロジェクトごとに別プロセスか」を調査し、**プロジェクトごとに別プロセス**に決めた。

- 既存 2 本(esltext ≈20 行の git 型 / minecraft ≈200 行の image pull 型 + 通知 + バックアップ世代管理)は中身がほぼ別物で、共通なのは「cron 起動・変化なしは即終了・ログ追記」の外形だけ。「デプロイしてよいか」の判断はサービス固有(daily-ai-music なら生成中タスク・時間帯)で、集中型にしてもフックとして残り、読み解く量は減らない
- 一般解も「制御は 1 つでもデプロイ単位はアプリごとに独立」(ArgoCD 等)。watchtower 型の一括更新が成立するのは前チェック不要の単純ケースだけ
- 集中型(自作ミニフレームワーク)はフレームワーク自体のバグが全サービスのデプロイを止める。8 サービス規模では割に合わない

**中央化するのは 2 点だけ**: ① build〜up の flock 排他ロック(上記)② 規約の共有 — ログのファイル名・形式、`deploy-hold` の置き場と意味、「変化なしは無音・失敗は記録」の原則を g3plus-ops の doc にテンプレートとして書く(コードは共有しない)。共通ライブラリ化は git 型の採用が 4〜5 サービスに増えてずれが痛くなってから(rule of three)。

daily-ai-music 版は esltext(静的)・minecraft(ゲーム)に続く 3 例目の変種になる。

## 運転モード(段階導入)

| モード | A(BACKLOG 更新) | デプロイ | B〜C(選定〜push) | 移行条件 |
|---|---|---|---|---|
| 0(現状) | 手動 `/logs` | 手動 ssh | 全手動 | — |
| **1(まずここへ)** | **無人・毎朝** | **無人・pull 型** | 人が `/backlog` を起動。**プラン承認ゲートあり**、以降 push まで自動 | Phase 1〜3 実装後 |
| 2(慣熟後) | 無人・毎朝 | 無人・pull 型 | 自動実行可クラスは承認ゲートなしで A の後続として無人実行(結果通知のみ)。それ以外は従来どおり承認待ち | モード 1 で誤修正ゼロの実績が溜まってから。**導入は別途判断**(自動でモード 2 に上げない) |

## リスクと対策

| リスク | 対策 |
|---|---|
| **push = デプロイの重み**(人の通常開発の push も自動で本番に出る) | CLAUDE.md に明文化(C-5)。まだ出したくないコミットは push しない。作業を止めたいときは `deploy-hold`(ssh 1 行で置ける) |
| 誤った修正が本番に出る | 1 項目 1 デプロイ・typecheck / 起動検証・auto-update.sh の /health 検証と自動 `:prev` ロールバック・翌朝の A が再発検知(自己検証ループ)。正道のロールバックは `git revert` → push(pull 型がそのまま反映する) |
| 生成中の再起動で曲が失われる | 前チェック(進行中タスク 0 件)+ 時間帯ガード。スキップは cron 周期が自動リトライ |
| デプロイ契約(Dockerfile / .env)とのずれ | B の自動実行可条件 4 + auto-update.sh の差分ガードの二重チェック。該当したら停止して人へ |
| 自動デプロイの失敗に気づかない | auto-update.log を fetch-logs.sh が取得し `/logs` が報告(事後)+ `/backlog` の反映監視(即時)。通知基盤(n8n 等)の追加は今回は見送り、必要になったら足す |
| 無人 `/logs` が台帳・BACKLOG を汚す | 迷う判定は書かない・`--local` 禁止・書き込みは従来どおり BACKLOG と台帳の 2 ファイルに限定(TODO.md に触らない) |
| launchd 不発(スリープ・Mac 不在) | 解析が遅れるだけでデプロイは止まらない(役割分担の効果)。launchd は起床時に追い実行、失敗は通知 |
| headless Claude の暴走・ハング | wrapper の timeout・allowlist 運用(skip-permissions を使わない) |
| クレジットの意図しない消費 | パイプラインが叩く API は `/api/errors` 系・`/api/tasks`・`/health`・`/api/ping` のみ(生成 API は呼ばない) |

## 見送り(今回やらないこと)

- **Mac からの ssh push 型デプロイ(初版の deploy.sh)**: Mac の稼働に依存し、デプロイ知識が Mac 側スクリプトに分散する。pull 型で置き換え
- **GitHub Actions 等の CI/CD**: g3plus は LAN 内で、secret・ssh 鍵を外部に出す必要が生じる。pull 型なら外に出すものが無い
- **クラウドのスケジュールエージェントでの実行**: `g3plus.lan` に到達できず secret も無い
- **release ブランチ / タグでのデプロイトリガ**: main 直コミットの単独開発では工程が増えるだけ。「push しない」自由と `deploy-hold` で足りる
- **通知基盤(n8n webhook 等)**: まずはログ + `/logs` 取り込み + `/backlog` 監視の二段構えで。足りなければ後付け
- **モード 2 を最初から**: 承認ゲート付きの実績を見てから別途判断
- **BACKLOG の優先度を LLM に自由裁量で決めさせる**: 選定は決定的ルール(影響度 → 追記順)に固定し、判断の揺れをなくす
- **全サービス一括の中央デプロイプロセス**(watchtower 型・自作オーケストレータ): サービス固有の前チェックが本体で、集中化してもフックに残るだけ。中央化は flock と規約の 2 点に限定(D の「多サービスへの一般化」参照)
- **auto-update.sh の他サービス共通化(ライブラリ化)**: 3 例目の変種で止める。git 型が 4〜5 サービスに増えてから考える

## 実装 Phase(実装は本タスクの範囲外。着手時に TODO へ子タスク展開)

- **Phase 1 — A の実装(Mac)**: `scripts/auto-logs.sh` + launchd plist(雛形と手順)+ `/logs` SKILL の無人対応 + allowlist
- **Phase 2 — D の実装(g3plus-ops + アプリ)**: `g3plus-ops/daily-ai-music/auto-update.sh`(flock 排他込み)+ crontab 登録 + workflow doc 改訂(自動デプロイ節・手動デプロイ枠と `deploy-hold` の規約・auto-update.sh の共通テンプレート規約)/ アプリ側は `/health` の commit SHA(+ Dockerfile の `ARG GIT_SHA` は g3plus-ops 側)。**この Phase の初回反映自体は手動デプロイ**(Dockerfile 変更を含むため)
- **Phase 3 — C の実装(Mac)**: `.claude/skills/backlog/SKILL.md`(B の選定ルールはこの SKILL に記載)+ CLAUDE.md へ push ルールと `/backlog` の明文化 + `fetch-logs.sh` の auto-update.log 取得
- **Phase 4 — モード 2**: 無承認クラスの無人実行(導入判断は実績を見て別途)

## 影響範囲・テスト方針

- アプリ側(daily-ai-music): `/health` への commit 追加のみサーバーコードに触る(応答フィールド追加で iOS・管理画面に影響なし)。ほかは `scripts/`・スキル・SKILL 追記の追加のみ。**DB・API 契約の変更は無い**
- g3plus-ops 側: `daily-ai-music/auto-update.sh` 新規・Dockerfile に `ARG GIT_SHA`・workflow doc 改訂・crontab 1 行
- テスト: Phase 1 は launchd を待たず `scripts/auto-logs.sh` の手動起動で無人挙動(迷う判定を書かない・通知)を確認。Phase 2 は auto-update.sh をサーバー上で手動実行し、(1) 新コミット無しで即終了 (2) hold・時間帯・進行中タスクの各ゲートでスキップ (3) 無害なコミット(ドキュメントのみ → 次に server/ の軽微変更)で pull → build → 検証まで通し (4) わざと落ちる /health で `:prev` ロールバック、を順に確認してから crontab に載せる
