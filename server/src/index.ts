// エントリポイント。API + 管理画面(静的ファイル)+ 保存済み音源の配信
import crypto from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { API_SECRET, AUDIO_DIR, IMAGE_DIR, PORT, PUBLIC_DIR } from "./config.ts";
import { getContextSettings } from "./context.ts";
import * as db from "./db.ts";
import { startGeneration, startPoller, sunoClient } from "./generation.ts";
import { currentWordLimits, generateSongPlan } from "./llm.ts";
import { CATEGORY_LABELS, SEED_PRESETS } from "./presets.ts";
import {
  getDailySettings,
  isValidTimezone,
  runDaily,
  startScheduler,
} from "./scheduler.ts";

const app = new Hono();

function isValidApiSecret(provided: string | undefined): boolean {
  if (!provided) return false;
  // timing-safe 比較(長さ差で漏れないよう sha256 で固定長に揃える)
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const secretHash = crypto.createHash("sha256").update(API_SECRET).digest();
  return crypto.timingSafeEqual(providedHash, secretHash);
}

app.get("/health", (c) => c.json({ status: "ok" }));

// API 本体。/api(iOS アプリ向け・X-API-Secret 必須)と
// /admin/api(管理画面向け・アプリ層は無認証。本番はエッジの Cloudflare Access が /admin ごと保護)の両方にマウントする
const api = new Hono();

// クライアントの接続テスト用(/api 配下では X-API-Secret の一致確認になる)
api.get("/ping", (c) => c.json({ ok: true }));

