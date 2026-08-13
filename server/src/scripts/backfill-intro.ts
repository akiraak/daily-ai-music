// 既存曲の紹介文(tasks.intro)を後から埋めるスクリプト。
// 新しく作る曲は生成時に intro が付くが、それ以前の曲は NULL のままなので公開ページの
// 紹介欄が空になる。一回きりの用途だが、途中で失敗しても NULL の行だけを拾い直すので
// 何度でも再実行できる形にしてある。
//
//   node src/scripts/backfill-intro.ts [--dry-run] [--limit N]
//
// 本番(コンテナ内)での実行:
//   docker compose --project-directory /home/ubuntu/g3plus-ops/daily-ai-music \
//     exec daily-ai-music node src/scripts/backfill-intro.ts --dry-run --limit 3
//
// **入力に参照曲(ref_artist_name / ref_song_title)は渡さない** — 公開ページに実在の
// アーティスト名・曲名を出さないという公開条件があり、入力に入れなければ出力に混ざりようが
// ないため(プロンプトでの禁止だけに頼らない)。渡すのは曲名・スタイルの日本語訳・歌詞だけ。
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "../config.ts";
import * as db from "../db.ts";

// 紹介文は 100 字程度の短文なので、生成時の Sonnet ではなく Haiku で十分(1 回きり・数十曲)
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 500;
// 歌詞が長い曲でも入力を抑える(冒頭だけで雰囲気は十分に伝わる)
const LYRICS_MAX_CHARS = 3000;

const SYSTEM_PROMPT =
  "あなたは音楽配信サイトの編集者です。曲の情報を読んで、聴く前の人に向けた短い紹介文を書きます。";

// 禁止事項は生成時(src/llm.ts の songPlanSchema / buildSongPlanPrompt)と揃える
function buildPrompt(row: db.MissingIntroRow): string {
  const sections = [`## 曲名\n${row.title}`];
  if (row.style_ja) sections.push(`## 曲調\n${row.style_ja}`);
  if (row.lyrics) {
    const lyrics = row.lyrics.slice(0, LYRICS_MAX_CHARS);
    sections.push(`## 歌詞\n${lyrics}`);
  } else {
    sections.push("## 歌詞\n(インストゥルメンタル。歌詞は無い)");
  }
  sections.push(
    [
      "## 書き方(厳守)",
      "- 公開ページに出す紹介文を日本語で書く。**2 文まで・120 字以内**(60〜100 字が目安)",
      "- 曲の雰囲気・情景が伝わる文にする",
      "- 実在のアーティスト名・曲名・固有名詞を含めない",
      "- 「AI が生成した」「この曲は」のようなメタな説明や前置きを書かない",
      "- 紹介文だけを出力する(見出し・かぎ括弧・説明は付けない)",
    ].join("\n")
  );
  return sections.join("\n\n");
}

async function generateIntro(
  client: Anthropic,
  row: db.MissingIntroRow
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(row) }],
  });
  if (message.stop_reason === "refusal") {
    throw new Error("LLM がリクエストを拒否しました");
  }
  const block = message.content.find((b) => b.type === "text");
  const text = block?.text.trim() ?? "";
  if (!text) {
    throw new Error(`本文が返りませんでした (stop_reason=${message.stop_reason})`);
  }
  // 1 行に正規化する(公開ページのカードは 2 行クランプなので改行が入ると崩れる)
  return text.replace(/\s*\n+\s*/g, " ").replace(/^["「]|["」]$/g, "").trim();
}

function parseArgs(argv: string[]): { dryRun: boolean; limit?: number } {
  let dryRun = false;
  let limit: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--limit は 1 以上の整数です");
      }
      limit = value;
    } else {
      throw new Error(`不明な引数: ${arg}`);
    }
  }
  return { dryRun, limit };
}

async function main(): Promise<void> {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const rows = db.listTasksMissingIntro(limit);
  if (rows.length === 0) {
    console.log("[backfill-intro] 紹介文が未生成の曲はありません");
    return;
  }
  console.log(
    `[backfill-intro] ${rows.length} 曲を処理します(model=${MODEL}${dryRun ? " / dry-run" : ""})`
  );

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  let done = 0;
  let failed = 0;
  // 並列にしない(1 回きりの処理で急ぐ必要が無く、失敗の切り分けもしやすい)
  for (const row of rows) {
    try {
      const intro = await generateIntro(client, row);
      if (!dryRun) db.setTaskIntro(row.task_id, intro);
      done++;
      console.log(`\n[${done}/${rows.length}] task ${row.task_id} 「${row.title}」`);
      console.log(`  ${intro}`);
    } catch (err) {
      failed++;
      console.error(
        `\n[!] task ${row.task_id}「${row.title}」の生成に失敗: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  console.log(
    `\n[backfill-intro] 完了: 成功 ${done} / 失敗 ${failed}` +
      (dryRun ? "(dry-run のため DB は更新していません)" : "")
  );
}

await main();
