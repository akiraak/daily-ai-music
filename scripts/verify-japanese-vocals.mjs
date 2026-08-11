#!/usr/bin/env node
// Suno が日本語の歌声を作れるかの検証スクリプト(依存パッケージなし・Node 18+)
//
// 同一の日本語歌詞・同一の style を V5 と V5_5 の 2 モデルで生成して聴き比べる。
// 本体サーバー・DB は経由しない(タスク行を作らない単発スクリプト)。
//
// 歌詞には日本語の既知の罠を意図的に含めてある:
//   助詞「は」「へ」「を」/ 数字(七時・二人・三分)/ 読み分けのある漢字(今日・明日・一日)
// 固有名詞は入れない(Suno のモデレーション対策。本体の properNounsIn() と同じ理由)
//
// 使い方:
//   .env に SUNOAPI_ORG_KEY / SUNOAPI_BASE_URL を書いてから
//   node scripts/verify-japanese-vocals.mjs [--models V5,V5_5]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

let BASE_URL = "https://api.kie.ai";
const DEFAULT_MODELS = ["V5", "V5_5"];
// callBackUrl はスキーマ上必須だが、完了検知はポーリングで行うためプレースホルダを渡す
const PLACEHOLDER_CALLBACK = "https://example.com/suno-callback";
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 10 * 60_000;
const OUTPUT_DIR = "output/ja-vocals";

const TITLE = "はじまりの朝";

// 本体(llm.ts)が Suno に渡すのと同じ粒度の英語スタイルプロンプト。日本語ボーカルを明示する
const STYLE =
  "bright J-pop, clear Japanese female vocal, natural Japanese pronunciation, " +
  "120 BPM, key of C major, bright piano, clean electric guitar arpeggios, " +
  "driving drums, warm synth pad, uplifting and hopeful, polished modern production";

const LYRICS = `[Verse]
朝の光が窓を叩く
私は今日もひとり歩く
七時の駅で 二人の影が
名前のない街へ消えた

[Pre-Chorus]
言葉にできない気持ちへ
そっと手を伸ばす

[Chorus]
明日はきっと晴れるから
夢を抱いて 歌うんだ
一日ずつ 数えながら
ここから始めよう

[Verse]
夕暮れの風 三分の沈黙
君は笑って 何も言わない
明日へ続く 長い坂道
一歩ずつ 上っていく

[Chorus]
明日はきっと晴れるから
夢を抱いて 歌うんだ
一日ずつ 数えながら
ここから始めよう

[Outro]
はじまりの朝`;

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

// クレジット確認のパスはプロバイダで異なる(kie.ai: /chat/credit、sunoapi.org: /generate/credit)
async function getCredits(apiKey) {
  for (const pathname of ["/api/v1/chat/credit", "/api/v1/generate/credit"]) {
    try {
      return await api(apiKey, "GET", pathname);
    } catch {
      // 次の候補を試す
    }
  }
  return null;
}

async function runModel(apiKey, model) {
  const startedAt = Date.now();
  const { taskId } = await api(apiKey, "POST", "/api/v1/generate", {
    customMode: true,
    instrumental: false,
    model,
    style: STYLE,
    title: TITLE,
    prompt: LYRICS,
    callBackUrl: PLACEHOLDER_CALLBACK,
  });
  console.log(`[${model}] taskId: ${taskId}`);

  let record;
  while (true) {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      throw new Error(`[${model}] タイムアウト(${TIMEOUT_MS / 60_000} 分)。taskId=${taskId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    record = await api(
      apiKey,
      "GET",
      `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`
    );
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[${model}] ${elapsed}s status=${record.status}`);

    if (record.status === "SUCCESS") break;
    // コールバック失敗は生成自体の失敗ではない。データがあれば成功扱い
    if (record.status === "CALLBACK_EXCEPTION" && record.response?.sunoData?.length) {
      console.warn(`[${model}] コールバックは失敗しましたが、生成データは取得できています。`);
      break;
    }
    if (
      ["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "SENSITIVE_WORD_ERROR", "CALLBACK_EXCEPTION"].includes(
        record.status
      )
    ) {
      throw new Error(`[${model}] 生成失敗: ${record.status} / ${JSON.stringify(record)}`);
    }
  }

  const tracks = record.response?.sunoData ?? [];
  if (tracks.length === 0) {
    throw new Error(`[${model}] SUCCESS だが sunoData が空: ${JSON.stringify(record)}`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const files = [];
  for (const [i, track] of tracks.entries()) {
    if (!track.audioUrl) continue;
    const res = await fetch(track.audioUrl);
    if (!res.ok) {
      console.warn(`[${model}] track ${i + 1} ダウンロード失敗: HTTP ${res.status}`);
      continue;
    }
    const file = path.join(OUTPUT_DIR, `${model}-${i + 1}.mp3`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    files.push(file);
    console.log(
      `[${model}] track ${i + 1}: "${track.title}" (${track.duration}s) → ${file}`
    );
  }

  return { model, taskId, seconds: Math.round((Date.now() - startedAt) / 1000), files };
}

async function main() {
  const args = process.argv.slice(2);
  const modelsIndex = args.indexOf("--models");
  const models =
    modelsIndex >= 0 ? args[modelsIndex + 1].split(",").map((s) => s.trim()) : DEFAULT_MODELS;

  const apiKey = await loadEnv();
  console.log(`API: ${BASE_URL}`);
  console.log(`モデル: ${models.join(", ")}`);

  const creditsBefore = await getCredits(apiKey);
  if (creditsBefore !== null) console.log(`残クレジット: ${creditsBefore}`);

  // 2 モデルを並行で走らせる(1 リクエスト 2 曲・数分かかるため)
  const results = await Promise.allSettled(models.map((m) => runModel(apiKey, m)));

  const creditsAfter = await getCredits(apiKey);
  console.log("---");
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      console.log(`${r.value.model}: ${r.value.seconds} 秒 / ${r.value.files.length} 曲`);
    } else {
      console.error(`${models[i]}: 失敗 — ${r.reason?.message ?? r.reason}`);
    }
  }
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
