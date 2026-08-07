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
          <div class="task-prompt"></div>
          <div class="task-meta">
            <span class="badge">${STATUS_LABELS[t.status] ?? t.status}</span>
            ${t.instrumental ? '<span class="badge">インスト</span>' : ""}
            <span>${formatDate(t.createdAt)}</span>
          </div>
          ${t.error ? `<div class="task-error"></div>` : ""}
        </div>`;
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
        <button type="button" class="rate-btn" data-kind="fav" title="お気に入り">★</button>
      </div>
    </div>`;
  li.querySelector(".track-title").textContent = t.title;
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
        kind === "up" ? t.rating === 1 : kind === "down" ? t.rating === -1 : t.favorite
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
          : kind === "down"
            ? { rating: t.rating === -1 ? null : -1 }
            : { favorite: !t.favorite };
      for (const b of buttons) b.disabled = true;
      try {
        const { track } = await fetchJson(`/admin/api/tracks/${t.id}/rating`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        t.rating = track.rating;
        t.favorite = track.favorite;
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

$("generate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("generate-button");
  const message = $("form-message");
  button.disabled = true;
  message.hidden = true;
  try {
    await fetchJson("/admin/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: $("prompt").value,
        instrumental: $("instrumental").checked,
      }),
    });
    $("prompt").value = "";
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
