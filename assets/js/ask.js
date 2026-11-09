/*
 * 블로그 AI 질문 사이드바
 * - 오른쪽에 붙는 사이드바(휴대폰은 아래 시트). 접기/펼치기, 열린 상태는 이 탭에서만 기억.
 * - 답변은 생성되는 대로 보여준다(서버 SSE). 서버가 출력 가드를 거친 "지금까지의 안전한 전체 글"을 보내고,
 *   끝나면 인용 확인을 마친 최종 답으로 바꾼다(인용이 없으면 "찾지 못했어요").
 * - 글은 textContent로만 넣는다. 링크는 블로그 글 주소(/posts/)만 <a>로 만든다.
 * - 봇 확인(Turnstile)은 사이드바를 처음 열 때만 불러오고, 필요할 때만 보인다(interaction-only).
 * - GA4로는 질문 내용을 보내지 않는다(결과 유형·글자 수 구간·걸린 시간만).
 * 설정: window.BLOG_ASK = { endpoint, sitekey, siteUrl, privacyUrl, examples: [..] }  (_data/assistant.yml)
 */
(function (root) {
  "use strict";

  /* ── 순수 함수 (_tests/ask.test.mjs) ── */
  const MAX_CHARS = 500;
  const cpLen = (s) => Array.from(s).length;

  function safeLinks(links, siteUrl) {
    if (!Array.isArray(links)) return [];
    let site;
    try { site = new URL(siteUrl).origin; } catch { return []; }
    const out = [];
    for (const l of links) {
      if (!l || typeof l.url !== "string") continue;
      let u;
      try { u = new URL(l.url); } catch { continue; }
      if (u.origin !== site || !u.pathname.startsWith("/posts/")) continue;
      out.push({ url: u.href, title: String(l.title || ""), heading: String(l.heading || "") });
    }
    return out.slice(0, 5);
  }

  function readConsent(storage) {
    try { const c = JSON.parse(storage.getItem("consent-v1") || "null"); return !!(c && c.ai_logging === true); }
    catch { return false; }
  }

  function buildRequest(question, token, consent, path) {
    return { question: question.trim(), turnstile_token: token, consent_logging: consent, stream: true,
             page: typeof path === "string" && path.startsWith("/") ? path.slice(0, 200) : undefined };
  }

  const lenBucket = (n) => (n <= 50 ? "<=50" : n <= 100 ? "<=100" : n <= 200 ? "<=200" : "<=500");
  const formatSeconds = (ms) => (ms < 10000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000))) + "초";

  /** 스트리밍이 아닌 응답(오류 JSON 등) 해석. */
  function interpret(status, body) {
    if (status === 200 && body && typeof body.can_answer === "boolean") {
      return body.can_answer
        ? { kind: "answered", text: String(body.answer || ""), answerId: typeof body.answer_id === "string" ? body.answer_id : null }
        : { kind: "none", text: NONE_TEXT, answerId: null };
    }
    const msg = body && typeof body.error === "string" && body.error.length < 200 ? body.error : ERROR_TEXT;
    return { kind: status === 429 || status === 503 ? "limited" : "error", text: msg, answerId: null };
  }
  const NONE_TEXT = "블로그에서 답을 찾지 못했어요.";
  const ERROR_TEXT = "지금은 답할 수 없어요. 잠시 후 다시 시도해 주세요.";

  /** SSE 조각 해석: 완성된 이벤트들과 남은 조각. 형식이 깨진 이벤트는 버린다. */
  function parseSSE(buffer) {
    const events = [];
    const parts = buffer.split("\n\n");
    const rest = parts.pop();
    for (const block of parts) {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      try { events.push({ event, data: JSON.parse(data) }); } catch { /* 버림 */ }
    }
    return { events, rest };
  }

  const core = { MAX_CHARS, cpLen, safeLinks, readConsent, buildRequest, lenBucket, formatSeconds, interpret, parseSSE };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }
  root.BlogAskCore = core;

  /* ── 화면 ── */
  const cfg = root.BLOG_ASK;
  if (!cfg || !cfg.endpoint || !cfg.sitekey) return;
  const doc = document;
  const html = doc.documentElement;
  const track = (e, p) => { if (typeof root.blogTrack === "function") root.blogTrack(e, p); };
  const storage = { getItem: (k) => { try { return root.localStorage.getItem(k); } catch { return null; } } };
  const session = {
    get: (k) => { try { return root.sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { root.sessionStorage.setItem(k, v); } catch { /* 무시 */ } },
  };
  const mobileMq = root.matchMedia ? root.matchMedia("(max-width: 767.98px)") : { matches: false, addEventListener() {} };
  const examples = Array.isArray(cfg.examples) && cfg.examples.length
    ? cfg.examples.slice(0, 2).map(String)
    : ["드리프트 경보가 울리면 바로 재학습해야 하나요?", "지연 라벨 환경에서 서빙 로그에 무엇을 남겨야 해요?"];

  /* 단순한 봇 얼굴 (직접 그림): 둥근 사각 얼굴, 두 눈, 양쪽 귀, 안테나. 색은 은색(스틸) 그라데이션 */
  const BOT = (g) =>
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/>` +
    `<stop offset=".55" stop-color="#c3c8ce"/><stop offset="1" stop-color="#8f969e"/></linearGradient></defs>` +
    `<g fill="none" stroke="url(#${g})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="4.5" y="7" width="15" height="12" rx="4"/><path d="M12 7V4.6"/><path d="M2.6 11.5v3M21.4 11.5v3"/></g>` +
    `<g class="ask-fill" fill="url(#${g})"><circle cx="12" cy="3.4" r="1.3"/><circle cx="9.3" cy="12.6" r="1.45"/>` +
    `<circle cx="14.7" cy="12.6" r="1.45"/></g>`;
  const svg = (inner, extra = "") => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${inner}</svg>`;
  const ICON = {
    spark: svg(BOT("ask-steel-a")),
    sparkGrad: `<span class="ask-badge">${svg(BOT("ask-steel-b"))}</span>`,
    send: svg('<path d="M12 4l7 7-1.4 1.4L13 7.8V20h-2V7.8l-4.6 4.6L5 11z"/>'),
    close: svg('<path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/>'),
    collapse: svg('<path d="M9.3 5.3 15.9 12l-6.6 6.7-1.4-1.4 5.2-5.3-5.2-5.3z"/>'),
    down: svg('<path d="M5.3 8.3 12 14.9l6.7-6.6 1.4 1.4L12 17.8 3.9 9.7z"/>'),
    reset: svg('<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>'),
  };

  function el(tag, attrs, text) {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  let turnstileLoading = null;
  const loadTurnstile = () => turnstileLoading || (turnstileLoading = new Promise((resolve, reject) => {
    if (root.turnstile) return resolve(root.turnstile);
    const s = doc.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve(root.turnstile);
    s.onerror = () => { turnstileLoading = null; reject(new Error("turnstile")); };
    doc.head.appendChild(s);
  }));

  function init() {
    /* 열기 버튼 */
    const launcher = el("button", { type: "button", class: "ask-launcher", "aria-controls": "ask-panel", "aria-expanded": "false" });
    launcher.innerHTML = ICON.spark;
    launcher.setAttribute("aria-label", "AI에게 질문하기");
    launcher.setAttribute("title", "AI에게 질문하기");

    /* 사이드바 */
    const panel = el("aside", { id: "ask-panel", class: "ask-panel", "aria-labelledby": "ask-title", translate: "no" });
    const head = el("div", { class: "ask-head" });
    const btnNew = el("button", { type: "button", class: "ask-iconbtn", "aria-label": "새 대화", title: "새 대화" });
    btnNew.innerHTML = ICON.reset;
    const btnClose = el("button", { type: "button", class: "ask-iconbtn", "aria-label": "접기", title: "접기" });
    const titles = el("div", { class: "ask-titles" });
    titles.append(el("h2", { id: "ask-title" }, "블로그 AI"));
    head.append(titles, btnNew, btnClose);

    const log = el("div", { class: "ask-log", role: "log", "aria-live": "polite", "aria-relevant": "additions" });
    const announce = el("div", { class: "ask-sr", "aria-live": "polite" });

    const foot = el("div", { class: "ask-foot" });
    const exBox = el("div", { class: "ask-examples", role: "group", "aria-label": "예시 질문" });
    for (const q of examples) {
      const b = el("button", { type: "button", class: "ask-example" }, q);
      b.addEventListener("click", () => { input.value = q; onInput(); submit("example"); });
      exBox.append(b);
    }
    const card = el("div", { class: "ask-card" });
    const form = el("form", { class: "ask-form" });
    const box = el("div", { class: "ask-box" });
    const input = el("textarea", { id: "ask-input", rows: "1", placeholder: "질문 입력 (개인정보 제외)",
                                   "aria-label": "질문", "aria-describedby": "ask-count" });
    const send = el("button", { type: "submit", class: "ask-send", "aria-label": "보내기", disabled: "" });
    send.innerHTML = ICON.send;
    box.append(input, send);
    const row2 = el("div", { class: "ask-row2" });
    const count = el("span", { id: "ask-count", class: "ask-count" }, `0 / ${MAX_CHARS}`);
    row2.append(count);
    const human = el("div", { class: "ask-human" });
    form.append(box, row2);
    card.append(form);
    foot.append(exBox, card, human);
    panel.append(head, log, foot, announce);
    doc.body.append(launcher, panel);

    /* 상단 바 버튼(있으면) */
    const tools = doc.querySelector(".site-tools");
    let topBtn = null;
    if (tools && false) {   // 상단 바 버튼은 쓰지 않음(2026-11-10): 번역·듣기·검색만 둔다
      topBtn = el("button", { type: "button", "aria-controls": "ask-panel", "aria-expanded": "false", "aria-label": "AI에게 질문하기" });
      topBtn.innerHTML = '<i class="fas fa-comments" aria-hidden="true"></i><span class="tool-label">질문하기</span>';
      tools.insertBefore(topBtn, tools.querySelector(".tool-status"));
    }

    /* 상태 */
    let busy = false;
    let widgetId = null;

    const setMobile = () => {
      html.classList.toggle("ask-mobile", mobileMq.matches);
      btnClose.innerHTML = mobileMq.matches ? ICON.down : ICON.collapse;
    };
    setMobile();
    mobileMq.addEventListener("change", setMobile);


    const ensureHuman = async () => {
      if (widgetId !== null) return;
      try {
        const ts = await loadTurnstile();
        widgetId = ts.render(human, { sitekey: cfg.sitekey, appearance: "interaction-only", size: "flexible",
                                      language: "ko", "refresh-expired": "auto", action: "ask" });
      } catch {
        human.textContent = "사람 확인을 불러오지 못했어요(차단 확장 확인).";
      }
    };
    const waitToken = async (ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const tok = root.turnstile && widgetId !== null ? root.turnstile.getResponse(widgetId) : "";
        if (tok) return tok;
        await new Promise((r) => setTimeout(r, 200));
      }
      return "";
    };

    const showEmpty = () => {
      log.replaceChildren();
      const w = el("div", { class: "ask-welcome" });
      const icon = el("div");
      icon.innerHTML = ICON.sparkGrad;
      w.append(icon, el("h3", null, "블로그 글에서 찾아 답해요"));
      log.append(w);
      exBox.hidden = false;
    };
    showEmpty();

    const open = (via) => {
      html.classList.add("ask-open");
      [launcher, topBtn].forEach((b) => b && b.setAttribute("aria-expanded", "true"));
      session.set("ask-open", "1");
      ensureHuman();
      if (!mobileMq.matches || via !== "restore") setTimeout(() => input.focus(), 50);
      if (via !== "restore") track("ai_panel_open", { via });
    };
    const close = () => {
      html.classList.remove("ask-open");
      [launcher, topBtn].forEach((b) => b && b.setAttribute("aria-expanded", "false"));
      session.set("ask-open", "0");
      (doc.activeElement && panel.contains(doc.activeElement) ? launcher : null)?.focus();
    };
    launcher.addEventListener("click", () => open("launcher"));
    if (topBtn) topBtn.addEventListener("click", () => (html.classList.contains("ask-open") ? close() : open("topbar")));
    btnClose.addEventListener("click", close);
    btnNew.addEventListener("click", () => { if (!busy) { showEmpty(); input.focus(); } });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    if (session.get("ask-open") === "1" && !mobileMq.matches) open("restore");

    const onInput = () => {
      const n = cpLen(input.value);
      count.textContent = `${n} / ${MAX_CHARS}`;
      count.classList.toggle("over", n > MAX_CHARS);
      send.disabled = busy || !input.value.trim() || n > MAX_CHARS;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 136) + "px";
    };
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit("enter"); }
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); submit("button"); });

    const scrollDown = () => { log.scrollTop = log.scrollHeight; };

    function botMessage() {
      const wrap = el("div", { class: "ask-msg bot is-streaming", "aria-busy": "true" });
      const bubble = el("div", { class: "ask-bubble" });
      const thinking = el("span", { class: "ask-thinking", "aria-hidden": "true" });
      thinking.append(el("i"), el("i"), el("i"));
      const text = el("span", { class: "ask-text" });
      bubble.append(thinking, text);
      const meta = el("div", { class: "ask-meta" }, "답변 생성 중 · 0초");
      wrap.append(bubble, meta);
      log.append(wrap);
      const t0 = performance.now();
      const tick = setInterval(() => {
        meta.textContent = `${text.textContent ? "작성 중" : "답변 생성 중"} · ${Math.floor((performance.now() - t0) / 1000)}초`;
      }, 250);
      return {
        set(t) { if (t) thinking.remove(); text.textContent = t; scrollDown(); },
        finish(state, links) {
          clearInterval(tick);
          const ms = performance.now() - t0;
          thinking.remove();
          wrap.classList.remove("is-streaming");
          wrap.setAttribute("aria-busy", "false");
          if (state.kind !== "answered") wrap.classList.add(state.kind === "none" ? "is-none" : "is-error");
          text.textContent = state.text;
          meta.textContent = state.kind === "answered" ? `${formatSeconds(ms)} · 근거 ${links.length}개` : formatSeconds(ms);
          if (links.length) {
            const ul = el("ul", { class: "ask-sources", "aria-label": "근거 단락" });
            for (const l of links) {
              const a = el("a", { href: l.url }, l.heading && l.heading !== "(도입)" ? `${l.title} › ${l.heading}` : l.title);
              a.addEventListener("click", () => track("ai_link_click", {}));
              const li = el("li"); li.append(a); ul.append(li);
            }
            wrap.append(ul);
          }
          if (state.answerId) wrap.append(feedback(state.answerId));
          announce.textContent = state.kind === "answered" ? "답변이 완성됐어요" : state.text;
          scrollDown();
          return ms;
        },
      };
    }

    function feedback(answerId) {
      const fb = el("div", { class: "ask-feedback", role: "group", "aria-label": "답변 평가" });
      const sendFb = async (rating, b) => {
        fb.querySelectorAll("button").forEach((x) => { x.disabled = true; });
        b.setAttribute("aria-pressed", "true");
        track("ai_feedback", { rating });
        try {
          await fetch(`${cfg.endpoint}/feedback`, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ answer_id: answerId, rating }) });
        } catch { /* 조용히 */ }
      };
      const up = el("button", { type: "button", "aria-label": "도움이 됐어요" }, "👍");
      const down = el("button", { type: "button", "aria-label": "도움이 안 됐어요" }, "👎");
      up.addEventListener("click", () => sendFb(1, up));
      down.addEventListener("click", () => sendFb(-1, down));
      fb.append(up, down);
      return fb;
    }

    async function submit(via) {
      const q = input.value.trim();
      if (busy || !q || cpLen(q) > MAX_CHARS) return;
      busy = true;
      if (log.querySelector(".ask-welcome")) log.replaceChildren();
      exBox.hidden = true;
      log.append(el("div", { class: "ask-msg user" }, q));
      input.value = ""; onInput();
      const msg = botMessage();
      scrollDown();

      let state = null;
      let links = [];
      try {
        await ensureHuman();
        const token = await waitToken(8000);
        if (!token) throw new Error("human");
        const r = await fetch(`${cfg.endpoint}/ask`, {
          method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(buildRequest(q, token, readConsent(storage), location.pathname)),
        });
        const type = r.headers.get("content-type") || "";
        if (!r.ok || !type.startsWith("text/event-stream") || !r.body) {
          let body = null;
          try { body = await r.json(); } catch { /* 빈 본문 */ }
          state = interpret(r.status, body);
        } else {
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const parsed = parseSSE(buf + dec.decode(value, { stream: true }));
            buf = parsed.rest;
            for (const ev of parsed.events) {
              if (ev.event === "delta" && typeof ev.data.text === "string") msg.set(ev.data.text);
              else if (ev.event === "done") {
                state = interpret(200, ev.data);
                if (state.kind === "answered") links = safeLinks(ev.data.links, cfg.siteUrl);
              } else if (ev.event === "error") state = interpret(500, ev.data);
            }
          }
          if (!state) state = { kind: "error", text: ERROR_TEXT, answerId: null };
        }
      } catch (e) {
        state = e && e.message === "human"
          ? { kind: "error", text: "사람 확인 후 다시 보내 주세요.", answerId: null }
          : { kind: "error", text: ERROR_TEXT, answerId: null };
      } finally {
        if (root.turnstile && widgetId !== null) root.turnstile.reset(widgetId);   // 토큰은 1회용
      }
      const ms = msg.finish(state, links);
      busy = false; onInput();
      if (!mobileMq.matches) input.focus();
      track("ai_ask", { result: state.kind, q_len: lenBucket(cpLen(q)), seconds: Math.round(ms / 1000),
                        consent: readConsent(storage) ? "yes" : "no", via });
    }
  }

  /* defer 스크립트는 DOMContentLoaded 직전에 실행돼서 상단 바(.site-tools)가 아직 없다(2026-11-09 버그: 버튼이 안 생김).
     DOMContentLoaded 이후, 다른 초기화가 끝난 뒤(setTimeout 0)에 시작한다. */
  const start = () => setTimeout(init, 0);
  if (document.readyState === "complete") start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})(typeof window !== "undefined" ? window : globalThis);
