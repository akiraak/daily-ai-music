// 生成ジョブ管理。タスク作成 → ポーラーが完了検知 → 音源・カバー画像を data/ に保存
// プロバイダの audioUrl は一時ファイル置き場のため、完了検知後すぐダウンロードする
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { AUDIO_DIR, IMAGE_DIR, SUNO_API_KEY, SUNO_BASE_URL, SUNO_MODEL } from "./config.ts";
import * as db from "./db.ts";
import type { SunoClient, SunoTrack } from "./suno/client.ts";
import { KieAiClient } from "./suno/kieai.ts";

const POLL_INTERVAL_MS = 10_000;
// これを超えて完了しないタスクは打ち切る(実測は約 2 分で完了)
const TASK_TIMEOUT_MS = 30 * 60_000;

export const sunoClient: SunoClient = new KieAiClient(SUNO_API_KEY, SUNO_BASE_URL);

// LLM が出力した usedPresets をプリセット表と照合して解決する(category は完全一致、
// value は trim + 小文字化で比較)。一致しないものは写し間違い・独自要素として捨てる(警告ログのみ)
function resolveUsedPresets(
  used: { category: string; value: string }[]
): db.PresetRow[] {
  const pool = db.listPresets();
  const resolved: db.PresetRow[] = [];
  for (const u of used) {
    const match = pool.find(
      (p) =>
        p.category === u.category &&
        p.value.trim().toLowerCase() === u.value.trim().toLowerCase()
    );
    if (match) {
      resolved.push(match);
    } else {
      console.warn(
        `[generation] usedPresets がプリセットと一致しないため保存しません: [${u.category}] ${u.value}`
      );
    }
  }
  return resolved;
}

// LLM が生成したプラン(customMode)で Suno に送信し、タスクを記録する。
// prompt にはユーザーのリクエスト内容(表示用)を渡す
export async function startGeneration(input: {
  prompt: string;
  instrumental: boolean;
  mode: string;
  plan: {
    style: string;
    styleJa: string;
    title: string;
    lyrics: string;
    lyricsJa: string;
    intent: string;
    realWorldWords: string[];
    usedPresets: { category: string; value: string }[];
  };
  selectedPresets?: db.PresetRow[]; // manual でユーザーが選んだ要素(必ず記録する)
  llmModel?: string;
  llmPrompt?: string;
}): Promise<db.TaskRow> {
  const providerTaskId = await sunoClient.createTask({
    customMode: true,
    style: input.plan.style,
    title: input.plan.title,
    prompt: input.plan.lyrics,
    instrumental: input.instrumental,
    model: SUNO_MODEL,
  });
  const task = db.createTask({
    provider: sunoClient.provider,
    providerTaskId,
    prompt: input.prompt,
    instrumental: input.instrumental,
    model: SUNO_MODEL,
    mode: input.mode,
    style: input.plan.style,
    styleJa: input.plan.styleJa || null,
    lyrics: input.plan.lyrics || null,
    lyricsJa: input.plan.lyricsJa || null,
    title: input.plan.title,
    intent: input.plan.intent,
    llmModel: input.llmModel ?? null,
    llmPrompt: input.llmPrompt ?? null,
  });
  // リアルワード(曲の中心となった語)を保存し、以後の生成の使用回数制限に使う
  db.insertRealWorldWords(task.id, input.plan.realWorldWords);
  // 使用プリセット: ユーザー選択(manual)と LLM 出力の照合結果の和集合を保存する(重複は insert 側で除去)
  db.insertTaskPresets(task.id, [
    ...(input.selectedPresets ?? []),
    ...resolveUsedPresets(input.plan.usedPresets),
  ]);
  console.log(`[generation] task ${task.id} 作成 (provider taskId=${providerTaskId})`);
  return task;
}

async function download(url: string, file: string): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[generation] ダウンロード失敗 HTTP ${res.status}: ${url}`);
    return false;
  }
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function saveTracks(task: db.TaskRow, tracks: SunoTrack[]): Promise<void> {
  for (const track of tracks) {
    const audioFile = `${track.id}.mp3`;
    if (!(await download(track.audioUrl, path.join(AUDIO_DIR, audioFile)))) {
      throw new Error(`音源のダウンロードに失敗: ${track.audioUrl}`);
    }
    let imageFile: string | null = null;
    if (track.imageUrl) {
      // カバー画像は再生に必須ではないので、失敗しても続行する
      const file = `${track.id}.jpeg`;
      if (await download(track.imageUrl, path.join(IMAGE_DIR, file))) {
        imageFile = file;
      }
    }
    db.insertTrack({
      taskId: task.id,
      providerTrackId: track.id,
      title: track.title,
      duration: track.duration,
      audioFile,
      imageFile,
    });
    console.log(`[generation] track 保存: "${track.title}" (${audioFile})`);
  }
}

async function pollTask(task: db.TaskRow): Promise<void> {
  const state = await sunoClient.getTask(task.provider_task_id);

  if (state.failed) {
    db.updateTaskStatus(task.id, "FAILED", state.error ?? state.status);
    console.warn(`[generation] task ${task.id} 失敗: ${state.error ?? state.status}`);
    return;
  }
  if (state.done) {
    // Suno は通常 2 曲返すが同一歌詞・スタイルのバリエーションのため、1 曲目のみ採用する
    await saveTracks(task, state.tracks.slice(0, 1));
    db.updateTaskStatus(task.id, "COMPLETE");
    console.log(
      `[generation] task ${task.id} 完了 (${state.tracks.length} tracks 中 1 曲目を採用)`
    );
    return;
  }
  if (Date.now() - Date.parse(task.created_at) > TASK_TIMEOUT_MS) {
    db.updateTaskStatus(task.id, "FAILED", `タイムアウト (status=${state.status})`);
    return;
  }
  if (state.status !== task.status) {
    db.updateTaskStatus(task.id, state.status);
  }
}

let polling = false;

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (const task of db.listActiveTasks()) {
      try {
        await pollTask(task);
      } catch (err) {
        // 一時的な API エラーの可能性があるので FAILED にせず次回に再試行する
        console.warn(`[generation] task ${task.id} のポーリングでエラー: ${err}`);
      }
    }
  } finally {
    polling = false;
  }
}

// サーバ起動時に呼ぶ。DB の未完了タスクも自動的に拾うので、再起動しても再開できる
export function startPoller(): void {
  const active = db.listActiveTasks();
  if (active.length > 0) {
    console.log(`[generation] 未完了タスク ${active.length} 件をポーリング再開`);
  }
  void pollOnce();
  setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
}
