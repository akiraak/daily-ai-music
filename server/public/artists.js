// アーティストページ。iTunes から曲を取り込んだアーティストを管理し、曲を選んで
// 「その曲に似た新曲」を生成する(生成経路 artist)
// (/admin/api/* は同居サーバーの無認証 API。本番はエッジの Cloudflare Access が /admin ごと保護する)
const $ = (id) => document.getElementById(id);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

function showMessage(id, text, info = false) {
  const el = $(id);
  el.textContent = text ?? "";
  el.hidden = !text;
  el.classList.toggle("info", info);
}

// 表示中のアーティストの曲(絞り込みはクライアント側で行う。最大 200 件)
let currentArtist = null;
let currentSongs = [];

// --- アーティストの検索・登録 ---

async function register(name, itunesArtistId) {
  showMessage("search-message", "登録しています…(iTunes から曲を取り込みます)", true);
  try {
    const { artist, added } = await fetchJson("/admin/api/artists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, itunesArtistId }),
    });
    $("candidates").replaceChildren();
    $("search-term").value = "";
    showMessage("search-message", `「${artist.name}」を登録し、曲を ${added} 件取り込みました。`, true);
    loadArtists();
  } catch (err) {
    showMessage("search-message", err.message);
  }
}

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const term = $("search-term").value.trim();
  if (!term) return;
  showMessage("search-message", "検索しています…", true);
  $("candidates").replaceChildren();
  try {
    const { candidates } = await fetchJson(
      `/admin/api/artists/search?term=${encodeURIComponent(term)}`
    );
    if (candidates.length === 0) {
      showMessage("search-message", `「${term}」に一致するアーティストが見つかりません。`);
      return;
    }
    showMessage("search-message", "登録するアーティストを選んでください。", true);
    $("candidates").replaceChildren(
      ...candidates.map((cand) => {
        const li = document.createElement("li");
        li.className = "artist";
        li.innerHTML = `
          <span class="artist-name"></span>
          <span class="artist-meta"></span>
          <button type="button" class="icon-btn" data-act="register">登録</button>`;
        li.querySelector(".artist-name").textContent = cand.name;
        li.querySelector(".artist-meta").textContent = cand.genre ?? "";
        li.querySelector('[data-act="register"]').addEventListener("click", () =>
          register(cand.name, cand.itunesArtistId)
        );
        return li;
      })
    );
  } catch (err) {
    showMessage("search-message", err.message);
  }
});

// --- 登録済みアーティスト ---

function artistRow(a) {
  const li = document.createElement("li");
  li.className = "artist";
  li.innerHTML = `
    <span class="artist-name"></span>
    <span class="artist-meta"></span>
    <button type="button" class="icon-btn" data-act="songs">曲を見る</button>
    <button type="button" class="icon-btn" data-act="refresh">再取得</button>
    <button type="button" class="icon-btn" data-act="delete">削除</button>`;
  li.querySelector(".artist-name").textContent = a.name;
  li.querySelector(".artist-meta").textContent = [a.genre, `${a.songCount} 曲`]
    .filter(Boolean)
    .join(" / ");
  li.querySelector('[data-act="songs"]').addEventListener("click", () => loadSongs(a));
  li.querySelector('[data-act="refresh"]').addEventListener("click", async () => {
    showMessage("artists-message", `「${a.name}」の曲を再取得しています…`, true);
    try {
      const { added } = await fetchJson(`/admin/api/artists/${a.id}/refresh`, {
        method: "POST",
      });
      showMessage(
        "artists-message",
        added > 0 ? `新しい曲を ${added} 件追加しました。` : "新しい曲はありませんでした。",
        true
      );
      loadArtists();
      if (currentArtist?.id === a.id) loadSongs(a);
    } catch (err) {
      showMessage("artists-message", err.message);
    }
  });
  li.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (!confirm(`「${a.name}」と取り込んだ曲を削除しますか?(生成済みの曲は残ります)`)) return;
    try {
      await fetchJson(`/admin/api/artists/${a.id}`, { method: "DELETE" });
      showMessage("artists-message", null);
      if (currentArtist?.id === a.id) {
        currentArtist = null;
        $("songs-panel").hidden = true;
      }
      loadArtists();
    } catch (err) {
      showMessage("artists-message", err.message);
    }
  });
  return li;
}

async function loadArtists() {
  try {
    const { artists } = await fetchJson("/admin/api/artists");
    $("artists-empty").hidden = artists.length > 0;
    $("artists").replaceChildren(...artists.map(artistRow));
  } catch (err) {
    showMessage("artists-message", err.message);
  }
}

// --- 曲一覧と生成 ---

async function generate(song) {
  const extra = $("song-extra").value.trim();
  if (!confirm(`「${song.title}」に似た曲を生成しますか?`)) return;
  showMessage("songs-message", "AI がスタイルと歌詞を作っています…(1 分ほどかかります)", true);
  try {
    const { task } = await fetchJson("/admin/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artistSongId: song.id, prompt: extra }),
    });
    // 完成までは Suno 側で数分かかるので、進行状況は楽曲一覧ページで見てもらう
    showMessage("songs-message", `生成を開始しました(${task.title})。仕上がりは `, true);
    const link = document.createElement("a");
    link.href = "/admin/";
    link.textContent = "楽曲一覧";
    $("songs-message").append(link, "で確認できます。");
  } catch (err) {
    showMessage("songs-message", err.message);
  }
}

function renderSongs() {
  const keyword = $("song-filter").value.trim().toLowerCase();
  const songs = keyword
    ? currentSongs.filter((s) => s.title.toLowerCase().includes(keyword))
    : currentSongs;
  $("songs").replaceChildren(
    ...songs.map((s) => {
      const li = document.createElement("li");
      li.className = "song";
      li.innerHTML = `
        <span class="song-title"></span>
        <span class="song-meta"></span>
        <button type="button" class="icon-btn" data-act="generate">この曲で生成</button>`;
      li.querySelector(".song-title").textContent = s.title;
      li.querySelector(".song-meta").textContent = [s.releaseYear, s.album]
        .filter(Boolean)
        .join(" / ");
      li.querySelector('[data-act="generate"]').addEventListener("click", () => generate(s));
      return li;
    })
  );
}

async function loadSongs(artist) {
  currentArtist = artist;
  $("songs-panel").hidden = false;
  $("songs-title").textContent = `${artist.name} の曲`;
  $("songs").replaceChildren();
  showMessage("songs-message", null);
  try {
    const { songs } = await fetchJson(`/admin/api/artists/${artist.id}/songs`);
    currentSongs = songs;
    renderSongs();
  } catch (err) {
    showMessage("songs-message", err.message);
  }
}

$("song-filter").addEventListener("input", renderSongs);

loadArtists();
