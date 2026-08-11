# TODO

- [ ] 歌声の言語を設定で選べるようにし、既定を日本語に変更する — 現在は「英語歌詞 + 日本語訳(表示用)」で固定(`server/src/llm.ts` の出力スキーマ `lyrics` / `lyricsJa`)。Suno が日本語で正しく歌えることは確認済み(調査: [docs/plans/archive/suno-japanese-vocals.md](docs/plans/archive/suno-japanese-vocals.md))。`settings` テーブルに言語設定(例: `vocal_language`、既定 `ja`)を追加し、管理画面の設定ページと iOS の設定画面から変更できるようにする。LLM は選ばれた言語で歌詞を書く
  - 設計時に決めること: `lyrics` / `lyricsJa` の意味(日本語が原詞になったときにどちらへ入れるか)と、iOS / 管理画面の EN/JA 切替表示の扱い
  - 日本語のときの発音対策(助詞「は」「へ」・数字の英語読み・漢字の読み間違い)をプロンプトの表記ルールで入れるか、`SUNO_MODEL` を `V5` → `V5_5` に上げるかも併せて判断する
