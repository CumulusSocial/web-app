// ─── config ───────────────────────────────────────────────────────────────
const DEFAULTS = {
  auth: "http://localhost:8001",
  post: "http://localhost:8002",
  feed: "http://localhost:8003",
};
const cfg = {
  auth: localStorage.getItem("urlAuth") || DEFAULTS.auth,
  post: localStorage.getItem("urlPost") || DEFAULTS.post,
  feed: localStorage.getItem("urlFeed") || DEFAULTS.feed,
};
let token = localStorage.getItem("token") || null;
let userId = localStorage.getItem("userId") || null;

// ─── tiny helpers ─────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const show = (el, on = true) => { el.hidden = !on; };
function toast(msg, kind) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (kind === "error" ? " error" : "");
  show(t, true);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => show(t, false), 3000);
}

async function request(base, path, { method = "GET", body, auth = true, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).detail; } catch { detail = await res.text(); }
    throw new Error(`${res.status}: ${detail || res.statusText}`);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

// JWT decode (no verification — UI only) so we know our own user_id.
function decodeJwt(t) {
  const [, payload] = t.split(".");
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

// ─── boot ─────────────────────────────────────────────────────────────────
$("#urlAuth").value = cfg.auth;
$("#urlPost").value = cfg.post;
$("#urlFeed").value = cfg.feed;
$("#saveUrls").onclick = (e) => {
  e.preventDefault();
  cfg.auth = $("#urlAuth").value.trim();
  cfg.post = $("#urlPost").value.trim();
  cfg.feed = $("#urlFeed").value.trim();
  localStorage.setItem("urlAuth", cfg.auth);
  localStorage.setItem("urlPost", cfg.post);
  localStorage.setItem("urlFeed", cfg.feed);
  toast("Service URLs saved");
};

function refreshAuthUI() {
  const loggedIn = Boolean(token && userId);
  show($("#composeSection"), loggedIn);
  show($("#followSection"), loggedIn);
  show($("#feedSection"), loggedIn);
  show($("#logoutBtn"), loggedIn);
  show($("#registerForm"), !loggedIn);
  show($("#loginForm"), !loggedIn);
  $("#me").textContent = loggedIn ? `Signed in as ${userId}` : "Not signed in";
  if (loggedIn) {
    getUserName(userId).then((name) => {
      $("#me").textContent = `Signed in as ${name}`;
    });
    loadFeed();
  }
}

// ─── auth ─────────────────────────────────────────────────────────────────
$("#registerForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const { user_id } = await request(cfg.auth, "/register", {
      method: "POST",
      auth: false,
      body: {
        email: f.email.value,
        password: f.password.value,
        display_name: f.display_name.value,
      },
    });
    toast(`Registered ${user_id} — now log in`);
    f.reset();
  } catch (err) {
    toast(err.message, "error");
  }
};

$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await request(cfg.auth, "/login", {
      method: "POST",
      auth: false,
      body: { email: f.email.value, password: f.password.value },
    });
    token = r.access_token;
    userId = decodeJwt(token).sub;
    localStorage.setItem("token", token);
    localStorage.setItem("userId", userId);
    f.reset();
    refreshAuthUI();
    toast("Logged in");
  } catch (err) {
    toast(err.message, "error");
  }
};

$("#logoutBtn").onclick = () => {
  token = null;
  userId = null;
  localStorage.removeItem("token");
  localStorage.removeItem("userId");
  $("#feed").innerHTML = "";
  refreshAuthUI();
};

// ─── compose ──────────────────────────────────────────────────────────────
$("#composeForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const file = f.image.files[0];
    let media_keys = [];
    if (file) {
      const presign = await request(cfg.post, "/media/presign", {
        method: "POST",
        body: { content_type: file.type, size_bytes: file.size },
      });
      const putRes = await fetch(presign.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);
      media_keys = [presign.media_key];
    }
    await request(cfg.post, "/posts", {
      method: "POST",
      body: { content: f.content.value, media_keys },
    });
    f.reset();
    toast("Posted — feed will update once the worker processes the event");
    setTimeout(loadFeed, 800);
  } catch (err) {
    toast(err.message, "error");
  }
};

