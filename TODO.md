# TODO

- [ ] 歌声の言語を設定で選べるようにし、既定を日本語に変更する — 現在は「英語歌詞 + 日本語訳(表示用)」で固定(`server/src/llm.ts` の出力スキーマ `lyrics` / `lyricsJa`)。Suno が日本語で正しく歌えることは確認済み(調査: [docs/plans/archive/suno-japanese-vocals.md](docs/plans/archive/suno-japanese-vocals.md))。`settings` テーブルに言語設定(`vocal_language`、既定 `ja`)を追加し、管理画面の設定ページと iOS の設定画面から変更できるようにする。LLM は選ばれた言語で歌詞を書く [plan](docs/plans/vocal-language-setting.md)
  - 設計判断は決着済み(プランの「決めたこと」参照) — `lyrics` = Suno に渡す原詞 / `lyricsJa` = 日本語訳(日本語原詞なら無し)・EN/JA 切替表示は既存ロジックのままでよい・発音対策は軽い表記ルールのみ(助詞の「ワ」置換はしない)・`SUNO_MODEL` は `V5_5` へ・タイトルは歌詞の言語に寄せるが強制しない(日本語の曲名には英語のものも多いので無理に日本語にしない)
  - [ ] Phase 1: サーバー(設定・LLM のスキーマとプロンプト・`tasks.lyrics_lang`・設定 API)
  - [ ] Phase 2: Web 管理画面(設定ページの言語選択・楽曲詳細の表示)
  - [ ] Phase 3: iOS アプリ(API モデル・設定画面・生成パラメータ画面・楽曲詳細)
  - [ ] Phase 4: 実生成での確認とドキュメント更新
