# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

daily-ai-music は、Suno を使って音楽を生成し、iPhone から操作・再生できるアプリ。

- **毎日の自動生成**: スケジュール実行で毎日新しい曲を自動生成する
- **手動リクエスト**: iPhone からプロンプトを指定してその都度生成することもできる
- 生成した楽曲は iPhone アプリで一覧・再生できる

## 構成(予定)

| コンポーネント | 技術 | 役割 |
|---|---|---|
| iOS アプリ | ネイティブ(Swift) | 楽曲の一覧・再生、生成リクエストの送信 |
| バックエンド | TypeScript / Node.js | Suno 連携、楽曲メタデータ・音源の管理、毎日の自動生成スケジューラ、iOS アプリ向け API |

## 現状

コードは未実装(README と LICENSE のみ)。ビルド・テスト等のコマンドは存在しない。実装が始まったら、このファイルにコマンドとアーキテクチャの詳細を追記すること。

## 未確定事項(決まり次第このファイルを更新)

- ~~Suno との連携方式~~ — 調査・検証済み([docs/specs/suno-api.md](docs/specs/suno-api.md))。当面はサードパーティ API を抽象化レイヤ越しに使い、公式 API(早期アクセス応募中)が出たら差し替える方針。**kie.ai**(sunoapi.org と同一運営・同一 API 構造、Bearer 認証)で生成フローを検証済み(sunoapi.org は Google ログイン不可だったため kie.ai を採用)。検証スクリプト: `scripts/verify-sunoapi.mjs`
- バックエンドのフレームワークとホスティング先
- 音源ファイルの保存先(オブジェクトストレージ等)
- iOS アプリの UI フレームワーク(SwiftUI を想定)と API 認証方式

<!-- vibeboard:begin -->
## 開発管理画面 (vibeboard)

ローカル開発時のタスク・プラン管理は [vibeboard](https://github.com/akiraak/vibeboard) で行う。
プロジェクト直下に degit で vendor してある（`./vibeboard/`）。

```bash
# 親プロジェクト直下から
node vibeboard/dist/cli.js --root .
```

`http://localhost:3010` でプロジェクト直下の `docs/plans/`・`docs/specs/`・`TODO.md`・`DONE.md`・`CLAUDE.md`・`README.md` を閲覧・編集できる。

- `Root` タブで `TODO.md` / `DONE.md` / `CLAUDE.md` / `README.md` をプレビュー表示・編集できる
  - 編集は楽観ロック（mtime チェック）付き。外部で先に更新されていた場合は保存時に 409 を返し、リロード / 手元維持 / 強制上書き を選べる
  - `fs.watch` + 2 秒ポーリングで外部変更を検知し、SSE でクライアントへ即時反映する
- ローカル開発専用（本番管理画面とは独立）
- ポート変更は `--port` または `VIBEBOARD_PORT` 環境変数で指定可能

## タスク管理ルール

- タスクは `TODO.md` で管理する
- タスクが完了したら `TODO.md` から該当項目を削除し、`DONE.md` に移動する
- `DONE.md` には完了日を `YYYY-MM-DD` 形式で付けて記録する
- 新しいタスクが発生したら `TODO.md` の適切なセクションに追加する
- タスクの実施前に `TODO.md` を確認し、優先度の高いものから着手する
- コミット時に `TODO.md` を確認し、実装した機能に対応するタスクがあれば `DONE.md` に移動する

## 作業着手ルール

作業（実装・調査いずれも）を始めるときは、コードに手を入れる前に以下を行う。

1. **プランファイルを作成する**: `docs/plans/<task-name>.md` に実装プラン or 調査プランを作成する
   - 目的・背景、対応方針、影響範囲、テスト方針を最低限記載する
   - 複数 Phase / Step に分かれる場合はファイル内でも Phase / Step を明示する
2. **`TODO.md` に該当項目があるか確認する**
   - 無ければ適切なセクションに追加する
   - 既存項目があれば、その項目に作成したプランファイルへのリンクを追記する（例: `[plan](docs/plans/<task-name>.md)`）
3. **複数 Phase / Step がある場合は `TODO.md` に子タスクとして追加する**
   - 親項目の下にインデントしたチェックボックスで Phase / Step を列挙する
   - Phase / Step が完了するごとにチェックを入れ、全完了で親項目を `DONE.md` に移す
4. **作業完了時の後片付け**
   - 親タスクを `DONE.md` に移動する
   - 対応するプランファイルは `docs/plans/archive/` に移動する
<!-- vibeboard:end -->

### このプロジェクト固有の vibeboard 設定

ポート 3010〜3012 は別プロジェクトが使用しているため、`vibeboard.config.json` でポートを **3013** に固定している。管理画面は `http://localhost:3013` で開く。起動は `./run-vibeboard.sh`(既存プロセスがポートを掴んでいれば停止してから起動する)。
