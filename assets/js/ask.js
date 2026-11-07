/*
 * 블로그 AI 질문 창 (2단계 G3)
 * - 상단 바에 "질문하기" 버튼 → 오른쪽 패널(휴대폰은 아래 시트)
 * - 답변은 textContent로만 넣는다. 링크는 블로그 주소(/posts/...)인 것만 <a>로 만든다.
 * - 봇 확인(Turnstile) 스크립트는 패널을 처음 열 때만 불러온다(모든 방문자에게 제3자 스크립트를 싣지 않음).
 * - 질문 저장 여부는 동의 설정(localStorage "consent-v1".ai_logging)을 따른다.
 * - GA4로는 질문 내용을 보내지 않는다(결과 유형·글자 수 구간만).
 * 설정: window.BLOG_ASK = { endpoint, sitekey, siteUrl }  (_data/assistant.yml)
 */
(function (root) {
  "use strict";

  /* ── 순수 함수 (tools 없이 node로 테스트: _tests/ask.test.mjs) ── */
  const MAX_CHARS = 500;
  const cpLen = (s) => Array.from(s).length;

  /** 서버가 준 링크 중 블로그 글 주소만 남긴다(다른 사이트·스킴 차단). */
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
    return { question: question.trim(), turnstile_token: token, consent_logging: consent,
             page: typeof path === "string" && path.startsWith("/") ? path.slice(0, 200) : undefined };
  }

  const lenBucket = (n) => (n <= 50 ? "<=50" : n <= 100 ? "<=100" : n <= 200 ? "<=200" : "<=500");

  /** 응답 → 화면 상태. 서버 오류 문구는 서버가 고정 문구만 주지만, 형식이 이상하면 기본 문구로. */
  function interpret(status, body) {
    if (status === 200 && body && typeof body.can_answer === "boolean") {
      return body.can_answer
        ? { kind: "answered", text: String(body.answer || ""), answerId: typeof body.answer_id === "string" ? body.answer_id : null }
        : { kind: "no_answer", text: "블로그에서 답을 찾지 못했어요. 다른 표현으로 물어보거나 검색을 써 보세요.", answerId: null };
    }
    const msg = body && typeof body.error === "string" && body.error.length < 200 ? body.error : "지금은 답변할 수 없어요. 잠시 후 다시 시도해 주세요.";
    return { kind: status === 429 || status === 503 ? "limited" : "error", text: msg, answerId: null };
  }

  const core = { MAX_CHARS, cpLen, safeLinks, readConsent, buildRequest, lenBucket, interpret };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }
  root.BlogAskCore = core;

  /* ── 화면 ── */
  const cfg = root.BLOG_ASK;
  if (!cfg || !cfg.endpoint || !cfg.sitekey) return;
  const track = (e, p) => { if (typeof root.blogTrack === "function") root.blogTrack(e, p); };
  /* 일부 환경(차단된 저장소, 샌드박스)에서는 localStorage에 접근만 해도 예외가 난다 */
  const storage = { getItem: (k) => { try { return root.localStorage.getItem(k); } catch { return null; } } };

  let turnstileLoading = null;
  const loadTurnstile = () => turnstileLoading || (turnstileLoading = new Promise((resolve, reject) => {
    if (root.turnstile) return resolve(root.turnstile);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve(root.turnstile);
    s.onerror = () => { turnstileLoading = null; reject(new Error("turnstile")); };
    document.head.appendChild(s);
  }));

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text) e.textContent = text;
    return e;
  }

  function init() {
    const tools = document.querySelector(".site-tools");
    if (!tools) return;

    const btn = el("button", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": "ask-panel", "aria-label": "블로그에 질문하기" });
    btn.innerHTML = '<i class="fas fa-comments" aria-hidden="true"></i><span class="tool-label">질문하기</span>';
    const status = tools.querySelector(".tool-status");
    tools.insertBefore(btn, status || null);

    const panel = el("section", { id: "ask-panel", class: "ask-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "ask-title", translate: "no", hidden: "" });
    const head = el("div", { class: "ask-head" });
    head.append(el("h2", { id: "ask-title" }, "블로그에 질문하기"));
    const close = el("button", { type: "button", class: "ask-close", "aria-label": "닫기" }, "×");
    head.append(close);

    const notice = el("p", { class: "ask-notice" });
    const noticeText = el("span");
    const change = el("a", { href: "#" }, "바꾸기");
    notice.append(noticeText, " ", change);

    const form = el("form", { class: "ask-form" });
    const label = el("label", { for: "ask-input", class: "ask-label" }, "이 블로그의 글을 근거로 답해요. 개인정보는 입력하지 마세요.");
    const input = el("textarea", { id: "ask-input", rows: "3", maxlength: String(MAX_CHARS * 2), placeholder: "예: 드리프트 경보가 울리면 바로 재학습해야 하나요?", "aria-describedby": "ask-count" });
    const row = el("div", { class: "ask-row" });
    const count = el("span", { id: "ask-count", class: "ask-count" }, `0 / ${MAX_CHARS}`);
    const submit = el("button", { type: "submit", class: "ask-submit" }, "질문");
    row.append(count, submit);
    const human = el("div", { class: "ask-human" });
    form.append(label, input, human, row);

    const out = el("div", { class: "ask-out", "aria-live": "polite" });
    panel.append(head, notice, form, out);
    document.body.appendChild(panel);

    const updateNotice = () => {
      noticeText.textContent = readConsent(storage)
        ? "질문 저장: 동의함 (가린 뒤 90일 보관)."
        : "질문 저장: 안 함 (답변에는 영향 없음).";
    };
    change.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof root.openConsentSettings === "function") root.openConsentSettings();
      else location.href = (cfg.privacyUrl || "/privacy/");
    });

    let widgetId = null;
    const ensureHuman = async () => {
      if (widgetId !== null) return;
      try {
        const ts = await loadTurnstile();
        widgetId = ts.render(human, { sitekey: cfg.sitekey, size: "flexible", language: "ko",
                                      "refresh-expired": "auto", action: "ask" });
      } catch {
        human.textContent = "사람 확인 도구를 불러오지 못했어요. 광고 차단 기능이 막고 있을 수 있어요.";
      }
    };

    const open = () => {
      panel.hidden = false; btn.setAttribute("aria-expanded", "true");
      updateNotice(); ensureHuman(); input.focus();
      track("ai_panel_open", {});
    };
    const hide = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); };
    btn.addEventListener("click", () => (panel.hidden ? open() : hide()));
    close.addEventListener("click", hide);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    input.addEventListener("input", () => {
      const n = cpLen(input.value);
      count.textContent = `${n} / ${MAX_CHARS}`;
      count.classList.toggle("over", n > MAX_CHARS);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });

    const render = (state, links) => {
      out.replaceChildren();
      const p = el("p", { class: `ask-answer ask-${state.kind}` }, state.text);
      out.append(p);
      if (links.length) {
        out.append(el("p", { class: "ask-sub" }, "근거 단락"));
        const ul = el("ul", { class: "ask-links" });
        for (const l of links) {
          const li = el("li");
          const a = el("a", { href: l.url }, l.heading && l.heading !== "(도입)" ? `${l.title} › ${l.heading}` : l.title);
          a.addEventListener("click", () => track("ai_link_click", {}));
          li.append(a); ul.append(li);
        }
        out.append(ul);
      }
      if (state.answerId) {
        const fb = el("div", { class: "ask-feedback", role: "group", "aria-label": "답변 평가" });
        const send = async (rating, b) => {
          fb.querySelectorAll("button").forEach((x) => { x.disabled = true; });
          b.setAttribute("aria-pressed", "true");
          track("ai_feedback", { rating });
          try {
            await fetch(`${cfg.endpoint}/feedback`, { method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ answer_id: state.answerId, rating }) });
          } catch { /* 평가 실패는 조용히 */ }
        };
        const up = el("button", { type: "button", "aria-label": "도움이 됐어요" }, "👍");
        const down = el("button", { type: "button", "aria-label": "도움이 안 됐어요" }, "👎");
        up.addEventListener("click", () => send(1, up));
        down.addEventListener("click", () => send(-1, down));
        fb.append(up, down);
        out.append(fb);
      }
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return input.focus();
      if (cpLen(q) > MAX_CHARS) return render({ kind: "error", text: `질문은 ${MAX_CHARS}자까지 쓸 수 있어요.` }, []);
      const ts = root.turnstile;
      const token = ts && widgetId !== null ? ts.getResponse(widgetId) : "";
      if (!token) return render({ kind: "error", text: "사람 확인이 끝나면 다시 눌러 주세요." }, []);

      submit.disabled = true; submit.textContent = "답변 중…";
      out.replaceChildren(el("p", { class: "ask-sub" }, "블로그 글에서 찾는 중이에요…"));
      let state, links = [];
      try {
        const r = await fetch(`${cfg.endpoint}/ask`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(buildRequest(q, token, readConsent(storage), location.pathname)),
        });
        let body = null;
        try { body = await r.json(); } catch { /* 빈 본문 */ }
        state = interpret(r.status, body);
        if (state.kind === "answered") links = safeLinks(body.links, cfg.siteUrl);
      } catch {
        state = interpret(0, null);
      } finally {
        submit.disabled = false; submit.textContent = "질문";
        if (ts && widgetId !== null) ts.reset(widgetId);   // 토큰은 1회용
      }
      render(state, links);
      track("ai_ask", { result: state.kind, q_len: lenBucket(cpLen(q)), consent: readConsent(storage) ? "yes" : "no" });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