function taskJson(t: db.TaskRow) {
  return {
    id: t.id,
    prompt: t.prompt,
    instrumental: t.instrumental === 1,
    model: t.model,
    status: t.status,
    error: t.error,
    mode: t.mode,
    title: t.title,
    style: t.style,
    styleJa: t.style_ja,
    lyrics: t.lyrics,
    lyricsJa: t.lyrics_ja,
    intent: t.intent,
    llmModel: t.llm_model,
    llmPrompt: t.llm_prompt,
    realWorldWords: db.listRealWorldWords(t.id),
    usedPresets: db.listTaskPresets(t.id).map(usedPresetJson),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// 使用プリセット(使用時点のスナップショット)の API 表現
function usedPresetJson(p: db.TaskPresetRow) {
  return { category: p.category, value: p.value, labelJa: p.label_ja };
}

// LLM 経由の生成フロー: プリセット選択 + 自由テキスト → LLM がスタイル・歌詞を生成 → Suno へ customMode で送信
api.post("/generate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const freeText = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const presetIds: number[] = Array.isArray(body?.presetIds)
    ? body.presetIds.filter((id: unknown) => Number.isInteger(id))
    : [];
  const instrumental = body?.instrumental === true;
  if (!freeText && presetIds.length === 0) {
    return c.json({ error: "プリセットか自由テキストを指定してください" }, 400);
  }
  if (freeText.length > 2000) {
    return c.json({ error: "自由テキストが長すぎます(2000 文字以内)" }, 400);
  }
  const selectedPresets = presetIds
    .map((id) => db.getPreset(id))
    .filter((p): p is db.PresetRow => p !== undefined);

  // タスク一覧に出す表示用のリクエスト内容
  const promptParts: string[] = [];
  if (freeText) promptParts.push(freeText);
  if (selectedPresets.length > 0) {
    promptParts.push(`プリセット: ${selectedPresets.map((p) => p.label_ja).join("、")}`);
  }
  const displayPrompt = promptParts.join(" / ");

  try {
    const { plan, llmModel, llmPrompt } = await generateSongPlan({
      mode: "manual",
      instrumental,
      selectedPresets,
      presetPool: db.listPresets(),
      freeText,
      recentStyles: db.listRecentStyles(),
    });
    const task = await startGeneration({
      prompt: displayPrompt,
      instrumental,
      mode: "manual",
      plan,
      selectedPresets,
      llmModel,
      llmPrompt,
    });
    return c.json({ task: taskJson(task) }, 201);
  } catch (err) {
    console.error(`[api] 生成リクエスト失敗: ${err}`);
    return c.json({ error: `生成リクエストに失敗しました: ${err}` }, 502);
  }
});

// --- 毎日の自動生成の設定・手動トリガ ---

// 毎日の自動生成+外部コンテキスト+リアルワード制限の設定をまとめて返す
function allSettings() {
  return {
    ...getDailySettings(),
    ...getContextSettings(),
    ...db.getWordLimitSettings(),
  };
}

api.get("/settings", (c) => {
  return c.json({ settings: allSettings() });
});

// 部分更新: { dailyEnabled?, adventureProbability?, dailyHour?, dailyTimezone?,
//            contextNews?, wordMaxUses?, wordWindowDays? }
api.put("/settings", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return c.json({ error: "JSON body を指定してください" }, 400);
  }
  const updates: [key: string, value: string][] = [];
  if ("dailyEnabled" in body) {
    if (typeof body.dailyEnabled !== "boolean") {
      return c.json({ error: "dailyEnabled は boolean です" }, 400);
    }
    updates.push(["daily_enabled", String(body.dailyEnabled)]);
  }
  if ("adventureProbability" in body) {
    const p = body.adventureProbability;
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) {
      return c.json({ error: "adventureProbability は 0〜1 の数値です" }, 400);
    }
    updates.push(["adventure_probability", String(p)]);
  }
  if ("dailyHour" in body) {
    const h = body.dailyHour;
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      return c.json({ error: "dailyHour は 0〜23 の整数です" }, 400);
    }
    updates.push(["daily_hour", String(h)]);
  }
  if ("dailyTimezone" in body) {
    if (typeof body.dailyTimezone !== "string" || !isValidTimezone(body.dailyTimezone)) {
      return c.json({ error: "dailyTimezone が不正です(IANA タイムゾーン名)" }, 400);
    }
    updates.push(["daily_timezone", body.dailyTimezone]);
  }
  if ("contextNews" in body) {
    if (typeof body.contextNews !== "boolean") {
      return c.json({ error: "contextNews は boolean です" }, 400);
    }
    updates.push(["context_news", String(body.contextNews)]);
  }
  if ("wordMaxUses" in body) {
    const v = body.wordMaxUses;
    if (!Number.isInteger(v) || v < 1 || v > 100) {
      return c.json({ error: "wordMaxUses は 1〜100 の整数です" }, 400);
    }
    updates.push(["word_max_uses", String(v)]);
  }
  if ("wordWindowDays" in body) {
    const v = body.wordWindowDays;
    if (!Number.isInteger(v) || v < 1 || v > 365) {
      return c.json({ error: "wordWindowDays は 1〜365 の整数です" }, 400);
    }
    updates.push(["word_window_days", String(v)]);
  }
  if (updates.length === 0) {
    return c.json({ error: "更新するフィールドを指定してください" }, 400);
  }
  for (const [key, value] of updates) db.setSetting(key, value);
  return c.json({ settings: allSettings() });
});

// おまかせ生成(runDaily)が LLM に注入する入力の一覧(iOS の生成パラメータ画面用)。
// runDaily と同じ関数群から組み立てることで、表示と実際の生成入力のずれを防ぐ
api.get("/generation-params", (c) => {
  const daily = getDailySettings();
  const context = getContextSettings();
  const ratings = db.countPresetRatings();
  const limits = currentWordLimits();
  const { wordMaxUses, wordWindowDays } = db.getWordLimitSettings();
  return c.json({
    params: {
      adventureProbability: daily.adventureProbability,
      contextNews: context.contextNews,
      presets: db.listPresets().map((p) => presetJson(p, ratings)),
      categoryLabels: CATEGORY_LABELS,
      recentStyles: db.listRecentStyleRows(),
      wordMaxUses,
      wordWindowDays,
      bannedWords: limits.banned,
      lastChanceWords: limits.lastChance,
      trackedWordCount: db.countRealWorldWordUses(wordWindowDays).length,
    },
  });
});

// 直近ウィンドウ内のリアルワード使用状況(パラメータ一覧ページの表示用)
api.get("/real-world-words", (c) => {
  const { wordMaxUses, wordWindowDays } = db.getWordLimitSettings();
  return c.json({
    wordMaxUses,
    wordWindowDays,
    words: db.countRealWorldWordUses(wordWindowDays),
  });
});

