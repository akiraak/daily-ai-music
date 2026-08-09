// LLM(Claude API)クライアント。スタイル+歌詞+訳+タイトル+狙いの生成
// モデルは claude-sonnet-5(.env の LLM_MODEL で変更可)。構造化出力(output_config.format)で JSON を受け取る
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, LLM_MODEL } from "./config.ts";
import * as db from "./db.ts";
import type { PresetRow } from "./db.ts";

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export type GenerationMode = "manual" | "daily" | "daily_adventure";

export interface SongPlan {
  style: string;
  styleJa: string;
  title: string;
  lyrics: string;
  lyricsJa: string;
  intent: string;
  realWorldWords: string[]; // この曲の中心となった語(保存して使用回数を制限する)
  usedPresets: { category: string; value: string }[]; // 採用したプリセット(提示値の写し。サーバーで照合して保存)
}

// 生成結果と、生成に使用したパラメータ(記録・管理画面表示用)
export interface SongPlanResult {
  plan: SongPlan;
  llmModel: string;
  llmPrompt: string; // LLM に送った user メッセージ全文(プリセット・直近スタイル等を含む)
}

const SONG_PLAN_SCHEMA = {
  type: "object",
  properties: {
    style: {
      type: "string",
      description:
        "Suno に渡す英語のスタイルプロンプト。ジャンル・楽器・ムード・テンポ・ボーカルスタイルをカンマ区切りで具体的に(500 文字以内)",
    },
    styleJa: {
      type: "string",
      description: "style の自然な日本語訳(管理画面に表示する)",
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
    realWorldWords: {
      type: "array",
      items: { type: "string" },
      description:
        "この曲の中心となった語(リアルワード)。今日のコンテキストから採ったテーマ語と、曲の中心要素(ジャンル・ムード・情景など)を英語小文字で 5〜8 個",
    },
    usedPresets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "プロンプトに提示された要素の [ ] 内の category を一字一句そのまま写す",
          },
          value: {
            type: "string",
            description: "プロンプトに提示された要素の value(英語部分)を一字一句そのまま写す",
          },
        },
        required: ["category", "value"],
        additionalProperties: false,
      },
      description:
        "この曲に採用したプリセット要素。プロンプトに提示された要素(「- [category] value(和名)」の行)から採用したものだけを、category と value を一字一句そのまま写して列挙する。提示に無い独自の要素は含めない(提示が無ければ空配列)",
    },
  },
  required: [
    "style",
    "styleJa",
    "title",
    "lyrics",
    "lyricsJa",
    "intent",
    "realWorldWords",
    "usedPresets",
  ],
  additionalProperties: false,
};

// プリセット別の 👍/👎 集計(preset_id → 件数)。daily 系のプール行に併記する
export type PresetRatings = Map<number, { up: number; down: number }>;

