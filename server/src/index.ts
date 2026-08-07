// エントリポイント。API + 管理画面(静的ファイル)+ 保存済み音源の配信
import crypto from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { API_SECRET, AUDIO_DIR, IMAGE_DIR, PORT, PUBLIC_DIR } from "./config.ts";
import * as db from "./db.ts";
import { startGeneration, startPoller, sunoClient } from "./generation.ts";

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
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

api.post("/generate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const instrumental = body?.instrumental === true;
  if (!prompt) {
    return c.json({ error: "prompt を入力してください" }, 400);
  }
  if (prompt.length > 2000) {
    return c.json({ error: "prompt が長すぎます(2000 文字以内)" }, 400);
  }
  try {
    const task = await startGeneration({ prompt, instrumental });
    return c.json({ task: taskJson(task) }, 201);
  } catch (err) {
    console.error(`[api] 生成リクエスト失敗: ${err}`);
    return c.json({ error: `生成リクエストに失敗しました: ${err}` }, 502);
  }
});

api.get("/tasks", (c) => {
  return c.json({ tasks: db.listTasks().map(taskJson) });
});

api.get("/tracks", (c) => {
  const tracks = db.listTracks().map((t) => ({
    id: t.id,
    taskId: t.task_id,
    title: t.title,
    duration: t.duration,
    audioUrl: `/audio/${t.audio_file}`,
    imageUrl: t.image_file ? `/images/${t.image_file}` : null,
    createdAt: t.created_at,
  }));
  return c.json({ tracks });
});

api.get("/credits", async (c) => {
  return c.json({ credits: await sunoClient.getCredits() });
});

// /api/* は X-API-Secret ヘッダ必須。/audio /images は当面無認証(ローカル LAN 運用。公開時に見直す)
app.use("/api/*", async (c, next) => {
  if (!isValidApiSecret(c.req.header("x-api-secret"))) {
    console.warn(`[api] rejected (invalid X-API-Secret) ${c.req.method} ${c.req.path}`);
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
app.route("/api", api);
app.route("/admin/api", api);

app.use(
  "/audio/*",
  serveStatic({
    root: AUDIO_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/audio/, ""),
  })
);
app.use(
  "/images/*",
  serveStatic({
    root: IMAGE_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/images/, ""),
  })
);

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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`daily-ai-music admin: http://localhost:${info.port}/admin/`);
  startPoller();
});