// 自動生成の手動トリガ(管理画面の生成ボタンが使用)。last_daily_date は更新しないため
// その日のスケジュール実行は別途行われる
api.post("/daily/run", async (c) => {
  try {
    const { task, adventure } = await runDaily();
    return c.json({ task: taskJson(task), adventure }, 201);
  } catch (err) {
    console.error(`[api] daily/run 失敗: ${err}`);
    return c.json({ error: `自動生成に失敗しました: ${err}` }, 502);
  }
});

api.get("/tasks", (c) => {
  return c.json({ tasks: db.listTasks().map(taskJson) });
});

function trackJson(t: db.TrackWithTaskRow, prefix: string) {
  return {
    id: t.id,
    taskId: t.task_id,
    title: t.title,
    duration: t.duration,
    audioUrl: `${prefix}/audio/${t.audio_file}`,
    imageUrl: t.image_file ? `${prefix}/images/${t.image_file}` : null,
    rating: t.rating,
    mode: t.mode,
    prompt: t.prompt,
    instrumental: t.instrumental === 1,
    sunoModel: t.model,
    style: t.style,
    styleJa: t.style_ja,
    lyrics: t.lyrics,
    lyricsJa: t.lyrics_ja,
    intent: t.intent,
    llmModel: t.llm_model,
    llmPrompt: t.llm_prompt,
    realWorldWords: db.listRealWorldWords(t.task_id),
    usedPresets: db.listTaskPresets(t.task_id).map(usedPresetJson),
    createdAt: t.created_at,
  };
}

// 音源・画像 URL はマウント先(/api = secret 必須、/admin/api = Access 保護)と同じ認証帯を返す
function urlPrefix(c: { req: { path: string } }): string {
  return c.req.path.startsWith("/admin/") ? "/admin" : "/api";
}

api.get("/tracks", (c) => {
  return c.json({ tracks: db.listTracks().map((t) => trackJson(t, urlPrefix(c))) });
});

// 👍/👎 の付与・解除。body は { rating: 1 | -1 | null }(null で解除)
api.post("/tracks/:id/rating", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const body = await c.req.json().catch(() => null);
  if (body === null || typeof body !== "object" || !("rating" in body)) {
    return c.json({ error: "rating を指定してください" }, 400);
  }
  if (body.rating !== 1 && body.rating !== -1 && body.rating !== null) {
    return c.json({ error: "rating は 1 / -1 / null のいずれかです" }, 400);
  }
  const track = db.updateTrackRating(id, body.rating);
  if (!track) return c.json({ error: "楽曲が見つかりません" }, 404);
  return c.json({ track: trackJson(track, urlPrefix(c)) });
});

api.get("/credits", async (c) => {
  return c.json({ credits: await sunoClient.getCredits() });
});

// --- プリセット管理 ---

// ratings は countPresetRatings() の集計(省略時は 0 件扱い。iOS 既存コードは未知キーを無視するので後方互換)
function presetJson(p: db.PresetRow, ratings?: Map<number, db.PresetRatingCount>) {
  const r = ratings?.get(p.id);
  return {
    id: p.id,
    category: p.category,
    value: p.value,
    labelJa: p.label_ja,
    upCount: r?.up ?? 0,
    downCount: r?.down ?? 0,
    createdAt: p.created_at,
  };
}

// body の各フィールドを検証して trim 済み値を返す。partial=true なら未指定フィールドを許す
function parsePresetBody(
  body: unknown,
  partial: boolean
): { category?: string; value?: string; labelJa?: string } | { error: string } {
  if (body === null || typeof body !== "object") {
    return { error: "JSON body を指定してください" };
  }
  const b = body as Record<string, unknown>;
  const result: { category?: string; value?: string; labelJa?: string } = {};
  for (const key of ["category", "value", "labelJa"] as const) {
    if (b[key] === undefined) {
      if (!partial) return { error: `${key} を指定してください` };
      continue;
    }
    if (typeof b[key] !== "string") return { error: `${key} は文字列です` };
    const trimmed = (b[key] as string).trim();
    if (!trimmed) return { error: `${key} が空です` };
    if (trimmed.length > 100) return { error: `${key} が長すぎます(100 文字以内)` };
    result[key] = trimmed;
  }
  if (partial && Object.keys(result).length === 0) {
    return { error: "更新するフィールドを指定してください" };
  }
  return result;
}

