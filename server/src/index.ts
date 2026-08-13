// エントリポイント。API + 管理画面(静的ファイル)+ 保存済み音源の配信
import crypto from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
  API_SECRET,
  AUDIO_DIR,
  IMAGE_DIR,
  PORT,
  PUBLIC_DIR,
  SITE_DIR,
  SUNO_MODEL,
} from "./config.ts";
import { getContextSettings } from "./context.ts";
import * as db from "./db.ts";
import { errorDetail, logError, logWarn, nowIso } from "./errorlog.ts";
import {
  acceptGeneration,
  completeGeneration,
  startPoller,
  sunoClient,
} from "./generation.ts";
import * as itunes from "./itunes.ts";
import {
  LLM_EFFORTS,
  VOCAL_LANGUAGES,
  currentWordLimits,
  getLlmSettings,
  getVocalLanguage,
} from "./llm.ts";
import { referenceCandidateSummary } from "./reference.ts";
import {
  NoReferenceSongError,
  getDailySettings,
  isValidTimezone,
  startDailyRun,
  startScheduler,
} from "./scheduler.ts";

const app = new Hono();

// API ルートの失敗を 1 行で記録する(呼び出し側は応答を返すだけにする)
function logRouteFailure(
  c: { req: { method: string; path: string } },
  err: unknown,
  httpStatus: number
): void {
  logError({
    source: "api",
    event: "route_failed",
    message: `${c.req.method} ${c.req.path} が失敗: ${err instanceof Error ? err.message : err}`,
    detail: { method: c.req.method, path: c.req.path, httpStatus, ...errorDetail(err) },
  });
}

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
    // 原詞の言語(旧データは null。英語固定だった頃のもの)
    lyricsLang: t.lyrics_lang,
    intent: t.intent,
    llmModel: t.llm_model,
    llmPrompt: t.llm_prompt,
    // web_search で参照した情報源(参照曲ありの生成のみ。他は空配列)
    sources: db.parseSources(t.llm_sources),
    realWorldWords: db.listRealWorldWords(t.id),
    // 参照曲(daily / artist のどちらも持つ。旧データでは null)
    refArtistName: t.ref_artist_name,
    refSongTitle: t.ref_song_title,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// アーティスト経由の生成フロー: 参照曲(artistSongId)+ 任意の追加要望 → LLM が web_search で
// その曲の音楽的特徴を調べてスタイル・歌詞を生成 → Suno へ customMode で送信。
// 参照曲は必須(自由テキストだけで作る経路は 2026-08-10 に廃止)
api.post("/generate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const freeText = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const instrumental = body?.instrumental === true;
  const artistSongId = Number.isInteger(body?.artistSongId)
    ? (body.artistSongId as number)
    : undefined;
  if (artistSongId === undefined) {
    return c.json({ error: "artistSongId を指定してください" }, 400);
  }
  if (freeText.length > 2000) {
    return c.json({ error: "自由テキストが長すぎます(2000 文字以内)" }, 400);
  }
  const song = db.getArtistSong(artistSongId);
  if (!song) {
    return c.json({ error: "参照する楽曲が見つかりません" }, 404);
  }
  // 無効な曲は UI 側でも押せないが、サーバーで弾くのが正(LLM を呼ぶ前なのでクレジットも消えない)
  if (song.enabled === 0) {
    return c.json(
      { error: "この曲は無効になっています。曲一覧で有効にしてから生成してください" },
      409
    );
  }

  // タスク一覧に出す表示用のリクエスト内容
  const promptParts = [`${song.artist_name}「${song.title}」風`];
  if (freeText) promptParts.push(freeText);

  // 受付だけ済ませて即座に返す。LLM が web_search で調べるため 3 分ほどかかり、
  // 完了まで待つとエッジのプロキシタイムアウトに掛かる。進行状況は GET /api/tasks で追える
  const task = acceptGeneration({
    prompt: promptParts.join(" / "),
    instrumental,
    mode: "artist",
    artist: {
      artistId: song.artist_id,
      artistSongId: song.id,
      artistName: song.artist_name,
      songTitle: song.title,
    },
  });
  // 失敗は completeGeneration がタスクに記録するので、ここでは握って落とさないだけでよい
  void completeGeneration(task.id, {
    instrumental,
    planInput: {
      instrumental,
      freeText,
      referenceSong: {
        artist: song.artist_name,
        title: song.title,
        album: song.album,
        releaseYear: song.release_year,
        genre: song.genre,
      },
    },
  }).catch(() => {});
  return c.json({ task: taskJson(task) }, 201);
});

