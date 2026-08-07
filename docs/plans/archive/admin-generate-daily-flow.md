# 管理画面の生成機能を毎日の自動生成と同じにする

## 目的・背景

現在、管理画面の「音楽を生成」フォームは `POST /admin/api/generate`(mode=manual)を呼び、
プリセット選択・自由テキスト・インストゥルメンタル指定を LLM に渡す独自フローになっている。
これを毎日の自動生成(`runDaily()`: プロファイル更新 → 冒険日判定 → LLM 生成 → Suno 送信)と
完全に同じフローに変更する。ジャンル選択などの入力 UI は不要になるため削除し、
プリセット(パラメータ)の一覧・管理は別画面に移す。

## 対応方針

1. **生成フォームの置き換え**(`server/public/index.html` / `app.js`)
   - プリセット選択チップ・自由テキスト欄・インストゥルメンタルチェックを削除し、生成ボタンのみにする
   - ボタンは既存の `POST /admin/api/daily/run` を呼ぶ(プロファイル更新 → 冒険日判定 → LLM → Suno。
     `last_daily_date` は更新しないため、その日のスケジュール実行は別途行われる)
2. **パラメータ一覧ページの新設**(`server/public/presets.html` / `presets.js`)
   - 既存の「プリセット管理」パネル(カテゴリ別一覧 + 追加・編集・削除)を index.html から移動
   - ヘッダーに相互リンクを付ける(index → パラメータ一覧、presets → 戻る)
3. **サーバー側**は変更なし(`/admin/api/daily/run` は既存)。コメントのみ実態に合わせて更新
   - `POST /api/generate`(manual フロー)は iOS アプリの生成画面が使うため残す(iOS は本タスクの対象外)

## 影響範囲

- `server/public/index.html` / `app.js` / `style.css`(ナビリンクのスタイル追加)
- `server/public/presets.html` / `presets.js`(新規)
- `server/src/index.ts`(コメントのみ)
- iOS アプリ・API 仕様は変更なし

## テスト方針

- `npm run typecheck`
- サーバーを起動しヘッドレス Chrome で `/admin/` と `/admin/presets.html` のスクリーンショットを取得して
  レイアウトとプリセット一覧の表示を確認する
- 生成ボタンの実行は Suno クレジットを消費するため実施しない(呼び先の `/admin/api/daily/run` は既存動作)
