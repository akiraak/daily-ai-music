// 曲一覧。カードのクリックで詳細ページへ、カバー上の ▶ ボタンだけ行内再生
const grid = document.getElementById("grid");
const status = document.getElementById("status");
const audio = new Audio();
let playingCard = null;

function showStatus(text) {
  status.hidden = false;
  status.textContent = text;
}

function render(tracks) {
  if (tracks.length === 0) {
    showStatus("まだ曲がありません");
    return;
  }
  for (const t of tracks) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="cover">
        <img alt="" loading="lazy">
        <div class="eq"><i></i><i></i><i></i></div>
        <div class="play"><span class="icon-play">▶</span></div>
      </div>
      <div class="info">
        <div class="title"></div>
        <div class="meta"></div>
        <div class="models"></div>
      </div>`;
    if (t.imageUrl) card.querySelector("img").src = t.imageUrl;
    card.querySelector(".title").textContent = t.title;
    card.querySelector(".meta").textContent = `${fmtDateJa(t.createdAt)} · ${fmtDuration(t.duration)}`;
    card.querySelector(".models").textContent = modelLabel(t);
    card.addEventListener("click", () => { location.href = trackPageUrl(t); });
    card.querySelector(".play span").addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(t, card);
    });
    grid.appendChild(card);
  }
}

function toggle(t, card) {
  if (playingCard === card && !audio.paused) {
    audio.pause();
    setPlaying(null);
    return;
  }
  if (playingCard !== card) audio.src = t.audioUrl;
  audio.play();
  setPlaying(card);
}

function setPlaying(card) {
  if (playingCard) {
    playingCard.classList.remove("playing");
    const btn = playingCard.querySelector(".play span");
    btn.textContent = "▶";
    btn.classList.add("icon-play");
  }
  playingCard = card;
  if (card) {
    card.classList.add("playing");
    const btn = card.querySelector(".play span");
    btn.textContent = "❚❚";
    btn.classList.remove("icon-play");
  }
}
audio.addEventListener("ended", () => setPlaying(null));

fetchTracks()
  .then(render)
  .catch(() => showStatus("読み込みに失敗しました。時間をおいて再読み込みしてください。"));
