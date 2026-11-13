/*
 * 글 좋아요 + 댓글 (글 페이지). 서버: ~/llmops-blog-assistant/gateway/src/community (Cloudflare Worker + D1)
 * - 글 좋아요: 로그인 없이. 이 브라우저의 임의 ID(localStorage "cm-voter")로 글마다 한 번. 다시 누르면 취소.
 * - 댓글: Google 로그인 뒤 쓰기·답글(한 단계)·좋아요·신고·내 글 삭제. 읽기는 누구나.
 *   Google 스크립트는 "Google로 로그인"을 누를 때만 불러온다(누르기 전에는 Google로 아무것도 가지 않음).
 *   로그인 상태는 이 탭에서만 기억(sessionStorage "cm-session", 24시간짜리 서버 서명 토큰).
 *   로그아웃·전체 삭제 버튼은 두지 않는다(2026-11-13 사용자 결정). 탭을 닫으면 로그아웃되고, 댓글은 하나씩 지운다.
 * - 남이 쓴 글자는 textContent로만 그린다(innerHTML 없음, 링크 없음).
 * - 좋아요를 누르면 팡 효과(site-tools.js blogBurst).
 * 설정: window.BLOG_COMMUNITY = { endpoint, googleClientId, privacyUrl }  (_data/community.yml)
 * 순수 함수는 _tests/community.test.mjs 에서 테스트한다.
 */
