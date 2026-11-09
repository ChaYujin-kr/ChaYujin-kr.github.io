/*
 * 다 읽으면 추천 (글 페이지). 기본은 같은 시리즈의 다음 편.
 * 사용자 데이터: 이 브라우저에만 저장하는 "읽은 글" 목록(localStorage "read-v1"). 서버로 보내지 않는다.
 *   - 다 읽은 글(90% 스크롤)을 기록하고, 추천에서 이미 읽은 글은 뒤로 미룬다.
 * 점수: 같은 시리즈 +3, 겹치는 태그 1개당 +1(최대 3), 안 읽은 글 +2. 같은 점수면 최근 글 먼저.
 * 순수 함수는 _tests/recommend.test.mjs 에서 테스트한다.
 */
(function (root) {
  "use strict";
  const KEY = "read-v1";
  const MAX_HISTORY = 200;

  const norm = (u) => String(u || "").replace(/[?#].*$/, "").replace(/\/?$/, "/");

  /** 시리즈 안에서 날짜순 다음 편(없으면 null). */
  function seriesNext(posts, cur) {
    if (!cur || !cur.series) return null;
    const list = posts.filter((p) => p.series === cur.series).sort((a, b) => (a.date < b.date ? -1 : 1));
    const i = list.findIndex((p) => norm(p.url) === norm(cur.url));
    return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  }

  /** 추천: { primary: {post, reason}, more: [{post, reason}] } */
  function recommend(posts, curUrl, history) {
    const read = new Set(Object.keys(history || {}).map(norm));
    const cur = posts.find((p) => norm(p.url) === norm(curUrl));
    if (!cur) return { primary: null, more: [] };
    const next = seriesNext(posts, cur);
    const tags = new Set(cur.tags || []);
    const scored = posts
      .filter((p) => norm(p.url) !== norm(cur.url) && (!next || norm(p.url) !== norm(next.url)))
      .map((p) => {
        const shared = (p.tags || []).filter((t) => tags.has(t));
        const sameSeries = !!cur.series && p.series === cur.series;
        const unread = !read.has(norm(p.url));
        const score = (sameSeries ? 3 : 0) + Math.min(shared.length, 3) + (unread ? 2 : 0);
        const reason = sameSeries ? "같은 시리즈" : shared.length ? `같은 주제: ${shared.slice(0, 2).join(", ")}` : "최근 글";
        return { post: p, score, reason, unread };
      })
      .sort((a, b) => b.score - a.score || (a.post.date < b.post.date ? 1 : -1));
    const primary = next ? { post: next, reason: "시리즈 다음 편" } : (scored.length ? { post: scored[0].post, reason: scored[0].reason } : null);
    const more = (next ? scored : scored.slice(1)).filter((s) => s.score > 0).slice(0, 2).map((s) => ({ post: s.post, reason: s.reason }));
    return { primary, more };
  }

  function remember(history, url, now) {
    const h = { ...(history || {}) };
    h[norm(url)] = now;
    const keys = Object.keys(h).sort((a, b) => h[b] - h[a]);
    for (const k of keys.slice(MAX_HISTORY)) delete h[k];
    return h;
  }

  const core = { recommend, seriesNext, remember, norm };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }

  const doc = document;
  const cfg = root.BLOG_REC || {};
  const track = (e, p) => { if (typeof root.blogTrack === "function") root.blogTrack(e, p); };
  const load = () => { try { return JSON.parse(root.localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = (h) => { try { root.localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* 무시 */ } };
  const el = (tag, attrs, text) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };

  let shown = false;
  async function onReadComplete() {
    if (shown) return;
    shown = true;
    const here = location.pathname;
    const history = remember(load(), here, Date.now());
    save(history);
    let posts;
    try { posts = await (await fetch(cfg.index || "/assets/data/posts.json", { cache: "force-cache" })).json(); }
    catch { return; }
    const rec = recommend(posts, here, history);
    if (!rec.primary) return;

    // 항목마다 "왜 이 글인지" 짧은 꼬리표: 다음 글 / 같은 시리즈 / 비슷한 글 / 추천 글
    const label = (reason) => reason === "시리즈 다음 편" ? "다음 글" : reason === "같은 시리즈" ? "같은 시리즈"
      : String(reason).startsWith("같은 주제") ? "비슷한 글" : "추천 글";
    const card = el("aside", { class: "rec-card", role: "complementary", "aria-label": "이어서 읽기" });
    const head = el("div", { class: "rec-head" });
    head.append(el("strong", null, "이어서 읽기"));
    const close = el("button", { type: "button", class: "rec-close", "aria-label": "닫기" }, "×");
    head.append(close);
    const ul = el("ul", { class: "rec-items" });
    const items = [{ ...rec.primary, primary: true }, ...rec.more];
    for (const it of items) {
      const a = el("a", { class: "rec-item" + (it.primary ? " is-primary" : ""), href: it.post.url });
      a.append(el("span", { class: "rec-label" }, label(it.reason)), el("span", { class: "rec-title" }, it.post.title));
      a.addEventListener("click", () => track("rec_click", { type: label(it.reason) }));
      const li = el("li"); li.append(a); ul.append(li);
    }
    card.append(head, ul);
    const list = el("a", { class: "rec-list", href: cfg.listUrl || "/" }, "목록으로");
    list.addEventListener("click", () => track("rec_click", { type: "list" }));
    card.append(list);
    const dismiss = () => { card.classList.remove("is-in"); setTimeout(() => card.remove(), 250); track("rec_dismiss", {}); };
    close.addEventListener("click", dismiss);
    card.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
    doc.body.append(card);
    requestAnimationFrame(() => card.classList.add("is-in"));
    track("rec_shown", { primary: rec.primary.reason === "시리즈 다음 편" ? "series_next" : "related", more: rec.more.length });
  }

  root.addEventListener("blog:read-complete", onReadComplete);
})(typeof window !== "undefined" ? window : globalThis);
