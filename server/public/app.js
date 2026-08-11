// 管理画面。/admin/api/tasks を定期ポーリングし、生成の進行と楽曲一覧を表示する
// (/admin/api/* は同居サーバーの無認証 API。本番はエッジの Cloudflare Access が /admin ごと保護する)
const POLL_MS = 5000;

const STATUS_LABELS = {
  PLANNING: "曲を考えています…",
  PENDING: "待機中",
  TEXT_SUCCESS: "歌詞生成完了・音声生成中",
  FIRST_SUCCESS: "1 曲目完了",
  SUCCESS: "音源を保存中",
  COMPLETE: "完了",
  FAILED: "失敗",
};

const MODE_LABELS = {
  manual: "手動",
  daily: "毎日の自動生成",
  artist: "アーティスト経由",
};

// 進行中カードのバッジ用の短い表記(manual は既定なのでバッジを出さない)
const MODE_BADGES = {
  daily: "毎日",
  artist: "アーティスト",
};

const $ = (id) => document.getElementById(id);
const seenTrackIds = new Set();
let hadActiveTasks = false;

function formatDuration(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// 生成プロンプト(buildSongPlanPrompt の出力)を行頭「## 」を境にセクション分解する。
// 見出しが無い・見出し前に本文がある旧データは null を返し、全文表示にフォールバックする
function splitPromptSections(text) {
  const sections = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      sections.push({ title: line.slice(3).trim(), body: [] });
    } else if (sections.length === 0) {
      if (line.trim()) return null;
    } else {
      sections.at(-1).body.push(line);
    }
  }
  if (sections.length === 0) return null;
  return sections.map((s) => ({ title: s.title, body: s.body.join("\n").trim() }));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

async function refreshCredits() {
  try {
    const { credits } = await fetchJson("/admin/api/credits");
    $("credits").textContent = credits === null ? "" : `残クレジット: ${credits}`;
  } catch {
    $("credits").textContent = "";
  }
}

function renderTasks(tasks) {
  const oneHourAgo = Date.now() - 60 * 60_000;
  const visible = tasks.filter(
    (t) =>
      (t.status !== "COMPLETE" && t.status !== "FAILED") ||
      (t.status === "FAILED" && Date.parse(t.updatedAt) > oneHourAgo)
  );
  $("active-panel").hidden = visible.length === 0;
  $("active-tasks").replaceChildren(
    ...visible.map((t) => {
      const li = document.createElement("li");
      li.className = t.status === "FAILED" ? "task failed" : "task";
      const spinner = t.status === "FAILED" ? "" : `<span class="spinner"></span>`;
      li.innerHTML = `
        ${spinner}
        <div class="task-body">
          ${t.title ? '<div class="task-song-title"></div>' : ""}
          <div class="task-prompt"></div>
          <div class="task-meta">
            <span class="badge">${STATUS_LABELS[t.status] ?? t.status}</span>
            ${MODE_BADGES[t.mode] ? `<span class="badge">${MODE_BADGES[t.mode]}</span>` : ""}
            ${t.instrumental ? '<span class="badge">インスト</span>' : ""}
            <span>${formatDate(t.createdAt)}</span>
          </div>
          ${t.error ? `<div class="task-error"></div>` : ""}
        </div>`;
      if (t.title) li.querySelector(".task-song-title").textContent = `♪ ${t.title}`;
      li.querySelector(".task-prompt").textContent = t.prompt;
      if (t.error) li.querySelector(".task-error").textContent = t.error;
      return li;
    })
  );
}

