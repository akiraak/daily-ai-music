# アプリアイコンを変更する

## 目的・背景

iOS アプリ(Music Plant)のホーム画面アイコンが未設定(AppIcon セットは存在するが画像が空)。
用意済みのアイコン画像 `/Users/akiraak/Downloads/daily-ai-music-icon.png`(1254x1254、アルファ無し PNG)をアプリアイコンとして設定する。

## 対応方針

iOS 17+ 向けの単一サイズ(1024x1024)アイコン形式を使う(既存の `AppIcon.appiconset/Contents.json` がその形式)。

1. 元画像を `sips` で 1024x1024 に縮小し、`ios/DailyAIMusic/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png` として保存する
2. `Contents.json` の `images[0]` に `"filename": "AppIcon.png"` を追記する
3. `xcodegen generate` → シミュレータビルドで検証する

## 影響範囲

- `ios/DailyAIMusic/Resources/Assets.xcassets/AppIcon.appiconset/` のみ(画像追加 + Contents.json)
- `project.yml` は `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` 設定済みのため変更不要

## テスト方針

- シミュレータビルドが通ること
- シミュレータにインストールしてホーム画面のアイコンが変わることを確認する
