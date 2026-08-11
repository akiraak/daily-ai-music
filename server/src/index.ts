// エントリポイント。API + 管理画面(静的ファイル)+ 保存済み音源の配信
import crypto from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { API_SECRET, AUDIO_DIR, IMAGE_DIR, PORT, PUBLIC_DIR, SUNO_MODEL } from "./config.ts";
import { getContextSettings } from "./context.ts";
import * as db from "./db.ts";
import {
  acceptGeneration,
  completeGeneration,
  startPoller,
  sunoClient,
} from "./generation.ts";
import * as itunes from "./itunes.ts";
import { LLM_EFFORTS, currentWordLimits, getLlmSettings } from "./llm.ts";
import { referenceCandidateSummary } from "./reference.ts";
import {
  NoReferenceSongError,
  getDailySettings,
  isValidTimezone,
  startDailyRun,
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
    sunoModel: SUNO_MODEL,
  };
}

api.get("/settings", (c) => {
  return c.json({ settings: allSettings() });
});

// 部分更新: { dailyEnabled?, dailyHour?, dailyTimezone?,
//            dailyCount?, contextNews?, wordMaxUses?, wordWindowDays?, llmEffort? }
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
    console.error(`[api] daily/run 失敗: ${err}`);
    // 参照曲が 1 件も無いのは設定の問題(アーティスト未登録)なので 409 で区別する
    if (err instanceof NoReferenceSongError) {
      return c.json({ error: err.message }, 409);
    }
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
    intent: t.intent,
    llmModel: t.llm_model,
    llmPrompt: t.llm_prompt,
    // web_search で参照した情報源(参照曲ありの生成のみ。他は空配列)
    sources: db.parseSources(t.llm_sources),
    realWorldWords: db.listRealWorldWords(t.task_id),
    // 参照曲(daily / artist のどちらも持つ。旧データでは null)
    refArtistName: t.ref_artist_name,
    refSongTitle: t.ref_song_title,
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

api.get("/credits", async (c) => {
  return c.json({ credits: await sunoClient.getCredits() });
});

// --- アーティスト管理(生成経路「アーティスト経由」) ---

function artistJson(a: db.ArtistWithCountRow) {
  return {
    id: a.id,
    name: a.name,
    itunesArtistId: a.itunes_artist_id,
    genre: a.genre,
    songCount: a.song_count,
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
    console.error(`[api] アーティスト検索失敗: ${err}`);
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
    console.error(`[api] アーティスト登録失敗: ${err}`);
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
    console.error(`[api] 楽曲再取得失敗: ${err}`);
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
    console.error(`[api] 曲名検索失敗: ${err}`);
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
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
    console.error(`[api] 曲の登録失敗: ${err}`);
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
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
  console.log(`Music Plant admin: http://localhost:${info.port}/admin/`);
  startPoller();
  startScheduler();
});
