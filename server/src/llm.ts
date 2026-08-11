// LLM(Claude API)クライアント。スタイル+歌詞+訳+タイトル+狙いの生成
// モデルは claude-sonnet-5(.env の LLM_MODEL で変更可)。構造化出力(output_config.format)で JSON を受け取る
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, LLM_MODEL } from "./config.ts";
import * as db from "./db.ts";

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// 思考の深さ(output_config.effort)。深いほど品質が上がるがトークンと時間が増える。
// API の既定が high なので、設定が入っていない既存 DB でも挙動が変わらないよう既定値も high にする
export const LLM_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type LlmEffort = (typeof LLM_EFFORTS)[number];
const DEFAULT_LLM_EFFORT: LlmEffort = "high";

// 生成に使うモデルと思考の深さ(生成時の読み出しと、管理画面の設定ページ表示に使う)。
// モデルは .env が真実源なので読み取り専用、effort だけ settings テーブルで切り替える。
// 保存値をキャッシュしないので、設定変更は次の生成にそのまま効く
export function getLlmSettings(): { llmModel: string; llmEffort: LlmEffort } {
  const stored = db.getSetting("llm_effort");
  return {
    llmModel: LLM_MODEL,
    llmEffort: LLM_EFFORTS.find((e) => e === stored) ?? DEFAULT_LLM_EFFORT,
  };
}

// 歌声の言語(歌詞をどの言語で書くか)。既定は日本語(2026-08-11 に英語固定から変更)。
// 設定は生成のたびに読むので、変更は次の生成にそのまま効く(llm_effort と同じ流儀)
export const VOCAL_LANGUAGES = ["ja", "en"] as const;
export type VocalLanguage = (typeof VOCAL_LANGUAGES)[number];
const DEFAULT_VOCAL_LANGUAGE: VocalLanguage = "ja";

export function getVocalLanguage(): VocalLanguage {
  const stored = db.getSetting("vocal_language");
  return VOCAL_LANGUAGES.find((l) => l === stored) ?? DEFAULT_VOCAL_LANGUAGE;
}

// タスク行に記録する生成経路。どちらも参照曲を持つ(2026-08-10 に manual を廃止。
// 過去データには 'manual' / 'daily_adventure' が残るが、表示のラベル対応のみ)
export type GenerationMode = "daily" | "artist";

export interface SongPlan {
  style: string;
  styleJa: string;
  title: string;
  lyrics: string; // Suno に渡す原詞(歌声の言語で書かれる)
  lyricsJa?: string; // 日本語訳。原詞が日本語のときはスキーマから外すので undefined
  intent: string;
  realWorldWords: string[]; // この曲の中心となった語(保存して使用回数を制限する)
  sources: string[]; // web_search で参照した情報源(検索できなかったときは空配列)
}

// 生成結果と、生成に使用したパラメータ(記録・管理画面表示用)
export interface SongPlanResult {
  plan: SongPlan;
  llmModel: string;
  llmPrompt: string; // LLM に送った user メッセージ全文(リファレンス・今日のコンテキスト等を含む)
  lyricsLang: VocalLanguage; // 原詞の言語(タスクに記録する)
}

