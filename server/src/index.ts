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

function trackJson(t: db.TrackRow, prefix: string) {
  return {
    id: t.id,
    taskId: t.task_id,
    title: t.title,
    duration: t.duration,
    audioUrl: `${prefix}/audio/${t.audio_file}`,
    imageUrl: t.image_file ? `${prefix}/images/${t.image_file}` : null,
    rating: t.rating,
    favorite: t.favorite === 1,
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

// 👍/👎/★ の付与・解除。body は { rating?: 1 | -1 | null, favorite?: boolean } の部分更新
api.post("/tracks/:id/rating", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const body = await c.req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return c.json({ error: "JSON body を指定してください" }, 400);
  }
  const input: { rating?: 1 | -1 | null; favorite?: boolean } = {};
  if ("rating" in body) {
    if (body.rating !== 1 && body.rating !== -1 && body.rating !== null) {
      return c.json({ error: "rating は 1 / -1 / null のいずれかです" }, 400);
    }
    input.rating = body.rating;
  }
  if ("favorite" in body) {
    if (typeof body.favorite !== "boolean") {
      return c.json({ error: "favorite は boolean です" }, 400);
    }
    input.favorite = body.favorite;
  }
  if (input.rating === undefined && input.favorite === undefined) {
    return c.json({ error: "rating か favorite を指定してください" }, 400);
  }
  const track = db.updateTrackRating(id, input);
  if (!track) return c.json({ error: "楽曲が見つかりません" }, 404);
  return c.json({ track: trackJson(track, urlPrefix(c)) });
});

api.get("/credits", async (c) => {
  return c.json({ credits: await sunoClient.getCredits() });
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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`daily-ai-music admin: http://localhost:${info.port}/admin/`);
  startPoller();
});