function presetLines(presets: PresetRow[], ratings?: PresetRatings): string {
  return presets
    .map((p) => {
      const r = ratings?.get(p.id);
      const suffix = r && (r.up > 0 || r.down > 0) ? ` 👍 ${r.up} / 👎 ${r.down}` : "";
      return `- [${p.category}] ${p.value}(${p.label_ja})${suffix}`;
    })
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

export interface SongPlanInput {
  mode: GenerationMode;
  instrumental: boolean;
  selectedPresets: PresetRow[];
  presetPool: PresetRow[];
  presetRatings?: PresetRatings; // プリセット別の 👍/👎 集計(daily 系で注入。manual は非注入)
  freeText: string;
  recentStyles: string[];
  extraContext?: string; // 「今日のコンテキスト」(ニュース・天気。毎日の自動生成のみ)
}

// リアルワードの使用制限(ウィンドウ内の使用回数から算出。テスト用に注入可能)
export interface WordLimits {
  banned: string[]; // 使用上限に達した(中心に据えない)
  lastChance: string[]; // 残り 1 回(できれば別のアイデアを優先)
}

export function currentWordLimits(): WordLimits {
  const { wordMaxUses, wordWindowDays } = db.getWordLimitSettings();
  const usage = db.countRealWorldWordUses(wordWindowDays);
  return {
    banned: usage.filter((u) => u.uses >= wordMaxUses).map((u) => u.word),
    lastChance: usage.filter((u) => u.uses === wordMaxUses - 1).map((u) => u.word),
  };
}

// LLM に送る user メッセージを組み立てる(純関数。テストで直接検証できるよう分離)
export function buildSongPlanPrompt(input: SongPlanInput, limits: WordLimits): string {
  const sections: string[] = [];

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
      `## 利用できる要素プール(評価 👍/👎 の集計を踏まえて自由に選ぶ)\n${presetLines(input.presetPool, input.presetRatings)}`
    );
    if (input.mode === "daily_adventure") {
      sections.push(
        `## モード: 冒険日\n今日は普段の好みから大きく外れた意外な組み合わせに挑戦する日。評価集計(👍/👎)には従わなくてよく、むしろ未評価・低評価の要素への挑戦も歓迎。普段選ばれない要素を大胆に使うこと。`
      );
    } else {
      sections.push(
        `## モード: 毎日の自動生成\n👍/👎 はその要素を使った曲へのユーザー評価。👍 の多い要素を優先し、👎 の多い要素は避けること。ただし優先に従いすぎるとマンネリ化するため、1 要素だけは普段(👍 集計の上位)と違うものを入れること。`
      );
    }
  }
  if (input.extraContext) {
    sections.push(
      `## 今日のコンテキスト(歌詞・曲調の着想に使う。ニュースの報告ではなく、雰囲気やテーマとしてさりげなく織り込む)\n${input.extraContext}`
    );
  }
  if (input.recentStyles.length > 0) {
    sections.push(
      `## 直近の生成スタイル(重複を避ける)\n${input.recentStyles.map((s) => `- ${s}`).join("\n")}`
    );
  }
  if (limits.banned.length > 0) {
    // manual はユーザーの指定・リクエストが最優先(禁止ワードと衝突したらユーザー指定が勝つ)
    const note =
      input.mode === "manual"
        ? "。ただしユーザーが選んだ要素・自由リクエストと衝突する場合はユーザー指定を優先する"
        : "";
    sections.push(
      `## 使用禁止ワード(直近で使いすぎ。テーマ・スタイル・歌詞の中心に据えず、realWorldWords にも含めない${note})\n${limits.banned.map((w) => `- ${w}`).join("\n")}`
    );
  }
  if (limits.lastChance.length > 0) {
    sections.push(
      `## 残り 1 回のワード(できれば別のアイデアを優先する)\n${limits.lastChance.map((w) => `- ${w}`).join("\n")}`
    );
  }
  // realWorldWords の出力指示はスキーマの description で行う(ここに書くと LLM 入力全文の
  // 表示にプロンプト指示文が混ざり、具体的なワードと紛らわしいため)
  const conditions = [
    `- インストゥルメンタル: ${input.instrumental ? "はい(lyrics / lyricsJa は空文字列)" : "いいえ(歌詞を書く)"}`,
  ];
  if (!input.instrumental) {
    conditions.push(
      "- 歌声: style に歌手の声の特徴(性別・声質・年齢感。vocal カテゴリの要素を参考に)を必ず含める。直近の生成スタイルと歌声が偏らないよう、幅広い声色を試すこと"
    );
  }
  sections.push(`## 出力条件\n${conditions.join("\n")}`);

  return sections.join("\n\n");
}

async function requestSongPlan(llmPrompt: string): Promise<SongPlan> {
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
  return JSON.parse(firstText(message)) as SongPlan;
}

function bannedWordsIn(plan: SongPlan, banned: string[]): string[] {
  const words = plan.realWorldWords.map((w) => w.trim().toLowerCase());
  return banned.filter((b) => words.includes(b));
}

// スタイル+歌詞+訳+タイトル+狙い+リアルワードを生成する。manual はユーザー指定の要素を尊重し、
// daily はプール全体から評価を踏まえて選ぶ(1 要素は普段と違うもの)。daily_adventure は大きく外す。
// リアルワードの使用制限は全モード共通でここで一元処理する
export async function generateSongPlan(input: SongPlanInput): Promise<SongPlanResult> {
  const limits = currentWordLimits();
  let llmPrompt = buildSongPlanPrompt(input, limits);
  let plan = await requestSongPlan(llmPrompt);

  // 検証リトライ: 禁止ワードが中心要素に残っていたら、指示を強めて 1 回だけ再生成する
  const violations = bannedWordsIn(plan, limits.banned);
  if (violations.length > 0) {
    console.warn(
      `[llm] 禁止ワード(${violations.join(", ")})が含まれたため再生成します`
    );
    llmPrompt +=
      `\n\n## 再生成の指示(厳守)\n前回の出力には使用禁止ワード(${violations.join(", ")})が中心要素として含まれていた。` +
      `これらのワードをテーマ・スタイル・歌詞・realWorldWords のいずれにも使わず、別の発想で作り直すこと。`;
    plan = await requestSongPlan(llmPrompt);
    const still = bannedWordsIn(plan, limits.banned);
    if (still.length > 0) {
      // 生成は止めない(警告のみ)
      console.warn(
        `[llm] 再生成後も禁止ワード(${still.join(", ")})が残ったため、そのまま採用します`
      );
    }
  }

  console.log(`[llm] 生成プラン: "${plan.title}" style=${plan.style.slice(0, 80)}...`);
  return { plan, llmModel: LLM_MODEL, llmPrompt };
}