// 出力スキーマ。歌詞の言語で lyrics / title の指示が変わり、日本語のときは訳が要らないので
// lyricsJa の項目自体を外す(空文字列を書かせるより、無い方が意図が明確)。
// buildSongPlanPrompt と同じくテストから直接叩けるよう export する
export function songPlanSchema(lang: VocalLanguage) {
  const ja = lang === "ja";
  const properties: Record<string, unknown> = {
    style: {
      type: "string",
      description:
        "Suno に渡す英語のスタイルプロンプト。ジャンル・楽器・ムード・テンポ・ボーカルスタイルをカンマ区切りで具体的に(500 文字以内)",
    },
    styleJa: {
      type: "string",
      description: "style の自然な日本語訳(管理画面に表示する)",
    },
    title: {
      type: "string",
      description: ja
        ? "曲のタイトル(80 文字以内)。日本語を基本にするが、英語のタイトルの方が自然ならそれでよい"
        : "曲のタイトル(英語、80 文字以内)",
    },
    lyrics: {
      type: "string",
      description:
        (ja ? "日本語の歌詞。" : "英語の歌詞。") +
        "[Verse] [Chorus] [Bridge] などのセクションタグ付き(タグは英語のまま)、3〜4 分の曲になる分量。インストゥルメンタルの場合は空文字列",
    },
    // 原詞が日本語なら訳は要らないので項目ごと外す
    ...(ja
      ? {}
      : {
          lyricsJa: {
            type: "string",
            description:
              "歌詞の自然な日本語訳(セクションタグは残す)。インストゥルメンタルの場合は空文字列",
          },
        }),
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
    sources: {
      type: "array",
      items: { type: "string" },
      description:
        "web_search で実際に参照した情報源の URL またはタイトル。検索していない場合は空配列",
    },
  };
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
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

// 参照曲(この曲に似た新曲を作る)。artist モードのほか、毎日の自動生成(daily)でも
// サーバーが登録済みの曲から 1 曲選んで渡す
export interface ReferenceSong {
  artist: string;
  title: string;
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
}

export interface SongPlanInput {
  instrumental: boolean;
  freeText: string; // 「追加の要望」(リファレンスに重ねて反映する。daily は空)
  extraContext?: string; // 「今日のコンテキスト」(ニュース。毎日の自動生成のみ)
  // 参照曲。daily / artist のどちらも必ず持つ(2026-08-10 に必須化)
  referenceSong: ReferenceSong;
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

// LLM に送る user メッセージを組み立てる(純関数。テストで直接検証できるよう分離)。
// 歌声の言語は設定値なので、limits と同じく呼び出し側(generateSongPlan)が読んで渡す
export function buildSongPlanPrompt(
  input: SongPlanInput,
  limits: WordLimits,
  lang: VocalLanguage
): string {
  const sections: string[] = [];

  // 生成は daily / artist の 2 経路だけで、どちらも参照曲を持つ(2026-08-10 に分岐を撤去)。
  // 曲調は参照曲が決めるため、要素プールや直近スタイルは提示しない
  const ref = input.referenceSong;
  const refLines = [`- アーティスト: ${ref.artist}`, `- 曲名: ${ref.title}`];
  if (ref.album) refLines.push(`- 収録アルバム: ${ref.album}`);
  if (ref.releaseYear) refLines.push(`- リリース年: ${ref.releaseYear}`);
  if (ref.genre) refLines.push(`- ジャンル(iTunes の分類): ${ref.genre}`);
  sections.push(`## リファレンス楽曲(この曲に似た新曲を作る)\n${refLines.join("\n")}`);

  const howTo = [
    "- **まず web_search でリファレンス楽曲の音楽的特徴を調べる**(BPM、キー、コード進行、楽器編成、ボーカルの音域と質感、プロダクション)。記憶だけで書かず、調べられるものは調べること",
    "- 検索では**上に挙げたアーティスト名・アルバム・リリース年と一致する曲かを必ず確かめる**。同名の別の曲の情報を使ってはいけない",
    "- 調べた特徴を具体的な英語の音楽用語に翻訳して style を書く。「〜風」と書くのではなく、音そのものを記述すること",
    "- **style・title・lyrics に実在の固有名詞(アーティスト名・バンド名・曲名)を一切含めない**。上記のアーティスト名・曲名も、検索結果に出てきた名前も書いてはいけない。Suno のモデレーションが固有名詞を拒否し、生成そのものが失敗する",
    "- 歌詞は原曲の歌詞を複製・翻訳・言い換えしない。テーマや情景の方向性を参考にするのは構わないが、完全な新作の歌詞を書く",
    // 参照曲と今日のコンテキストが同時に来るのは毎日の自動生成の経路。音と言葉で担当を分ける
    ...(input.extraContext
      ? [
          "- 曲調・編成・ボーカルの質感はリファレンス楽曲に寄せ、歌詞のテーマ・情景は今日のコンテキストから採る。両者が衝突する場合は、音はリファレンス・言葉はコンテキストを優先する",
        ]
      : []),
    "- 検索で確かめられなかった要素は、そのアーティストの一般的な作風から推定してよい。その場合も推測であることを断らずに具体的に書き切ること",
    "- intent には、取り入れた音楽的特徴と、その根拠を**項目ごとに書き分ける**(検索で確認した / 曲を知っている / 作風からの推定)",
    "- sources には、実際に参照した情報源の URL またはタイトルを列挙する(検索しなかった場合は空配列)",
  ];
  sections.push(`## 作り方(厳守)\n${howTo.join("\n")}`);

  if (input.freeText) {
    sections.push(`## 追加の要望(リファレンスに重ねて反映する)\n${input.freeText}`);
  }
  if (input.extraContext) {
    sections.push(
      `## 今日のコンテキスト(歌詞・曲調の着想に使う。ニュースの報告ではなく、雰囲気やテーマとしてさりげなく織り込む)\n${input.extraContext}`
    );
  }
  if (limits.banned.length > 0) {
    // 参照曲は禁止ワードより優先する(衝突したら再現が勝つ)
    sections.push(
      `## 使用禁止ワード(直近で使いすぎ。テーマ・スタイル・歌詞の中心に据えず、realWorldWords にも含めない。ただしリファレンス楽曲の再現と衝突する場合はリファレンスを優先する)\n${limits.banned.map((w) => `- ${w}`).join("\n")}`
    );
  }
  if (limits.lastChance.length > 0) {
    sections.push(
      `## 残り 1 回のワード(できれば別のアイデアを優先する)\n${limits.lastChance.map((w) => `- ${w}`).join("\n")}`
    );
  }
  // realWorldWords の出力指示はスキーマの description で行う(ここに書くと LLM 入力全文の
  // 表示にプロンプト指示文が混ざり、具体的なワードと紛らわしいため)
  const ja = lang === "ja";
  const emptyFields = ja ? "lyrics は空文字列" : "lyrics / lyricsJa は空文字列";
  const conditions = [
    `- インストゥルメンタル: ${input.instrumental ? `はい(${emptyFields})` : "いいえ(歌詞を書く)"}`,
  ];
  if (!input.instrumental) {
    conditions.push(
      `- 歌詞の言語: ${ja ? "日本語" : "英語"}(この歌詞をそのまま Suno に渡して歌わせる)`
    );
    if (ja) {
      // Suno の日本語読みの弱点(助詞の「は」「へ」・数字の英語読み・漢字の誤読)への対策。
      // 歌詞はアプリにそのまま表示・保存されるので、助詞を「ワ」「エ」に書き換えるような
      // 表記置換はさせない(読みは安定するが、歌詞が読み物として崩れる)
      conditions.push(
        "- 日本語の表記: 漢字かな交じりの自然な表記で書く(全部ひらがなにしない)。算用数字は使わず日本語の表記にする(「7時」ではなく「七時」)。読み間違えられやすい語(特殊な読みの熟語・当て字)は避け、別の言い回しに置き換える。歌唱を補助するための表記の崩し(助詞を「ワ」「エ」と書くなど)はしない",
        "- style には日本語で歌っていることが分かる指定(Japanese vocals, natural Japanese pronunciation など)を必ず含める(style 自体は英語で書く)"
      );
    }
    // 参照曲の声に寄せるのが目的なので、声色を散らす指示は出さない
    conditions.push(
      "- 歌声: style に歌手の声の特徴(性別・声質・年齢感)を必ず含める。リファレンス楽曲のボーカルの質感に寄せること"
    );
  }
  sections.push(`## 出力条件\n${conditions.join("\n")}`);

  return sections.join("\n\n");
}

const SYSTEM_PROMPT =
  "あなたは優れた音楽プロデューサー兼作詞家です。AI 音楽生成サービス Suno に渡すスタイルプロンプトと歌詞を作ります。" +
  "毎日、ユーザーの生活に寄り添う新しい曲を届けるのが仕事です。ありきたりな表現を避け、具体的で音の想像がつくスタイル指定と、心に残る歌詞を書いてください。";

// 参照曲を調べる検索の上限。実測では 5 回で BPM・キー・コード進行・音域まで揃い、
// 1 曲あたり 3 分ほど・入力 12 万トークンほどかかる。増やすと精度より先に時間とコストが伸びる
const WEB_SEARCH_MAX_USES = 5;
// server tool の反復上限で pause_turn が返ったときの再開回数の上限(無限ループ防止)
const MAX_PAUSE_RESUMES = 3;

// max_tokens は思考と本文の合算の上限。effort が高いほど思考がこの枠を食い、
// 足りないと JSON が途中で切れて JSON.parse に失敗する(= タスクが FAILED)。
// effort=max の実測は 1 曲目 15,639 / 2 曲目 20,139 トークンと振れ幅が大きく、
// 旧上限の 16,000 では 2 曲目が切れていたため広く取る
const MAX_TOKENS = 32000;

// 検索の失敗は例外にならず、web_search_tool_result の content がエラーオブジェクト
// (配列ではない)で返る。検索できなくても作風からの推定で書けるので警告だけ出して続行する
function logSearchOutcome(message: Anthropic.Message): void {
  let searches = 0;
  const errors: string[] = [];
  for (const block of message.content) {
    if (block.type === "server_tool_use") searches++;
    if (block.type === "web_search_tool_result" && !Array.isArray(block.content)) {
      errors.push(
        (block.content as { error_code?: string }).error_code ?? "unknown_error"
      );
    }
  }
  if (errors.length > 0) {
    console.warn(`[llm] web_search が失敗しました(${errors.join(", ")})。推定で続行します`);
  } else if (searches > 0) {
    console.log(`[llm] web_search でリファレンス楽曲を調査(ツール呼び出し ${searches} 回)`);
  }
}

async function requestSongPlan(
  llmPrompt: string,
  lang: VocalLanguage
): Promise<SongPlan> {
  // 生成は必ず参照曲を持つので web_search は常時有効。
  // code_execution は宣言しない — web_search_20260209 の動的フィルタリングが内部で使うため、
  // 別途宣言すると実行環境が 2 つになりモデルが混乱する
  const tools = [
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: WEB_SEARCH_MAX_USES },
  ];

  const { llmModel, llmEffort } = getLlmSettings();
  console.log(
    `[llm] ${llmModel} で生成します(effort=${llmEffort} / 歌詞=${lang} / web_search 有効)`
  );

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: llmPrompt }];
  for (let resumes = 0; ; resumes++) {
    // ストリーミングで受ける(応答の扱いは finalMessage() で非ストリーミングと同じ)。
    // SDK は max_tokens が 21,333 を超える非ストリーミング要求を「10 分を超える恐れ」として
    // 送信前に例外にするため、上記の MAX_TOKENS ではこちらでないと通らない
    const message = await client.messages
      .stream({
        model: llmModel,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        tools,
        output_config: {
          effort: llmEffort,
          format: { type: "json_schema", schema: songPlanSchema(lang) },
        },
      })
      .finalMessage();
    logSearchOutcome(message);
    console.log(
      `[llm] 応答 stop_reason=${message.stop_reason} ` +
        `入力 ${message.usage.input_tokens} / 出力 ${message.usage.output_tokens}(上限 ${MAX_TOKENS})`
    );
    // server tool がサーバー側の反復上限に達した合図。直前の応答を添えて送り直すと続きから再開する
    // (「続けて」のような追加メッセージは付けない — 付けると再開ではなく新しい指示として読まれる)
    if (message.stop_reason === "pause_turn" && resumes < MAX_PAUSE_RESUMES) {
      messages = [
        { role: "user", content: llmPrompt },
        { role: "assistant", content: message.content as Anthropic.ContentBlockParam[] },
      ];
      continue;
    }
    return JSON.parse(firstText(message)) as SongPlan;
  }
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