// --- 毎日の自動生成の設定・手動トリガ ---

// 毎日の自動生成+外部コンテキスト+リアルワード制限+生成モデルの設定をまとめて返す。
// llmModel / sunoModel は .env が真実源のため読み取り専用(PUT では受け付けない)
function allSettings() {
  return {
    ...getDailySettings(),
    ...getContextSettings(),
    ...db.getWordLimitSettings(),
    ...getLlmSettings(),
    vocalLanguage: getVocalLanguage(),
    sunoModel: SUNO_MODEL,
  };
}

api.get("/settings", (c) => {
  return c.json({ settings: allSettings() });
});

// 部分更新: { dailyEnabled?, dailyHour?, dailyTimezone?, dailyCount?, contextNews?,
//            wordMaxUses?, wordWindowDays?, llmEffort?, vocalLanguage? }
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
  if ("dailyCount" in body) {
    const v = body.dailyCount;
    if (!Number.isInteger(v) || v < 1 || v > 10) {
      return c.json({ error: "dailyCount は 1〜10 の整数です" }, 400);
    }
    updates.push(["daily_count", String(v)]);
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
  if ("llmEffort" in body) {
    if (!LLM_EFFORTS.some((e) => e === body.llmEffort)) {
      return c.json(
        { error: `llmEffort は ${LLM_EFFORTS.join(" / ")} のいずれかです` },
        400
      );
    }
    updates.push(["llm_effort", body.llmEffort]);
  }
  if ("vocalLanguage" in body) {
    if (!VOCAL_LANGUAGES.some((l) => l === body.vocalLanguage)) {
      return c.json(
        { error: `vocalLanguage は ${VOCAL_LANGUAGES.join(" / ")} のいずれかです` },
        400
      );
    }
    updates.push(["vocal_language", body.vocalLanguage]);
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
  const context = getContextSettings();
  const limits = currentWordLimits();
  const { wordMaxUses, wordWindowDays } = db.getWordLimitSettings();
  return c.json({
    params: {
      // 候補が空 = 参照曲が無く、おまかせ生成できない状態(POST /daily/run は 409)
      referenceCandidates: referenceCandidateSummary(),
      recentReferences: db.listRecentReferences().map((r) => ({
        artistName: r.artist_name,
        title: r.title,
        usedAt: r.last_used_at,
      })),
      contextNews: context.contextNews,
      vocalLanguage: getVocalLanguage(),
      wordMaxUses,
      wordWindowDays,
      bannedWords: limits.banned,
      lastChanceWords: limits.lastChance,
      trackedWordCount: db.countRealWorldWordUses(wordWindowDays).length,
    },
  });
});