api.get("/presets", (c) => {
  const ratings = db.countPresetRatings();
  return c.json({
    presets: db.listPresets().map((p) => presetJson(p, ratings)),
    categoryLabels: CATEGORY_LABELS,
  });
});

api.post("/presets", async (c) => {
  const parsed = parsePresetBody(await c.req.json().catch(() => null), false);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  try {
    const preset = db.createPreset({
      category: parsed.category!,
      value: parsed.value!,
      labelJa: parsed.labelJa!,
    });
    return c.json({ preset: presetJson(preset) }, 201);
  } catch {
    return c.json({ error: "同じカテゴリ・値のプリセットが既にあります" }, 409);
  }
});

api.put("/presets/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const parsed = parsePresetBody(await c.req.json().catch(() => null), true);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  try {
    const preset = db.updatePreset(id, parsed);
    if (!preset) return c.json({ error: "プリセットが見つかりません" }, 404);
    // 行内編集の保存後もページ側が集計表示を維持できるよう、集計付きで返す
    return c.json({ preset: presetJson(preset, db.countPresetRatings()) });
  } catch {
    return c.json({ error: "同じカテゴリ・値のプリセットが既にあります" }, 409);
  }
});

api.delete("/presets/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  if (!db.deletePreset(id)) return c.json({ error: "プリセットが見つかりません" }, 404);
  return c.json({ ok: true });
});

// /api/* は X-API-Secret ヘッダ必須
app.use("/api/*", async (c, next) => {
  if (!isValidApiSecret(c.req.header("x-api-secret"))) {
    console.warn(`[api] rejected (invalid X-API-Secret) ${c.req.method} ${c.req.path}`);
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
app.route("/api", api);
app.route("/admin/api", api);

// 音源・カバー画像も API と同じ二重マウント(/api = X-API-Secret 必須、/admin = 本番はエッジの Cloudflare Access)。
// <audio>/<img> タグはヘッダを付けられないが Cookie は自動送信されるため管理画面は /admin 側を、
// AVPlayer は AVURLAsset のヘッダ注入で /api 側を使う
for (const prefix of ["/api", "/admin"]) {
  app.use(
    `${prefix}/audio/*`,
    serveStatic({
      root: AUDIO_DIR,
      rewriteRequestPath: (p) => p.slice(`${prefix}/audio`.length),
    })
  );
  app.use(
    `${prefix}/images/*`,
    serveStatic({
      root: IMAGE_DIR,
      rewriteRequestPath: (p) => p.slice(`${prefix}/images`.length),
    })
  );
}

// 管理画面は /admin 配下(本番で Cloudflare Access をこのパスだけに掛けるため)
app.get("/", (c) => c.redirect("/admin/"));
app.get("/admin", (c) => c.redirect("/admin/"));
app.use(
  "/admin/*",
  serveStatic({
    root: PUBLIC_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/admin/, ""),
  })
);

// 初期プリセット投入(DB に 1 件も無いカテゴリだけ。既存カテゴリ内でユーザーが
// 編集・削除した内容は再投入せず、後から追加された新カテゴリは既存 DB にも入る)
{
  const existing = new Set(db.listPresets().map((p) => p.category));
  const toSeed = SEED_PRESETS.filter((p) => !existing.has(p.category));
  if (toSeed.length > 0) {
    for (const p of toSeed) db.createPreset(p);
    const categories = [...new Set(toSeed.map((p) => p.category))].join(", ");
    console.log(
      `[presets] 初期プリセット ${toSeed.length} 件を投入しました(カテゴリ: ${categories})`
    );
  }
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Music Plant admin: http://localhost:${info.port}/admin/`);
  startPoller();
  startScheduler();
});
