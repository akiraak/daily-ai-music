// エントリポイント。API + 管理画面(静的ファイル)+ 保存済み音源の配信
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { AUDIO_DIR, IMAGE_DIR, PORT, PUBLIC_DIR } from "./config.ts";
import * as db from "./db.ts";
import { startGeneration, startPoller, sunoClient } from "./generation.ts";

const app = new Hono();

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

app.post("/api/generate", async (c) => {
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

app.get("/api/tasks", (c) => {
  return c.json({ tasks: db.listTasks().map(taskJson) });
});

app.get("/api/tracks", (c) => {
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

app.get("/api/credits", async (c) => {
  return c.json({ credits: await sunoClient.getCredits() });
});

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
app.use("/*", serveStatic({ root: PUBLIC_DIR }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`daily-ai-music admin: http://localhost:${info.port}`);
  startPoller();
});