// ─── follow ──────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveFollowee(input) {
  const v = input.trim();
  if (!v) throw new Error("Enter a user name first");
  if (UUID_RE.test(v)) return v;
  const user = await request(cfg.auth, `/users/by-name/${encodeURIComponent(v)}`);
  return user.user_id;
}

$("#followForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const followee_id = await resolveFollowee(f.followee_id.value);
    await request(cfg.post, "/follow", {
      method: "POST",
      body: { followee_id },
    });
    toast("Followed");
  } catch (err) {
    toast(err.message, "error");
  }
};
$("#unfollowBtn").onclick = async () => {
  try {
    const followee_id = await resolveFollowee($("#followForm").followee_id.value);
    await request(cfg.post, "/follow", {
      method: "DELETE",
      body: { followee_id },
    });
    toast("Unfollowed");
  } catch (err) {
    toast(err.message, "error");
  }
};

// ─── feed ─────────────────────────────────────────────────────────────────
async function loadFeed() {
  const target = $("#feed");
  target.textContent = "loading…";
  try {
    const data = await request(cfg.feed, `/feed/${userId}?limit=50`);
    target.innerHTML = "";
    if (!data.items.length) {
      target.innerHTML = '<div class="empty">No posts yet — create one or follow somebody.</div>';
      return;
    }
    for (const item of data.items) {
      target.appendChild(renderPost(item));
    }
  } catch (err) {
    target.innerHTML = "";
    toast(err.message, "error");
  }
}

// Tiny per-session cache so we don't refetch the same user repeatedly.
const userCache = new Map();
async function getUserName(userId) {
  if (userCache.has(userId)) return userCache.get(userId);
  const p = request(cfg.auth, `/users/${userId}`)
    .then((u) => u.display_name)
    .catch(() => userId); // fall back to UUID if lookup fails
  userCache.set(userId, p);
  return p;
}

function renderPost(item) {
  const wrap = document.createElement("div");
  wrap.className = "post";
  const ts = new Date(item.created_at).toLocaleString();
  wrap.innerHTML = `
    <div class="meta">
      <span class="author">${item.author_id}</span>
      <span>${ts}</span>
    </div>
    <div class="content"></div>
    <div class="media"></div>
    <div class="actions">
      <button class="ghost like">Like</button>
      <button class="ghost unlike">Unlike</button>
      <span class="likeCount">0 likes</span>
    </div>
  `;
  wrap.querySelector(".content").textContent = item.content;

  getUserName(item.author_id).then((name) => {
    wrap.querySelector(".author").textContent = name;
  });

  // Fetch full post for media URLs + like count.
  request(cfg.post, `/posts/by-id/${item.post_id}`)
    .then((p) => {
      const mediaEl = wrap.querySelector(".media");
      for (const url of p.media_urls || []) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        mediaEl.appendChild(img);
      }
      setLikeCount(wrap, p.likes_count ?? 0);
    })
    .catch(() => { /* ignore */ });

  wrap.querySelector(".like").onclick = () => toggleLike(item.post_id, true, wrap);
  wrap.querySelector(".unlike").onclick = () => toggleLike(item.post_id, false, wrap);
  return wrap;
}

function setLikeCount(wrap, n) {
  const el = wrap.querySelector(".likeCount");
  el.textContent = `${n} like${n === 1 ? "" : "s"}`;
  el.dataset.count = String(n);
}

async function toggleLike(postId, liking, wrap) {
  try {
    await request(cfg.post, `/posts/${postId}/like`, {
      method: liking ? "POST" : "DELETE",
    });
    // Refresh the count from the server so it stays accurate even on no-op
    // (e.g. liking twice).
    const p = await request(cfg.post, `/posts/by-id/${postId}`);
    setLikeCount(wrap, p.likes_count ?? 0);
    toast(liking ? "Liked" : "Unliked");
  } catch (err) {
    toast(err.message, "error");
  }
}

$("#refreshFeed").onclick = loadFeed;

refreshAuthUI();