// 自動生成の手動トリガ(管理画面・iOS の「おまかせ生成」が使用)。last_daily_date は
// 更新しないため、その日のスケジュール実行は別途行われる。
// 受付だけ済ませて即座に返す(参照曲ありの生成は web_search で 3〜4 分かかり、
// 完了まで待つとエッジのプロキシタイムアウトに掛かる)。進行状況は GET /api/tasks で追える
api.post("/daily/run", async (c) => {
  try {
    const { task, complete } = await startDailyRun();
    // 失敗は completeGeneration がタスクに記録するので、ここでは握って落とさないだけでよい
    void complete().catch(() => {});
    return c.json({ task: taskJson(task) }, 201);
  } catch (err) {
    // 参照曲が 1 件も無いのは設定の問題(アーティスト未登録)なので 409 で区別する
    // (記録は scheduler 側の no_reference_song で行うため、ここでは応答だけ返す)
    if (err instanceof NoReferenceSongError) {
      return c.json({ error: err.message }, 409);
    }
    logRouteFailure(c, err, 502);
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
    mode: t.mode,
    prompt: t.prompt,
    instrumental: t.instrumental === 1,
    sunoModel: t.model,
    style: t.style,
    styleJa: t.style_ja,
    lyrics: t.lyrics,
    lyricsJa: t.lyrics_ja,
    // 原詞の言語(旧データは null。英語固定だった頃のもの)
    lyricsLang: t.lyrics_lang,
    intent: t.intent,
    // 公開ページに出している紹介文(管理画面は表示のみ。編集の口は用意しない)
    intro: t.intro,
    llmModel: t.llm_model,
    llmPrompt: t.llm_prompt,
    // web_search で参照した情報源(参照曲ありの生成のみ。他は空配列)
    sources: db.parseSources(t.llm_sources),
    realWorldWords: db.listRealWorldWords(t.task_id),
    // 参照曲(daily / artist のどちらも持つ。旧データでは null)
    refArtistName: t.ref_artist_name,
    refSongTitle: t.ref_song_title,
    // 公開ページに出しているか(opt-out。既定 true)
    published: t.published === 1,
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

// 公開ページからの除外・再公開(opt-out 運用の下げる口)。body は { published: boolean }
api.patch("/tracks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const body = await c.req.json().catch(() => null);
  if (typeof body?.published !== "boolean") {
    return c.json({ error: "published は boolean です" }, 400);
  }
  if (!db.setTrackPublished(id, body.published)) {
    return c.json({ error: "曲が見つかりません" }, 404);
  }
  return c.json({ track: trackJson(db.getTrack(id)!, urlPrefix(c)) });
});

api.get("/credits", async (c) => {
  return c.json({ credits: await sunoClient.getCredits() });
});

// --- エラーログ(Mac から取得して解析するための入口) ---

function errorJson(e: db.ErrorLogRow) {
  let detail: unknown = null;
  if (e.detail) {
    try {
      detail = JSON.parse(e.detail);
    } catch {
      detail = { unparsable: e.detail };
    }
  }
  return {
    id: e.id,
    occurredAt: e.occurred_at,
    receivedAt: e.received_at,
    lastSeenAt: e.last_seen_at,
    // 同じ種類のエラーが短時間に連発したら 1 行に畳んでいる(その回数)
    repeatCount: e.repeat_count,
    level: e.level,
    origin: e.origin,
    source: e.source,
    event: e.event,
    message: e.message,
    detail,
    fingerprint: e.fingerprint,
    taskId: e.task_id,
  };
}

// '24h' / '7d' / '90m' の相対指定か ISO8601 を ISO8601 に正規化する。不正なら null
function parseSince(value: string | undefined): string | null {
  if (!value) return new Date(Date.now() - 24 * 3_600_000).toISOString();
  const relative = /^(\d+)([mhd])$/.exec(value.trim());
  if (relative) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] as "m" | "h" | "d"];
    return new Date(Date.now() - Number(relative[1]) * unit).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// scripts/fetch-error-logs.sh が叩く。新しい順(last_seen_at)で返す
api.get("/errors", (c) => {
  const since = parseSince(c.req.query("since"));
  if (since === null) {
    return c.json({ error: "since は 24h / 7d のような相対指定か ISO8601 です" }, 400);
  }
  const level = c.req.query("level");
  if (level !== undefined && level !== "error" && level !== "warn") {
    return c.json({ error: "level は error / warn です" }, 400);
  }
  const origin = c.req.query("origin");
  if (origin !== undefined && origin !== "server" && origin !== "ios") {
    return c.json({ error: "origin は server / ios です" }, 400);
  }
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 200) || 200, 1), 1000);
  const errors = db.listErrorLogs({
    since,
    level,
    origin,
    source: c.req.query("source"),
    limit,
  });
  return c.json({ since, limit, count: errors.length, errors: errors.map(errorJson) });
});

// iOS アプリからのエラー報告。1 リクエスト最大 20 件。
// クライアントの申告は信用しないので origin は 'ios' に固定し、source / event は形式を検証する
const CLIENT_ERRORS_MAX = 20;

api.post("/client-errors", async (c) => {
  const body = await c.req.json().catch(() => null);
  const items = Array.isArray(body?.errors) ? body.errors : null;
  if (!items) return c.json({ error: "errors 配列を指定してください" }, 400);
  if (items.length > CLIENT_ERRORS_MAX) {
    return c.json({ error: `errors は ${CLIENT_ERRORS_MAX} 件以内です` }, 400);
  }

  let accepted = 0;
  for (const item of items) {
    const message = typeof item?.message === "string" ? item.message.trim() : "";
    if (!message) continue;
    // ios-* 以外の source を名乗らせない(サーバー自身の記録と混ざらないようにする)
    const source =
      typeof item?.source === "string" && /^ios-[a-z]+$/.test(item.source)
        ? item.source
        : "ios-app";
    const event =
      typeof item?.event === "string" && /^[a-z0-9_]{1,60}$/.test(item.event)
        ? item.event
        : "unknown";
    // 端末の時計がずれていても received_at で気付けるので、申告値はそのまま採る
    const occurredAt =
      typeof item?.occurredAt === "string" && !Number.isNaN(Date.parse(item.occurredAt))
        ? new Date(item.occurredAt).toISOString()
        : nowIso();
    const detail =
      item?.detail !== null && typeof item?.detail === "object" && !Array.isArray(item.detail)
        ? (item.detail as Record<string, unknown>)
        : undefined;
    const entry = { source, event, message, detail, origin: "ios" as const, occurredAt };
    if (item?.level === "warn") logWarn(entry);
    else logError(entry);
    accepted++;
  }
  return c.json({ accepted }, 201);
});

