// 管理画面。/admin/api/tasks を定期ポーリングし、生成の進行と楽曲一覧を表示する
// (/admin/api/* は同居サーバーの無認証 API。本番はエッジの Cloudflare Access が /admin ごと保護する)
const POLL_MS = 5000;

const STATUS_LABELS = {
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
  daily_adventure: "毎日の自動生成(冒険日)",
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
            ${t.mode && t.mode !== "manual" ? `<span class="badge">${t.mode === "daily_adventure" ? "冒険日" : "毎日"}</span>` : ""}
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
      <div class="rating">
        <button type="button" class="rate-btn" data-kind="up" title="好き">👍</button>
        <button type="button" class="rate-btn" data-kind="down" title="好みじゃない">👎</button>
      </div>
    </div>`;
  li.querySelector(".track-title").textContent = t.title;
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
    addSection("狙い", t.intent);
    addSection("歌詞", t.lyrics, true);
    addSection("日本語訳", t.lyricsJa, true);
    addSection("スタイル", t.style);
    addSection("スタイル(日本語訳)", t.styleJa);
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
    addSection("LLM への入力全文", t.llmPrompt, true);
    li.querySelector(".track-body").append(details);
  }
  const audio = li.querySelector("audio");
  audio.addEventListener("play", () => {
    for (const other of document.querySelectorAll("audio")) {
      if (other !== audio) other.pause();
    }
  });

  const buttons = li.querySelectorAll(".rate-btn");
  const syncRating = () => {
    for (const btn of buttons) {
      const kind = btn.dataset.kind;
      btn.classList.toggle(
        "active",
        kind === "up" ? t.rating === 1 : t.rating === -1
      );
    }
  };
  syncRating();
  for (const btn of buttons) {
    btn.addEventListener("click", async () => {
      // トグル式: 押されている状態でもう一度押すと解除
      const kind = btn.dataset.kind;
      const payload =
        kind === "up"
          ? { rating: t.rating === 1 ? null : 1 }
          : { rating: t.rating === -1 ? null : -1 };
      for (const b of buttons) b.disabled = true;
      try {
        const { track } = await fetchJson(`/admin/api/tracks/${t.id}/rating`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        t.rating = track.rating;
        syncRating();
      } catch (err) {
        console.warn("rating failed:", err);
      } finally {
        for (const b of buttons) b.disabled = false;
      }
    });
  }
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

// 生成ボタン: 毎日の自動生成と同じフロー(プロファイル更新 → 冒険日判定 → LLM 生成 → Suno 送信)を
// 手動トリガする。last_daily_date は更新されないため、その日のスケジュール実行は別途行われる
$("generate-button").addEventListener("click", async () => {
  const button = $("generate-button");
  const message = $("form-message");
  button.disabled = true;
  message.classList.add("info");
  message.textContent = "AI がスタイルと歌詞を考えています…(1〜2 分かかります)";
  message.hidden = false;
  try {
    await fetchJson("/admin/api/daily/run", { method: "POST" });
    message.hidden = true;
    hadActiveTasks = true;
    await refresh();
    refreshCredits();
  } catch (err) {
    message.textContent = err.message;
    message.hidden = false;
  } finally {
    message.classList.remove("info");
    button.disabled = false;
  }
});

// --- 好みプロファイル閲覧 ---
async function loadProfile() {
  try {
    const { profile } = await fetchJson("/admin/api/profile");
    $("profile-meta").textContent = profile
      ? `更新: ${formatDate(profile.createdAt)}`
      : "まだプロファイルがありません。曲を評価すると、毎日の自動生成時に作成されます。";
    $("profile-content").textContent = profile?.content ?? "";
  } catch (err) {
    console.warn("profile load failed:", err);
  }
}
// パネルを開いたときに最新を取り直す
$("profile-panel").addEventListener("toggle", () => {
  if ($("profile-panel").open) loadProfile();
});

refreshCredits();
refresh();
loadProfile();
setInterval(refresh, POLL_MS);