// 参照曲ありの生成の固有名詞チェック。Suno はプロンプト内のアーティスト名・曲名をモデレーションで
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
  // 検索結果由来の固有名詞がそのまま Suno の SENSITIVE_WORD_ERROR を踏むため必ず検査する
  const nouns = properNounsIn(plan, input.referenceSong);
  if (nouns.length > 0) {
    issues.push({
      label: `固有名詞の混入(${nouns.join(", ")})`,
      instruction:
        `前回の出力には固有名詞(${nouns.join(", ")})が含まれていた。Suno のモデレーションに拒否され生成が失敗するため、` +
        `style・title・lyrics から固有名詞を完全に取り除き、音楽的特徴の記述だけで書き直すこと。`,
    });
  }
  return issues;
}

// スタイル+歌詞+訳+タイトル+狙い+リアルワードを生成する。参照曲の音楽的特徴を
// web_search で調べて寄せる(daily / artist 共通)。
// リアルワードの使用制限は両経路共通でここで一元処理する
export async function generateSongPlan(input: SongPlanInput): Promise<SongPlanResult> {
  const limits = currentWordLimits();
  const lang = getVocalLanguage();
  let llmPrompt = buildSongPlanPrompt(input, limits, lang);
  let plan = await requestSongPlan(llmPrompt, lang);

  // 検証リトライ: 禁止ワードの残留・固有名詞の混入があれば、指示を強めて 1 回だけ再生成する
  const issues = planIssues(plan, input, limits);
  if (issues.length > 0) {
    console.warn(
      `[llm] ${issues.map((i) => i.label).join(" / ")}が含まれたため再生成します`
    );
    llmPrompt += `\n\n## 再生成の指示(厳守)\n${issues.map((i) => i.instruction).join("\n")}`;
    plan = await requestSongPlan(llmPrompt, lang);
    const still = planIssues(plan, input, limits);
    if (still.length > 0) {
      // 生成は止めない(警告のみ。固有名詞が残った場合は Suno 側で FAILED として観測できる)
      console.warn(
        `[llm] 再生成後も ${still.map((i) => i.label).join(" / ")} が残ったため、そのまま採用します`
      );
    }
  }

  console.log(`[llm] 生成プラン: "${plan.title}" style=${plan.style.slice(0, 80)}...`);
  return { plan, llmModel: LLM_MODEL, llmPrompt, lyricsLang: lang };
}