// --- アーティスト管理(生成経路「アーティスト経由」) ---

function artistJson(a: db.ArtistWithCountRow) {
  return {
    id: a.id,
    name: a.name,
    itunesArtistId: a.itunes_artist_id,
    genre: a.genre,
    songCount: a.song_count,
    // 参照曲の候補になる曲数(無効にした曲を除く)
    enabledSongCount: a.enabled_song_count,
    createdAt: a.created_at,
  };
}

function artistSongJson(s: db.ArtistSongRow) {
  return {
    id: s.id,
    artistId: s.artist_id,
    title: s.title,
    album: s.album,
    releaseYear: s.release_year,
    genre: s.genre,
    // false の曲は参照曲に選ばれない(生成の指定もできない)
    enabled: s.enabled === 1,
  };
}

// 登録前の曖昧性解消用(DB には触らない)。日本語で検索してもヒットするが、
// 返る名前はローマ字表記のことが多く別名義も混ざるため、候補から選ばせる
api.get("/artists/search", async (c) => {
  const term = (c.req.query("term") ?? "").trim();
  if (!term) return c.json({ error: "term を指定してください" }, 400);
  try {
    return c.json({ candidates: await itunes.searchArtists(term) });
  } catch (err) {
    logRouteFailure(c, err, 502);
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

api.get("/artists", (c) => {
  return c.json({ artists: db.listArtists().map(artistJson) });
});

// 登録と同時に楽曲リストの取得まで行う。itunesArtistId 省略時は検索の最上位候補を使う
api.post("/artists", async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name を指定してください" }, 400);
  if (name.length > 200) return c.json({ error: "name が長すぎます(200 文字以内)" }, 400);
  const itunesArtistId = Number.isInteger(body?.itunesArtistId)
    ? (body.itunesArtistId as number)
    : undefined;

  try {
    // itunesArtistId が指定されていればそれを信頼し、名前も指定値をそのまま採る。
    // 未指定なら検索して最上位候補(正式表記)に解決する
    let resolved: itunes.ArtistCandidate;
    if (itunesArtistId !== undefined) {
      resolved = { itunesArtistId, name, genre: null };
    } else {
      const candidates = await itunes.searchArtists(name);
      if (candidates.length === 0) {
        return c.json({ error: `「${name}」に一致するアーティストが見つかりません` }, 404);
      }
      resolved = candidates[0];
    }

    // 楽曲の取得を先に済ませてから登録する(iTunes 側で失敗しても曲 0 件の
    // アーティストが残らない)。ジャンルは候補経由で来ていなければ lookup の応答から拾う
    const { artistGenre, songs } = await itunes.fetchSongs(resolved.itunesArtistId);
    let artist: db.ArtistWithCountRow;
    try {
      artist = db.createArtist({
        name: resolved.name,
        itunesArtistId: resolved.itunesArtistId,
        genre: resolved.genre ?? artistGenre,
      });
    } catch {
      return c.json({ error: `「${resolved.name}」は既に登録されています` }, 409);
    }
    const added = db.insertArtistSongs(artist.id, songs);
    console.log(`[artists] "${artist.name}" を登録し楽曲 ${added} 件を取り込みました`);
    return c.json({ artist: artistJson(db.getArtist(artist.id)!), added }, 201);
  } catch (err) {
    logRouteFailure(c, err, 502);
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

api.get("/artists/:id/songs", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const artist = db.getArtist(id);
  if (!artist) return c.json({ error: "アーティストが見つかりません" }, 404);
  return c.json({
    artist: artistJson(artist),
    songs: db.listArtistSongs(id).map(artistSongJson),
  });
});

// 曲一覧の一括操作(「全て有効」「全て無効」「絞り込み中の曲をまとめて」)。
// body は { enabled, ids? } で、ids を省略するとそのアーティストの全曲が対象
api.patch("/artists/:id/songs", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const artist = db.getArtist(id);
  if (!artist) return c.json({ error: "アーティストが見つかりません" }, 404);
  const body = await c.req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return c.json({ error: "enabled は boolean です" }, 400);
  }
  let ids: number[] | undefined;
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || !body.ids.every((v: unknown) => Number.isInteger(v))) {
      return c.json({ error: "ids は数値の配列です" }, 400);
    }
    ids = body.ids as number[];
  }
  const updated = db.setArtistSongsEnabled(id, body.enabled, ids);
  return c.json({ artist: artistJson(db.getArtist(id)!), updated });
});