function trackElement(t) {
  const li = document.createElement("li");
  li.className = "track";
  li.innerHTML = `
    ${t.imageUrl ? `<img class="cover" src="${t.imageUrl}" alt="" loading="lazy">` : '<div class="cover placeholder"></div>'}
    <div class="track-body">
      <div class="track-title"></div>
      <div class="track-meta">${formatDuration(t.duration)}<span> · ${formatDate(t.createdAt)}</span></div>
      <audio controls preload="none" src="${t.audioUrl}"></audio>
      <div class="word-tags" hidden></div>
    </div>`;
  li.querySelector(".track-title").textContent = t.title;
  {
    // リアルワード(曲の中心となった語)を展開せずに見えるタグで表示。無い旧データは行ごと隠す
    const words = t.realWorldWords ?? [];
    const tags = li.querySelector(".word-tags");
    tags.hidden = words.length === 0;
    for (const w of words) {
      const span = document.createElement("span");
      span.className = "word-tag";
      span.textContent = w;
      tags.append(span);
    }
  }
  {
    const details = document.createElement("details");
    details.className = "track-details";
    const summary = document.createElement("summary");
    summary.textContent = "歌詞・生成パラメータ";
    details.append(summary);
    const addSection = (label, text, pre = false) => {
      if (!text) return;
      const h = document.createElement("h4");
      h.textContent = label;
      const body = document.createElement(pre ? "pre" : "p");
      body.className = "detail-text";
      body.textContent = text;
      details.append(h, body);
    };
    // artist モードで参照した曲(スナップショット。他モード・旧データでは出ない)
    if (t.refArtistName) {
      addSection("リファレンス", `${t.refArtistName}「${t.refSongTitle}」`);
    }
    addSection("狙い", t.intent);
    // web_search で参照した情報源(参照曲ありの生成のみ。旧データ・旧サーバーでは空)
    addSection("参照した情報源", (t.sources ?? []).join("\n"), true);
    addSection("歌詞", t.lyrics, true);
    addSection("日本語訳", t.lyricsJa, true);
    addSection("スタイル", t.style);
    addSection("スタイル(日本語訳)", t.styleJa);
    addSection("リアルワード", (t.realWorldWords ?? []).join(", "));
    // 生成に使用したパラメータ(旧データで欠けている項目は出さない)
    const params = [
      ["モード", MODE_LABELS[t.mode] ?? t.mode],
      ["リクエスト", t.prompt],
      ["インストゥルメンタル", t.instrumental ? "あり" : "なし"],
      ["Suno モデル", t.sunoModel],
      ["LLM モデル", t.llmModel],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    addSection("生成パラメータ", params, true);
    // LLM への入力全文はセクション分解して小見出し+本文で表示する
    const promptSections = t.llmPrompt ? splitPromptSections(t.llmPrompt) : null;
    if (promptSections) {
      const h = document.createElement("h4");
      h.textContent = "LLM への入力全文";
      details.append(h);
      for (const s of promptSections) {
        const title = document.createElement("h5");
        title.className = "prompt-section";
        title.textContent = s.title;
        const body = document.createElement("pre");
        body.className = "detail-text prompt-section-body";
        body.textContent = s.body;
        details.append(title, body);
      }
    } else {
      addSection("LLM への入力全文", t.llmPrompt, true);
    }
    li.querySelector(".track-body").append(details);
  }
  const audio = li.querySelector("audio");
  audio.addEventListener("play", () => {
    for (const other of document.querySelectorAll("audio")) {
      if (other !== audio) other.pause();
    }
  });

  return li;
}

// 再生を邪魔しないよう、全再描画はせず新しい楽曲だけを先頭に追加する
function renderNewTracks(tracks) {
  const list = $("tracks");
  const fresh = tracks.filter((t) => !seenTrackIds.has(t.id));
  for (const t of fresh.reverse()) {
    seenTrackIds.add(t.id);
    list.prepend(trackElement(t));
  }
  $("tracks-empty").hidden = seenTrackIds.size > 0;
}

async function refresh() {
  try {
    const [{ tasks }, { tracks }] = await Promise.all([
      fetchJson("/admin/api/tasks"),
      fetchJson("/admin/api/tracks"),
    ]);
    renderTasks(tasks);
    renderNewTracks(tracks);

    // 生成が全て終わったタイミングでクレジット表示を更新する
    const active = tasks.some((t) => t.status !== "COMPLETE" && t.status !== "FAILED");
    if (hadActiveTasks && !active) refreshCredits();
    hadActiveTasks = active;
  } catch (err) {
    console.warn("refresh failed:", err);
  }
}

// 生成ボタン: 毎日の自動生成と同じフロー(参照曲の選択 → LLM 生成 → Suno 送信)を
// 手動トリガする。last_daily_date は更新されないため、その日のスケジュール実行は別途行われる。
// サーバーは受付だけで返すので、待機メッセージは出さず進行中カード(「曲を考えています…」)に引き継ぐ
$("generate-button").addEventListener("click", async () => {
  const button = $("generate-button");
  const message = $("form-message");
  button.disabled = true;
  message.hidden = true;
  try {
    await fetchJson("/admin/api/daily/run", { method: "POST" });
    hadActiveTasks = true;
    await refresh();
    refreshCredits();
  } catch (err) {
    message.textContent = err.message;
    message.hidden = false;
  } finally {
    button.disabled = false;
  }
});

refreshCredits();
refresh();
setInterval(refresh, POLL_MS);
