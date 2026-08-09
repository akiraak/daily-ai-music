# カスタム指定のキーボードが閉じられない問題の修正

## 目的・背景

生成タブのカスタム生成でプロンプト入力欄(`GenerateView.swift` の `TextField(..., axis: .vertical)`)にフォーカスすると、キーボードを閉じる手段が無い。複数行 TextField はリターンキーが改行入力になるため、単一行のように「return で閉じる」が使えず、画面のどこをタップしてもスクロールしても閉じない。

あわせて他のテキスト入力箇所も点検した:

| 入力欄 | 状態 |
|---|---|
| 生成タブ: カスタムプロンプト(複数行) | **閉じられない(本タスクの対象)** |
| 設定タブ: タイムゾーン | `.submitLabel(.done)` + `.onSubmit` あり — return で閉じる(問題なし) |
| 設定タブ: サーバー URL / API Secret(単一行) | return で閉じる(問題なし) |

ただし全画面とも ScrollView にスクロールでのキーボード dismiss が未設定なので、iOS 標準の操作感(下スワイプで閉じる)も同時に入れる。

## 対応方針

`ios/DailyAIMusic/Sources/Views/GenerateView.swift`:

1. `@FocusState` をプロンプト入力欄にバインドする
2. キーボードツールバー(`ToolbarItemGroup(placement: .keyboard)`)に「閉じる」ボタンを置き、タップでフォーカスを外す(明示的で発見しやすい主経路)
3. ScrollView に `.scrollDismissesKeyboard(.interactively)` を付け、下スワイプでも閉じられるようにする
4. 「生成する」送信時にもフォーカスを外し、送信後にキーボードが残らないようにする

`ios/DailyAIMusic/Sources/Views/SettingsView.swift`:

5. ScrollView に `.scrollDismissesKeyboard(.interactively)` を付ける(一貫性のため。タイムゾーン欄をスワイプで閉じた場合は保存されないが、これは「return = 確定保存」の既存設計どおりでキャンセル相当)

## 影響範囲

- iOS アプリのみ(サーバー・API・管理画面は不変更)
- 生成タブと設定タブの見た目はキーボード表示中のツールバー 1 本分のみ変化

## テスト方針

- シミュレータビルド(iPhone 17)
- `GenerateUITests` にキーボード閉じの検証を追加: カスタム入力欄に typeText → キーボードツールバーの「閉じる」をタップ → キーボードが消えることを確認(サーバー起動 + `BACKEND_API_SECRET` 前提。実生成はしない)
- シミュレータにハードウェアキーボードが接続されているとソフトウェアキーボードが出ないため、テストはキーボード表示を前提条件にガードする