// 楽曲リストの再取得(新譜の取り込み)。既存曲はそのままで差分だけ追加する
api.post("/artists/:id/refresh", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const artist = db.getArtist(id);
  if (!artist) return c.json({ error: "アーティストが見つかりません" }, 404);
  if (artist.itunes_artist_id === null) {
    return c.json({ error: "iTunes のアーティスト ID が未登録のため再取得できません" }, 400);
  }
  try {
    const { songs } = await itunes.fetchSongs(artist.itunes_artist_id);
    const added = db.insertArtistSongs(id, songs);
    console.log(`[artists] "${artist.name}" の楽曲を再取得しました(新規 ${added} 件)`);
    return c.json({ artist: artistJson(db.getArtist(id)!), added });
  } catch (err) {
    logRouteFailure(c, err, 502);
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

// アーティストと曲を削除する。生成済みタスクは ref_* のスナップショットで表示が続く
api.delete("/artists/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  if (!db.deleteArtist(id)) return c.json({ error: "アーティストが見つかりません" }, 404);
  return c.json({ ok: true });
});

// --- 曲名からの登録(アーティストは iTunes の応答から逆引きする) ---
// アーティスト名を思い出せなくても「この曲みたいな曲」を作れるようにするための入口。
// パス名は artist_songs テーブルに合わせた(/api/tracks = 生成した曲と紛れないように)

// 登録前の曖昧性解消用(DB には触らない)。カバー・ピアノ版が多く混ざるため候補から選ばせる
api.get("/artist-songs/search", async (c) => {
  const term = (c.req.query("term") ?? "").trim();
  if (!term) return c.json({ error: "term を指定してください" }, 400);
  try {
    return c.json({ candidates: await itunes.searchSongs(term) });
  } catch (err) {
    logRouteFailure(c, err, 502);
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

// 曲 1 件の有効/無効。無効な曲は参照曲に選ばれず、POST /generate でも 409 になる
api.patch("/artist-songs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "不正な id です" }, 400);
  const body = await c.req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return c.json({ error: "enabled は boolean です" }, 400);
  }
  if (!db.setArtistSongEnabled(id, body.enabled)) {
    return c.json({ error: "曲が見つかりません" }, 404);
  }
  return c.json({ song: artistSongJson(db.getArtistSong(id)!) });
});

// 曲を 1 曲登録する。body は { itunesTrackId } のみで、曲メタはサーバーが取り直す
// (クライアントの申告は信用しない)。未登録のアーティストは同時に登録する
api.post("/artist-songs", async (c) => {
  const body = await c.req.json().catch(() => null);
  const itunesTrackId = Number.isInteger(body?.itunesTrackId)
    ? (body.itunesTrackId as number)
    : undefined;
  if (itunesTrackId === undefined) {
    return c.json({ error: "itunesTrackId を指定してください" }, 400);
  }
  try {
    const track = await itunes.fetchTrack(itunesTrackId);
    if (!track) return c.json({ error: "指定された曲が iTunes で見つかりません" }, 404);

    let artist = db.getArtistByItunesId(track.itunesArtistId);
    let artistCreated = false;
    let importedSongs = 0;
    if (!artist) {
      // 未登録なら曲一覧もまとめて取り込む。正式名とジャンルを取るために lookup は
      // どのみち 1 回必要で、曲一覧は同じ応答に入っており追加コストがゼロのため
      const { artistName, artistGenre, songs } = await itunes.fetchSongs(track.itunesArtistId);
      // 登録名は lookup の artist 行(正式表記)から採る。検索の track 行の artistName は
      // ローカライズされた表示名(「クイーン」)で、既存のアーティスト名検索経路と
      // 名前が食い違い二重登録になるうえ、llm.ts の固有名詞混入チェックも効かなくなる
      const name = artistName ?? track.artistName;
      if (!name) return c.json({ error: "アーティスト名を特定できませんでした" }, 502);
      try {
        artist = db.createArtist({
          name,
          itunesArtistId: track.itunesArtistId,
          genre: artistGenre,
        });
        artistCreated = true;
      } catch {
        // 同名が既に登録されている(iTunes ID を持たない手動登録など)→ その行に合流する
        artist = db.getArtistByName(name);
        if (!artist) return c.json({ error: `「${name}」の登録に失敗しました` }, 409);
      }
      importedSongs = db.insertArtistSongs(artist.id, songs);
    }

    // 選んだ曲が lookup の 200 件から漏れることがある(米津玄師は 162 曲だが Queen は
    // 200 で打ち切り)ため、無ければこの 1 曲だけ足して「登録した曲が一覧に無い」を防ぐ
    let song = db.findArtistSongByTitle(artist.id, track.title);
    const songAdded = song === undefined;
    if (!song) {
      db.insertArtistSongs(artist.id, [
        {
          title: track.title,
          album: track.album,
          releaseYear: track.releaseYear,
          genre: track.genre,
          itunesTrackId: track.itunesTrackId,
        },
      ]);
      song = db.findArtistSongByTitle(artist.id, track.title);
      if (!song) return c.json({ error: "曲の登録に失敗しました" }, 500);
    }
    // 無効(取り込み時のノイズ判定 or 手動)なら有効に戻す。この曲で生成するために
    // 選んだ操作なので、選び直し自体が「有効にする」の意思表示になる
    if (song.enabled === 0) {
      db.setArtistSongEnabled(song.id, true);
      song = db.findArtistSongByTitle(artist.id, track.title)!;
    }

    console.log(
      `[artists] "${artist.name}" の「${song.title}」を登録しました` +
        (artistCreated ? `(アーティストを新規登録し楽曲 ${importedSongs} 件を取り込み)` : "")
    );
    return c.json(
      {
        artist: artistJson(db.getArtist(artist.id)!),
        song: artistSongJson(song),
        artistCreated,
        importedSongs,
        songAdded,
      },
      201
    );
  } catch (err) {
    logRouteFailure(c, err, 502);
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});

// /api/* は X-API-Secret ヘッダ必須
app.use("/api/*", async (c, next) => {
  if (!isValidApiSecret(c.req.header("x-api-secret"))) {
    logWarn({
      source: "api",
      event: "unauthorized",
      message: `X-API-Secret が不正なため拒否: ${c.req.method} ${c.req.path}`,
      detail: { method: c.req.method, path: c.req.path, hasHeader: c.req.header("x-api-secret") !== undefined },
    });
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
app.get("/admin", (c) => c.redirect("/admin/"));
app.use(
  "/admin/*",
  serveStatic({
    root: PUBLIC_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/admin/, ""),
  })
);

// --- 公開ページ(すべて無認証)。本番の Cloudflare Access は /admin だけを保護しており、
// / 配下は誰でも見える。参照曲・スタイル・歌詞・狙い・リアルワードなどの生成情報は
// ページ側で隠すのではなくレスポンス自体に含めない ---

// 公開 API は安全なフィールドだけに絞る(生成モデル名は AI 生成の明記を曲単位で裏付けるため出す)。
// intro は公開用に書かせた紹介文で、開発者向けの intent(参照曲に触れる)とは別物
function publicTrackJson(t: db.TrackWithTaskRow) {
  return {
    id: t.id,
    title: t.title,
    duration: t.duration,
    audioUrl: `/site/audio/${t.audio_file}`,
    imageUrl: t.image_file ? `/site/images/${t.image_file}` : null,
    sunoModel: t.model,
    llmModel: t.llm_model,
    intro: t.intro,
    createdAt: t.created_at,
  };
}

// 歌詞の [Verse] [Chorus] などのセクションタグを落として本文だけにする。
// 表示側で隠すのではなく公開 API が出さない(既存の「出さないものは含めない」と揃える)。
// インストゥルメンタル・歌詞の無い旧データは null(ページ側で歌詞ブロックごと出さない)
export function stripLyricSectionTags(lyrics: string | null): string | null {
  if (!lyrics) return null;
  const body = lyrics
    .split("\n")
    .filter((line) => !/^\s*\[[^\]]*\]\s*$/.test(line))
    .join("\n")
    // タグ行を落とすと空行が連続するので 1 行に畳む
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body || null;
}

app.get("/site/api/tracks", (c) => {
  // 歌詞は 1 曲で数百〜数千字あるため一覧には載せない(詳細の /site/api/tracks/:id だけ)
  return c.json({ tracks: db.listPublishedTracks().map(publicTrackJson) });
});

// 曲詳細。公開中の曲だけを返し、非公開・不在・数字でない id はすべて 404。
// 一覧のフィールド + タグ除去済みの歌詞で、参照曲・スタイル・狙い・リアルワード・
// LLM 入力は一覧と同じく返さない
app.get("/site/api/tracks/:id", (c) => {
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.notFound();
  const track = db.getPublishedTrack(Number(id));
  if (!track) return c.notFound();
  return c.json({
    track: { ...publicTrackJson(track), lyrics: stripLyricSectionTags(track.lyrics) },
  });
});

// 音源・カバー画像は配信前に「そのファイルの曲が公開中か」を DB で確認し、非公開・不明なら 404。
// /api|/admin 側の serveStatic はディレクトリ丸ごと配信なので流用しない(Range 対応は serveStatic に任せる)
for (const [segment, dir, isPublished] of [
  ["audio", AUDIO_DIR, db.isPublishedAudioFile],
  ["images", IMAGE_DIR, db.isPublishedImageFile],
] as const) {
  const prefix = `/site/${segment}/`;
  const serveFile = serveStatic({
    root: dir,
    rewriteRequestPath: (p) => p.slice(prefix.length - 1),
  });
  app.use(`${prefix}*`, async (c, next) => {
    // パス区切りを含む名前(トラバーサル)は DB のファイル名と一致しないのでここで 404 になる
    const file = decodeURIComponent(c.req.path.slice(prefix.length));
    if (!isPublished(file)) return c.notFound();
    return serveFile(c, next);
  });
}

// 曲詳細の URL は /track/:id(共有される恒久 URL としてクエリより適切で、後から同じ URL の
// まま曲ごとの OGP メタ注入に差し替えられる)。実体は track.html で、曲の特定はページ側の JS が
// パスから行う。id が数字でないパスは 404(存在しない・非公開の id はページ側で案内を出す)
const serveTrackPage = serveStatic({
  root: SITE_DIR,
  rewriteRequestPath: () => "/track.html",
});
app.get("/track/:id", async (c, next) => {
  if (!/^\d+$/.test(c.req.param("id"))) return c.notFound();
  // serveStatic はファイルが無いと next に落とすミドルウェアなので、その場合は 404 で確定させる
  return (await serveTrackPage(c, next)) ?? c.notFound();
});

// 公開ページの静的ファイル(server/site/)。残りのパス全部を受けるため最後にマウントする
app.use("/*", serveStatic({ root: SITE_DIR }));

// ルートで捕まえ損ねた例外(Hono の既定は 500 を返すだけで記録が残らない)
app.onError((err, c) => {
  logError({
    source: "api",
    event: "unhandled",
    message: `${c.req.method} ${c.req.path} で未処理の例外: ${err.message}`,
    detail: { method: c.req.method, path: c.req.path, httpStatus: 500, ...errorDetail(err) },
  });
  return c.json({ error: "internal server error" }, 500);
});

// プロセスレベルの取りこぼし。uncaughtException はプロセスの状態が壊れている可能性が
// あるので記録してから終了する(本番は docker の restart: unless-stopped で再起動し、
// 未完了タスクは startPoller が DB から拾い直す)。
// unhandledRejection は 1 つの非同期処理の失敗にとどまるため、記録して動かし続ける
process.on("uncaughtException", (err) => {
  logError({
    source: "process",
    event: "uncaught_exception",
    message: `未捕捉の例外: ${err.message}`,
    detail: errorDetail(err),
  });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logError({
    source: "process",
    event: "unhandled_rejection",
    message: `未処理の Promise 拒否: ${reason instanceof Error ? reason.message : reason}`,
    detail: errorDetail(reason),
  });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Music Plant admin: http://localhost:${info.port}/admin/`);
  startPoller();
  startScheduler();
});
