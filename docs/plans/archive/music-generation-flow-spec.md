# 音楽生成の流れの仕様書を書く

## 目的・背景

音楽生成まわりの仕様は [docs/specs/music-generation.md](../specs/music-generation.md) にあるが、これは「設計決定の記録」(決定事項の表+決定日)が中心で、現在の実装が実際にどう動くか(入口が 3 つあること、毎日の自動生成の手順、Suno タスクの状態遷移、評価のフィードバックループ)を追いかけるにはコードを読む必要がある。流れを図付きで説明する仕様書を新設し、読めば全体が分かる状態にする。

## 対応方針

- `docs/specs/music-generation-flow.md` を新設。「現在の実装の流れ」に絞り、決定の経緯・理由は既存の music-generation.md へリンクで逃がす(二重管理を避ける)
- 図は SVG ファイル(`docs/specs/music-generation-flow/*.svg`)を作り、markdown から画像参照で埋め込む
  - mermaid は vibeboard(marked)が描画できず、インライン SVG は GitHub が除去するため、**画像参照が vibeboard(相対アセット URL の書き換えあり)と GitHub の両方で表示される唯一の方式**
  - 配色はアプリのデザイントークン(クリーム背景 #FDF2E5・アクセント #B4BA40・AccentDeep #787D2B)に合わせ、背景を SVG 自体に持たせてダークテーマでも読めるようにする
- 図は 3 枚: ①全体像(3 つの入口 → LLM → Suno → 保存 → アプリ、評価のフィードバックループ)②毎日の自動生成の手順(5 ステップ)③Suno タスクの状態遷移
- 内容はコード(scheduler.ts / llm.ts / context.ts / generation.ts / index.ts / suno/kieai.ts)から起こし、既存仕様と矛盾しないことを確認する

## 影響範囲

- `docs/specs/music-generation-flow.md`(新規)+ `docs/specs/music-generation-flow/`(SVG 3 枚)
- `docs/specs/music-generation.md` に流れの仕様書へのリンクを追記
- コード変更なし

## テスト方針

- vibeboard(http://localhost:3013)で該当ページをヘッドレス Chrome スクリーンショットし、本文と図 3 枚が描画されることを目視確認
- SVG 単体もヘッドレス Chrome で PNG 化して文字切れ・重なりを目視確認
