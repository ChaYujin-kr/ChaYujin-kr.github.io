/*
 * 상단 바 도구 (모든 페이지) — 아이콘만 두고, 누르면 작은 메뉴가 열린다.
 *  - 왼쪽 사이드바 접기/펼치기 (데스크톱, 선택 기억)
 *  - 번역: "EN" 버튼 → 언어 메뉴. 크롬 내장 Translator API, 본문 글자만 번역(코드·날짜 제외)
 *  - 브라우저 언어가 한국어가 아니면 한 번만 "번역할까요?" 제안 (IP를 쓰지 않음: 외부 전송 없음, 국가≠언어)
 *  - 듣기: 🎧 버튼 → [요약 듣기] [전체 듣기] [속도]. Web Speech API, 지원하지 않으면 버튼을 만들지 않음
 * 순수 함수는 _tests/site-tools.test.mjs 에서 테스트한다.
 */
(function (root) {
  "use strict";

  const LANGS = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };
  const SHORT = { ko: "KO", en: "EN", ja: "JA", zh: "ZH" };

  /** 번역을 제안할 언어. 저장된 선택이 있거나, 브라우저 첫 언어가 한국어면 제안하지 않는다. */
  function suggestLang(navLangs, saved, dismissed) {
    if (saved || dismissed || !Array.isArray(navLangs) || !navLangs.length) return null;
    const first = String(navLangs[0] || "").toLowerCase().split("-")[0];
    if (!first || first === "ko") return null;
    return LANGS[first] && first !== "ko" ? first : "en";
  }

  const core = { suggestLang, LANGS };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }

  const doc = document;
  const html = doc.documentElement;
  const track = (e, p) => { if (typeof root.blogTrack === "function") root.blogTrack(e, p); };
  const store = {
    get: (k) => { try { return root.localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { root.localStorage.setItem(k, v); } catch { /* 무시 */ } },
  };

  function el(tag, attrs, text) {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }
  function iconBtn(icon, label, extra) {
    const b = el("button", { type: "button", "aria-label": label, title: label, ...(extra || {}) });
    b.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
    return b;
  }

  /* 작은 메뉴(팝오버): 바깥 클릭·Esc로 닫힘, 열면 첫 항목에 포커스 */
  let openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.btn.setAttribute("aria-expanded", "false");
    openMenu = null;
  }
  function attachMenu(btn, menu) {
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = openMenu && openMenu.menu === menu;
      closeMenu();
      if (wasOpen) return;
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      openMenu = { btn, menu };
      const first = menu.querySelector("button:not([disabled])");
      if (first) first.focus();
    });
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); btn.focus(); } });
  }
  doc.addEventListener("click", (e) => { if (openMenu && !openMenu.menu.contains(e.target)) closeMenu(); });

  /* ── 사이드바 접기: 화면 깜빡임을 줄이려고 클래스는 head의 인라인 스크립트가 먼저 붙인다 ── */
  function sidebarToggle() {
    const topbar = doc.getElementById("topbar");
    if (!topbar) return;
    const b = iconBtn("fa-angles-left", "사이드바 접기", { class: "sb-toggle" });
    const sync = () => {
      const c = html.classList.contains("sb-collapsed");
      b.innerHTML = `<i class="fas ${c ? "fa-angles-right" : "fa-angles-left"}" aria-hidden="true"></i>`;
      b.setAttribute("aria-label", c ? "사이드바 펼치기" : "사이드바 접기");
      b.title = b.getAttribute("aria-label");
      b.setAttribute("aria-pressed", String(c));
    };
    b.addEventListener("click", () => {
      html.classList.toggle("sb-collapsed");
      store.set("sidebar-collapsed", html.classList.contains("sb-collapsed") ? "1" : "0");
      sync();
      track("sidebar_toggle", { collapsed: html.classList.contains("sb-collapsed") });
    });
    sync();
    topbar.prepend(b);
  }

  /* ── 다크/라이트: 사이드바 아래 아이콘 하나. 기본은 시스템 설정을 따르고, 아이콘은 "누르면 바뀔 모드"
        (다크일 때 ☀, 라이트일 때 ☾). 수동으로 고른 값이 시스템과 같아지면 저장을 지우고 다시 시스템을 따른다.
        Chirpy 기본 3단 메뉴(라이트/다크/시스템)는 CSS로 숨김 ── */
  const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
    + '<circle cx="12" cy="12" r="4.2" fill="currentColor"/>'
    + '<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'
    + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line x1="12" y1="2.6" x2="12" y2="4.4" transform="rotate(${a} 12 12)"/>`).join("")
    + "</g></svg>";
  const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
    + '<path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" fill="currentColor"/></svg>';
  function themeToggle() {
    const b = iconBtn("fa-moon", "다크 모드로", { class: "theme-btn" });
    const isDark = () => html.getAttribute("data-bs-theme") === "dark"
      || (!html.getAttribute("data-bs-theme") && root.matchMedia("(prefers-color-scheme: dark)").matches);
    const sync = () => {
      const d = isDark();
      b.innerHTML = d ? SUN : MOON;
      b.setAttribute("aria-label", d ? "라이트 모드로" : "다크 모드로");
      b.title = b.getAttribute("aria-label");
    };
    b.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      const sys = root.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      if (root.Theme && typeof root.Theme.update === "function") root.Theme.update(next === sys ? "system" : next);
      else { html.setAttribute("data-bs-theme", next); store.set("theme", next); }
      sync();
      track("theme_toggle", { mode: next });
    });
    new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ["data-bs-theme"] });
    sync();
    return b;
  }

  function init() {
    sidebarToggle();
    const sbBottom = doc.querySelector("#sidebar .sidebar-bottom");
    if (sbBottom) sbBottom.prepend(themeToggle());
    const anchor = doc.getElementById("search-trigger");
    const main = doc.querySelector("main");
    if (!anchor || !main) return;

    doc.querySelectorAll("pre, code, kbd, samp, time").forEach((n) => n.setAttribute("translate", "no"));
    const SKIP = "pre, code, kbd, samp, time, script, style, [translate='no'], .site-tools, .site-menu, #ask-panel, .rec-card";
    const SPEECH_LANG = { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN" };
    let currentLang = "ko";

    const tools = el("div", { class: "site-tools", role: "group", "aria-label": "번역과 듣기" });
    const status = el("span", { class: "tool-status", "aria-live": "polite" });
    const say = (m) => { status.textContent = m || ""; };

    /* ── 번역: EN 버튼 + 언어 메뉴 ── */
    const langWrap = el("div", { class: "tool-wrap" });
    const langBtn = el("button", { type: "button", class: "lang-btn", "aria-label": "페이지 언어: 한국어(원문)", title: "번역" });
    langBtn.innerHTML = '<i class="fas fa-globe" aria-hidden="true"></i><span class="lang-code">EN</span>';
    const langMenu = el("div", { class: "site-menu", role: "menu", "aria-label": "번역할 언어" });
    const langItems = {};
    for (const [code, name] of Object.entries(LANGS)) {
      const it = el("button", { type: "button", role: "menuitemradio", lang: code, "aria-checked": String(code === "ko") },
                    code === "ko" ? "한국어 (원문)" : name);
      it.addEventListener("click", () => { closeMenu(); store.set("site-lang", code); translateTo(code); });
      langItems[code] = it;
      langMenu.append(it);
    }
    langWrap.append(langBtn, langMenu);
    attachMenu(langBtn, langMenu);
    tools.append(langWrap);
    const markLang = (code) => {
      for (const [c, it] of Object.entries(langItems)) it.setAttribute("aria-checked", String(c === code));
      langBtn.querySelector(".lang-code").textContent = code === "ko" ? "EN" : SHORT[code];
      langBtn.setAttribute("aria-label", `페이지 언어: ${code === "ko" ? "한국어(원문)" : LANGS[code]}`);
      langBtn.classList.toggle("is-on", code !== "ko");
    };

    const originals = new Map();
    const textNodes = () => {
      const out = [];
      const walker = doc.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement.closest(SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      while (walker.nextNode()) out.push(walker.currentNode);
      return out;
    };
    const restore = () => {
      originals.forEach((t, n) => { n.nodeValue = t; });
      html.lang = "ko-KR"; currentLang = "ko"; markLang("ko"); say("");
    };
    const translateTo = async (lang, auto = false) => {
      restore();
      if (lang === "ko") return;
      if (!("Translator" in self)) {
        say("이 브라우저는 내장 번역을 지원하지 않아요 (최신 크롬에서 사용 가능)");
        track("translate_select", { language: lang, result: "unsupported" });
        return;
      }
      try {
        const opts = { sourceLanguage: "ko", targetLanguage: lang };
        const availability = await Translator.availability(opts);
        if (availability === "unavailable") { say("이 언어는 지원하지 않아요"); return; }
        if (auto && availability !== "available") return;
        const translator = await Translator.create({ ...opts, monitor(m) {
          m.addEventListener("downloadprogress", (e) => say(`번역 모델 내려받는 중 ${Math.round(e.loaded * 100)}%`));
        } });
        const nodes = textNodes();
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i], text = node.nodeValue;
          if (!originals.has(node)) originals.set(node, text);
          const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
          node.nodeValue = lead + await translator.translate(text.trim()) + trail;
          if (i % 20 === 0) say(`번역 중 ${Math.round((i / nodes.length) * 100)}%`);
        }
        html.lang = lang; currentLang = lang; markLang(lang); say("");
        track("translate_select", { language: lang, result: auto ? "auto" : "success" });
      } catch {
        restore(); say("번역하지 못했어요");
        track("translate_select", { language: lang, result: "failed" });
      }
    };

    /* ── 듣기: 🎧 버튼 + 메뉴 ── */
    const synth = root.speechSynthesis;
    if (synth && "SpeechSynthesisUtterance" in root) {
      const summary = main.querySelector("article .content blockquote.prompt-tip");
      const RATES = [1, 1.25, 1.5, 0.85];
      let rateIdx = 0, queue = [], mode = null;
      const wrap = el("div", { class: "tool-wrap" });
      const audioBtn = iconBtn("fa-headphones", "듣기");
      const menu = el("div", { class: "site-menu", role: "menu", "aria-label": "듣기" });
      const mSummary = summary ? el("button", { type: "button", role: "menuitem" }, "요약 듣기") : null;
      const mFull = el("button", { type: "button", role: "menuitem" }, "전체 듣기");
      const mRate = el("button", { type: "button", role: "menuitem" }, "속도 1x");
      const mStop = el("button", { type: "button", role: "menuitem", hidden: "" }, "멈추기");
      [mSummary, mFull, mRate, mStop].forEach((x) => x && menu.append(x));
      wrap.append(audioBtn, menu);
      attachMenu(audioBtn, menu);
      tools.append(wrap);

      const pickVoice = () => synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(currentLang));
      const blocks = () => {
        const parts = [];
        main.querySelectorAll("h1, h2, h3, p, li, blockquote").forEach((n) => {
          if (n.closest("pre, table, .series-nav, figure, .post-meta, nav, .rec-card")) return;
          if (n.tagName === "LI" && n.closest("blockquote")) return;
          if (n.tagName === "P" && n.closest("li, blockquote")) return;
          const t = n.innerText.trim(); if (t) parts.push(t);
        });
        return parts.join("\n");
      };
      const chunks = (text) => text.replace(/\s+/g, " ").split(/(?<=[.!?。])\s*/).flatMap((x) => {
        const out = []; for (let i = 0; i < x.length; i += 180) out.push(x.slice(i, i + 180)); return out;
      }).filter((t) => t.trim());
      const setPlaying = (on) => {
        audioBtn.classList.toggle("is-on", on);
        audioBtn.setAttribute("aria-label", on ? "듣는 중 (메뉴 열기)" : "듣기");
        mStop.hidden = !on;
      };
      const reset = (m) => { mode = null; queue = []; setPlaying(false); say(m); };
      const next = () => {
        if (!queue.length) return reset("다 읽었어요");
        const u = new SpeechSynthesisUtterance(queue.shift());
        u.lang = SPEECH_LANG[currentLang]; u.rate = RATES[rateIdx];
        const v = pickVoice(); if (v) u.voice = v;
        u.onend = () => { if (mode) next(); };
        u.onerror = (e) => { if (e.error !== "canceled" && e.error !== "interrupted") reset("음성을 재생하지 못했어요"); };
        synth.speak(u);
      };
      const play = (which) => {
        closeMenu(); synth.cancel(); reset("");
        mode = which;
        const title = (main.querySelector("h1") || {}).innerText || doc.title;
        queue = chunks(which === "summary" ? `${title}. ${summary.innerText}` : blocks());
        setPlaying(true);
        say(which === "summary" ? "요약을 읽는 중" : "읽는 중");
        track("tts_play", { mode: which, language: currentLang });
        next();
      };
      if (mSummary) mSummary.addEventListener("click", () => play("summary"));
      mFull.addEventListener("click", () => play("full"));
      mStop.addEventListener("click", () => { closeMenu(); synth.cancel(); reset("멈췄어요"); });
      mRate.addEventListener("click", () => {
        rateIdx = (rateIdx + 1) % RATES.length;
        mRate.textContent = `속도 ${RATES[rateIdx]}x`;
        track("tts_rate_change", { rate: RATES[rateIdx] });
        if (mode) say("다음 문장부터 적용돼요");
      });
      root.addEventListener("pagehide", () => synth.cancel());
    }

    tools.append(status);
    anchor.before(tools);

    /* 이전 선택 언어 자동 번역(모델이 이미 있을 때만), 처음이면 브라우저 언어 보고 한 번만 제안 */
    const saved = store.get("site-lang");
    if (saved && saved !== "ko" && LANGS[saved]) { translateTo(saved, true); return; }
    const sug = suggestLang(root.navigator && navigator.languages, saved, store.get("lang-suggest-dismissed"));
    if (sug && "Translator" in self) {
      const bar = el("div", { class: "lang-suggest", role: "region", "aria-label": "번역 제안", lang: sug });
      const msg = el("span", null, sug === "ja" ? "このページを日本語で読みますか？" : sug === "zh" ? "要用中文阅读此页面吗？" : "Read this page in English?");
      const yes = el("button", { type: "button", class: "primary" }, sug === "ja" ? "翻訳" : sug === "zh" ? "翻译" : "Translate");
      const no = el("button", { type: "button" }, sug === "ja" ? "いいえ" : sug === "zh" ? "不用" : "No thanks");
      yes.addEventListener("click", () => { bar.remove(); store.set("site-lang", sug); translateTo(sug); track("lang_suggest", { language: sug, choice: "yes" }); });
      no.addEventListener("click", () => { bar.remove(); store.set("lang-suggest-dismissed", "1"); track("lang_suggest", { language: sug, choice: "no" }); });
      bar.append(msg, yes, no);
      doc.body.append(bar);
    }
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(typeof window !== "undefined" ? window : globalThis);