(function (root) {
  "use strict";

  const MAX_CHARS = 1000, MAX_REASON = 200, MAX_NAME = 30;
  const cpLen = (s) => Array.from(s).length;

  /** 글 주소(/posts/<slug>/)에서 slug. 서버와 같은 규칙(소문자·숫자·-)이 아니면 null. */
  function slugOf(pathname) {
    const m = String(pathname || "").match(/^\/posts\/([a-z0-9][a-z0-9-]{0,99})\/?$/);
    return m ? m[1] : null;
  }

  /** "방금", "5분 전", "3시간 전", "2일 전", 그 뒤는 날짜(YYYY.MM.DD, 한국 시간). */
  function relTime(iso, nowMs) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.floor((nowMs - t) / 1000));
    if (s < 60) return "방금";
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}일 전`;
    return new Date(t + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, ".");
  }

  /** 서버가 준 평평한 목록 → 맨 위 댓글 + 답글. 부모가 없는 답글은 버린다. 화면에 보일 댓글 수(지워진 자리 제외)도 센다. */
  function toTree(list) {
    const tops = [], byId = new Map();
    let count = 0;
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || typeof c.id !== "string") continue;
      if (!c.parent_id) { const n = { ...c, replies: [] }; byId.set(c.id, n); tops.push(n); if (!c.deleted) count++; }
    }
    for (const c of Array.isArray(list) ? list : []) {
      if (c && c.parent_id && byId.has(c.parent_id)) { byId.get(c.parent_id).replies.push(c); if (!c.deleted) count++; }
    }
    return { tops, count };
  }

  /** 저장된 로그인 상태가 아직 쓸 만한지(형식·기한). 아니면 null. */
  function readSession(raw, nowMs) {
    try {
      const s = JSON.parse(raw || "null");
      if (!s || typeof s.token !== "string" || typeof s.exp !== "number" || s.exp * 1000 < nowMs + 60000) return null;
      return { token: s.token, exp: s.exp, name: String(s.name || "익명"), admin: s.admin === true };
    } catch { return null; }
  }

  const core = { MAX_CHARS, MAX_REASON, cpLen, slugOf, relTime, toTree, readSession };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }

  /* ── 화면 ── */
  const cfg = root.BLOG_COMMUNITY;
  const doc = document;
  const slug = slugOf(location.pathname);
  if (!cfg || !cfg.endpoint || !slug) return;
  const track = (e, p) => { if (typeof root.blogTrack === "function") root.blogTrack(e, p); };
  const burst = (b) => { if (typeof root.blogBurst === "function") root.blogBurst(b); };
  const local = {
    get: (k) => { try { return root.localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { root.localStorage.setItem(k, v); } catch { /* 무시 */ } },
  };
  const tab = {
    get: (k) => { try { return root.sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { root.sessionStorage.setItem(k, v); } catch { /* 무시 */ } },
    del: (k) => { try { root.sessionStorage.removeItem(k); } catch { /* 무시 */ } },
  };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const voter = (() => {
    let v = local.get("cm-voter");
    if (!v || !UUID_RE.test(v)) { v = root.crypto && crypto.randomUUID ? crypto.randomUUID() : ""; if (v) local.set("cm-voter", v); }
    return v;
  })();

  function el(tag, attrs, text) {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }
  const icon = (cls) => { const i = el("i", { class: cls, "aria-hidden": "true" }); return i; };

  let session = readSession(tab.get("cm-session"), Date.now());
  const setSession = (s) => { session = s; if (s) tab.set("cm-session", JSON.stringify(s)); else tab.del("cm-session"); };

  /** 서버 호출. 401이면 로그인 상태를 지운다. 돌려주는 값: { ok, status, data } */
  async function api(method, path, body) {
    try {
      const r = await fetch(cfg.endpoint + path, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}),
                   ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await r.json(); } catch { /* 빈 본문 */ }
      if (r.status === 401 && session && path !== "/session") { setSession(null); renderAuth(); }
      return { ok: r.ok, status: r.status, data: data || {} };
    } catch { return { ok: false, status: 0, data: {} }; }
  }
  const errText = (r) => (r.data && typeof r.data.error === "string" && r.data.error.length < 200
    ? r.data.error : "지금은 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");

  /* ── 뼈대 ── */
  const likeBar = el("div", { class: "cm cm-likebar" });
  const likeBtn = el("button", { type: "button", class: "cm-like", "aria-pressed": "false", "aria-label": "이 글 좋아요" });
  const likeIcon = icon("far fa-heart");
  const likeNum = el("span", { class: "cm-like-n" }, "0");
  likeBtn.append(likeIcon, el("span", null, "좋아요"), likeNum);
  likeBar.append(likeBtn);

  const box = el("section", { id: "comments", class: "cm cm-comments", "aria-labelledby": "cm-title" });
  const title = el("h2", { id: "cm-title" }, "댓글 ");
  const total = el("span", { class: "cm-total" }, "0");
  title.append(total);
  const authBox = el("div", { class: "cm-auth" });
  const status = el("p", { class: "cm-status", role: "status" });
  const listEl = el("ol", { class: "cm-list" });
  box.append(title, authBox, status, listEl);
  const say = (m) => { status.textContent = m || ""; };

  /* ── 글 좋아요 ── */
  let liked = false, likeBusy = false;
  const paintLike = (n, on) => {
    liked = on;
    likeBtn.setAttribute("aria-pressed", String(on));
    likeIcon.className = on ? "fas fa-heart" : "far fa-heart";
    likeNum.textContent = String(n);
    likeBtn.setAttribute("aria-label", on ? `좋아요 취소 (지금 ${n}개)` : `이 글 좋아요 (지금 ${n}개)`);
  };
  likeBtn.addEventListener("click", async () => {
    if (likeBusy || !voter) return;
    likeBusy = true;
    const want = !liked, before = Number(likeNum.textContent) || 0;
    paintLike(Math.max(0, before + (want ? 1 : -1)), want);   // 먼저 그리고, 실패하면 되돌린다
    if (want) burst(likeBtn);
    const r = await api("POST", `/posts/${slug}/like`, { voter, on: want });
    if (r.ok && typeof r.data.likes === "number") paintLike(r.data.likes, r.data.liked === true);
    else paintLike(before, !want);
    if (r.ok) track("post_like", { on: want });
    likeBusy = false;
  });

  /* ── 작은 입력 칸: 댓글·답글·신고 사유가 같이 쓴다 ── */
  function miniForm({ label, placeholder, max, submit, optional, withName, onSubmit, onCancel }) {
    const f = el("form", { class: "cm-form" });
    let name = null;
    if (withName) {
      name = el("input", { type: "text", class: "cm-name-input", maxlength: String(MAX_NAME), "aria-label": "표시 이름", placeholder: "표시 이름" });
      name.value = session ? session.name : "";
      f.append(name);
    }
    const ta = el("textarea", { rows: "3", maxlength: String(max), "aria-label": label, placeholder });
    const bar = el("div", { class: "cm-form-bar" });
    const note = el("span", { class: "cm-note", role: "status" });
    const cnt = el("span", { class: "cm-count" }, `0 / ${max}`);
    const ok = el("button", { type: "submit", class: "cm-submit" }, submit);
    ok.disabled = !optional;
    bar.append(note, cnt);
    if (onCancel) {
      const no = el("button", { type: "button", class: "cm-cancel" }, "취소");
      no.addEventListener("click", onCancel);
      bar.append(no);
    }
    bar.append(ok);
    f.append(ta, bar);
    ta.addEventListener("input", () => {
      const n = cpLen(ta.value);
      cnt.textContent = `${n} / ${max}`;
      ok.disabled = n > max || (!optional && !ta.value.trim());
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      ok.disabled = true; note.textContent = "";
      const err = await onSubmit(ta.value.trim(), name ? name.value.trim() : undefined);
      if (err) { note.textContent = err; ok.disabled = false; }
    });
    return { form: f, focus: () => ta.focus() };
  }

  /* ── 로그인 영역 ── */
  let gsiLoading = null;
  const loadGsi = () => gsiLoading || (gsiLoading = new Promise((resolve, reject) => {
    if (root.google && root.google.accounts && root.google.accounts.id) return resolve(root.google.accounts.id);
    const s = doc.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (root.google && root.google.accounts && root.google.accounts.id
      ? resolve(root.google.accounts.id) : reject(new Error("gsi")));
    s.onerror = () => { gsiLoading = null; reject(new Error("gsi")); };
    doc.head.appendChild(s);
  }));

  async function onCredential(resp) {
    const r = await api("POST", "/session", { credential: resp && resp.credential });
    if (!r.ok || typeof r.data.token !== "string") { say(errText(r)); return; }
    setSession({ token: r.data.token, exp: r.data.exp, name: String(r.data.name || "익명"), admin: r.data.admin === true });
    track("comment_login", {});
    say("");
    renderAuth();
    load();
  }

  function renderAuth() {
    authBox.replaceChildren();
    if (!cfg.googleClientId) return;   // 로그인 설정 전: 댓글 영역 자체를 만들지 않는다(start 참고)
    if (!session) {
      const start = el("button", { type: "button", class: "cm-login" });
      start.append(icon("fab fa-google"), el("span", null, "Google로 로그인하고 댓글 쓰기"));
      const hint = el("p", { class: "cm-hint" },
        "누르면 Google 로그인 버튼을 불러와요. 블로그에는 표시 이름만 저장하고, 이메일·프로필 사진은 저장하지 않아요. ");
      if (cfg.privacyUrl) hint.append(el("a", { href: cfg.privacyUrl }, "개인정보 처리방침"));
      const slot = el("div", { class: "cm-gsi" });
      start.addEventListener("click", async () => {
        start.disabled = true;
        try {
          const gid = await loadGsi();
          gid.initialize({ client_id: cfg.googleClientId, callback: onCredential, ux_mode: "popup", auto_select: false });
          gid.renderButton(slot, { type: "standard", theme: "outline", size: "large", text: "signin_with", locale: "ko" });
          start.hidden = true;
        } catch {
          say("Google 로그인을 불러오지 못했어요(차단 확장 확인).");
          start.disabled = false;
        }
      });
      authBox.append(start, slot, hint);
      return;
    }
    const { form } = miniForm({
      label: "댓글", placeholder: "댓글 쓰기 (개인정보 제외, 1000자 이내)", max: MAX_CHARS, submit: "등록", withName: true,
      onSubmit: (text, name) => post(text, null, name),
    });
    authBox.append(form);
  }

  async function post(text, parentId, name) {
    const r = await api("POST", `/posts/${slug}/comments`, { body: text, ...(parentId ? { parent_id: parentId } : {}), ...(name ? { name } : {}) });
    if (!r.ok) return errText(r);
    if (name && session && name !== session.name && r.data.comment) setSession({ ...session, name: String(r.data.comment.name || name) });
    track("comment_post", { reply: !!parentId });
    renderAuth();
    await load();
    return "";
  }

  /* ── 댓글 하나 ── */
  const needLogin = () => { say("로그인하면 할 수 있어요."); authBox.scrollIntoView({ block: "center", behavior: "smooth" }); };

  function item(c, isReply) {
    const li = el("li", { class: "cm-item" + (isReply ? " is-reply" : "") });
    if (c.deleted) { li.append(el("p", { class: "cm-gone" }, "삭제된 댓글이에요.")); return li; }
    const head = el("div", { class: "cm-head" });
    head.append(el("span", { class: "cm-avatar", "aria-hidden": "true" }, Array.from(c.name || "익")[0] || "익"),
                el("strong", { class: "cm-name" }, c.name || "익명"));
    if (c.owner) head.append(el("span", { class: "cm-badge" }, "글쓴이"));
    const time = el("time", { datetime: c.created_at, title: c.created_at }, relTime(c.created_at, Date.now()));
    head.append(time);
    li.append(head);
    if (c.hidden) li.append(el("p", { class: "cm-gone" }, "신고가 쌓여 가려진 댓글이에요."));
    if (c.body) li.append(el("p", { class: "cm-body" }, c.body));

    const acts = el("div", { class: "cm-actions" });
    const slot = el("div", { class: "cm-slot" });
    const openForm = (opts) => {
      const { form, focus } = miniForm({ ...opts, onCancel: () => slot.replaceChildren() });
      slot.replaceChildren(form);
      focus();
    };
    if (!c.hidden || c.body) {
      const like = el("button", { type: "button", class: "cm-clike", "aria-pressed": String(!!c.liked) });
      const li2 = icon(c.liked ? "fas fa-heart" : "far fa-heart");
      const num = el("span", null, String(c.likes || 0));
      like.append(li2, num);
      like.setAttribute("aria-label", "댓글 좋아요");
      like.addEventListener("click", async () => {
        if (!session) return needLogin();
        const want = like.getAttribute("aria-pressed") !== "true";
        if (want) burst(like);
        const r = await api("POST", `/comments/${c.id}/like`, { on: want });
        if (!r.ok) return say(errText(r));
        like.setAttribute("aria-pressed", String(r.data.liked === true));
        li2.className = r.data.liked ? "fas fa-heart" : "far fa-heart";
        num.textContent = String(r.data.likes);
      });
      acts.append(like);
    }
    if (!isReply && !c.hidden) {
      const reply = el("button", { type: "button" }, "답글");
      reply.addEventListener("click", () => {
        if (!session) return needLogin();
        openForm({ label: "답글", placeholder: "답글 쓰기 (1000자 이내)", max: MAX_CHARS, submit: "등록", onSubmit: (text) => post(text, c.id) });
      });
      acts.append(reply);
    }
    if (!c.mine && !c.hidden) {
      const rep = el("button", { type: "button" }, c.reported ? "신고함" : "신고");
      rep.disabled = !!c.reported;
      rep.addEventListener("click", () => {
        if (!session) return needLogin();
        openForm({ label: "신고 사유", placeholder: "신고 사유 (선택, 200자 이내)", max: MAX_REASON, submit: "신고", optional: true,
          onSubmit: async (text) => {
            const r = await api("POST", `/comments/${c.id}/report`, { reason: text || null });
            if (!r.ok) return errText(r);
            track("comment_report", {});
            await load();
            say("신고를 받았어요.");
            return "";
          } });
      });
      acts.append(rep);
    }
    if (c.mine || (session && session.admin)) {
      const del = el("button", { type: "button" }, "삭제");
      del.addEventListener("click", async () => {
        if (!root.confirm("이 댓글을 지울까요?")) return;
        const r = await api("DELETE", `/comments/${c.id}`);
        if (r.ok) load(); else say(errText(r));
      });
      acts.append(del);
    }
    if (session && session.admin) {
      const hide = el("button", { type: "button" }, c.hidden ? "다시 보이기" : "가리기");
      hide.addEventListener("click", async () => {
        const r = await api("POST", `/comments/${c.id}/hide`, { hidden: !c.hidden });
        if (r.ok) load(); else say(errText(r));
      });
      acts.append(hide);
      if (c.reports) acts.append(el("span", { class: "cm-reports" }, `신고 ${c.reports}건`));
    }
    li.append(acts, slot);
    return li;
  }

  async function load() {
    const r = await api("GET", `/posts/${slug}${voter ? `?voter=${voter}` : ""}`);
    if (!r.ok) { say("댓글을 불러오지 못했어요."); return; }
    paintLike(Number(r.data.likes) || 0, r.data.liked === true);
    const { tops, count } = toTree(r.data.comments);
    total.textContent = String(count);
    listEl.replaceChildren();
    for (const c of tops) {
      const li = item(c, false);
      if (c.replies.length) {
        const ol = el("ol", { class: "cm-replies" });
        for (const k of c.replies) ol.append(item(k, true));
        li.append(ol);
      }
      listEl.append(li);
    }
    if (!tops.length) listEl.append(el("li", { class: "cm-empty" }, "첫 댓글을 남겨 보세요."));
  }

  function start() {
    const tail = doc.querySelector("article .post-tail-wrapper");
    if (!tail) return;
    tail.before(likeBar);
    if (cfg.googleClientId) {   // 로그인 설정이 있어야 댓글 영역을 만든다(없으면 글 좋아요만)
      // 자리: [이전 글·목록·다음 글] 바로 아래(#tail-wrapper 안에는 푸터도 있어서 맨 끝에 붙이면 푸터 밑으로 간다)
      const nav = doc.querySelector("#tail-wrapper .post-navigation");
      if (nav) nav.after(box); else tail.parentElement.append(box);
      renderAuth();
    }
    load();
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(typeof window !== "undefined" ? window : globalThis);
