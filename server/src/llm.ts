// LLM(Claude API)クライアント。①スタイル+歌詞+訳+タイトル+狙いの生成 ②好みプロファイルの更新
// モデルは claude-sonnet-5(.env の LLM_MODEL で変更可)。構造化出力(output_config.format)で JSON を受け取る
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, LLM_MODEL } from "./config.ts";
import type { PresetRow } from "./db.ts";

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export type GenerationMode = "manual" | "daily" | "daily_adventure";

export interface SongPlan {
  style: string;
  title: string;
  lyrics: string;
  lyricsJa: string;
  intent: string;
}

// 生成結果と、生成に使用したパラメータ(記録・管理画面表示用)
export interface SongPlanResult {
  plan: SongPlan;
  llmModel: string;
  llmPrompt: string; // LLM に送った user メッセージ全文(プロファイル・プリセット・直近スタイル等を含む)
}

const SONG_PLAN_SCHEMA = {
  type: "object",
  properties: {
    style: {
      type: "string",
      description:
        "Suno に渡す英語のスタイルプロンプト。ジャンル・楽器・ムード・テンポ・ボーカルスタイルをカンマ区切りで具体的に(500 文字以内)",
    },
    title: { type: "string", description: "曲のタイトル(英語、80 文字以内)" },
    lyrics: {
      type: "string",
      description:
        "英語の歌詞。[Verse] [Chorus] [Bridge] などのセクションタグ付き、3〜4 分の曲になる分量。インストゥルメンタルの場合は空文字列",
    },
    lyricsJa: {
      type: "string",
      description:
        "歌詞の自然な日本語訳(セクションタグは残す)。インストゥルメンタルの場合は空文字列",
    },
    intent: {
      type: "string",
      description: "この曲の狙い・意図の説明(日本語、2〜3 文。管理画面に表示する)",
    },
  },
  required: ["style", "title", "lyrics", "lyricsJa", "intent"],
  additionalProperties: false,
};

function presetLines(presets: PresetRow[]): string {
  return presets
    .map((p) => `- [${p.category}] ${p.value}(${p.label_ja})`)
    .join("\n");
}

function firstText(message: Anthropic.Message): string {
  if (message.stop_reason === "refusal") {
    throw new Error("LLM がリクエストを拒否しました");
  }
  const block = message.content.find((b) => b.type === "text");
  if (!block || !block.text.trim()) {
    throw new Error(`LLM から本文が返りませんでした (stop_reason=${message.stop_reason})`);
  }
  return block.text;
}

// スタイル+歌詞+訳+タイトル+狙いを生成する。manual はユーザー指定の要素を尊重し、
// daily はプール全体から評価を踏まえて選ぶ(1 要素は普段と違うもの)。daily_adventure は大きく外す
export async function generateSongPlan(input: {
  mode: GenerationMode;
  instrumental: boolean;
  profile: string | null;
  selectedPresets: PresetRow[];
  presetPool: PresetRow[];
  freeText: string;
  recentStyles: string[];
}): Promise<SongPlanResult> {
  const sections: string[] = [];

  if (input.profile) {
    sections.push(`## ユーザーの好みプロファイル\n${input.profile}`);
  }
  if (input.mode === "manual") {
    if (input.selectedPresets.length > 0) {
      sections.push(
        `## ユーザーが選んだ要素(必ず反映する)\n${presetLines(input.selectedPresets)}`
      );
    }
    if (input.freeText) {
      sections.push(`## ユーザーの自由リクエスト(最優先で反映する)\n${input.freeText}`);
    }
  } else {
    sections.push(
      `## 利用できる要素プール(好みプロファイルを踏まえて自由に選ぶ)\n${presetLines(input.presetPool)}`
    );
    if (input.mode === "daily_adventure") {
      sections.push(
        `## モード: 冒険日\n今日は普段の好みから大きく外れた意外な組み合わせに挑戦する日。プロファイルに無い要素を大胆に使うこと。`
      );
    } else {
      sections.push(
        `## モード: 毎日の自動生成\n好みプロファイルに沿いつつ、1 要素だけは普段と違うものを入れてマンネリを避けること。`
      );
    }
  }
  if (input.recentStyles.length > 0) {
    sections.push(
      `## 直近の生成スタイル(重複を避ける)\n${input.recentStyles.map((s) => `- ${s}`).join("\n")}`
    );
  }
  sections.push(
    `## 出力条件\n- インストゥルメンタル: ${input.instrumental ? "はい(lyrics / lyricsJa は空文字列)" : "いいえ(歌詞を書く)"}`
  );

  const llmPrompt = sections.join("\n\n");
  const message = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 16000,
    system:
      "あなたは優れた音楽プロデューサー兼作詞家です。AI 音楽生成サービス Suno に渡すスタイルプロンプトと歌詞を作ります。" +
      "毎日 1 曲、ユーザーの生活に寄り添う新しい曲を届けるのが仕事です。ありきたりな表現を避け、具体的で音の想像がつくスタイル指定と、心に残る歌詞を書いてください。",
    messages: [{ role: "user", content: llmPrompt }],
    output_config: {
      format: { type: "json_schema", schema: SONG_PLAN_SCHEMA },
    },
  });

  const plan = JSON.parse(firstText(message)) as SongPlan;
  console.log(`[llm] 生成プラン: "${plan.title}" style=${plan.style.slice(0, 80)}...`);
  return { plan, llmModel: LLM_MODEL, llmPrompt };
}

// 評価(👍/👎)を好みプロファイル文書に反映し、更新後の文書全文を返す
export async function updateProfile(input: {
  currentProfile: string | null;
  ratedTracks: {
    title: string;
    style: string | null;
    rating: number | null;
  }[];
}): Promise<string> {
  const trackLines = input.ratedTracks
    .map(
      (t) =>
        `- ${t.rating === 1 ? "👍" : "👎"} "${t.title}" — style: ${t.style ?? "(不明)"}`
    )
    .join("\n");

  const message = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 4096,
    system:
      "あなたはユーザーの音楽の好みプロファイル文書を管理しています。新しい評価を踏まえて文書を更新し、更新後の文書全文だけを出力してください(前置きや説明は不要)。" +
      "プロファイルは日本語の簡潔な箇条書きで、好きな要素・避けたい要素・意外に好きだった要素を整理します。古い内容も evidence が覆らない限り保持し、全体で 500 字以内に収めてください。",
    messages: [
      {
        role: "user",
        content: [
          `## 現在のプロファイル\n${input.currentProfile ?? "(まだ無い。今回の評価から新規作成する)"}`,
          `## 新しい評価(👍=好き、👎=好みじゃない)\n${trackLines}`,
        ].join("\n\n"),
      },
    ],
  });

  return firstText(message).trim();
}
