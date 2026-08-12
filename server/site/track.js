// 曲詳細。URL(/track/:id)のパスから曲を特定し、シークバー付きプレイヤーと「ほかの曲」を出す
const status = document.getElementById("status");

function showStatus(text) {
  status.hidden = false;
  status.textContent = text;
}

function render(track, tracks) {
  document.title = `${track.title} — Music Plant`;
  document.getElementById("detail").hidden = false;
  if (track.imageUrl) document.getElementById("cover").src = track.imageUrl;
  document.getElementById("date").textContent =
    `${fmtDateJa(track.createdAt)} · ${fmtDuration(track.duration)}`;
  document.getElementById("title").textContent = track.title;
  document.getElementById("models").textContent = modelLabel(track);
  document.getElementById("t-total").textContent = fmtDuration(track.duration);

  const audio = new Audio(track.audioUrl);
  const btn = document.getElementById("btn");
  const bar = document.getElementById("bar");
  const seek = document.getElementById("seek");
  const tCur = document.getElementById("t-cur");
  const tTotal = document.getElementById("t-total");

  btn.addEventListener("click", () => {
    if (audio.paused) audio.play();
    else audio.pause();
  });
  const refresh = () => {
    btn.textContent = audio.paused ? "▶" : "❚❚";
    btn.classList.toggle("pause", !audio.paused);
  };
  audio.addEventListener("play", refresh);
  audio.addEventListener("pause", refresh);
  audio.addEventListener("ended", refresh);
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    bar.style.width = (audio.currentTime / audio.duration) * 100 + "%";
    tCur.textContent = fmtDuration(audio.currentTime);
    tTotal.textContent = fmtDuration(audio.duration);
  });
  seek.addEventListener("click", (e) => {
    if (!audio.duration) return;
    const r = seek.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });

  // ほかの曲(この曲を除く新しい順で 6 曲)
  const others = tracks.filter((t) => t.id !== track.id).slice(0, 6);
  if (others.length > 0) {
    document.getElementById("others-section").hidden = false;
    const grid = document.getElementById("others");
    for (const t of others) {
      const a = document.createElement("a");
      a.className = "o-card";
      a.href = trackPageUrl(t);
      a.innerHTML = `
        <div class="o-cover"><img alt="" loading="lazy"></div>
        <div class="o-title"></div>
        <div class="o-date"></div>`;
      if (t.imageUrl) a.querySelector("img").src = t.imageUrl;
      a.querySelector(".o-title").textContent = t.title;
      a.querySelector(".o-date").textContent = fmtDateJa(t.createdAt);
      grid.appendChild(a);
    }
  }
}

const id = Number(/^\/track\/(\d+)$/.exec(location.pathname)?.[1]);
fetchTracks()
  .then((tracks) => {
    const track = tracks.find((t) => t.id === id);
    if (!track) {
      showStatus("曲が見つかりません(非公開になった可能性があります)");
      return;
    }
    render(track, tracks);
  })
  .catch(() => showStatus("読み込みに失敗しました。時間をおいて再読み込みしてください。"));
