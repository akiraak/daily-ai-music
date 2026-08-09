// LLM(Claude API)クライアント。スタイル+歌詞+訳+タイトル+狙いの生成
// モデルは claude-sonnet-5(.env の LLM_MODEL で変更可)。構造化出力(output_config.format)で JSON を受け取る
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, LLM_MODEL } from "./config.ts";
import * as db from "./db.ts";
import type { PresetRow } from "./db.ts";

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export type GenerationMode = "manual" | "daily" | "daily_adventure" | "artist";

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

// artist モードの参照曲(この曲に似た新曲を作る)
export interface ReferenceSong {
  artist: string;
  title: string;
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
}

export interface SongPlanInput {
  mode: GenerationMode;
  instrumental: boolean;
  selectedPresets: PresetRow[];
  presetPool: PresetRow[];
  presetRatings?: PresetRatings; // プリセット別の 👍/👎 集計(daily 系で注入。manual は非注入)
  freeText: string;
  recentStyles: string[];
  extraContext?: string; // 「今日のコンテキスト」(ニュース。毎日の自動生成のみ)
  referenceSong?: ReferenceSong; // artist モードのみ
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

  if (input.mode === "artist" && input.referenceSong) {
    const ref = input.referenceSong;
    const refLines = [`- アーティスト: ${ref.artist}`, `- 曲名: ${ref.title}`];
    if (ref.album) refLines.push(`- 収録アルバム: ${ref.album}`);
    if (ref.releaseYear) refLines.push(`- リリース年: ${ref.releaseYear}`);
    if (ref.genre) refLines.push(`- ジャンル(iTunes の分類): ${ref.genre}`);
    sections.push(
      `## リファレンス楽曲(この曲に似た新曲を作る)\n${refLines.join("\n")}`
    );
    sections.push(
      `## 作り方(厳守)
- リファレンス楽曲の音楽的特徴(ジャンル、テンポ、リズム、コード進行の雰囲気、楽器編成、ボーカルの質感、プロダクションの質感)を具体的な英語の音楽用語に翻訳して style を書く。「〜風」と書くのではなく、音そのものを記述すること
- **style・title・lyrics に実在の固有名詞(アーティスト名・バンド名・曲名)を一切含めない**。上記のアーティスト名・曲名も書いてはいけない。Suno のモデレーションが固有名詞を拒否し、生成そのものが失敗する
- 歌詞は原曲の歌詞を複製・翻訳・言い換えしない。テーマや情景の方向性を参考にするのは構わないが、完全な新作の歌詞を書く
- リファレンス楽曲を知らない場合は、そのアーティストの一般的な作風から推定してよい。その場合も推測であることを断らずに具体的に書き切ること
- intent には、リファレンス楽曲のどの音楽的特徴を取り入れたかと、その根拠(その曲を知っている / アーティストの一般的な作風からの推定)を日本語で必ず書く`
    );
    if (input.freeText) {
      sections.push(`## 追加の要望(リファレンスに重ねて反映する)\n${input.freeText}`);
    }
  } else if (input.mode === "manual") {
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
  // artist は「参照曲に似せる」のが目的なので、直近スタイルとの重複回避は注入しない(目的と矛盾する)
  if (input.mode !== "artist" && input.recentStyles.length > 0) {
    sections.push(
      `## 直近の生成スタイル(重複を避ける)\n${input.recentStyles.map((s) => `- ${s}`).join("\n")}`
    );
  }
  if (limits.banned.length > 0) {
    // manual / artist はユーザーの指定・リクエストが最優先(禁止ワードと衝突したらユーザー指定が勝つ)
    const note =
      input.mode === "manual"
        ? "。ただしユーザーが選んだ要素・自由リクエストと衝突する場合はユーザー指定を優先する"
        : input.mode === "artist"
          ? "。ただしリファレンス楽曲の再現と衝突する場合はリファレンスを優先する"
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
    // artist は参照曲の声に寄せるのが目的なので、声色を散らす指示は出さない
    conditions.push(
      input.mode === "artist"
        ? "- 歌声: style に歌手の声の特徴(性別・声質・年齢感)を必ず含める。リファレンス楽曲のボーカルの質感に寄せること"
        : "- 歌声: style に歌手の声の特徴(性別・声質・年齢感。vocal カテゴリの要素を参考に)を必ず含める。直近の生成スタイルと歌声が偏らないよう、幅広い声色を試すこと"
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
      "毎日、ユーザーの生活に寄り添う新しい曲を届けるのが仕事です。ありきたりな表現を避け、具体的で音の想像がつくスタイル指定と、心に残る歌詞を書いてください。",
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

// 固有名詞の検出。ASCII の名前は語境界で見る(「Air」が「airplane」に誤ヒットしないように)。
// 日本語などの非 ASCII は語境界の概念が無いので単純な部分一致。短すぎる名前は誤検出が多いので見ない
function containsName(lowerHaystack: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 3) return false;
  if (/^[\x20-\x7e]+$/.test(n)) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lowerHaystack);
  }
  return lowerHaystack.includes(n);
}

// artist モードの固有名詞チェック。Suno はプロンプト内のアーティスト名・曲名をモデレーションで
// 弾く(SENSITIVE_WORD_ERROR → タスク FAILED)ため、送信前に検査する。
// 曲名は普通の単語のこと(「Lemon」等)があるので title だけを見る(歌詞に偶然出るのは許容)
export function properNounsIn(plan: SongPlan, ref: ReferenceSong): string[] {
  const found: string[] = [];
  const body = [plan.style, plan.title, plan.lyrics].join("\n").toLowerCase();
  if (containsName(body, ref.artist)) found.push(ref.artist);
  if (containsName(plan.title.toLowerCase(), ref.title)) found.push(ref.title);
  return found;
}

// 再生成すべき問題(検出内容と、プロンプトに足す指示)
interface PlanIssue {
  label: string;
  instruction: string;
}

function planIssues(
  plan: SongPlan,
  input: SongPlanInput,
  limits: WordLimits
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const banned = bannedWordsIn(plan, limits.banned);
  if (banned.length > 0) {
    issues.push({
      label: `禁止ワード(${banned.join(", ")})`,
      instruction:
        `前回の出力には使用禁止ワード(${banned.join(", ")})が中心要素として含まれていた。` +
        `これらのワードをテーマ・スタイル・歌詞・realWorldWords のいずれにも使わず、別の発想で作り直すこと。`,
    });
  }
  if (input.mode === "artist" && input.referenceSong) {
    const nouns = properNounsIn(plan, input.referenceSong);
    if (nouns.length > 0) {
      issues.push({
        label: `固有名詞の混入(${nouns.join(", ")})`,
        instruction:
          `前回の出力には固有名詞(${nouns.join(", ")})が含まれていた。Suno のモデレーションに拒否され生成が失敗するため、` +
          `style・title・lyrics から固有名詞を完全に取り除き、音楽的特徴の記述だけで書き直すこと。`,
      });
    }
  }
  return issues;
}

// スタイル+歌詞+訳+タイトル+狙い+リアルワードを生成する。manual はユーザー指定の要素を尊重し、
// daily はプール全体から評価を踏まえて選ぶ(1 要素は普段と違うもの)。daily_adventure は大きく外す。
// リアルワードの使用制限は全モード共通でここで一元処理する
export async function generateSongPlan(input: SongPlanInput): Promise<SongPlanResult> {
  const limits = currentWordLimits();
  let llmPrompt = buildSongPlanPrompt(input, limits);
  let plan = await requestSongPlan(llmPrompt);

  // 検証リトライ: 禁止ワードの残留・固有名詞の混入があれば、指示を強めて 1 回だけ再生成する
  const issues = planIssues(plan, input, limits);
  if (issues.length > 0) {
    console.warn(
      `[llm] ${issues.map((i) => i.label).join(" / ")}が含まれたため再生成します`
    );
    llmPrompt += `\n\n## 再生成の指示(厳守)\n${issues.map((i) => i.instruction).join("\n")}`;
    plan = await requestSongPlan(llmPrompt);
    const still = planIssues(plan, input, limits);
    if (still.length > 0) {
      // 生成は止めない(警告のみ。固有名詞が残った場合は Suno 側で FAILED として観測できる)
      console.warn(
        `[llm] 再生成後も ${still.map((i) => i.label).join(" / ")} が残ったため、そのまま採用します`
      );
    }
  }

  console.log(`[llm] 生成プラン: "${plan.title}" style=${plan.style.slice(0, 80)}...`);
  return { plan, llmModel: LLM_MODEL, llmPrompt };
}
