#!/usr/bin/env node
// sunoapi.org の生成フロー検証スクリプト(依存パッケージなし・Node 18+)
//
// フロー: 残クレジット確認 → 生成リクエスト → ポーリング → MP3 ダウンロード → 消費クレジット報告
//
// 使い方:
//   .env に SUNOAPI_ORG_KEY=<APIキー> を書いてから
//   node scripts/verify-sunoapi.mjs [--instrumental] [--prompt "..."]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// kie.ai(同一運営・同一 API 構造)を使う場合は SUNOAPI_BASE_URL=https://api.kie.ai
let BASE_URL = "https://api.sunoapi.org";
const MODEL = "V5";
// callBackUrl はスキーマ上必須だが、完了検知はポーリングで行うためプレースホルダを渡す
const PLACEHOLDER_CALLBACK = "https://example.com/suno-callback";
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 10 * 60_000;
const OUTPUT_DIR = "output";

const DEFAULT_PROMPT =
  "A calm and warm morning song with acoustic guitar and soft vocals";

// .env の全変数を process.env に取り込む(既存の環境変数が優先)
async function loadEnv() {
  try {
    const env = await readFile(new URL("../.env", import.meta.url), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env が無ければ環境変数のみ
  }
  if (process.env.SUNOAPI_BASE_URL) BASE_URL = process.env.SUNOAPI_BASE_URL;
  if (!process.env.SUNOAPI_ORG_KEY) {
    console.error(
      "API キーが見つかりません。.env に SUNOAPI_ORG_KEY=<key> を書くか、環境変数で渡してください。"
    );
    process.exit(1);
  }
  return process.env.SUNOAPI_ORG_KEY;
}

async function api(apiKey, method, pathname, body) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.code !== 200) {
    throw new Error(
      `${method} ${pathname} failed: HTTP ${res.status} / ${JSON.stringify(json)}`
    );
  }
  return json.data;
}

// クレジット確認のパスはプロバイダで異なる(sunoapi.org: /generate/credit、kie.ai: /chat/credit)。
// どちらも無ければ警告して続行する
async function getCredits(apiKey) {
  for (const pathname of ["/api/v1/generate/credit", "/api/v1/chat/credit"]) {
    try {
      return await api(apiKey, "GET", pathname);
    } catch {
      // 次の候補を試す
    }
  }
  console.warn("クレジット確認をスキップ(どのエンドポイントも応答せず)");
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const instrumental = args.includes("--instrumental");
  const promptIndex = args.indexOf("--prompt");
  const prompt = promptIndex >= 0 ? args[promptIndex + 1] : DEFAULT_PROMPT;

  const apiKey = await loadEnv();
  console.log(`API: ${BASE_URL}`);

  const creditsBefore = await getCredits(apiKey);
  if (creditsBefore !== null) console.log(`残クレジット: ${creditsBefore}`);

  console.log(`生成リクエスト送信 (model=${MODEL}, instrumental=${instrumental})`);
  console.log(`prompt: ${prompt}`);
  const startedAt = Date.now();
  const { taskId } = await api(apiKey, "POST", "/api/v1/generate", {
    customMode: false,
    instrumental,
    model: MODEL,
    prompt,
    callBackUrl: PLACEHOLDER_CALLBACK,
  });
  console.log(`taskId: ${taskId}`);

  let record;
  while (true) {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      throw new Error(`タイムアウト(${TIMEOUT_MS / 60_000} 分)。taskId=${taskId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    record = await api(
      apiKey,
      "GET",
      `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`
    );
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[${elapsed}s] status=${record.status}`);

    if (record.status === "SUCCESS") break;
    // コールバック失敗は生成自体の失敗ではない。データがあれば成功扱い
    if (record.status === "CALLBACK_EXCEPTION" && record.response?.sunoData?.length) {
      console.warn("コールバックは失敗しましたが、生成データは取得できています。");
      break;
    }
    if (
      ["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "SENSITIVE_WORD_ERROR", "CALLBACK_EXCEPTION"].includes(
        record.status
      )
    ) {
      throw new Error(`生成失敗: ${record.status} / ${JSON.stringify(record)}`);
    }
  }

  const tracks = record.response?.sunoData ?? [];
  if (tracks.length === 0) {
    throw new Error(`SUCCESS だが sunoData が空: ${JSON.stringify(record)}`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [i, track] of tracks.entries()) {
    console.log(
      `track ${i + 1}: "${track.title}" (${track.duration}s)\n  audioUrl: ${track.audioUrl}`
    );
    const res = await fetch(track.audioUrl);
    if (!res.ok) {
      console.warn(`  ダウンロード失敗: HTTP ${res.status}`);
      continue;
    }
    const file = path.join(OUTPUT_DIR, `${taskId}-${i + 1}.mp3`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(`  保存: ${file}`);
  }

  const creditsAfter = await getCredits(apiKey);
  const totalSec = Math.round((Date.now() - startedAt) / 1000);
  console.log("---");
  console.log(`所要時間: ${totalSec} 秒`);
  if (creditsBefore !== null && creditsAfter !== null) {
    console.log(
      `クレジット: ${creditsBefore} → ${creditsAfter}(消費 ${creditsBefore - creditsAfter})`
    );
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
