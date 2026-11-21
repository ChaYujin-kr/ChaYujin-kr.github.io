/* 글쓰기 화면 (/write/)
 * - 왼쪽에 마크다운, 오른쪽에 미리보기 (marked + DOMPurify, 둘 다 저장소에 고정)
 * - 게시 창: 썸네일, 요약(기본은 본문 앞 100자), 시리즈 선택·새로 만들기, 주소, 카테고리, 태그
 * - 기존 글 수정: '글 불러오기' 또는 /write/?edit=<파일 경로>. 다루지 않는 머리말 항목과 날짜는 그대로 둔다.
 * - 본문 이미지: 버튼·붙여넣기·끌어다 놓기. 본문에는 (upload:이름)으로 적어 두고 파일은 이 브라우저(IndexedDB)에 보관했다가,
 *   게시할 때 assets/img/posts/<주소>/ 아래에 글과 같은 커밋으로 올리고 경로를 바꿔 쓴다.
 * - 임시 저장: 쓰는 글마다 따로 보관하고 '임시 글' 목록에서 열거나 지운다 (이 브라우저의 localStorage).
 * - 관리자 확인: 댓글과 같은 Google 로그인으로 블로그 주인 계정인지 서버에 확인한 뒤에 편집기를 연다.
 * - 게시: 게시 서버가 설정돼 있으면(_data/write.yml) 관리자 로그인만으로 서버가 커밋한다.
 *         없으면 GitHub 토큰으로 브라우저가 직접 커밋한다(토큰은 이 브라우저에만 저장). 파일로 내려받을 수도 있다.
 *         어느 쪽이든 글·썸네일·본문 이미지·시리즈 목록을 커밋 하나에 담는다.
 * 순수 함수는 아래 api로 내보내 _tests/write.test.mjs에서 검사한다.
 */
(function (root) {
  "use strict";

  const SUMMARY_CHARS = 100;
  const SUMMARY_MAX = 200;
  const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
  const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif" };
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const COVER_COLORS = [
    { name: "초록", bg: "#0c2a20", fg: "#6ee7b7" },
    { name: "남보라", bg: "#1e1b3a", fg: "#a5b4fc" },
    { name: "파랑", bg: "#0b2239", fg: "#7dd3fc" },
    { name: "주황", bg: "#2b1a0e", fg: "#fdba74" },
    { name: "회색", bg: "#1f2328", fg: "#d0d7de" },
  ];

  /* ── 글자 처리 ── */

  /** 마크다운에서 읽히는 글자만 남긴다 (요약용). 코드 블록과 표 구분선은 버린다. */
  function plainText(md) {
    return String(md || "")
      .replace(/\r/g, "")
      .replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[^\n]*$/gm, " ")
      .replace(/\{%[\s\S]*?%\}/g, " ")
      .replace(/^\{:[^}\n]*\}\s*$/gm, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>\n]+>/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/gm, " ")
      .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+\.)\s+/gm, "")
      .replace(/\*+|`+|~~/g, "")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 본문 앞 n자. 이모지 같은 글자가 반으로 잘리지 않게 코드 포인트 단위로 자른다. */
  function summarize(md, n = SUMMARY_CHARS) {
    return Array.from(plainText(md)).slice(0, n).join("").trim();
  }

  /** 영문·숫자만 남긴 주소 조각. 한글 제목이면 빈 문자열이 나온다(직접 입력해야 함). */
  function slugify(text) {
    return String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  }

  const pad2 = (n) => String(n).padStart(2, "0");

  /** 브라우저 시간대와 상관없이 한국 시간으로 적는다 (_config.yml의 timezone과 같게). */
  function kstStamp(now = new Date()) {
    const k = new Date(now.getTime() + 9 * 3600 * 1000);
    const day = `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
    return { day, full: `${day} ${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}:${pad2(k.getUTCSeconds())} +0900` };
  }

  /** YAML 문자열. JSON 문자열은 그대로 YAML 큰따옴표 문자열이다. */
  const yamlStr = (s) => JSON.stringify(String(s == null ? "" : s));
  const yamlList = (arr) => `[${arr.map(yamlStr).join(", ")}]`;
  const splitList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

  /* ── 파일 내용 만들기 ── */

  /** 본문에 Liquid 문법처럼 보이는 글자가 있으면 빌드가 깨지지 않게 raw로 감싼다. */
  function protectLiquid(body) {
    if (!/\{\{|\{%/.test(body)) return body;
    const safe = body.replace(/\{%-?\s*endraw\s*-?%\}/g, "{% endraw %}{{ '{' }}% endraw %}{% raw %}");
    return `{% raw %}\n${safe}\n{% endraw %}`;
  }

  /**
   * 글 파일(_posts/날짜-주소.md)의 내용.
   * @param p {title, date, categories[], tags[], description, image, series, seriesTitle, body}
   */
  function buildPost(p) {
    const fm = ["---", `title: ${yamlStr(p.title)}`, `date: ${p.date}`];
    if (p.categories && p.categories.length) fm.push(`categories: ${yamlList(p.categories)}`);
    if (p.tags && p.tags.length) fm.push(`tags: ${yamlList(p.tags)}`);
    if (p.description) fm.push(`description: ${yamlStr(p.description)}`);
    if (p.image) fm.push("image:", `  path: ${p.image}`, `  alt: ${yamlStr(p.title)}`);
    if (p.series) fm.push(`series: ${p.series}`, `series_title: ${yamlStr(p.seriesTitle || p.series)}`);
    fm.push("---");
    if (p.series) fm.push("", "{% include series-nav.html %}", "");
    return fm.join("\n") + "\n" + protectLiquid(String(p.body || "").replace(/\r/g, "").trim()) + "\n";
  }

  /* ── 기존 글 읽기와 고쳐 쓰기 ── */

  const MANAGED_KEYS = ["title", "categories", "tags", "description", "image", "series", "series_title"];
  const SERIES_INCLUDE = "{% include series-nav.html %}";
  const RAW_ESCAPE = "{% endraw %}{{ '{' }}% endraw %}{% raw %}";

  /** YAML 한 줄 값: 큰따옴표, 작은따옴표, 따옴표 없는 값 */
  function parseScalar(raw) {
    const t = String(raw || "").trim();
    if (t.startsWith('"')) { try { return String(JSON.parse(t)); } catch { return t.replace(/^"|"$/g, ""); } }
    if (t.startsWith("'")) return t.replace(/^'|'$/g, "").replace(/''/g, "'");
    return t.replace(/\s+#.*$/, "").trim();
  }

  /** [a, "b, c", d] 꼴의 목록을 쉼표로 나눈다 (따옴표 안의 쉼표는 지킨다) */
  function parseFlowList(raw) {
    const inner = String(raw).trim().replace(/^\[/, "").replace(/\]\s*(#.*)?$/, "");
    const items = [];
    let cur = "", quote = "";
    for (const ch of inner) {
      if (quote) { cur += ch; if (ch === quote) quote = ""; }
      else if (ch === '"' || ch === "'") { quote = ch; cur += ch; }
      else if (ch === ",") { items.push(cur); cur = ""; }
      else cur += ch;
    }
    items.push(cur);
    return items.map(parseScalar).filter(Boolean);
  }

  /**
   * 글 파일을 머리말과 본문으로 나눈다. 머리말은 항목 단위로 원문 줄을 보관해서,
   * 이 화면이 다루지 않는 항목(date, pin, math 등)을 저장할 때 그대로 되돌려 쓴다.
   * @returns {entries:[{key, lines}], data:{title, categories, tags, description, image, series, seriesTitle}, body, liquid:'auto'|'keep'} 또는 null
   */
  function parsePost(text) {
    const src = String(text || "").replace(/\r/g, "");
    const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (!m) return null;
    const entries = [];
    for (const line of m[1].split("\n")) {
      const k = line.match(/^([A-Za-z_][\w-]*):(.*)$/);
      if (k) entries.push({ key: k[1], lines: [line] });
      else if (entries.length && (/^\s+\S/.test(line) || /^\s*-\s/.test(line))) entries[entries.length - 1].lines.push(line);
      else entries.push({ key: null, lines: [line] });
    }
    const find = (key) => entries.find((e) => e.key === key);
    const rest = (e) => e.lines[0].slice(e.key.length + 1);
    const scalar = (key) => { const e = find(key); return e ? parseScalar(rest(e)) : ""; };
    const list = (key) => {
      const e = find(key);
      if (!e) return [];
      const first = rest(e).trim();
      if (first.startsWith("[")) return parseFlowList(first);
      const items = e.lines.slice(1).map((l) => l.match(/^\s*-\s+(.*)$/)).filter(Boolean).map((x) => parseScalar(x[1]));
      return items.length ? items : first ? [parseScalar(first)] : [];
    };
    let image = "";
    const ie = find("image");
    if (ie) {
      const first = rest(ie).trim();
      const nested = ie.lines.slice(1).map((l) => l.match(/^\s+path:\s*(.*)$/)).find(Boolean);
      image = first ? parseScalar(first) : nested ? parseScalar(nested[1]) : "";
    }
    let body = src.slice(m[0].length).replace(/^\n+/, "");
    if (body.startsWith(SERIES_INCLUDE)) body = body.slice(SERIES_INCLUDE.length).replace(/^\n+/, "");
    body = body.replace(/\s+$/, "");
    let liquid = "auto";
    const wrapped = body.match(/^\{% raw %\}\n([\s\S]*)\n\{% endraw %\}$/);
    if (wrapped && !/\{%-?\s*(raw|endraw)\s*-?%\}/.test(wrapped[1].split(RAW_ESCAPE).join(""))) body = wrapped[1].split(RAW_ESCAPE).join("{% endraw %}");
    else if (/\{\{|\{%/.test(body)) liquid = "keep"; /* post_url 같은 Liquid를 직접 쓴 글: 감싸면 깨지므로 그대로 둔다 */
    return { entries, body, liquid,
      data: { title: scalar("title"), categories: list("categories"), tags: list("tags"), description: scalar("description"), image, series: scalar("series"), seriesTitle: scalar("series_title") } };
  }

  /**
   * 고친 글 파일의 내용. 다루는 항목만 새로 쓰고 나머지 머리말 줄은 원문 그대로 둔다.
   * @param p {entries, liquid, original(parsePost의 data), title, categories[], tags[], description, image:{mode:'keep'}|{path}, series, seriesTitle, body}
   */
  function buildEditedPost(p) {
    const fresh = { title: [`title: ${yamlStr(p.title)}`] };
    if (p.categories && p.categories.length) fresh.categories = [`categories: ${yamlList(p.categories)}`];
    if (p.tags && p.tags.length) fresh.tags = [`tags: ${yamlList(p.tags)}`];
    if (p.description) fresh.description = [`description: ${yamlStr(p.description)}`];
    const keepImage = p.image && p.image.mode === "keep";
    if (!keepImage && p.image && p.image.path) fresh.image = ["image:", `  path: ${p.image.path}`, `  alt: ${yamlStr(p.title)}`];
    if (p.series) { fresh.series = [`series: ${p.series}`]; fresh.series_title = [`series_title: ${yamlStr(p.seriesTitle || p.series)}`]; }
    /* 값이 그대로인 항목은 원문 줄을 그대로 둔다 (따옴표 모양 같은 사소한 차이로 변경 내역이 생기지 않게) */
    const o = p.original || {};
    const same = { title: o.title === p.title, categories: JSON.stringify(o.categories) === JSON.stringify(p.categories || []),
      tags: JSON.stringify(o.tags) === JSON.stringify(p.tags || []), description: o.description === (p.description || ""),
      image: keepImage, series: o.series === (p.series || ""), series_title: o.seriesTitle === (p.series ? p.seriesTitle || p.series : "") };
    const out = [], seen = new Set();
    for (const e of p.entries) {
      if (!MANAGED_KEYS.includes(e.key) || (p.original && same[e.key])) { out.push(...e.lines); if (e.key) seen.add(e.key); continue; }
      seen.add(e.key);
      if (fresh[e.key]) out.push(...fresh[e.key]);
    }
    for (const key of MANAGED_KEYS) if (fresh[key] && !seen.has(key)) out.push(...fresh[key]);
    const raw = String(p.body || "").replace(/\r/g, "").trim();
    const body = p.liquid === "keep" ? raw : protectLiquid(raw);
    return `---\n${out.join("\n")}\n---\n\n${p.series ? SERIES_INCLUDE + "\n\n" : ""}${body}\n`;
  }

  /** _posts/2026-11-22-my-post.md → my-post */
  const slugFromPath = (path) => (String(path).match(/^_posts\/\d{4}-\d{2}-\d{2}-(.+)\.(?:md|markdown)$/) || [])[1] || "";

  const postPath = (day, slug) => `_posts/${day}-${slug}.md`;
  const postUrl = (slug) => `/posts/${slug}/`;

  /** _data/series.yml 끝에 새 시리즈 항목을 덧붙인다. */
  function appendSeries(yamlText, s) {
    const lines = [`- key: ${s.key}`, `  title: ${yamlStr(s.title)}`];
    if (s.description) lines.push(`  description: ${yamlStr(s.description)}`);
    if (s.image) lines.push(`  image: ${s.image}`);
    return String(yamlText || "").replace(/\s*$/, "\n") + lines.join("\n") + "\n";
  }

  const xmlEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** 기존 글 표지와 같은 모양의 SVG. 글자가 길면 크기를 줄여 넘치지 않게 한다. */
  function coverSvg({ label = "", number = "", text = "", bg = COVER_COLORS[0].bg, fg = COVER_COLORS[0].fg }) {
    const width = (s) => Array.from(String(s)).reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 1 : 0.58), 0);
    const size = Math.max(30, Math.min(64, Math.floor(1040 / Math.max(1, width(text)))));
    const sans = "'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`,
      `  <rect width="1200" height="630" fill="${xmlEsc(bg)}"/>`,
      `  <circle cx="1040" cy="120" r="260" fill="${xmlEsc(fg)}" opacity=".10"/>`,
      `  <circle cx="1120" cy="560" r="180" fill="${xmlEsc(fg)}" opacity=".08"/>`,
    ];
    if (label) parts.push(`  <text x="80" y="140" font-family="${sans}" font-size="34" fill="${xmlEsc(fg)}" letter-spacing="2">${xmlEsc(label)}</text>`);
    if (number) parts.push(`  <text x="72" y="380" font-family="'Fira Code',Consolas,monospace" font-weight="700" font-size="220" fill="${xmlEsc(fg)}">${xmlEsc(number)}</text>`);
    parts.push(`  <text x="80" y="${number ? 520 : 360}" font-family="${sans}" font-weight="700" font-size="${size}" fill="#f8fafc">${xmlEsc(text)}</text>`, `</svg>`, "");
    return parts.join("\n");
  }

  /* ── 본문 이미지 ── */

  const UPLOAD_REF = /(["(])upload:([A-Za-z0-9][\w.-]*)/g;
  const BODY_IMAGE_MAX_WIDTH = 1600;

  /** 올린 파일의 저장 이름: 원래 이름의 영문·숫자 + 겹치지 않게 하는 짧은 꼬리표 + 확장자 */
  function uploadName(original, type, tag) {
    const base = slugify(String(original || "").replace(/\.[^.]*$/, "")).slice(0, 30).replace(/-+$/, "") || "image";
    return `${base}-${tag}.${IMAGE_TYPES[type]}`;
  }

  /** 본문에서 쓰인 upload: 이름들 (나온 순서, 중복 없이) */
  function uploadRefs(body) {
    const names = [];
    for (const m of String(body || "").matchAll(UPLOAD_REF)) if (!names.includes(m[2])) names.push(m[2]);
    return names;
  }

  /**
   * 본문의 (upload:이름)을 게시될 경로로 바꾸고, 올릴 파일 목록을 만든다. 본문에서 쓰지 않는 파일은 올리지 않는다.
   * @param uploads [{name, base64}]
   * @returns {body, files:[{path, base64}], missing:[이름]}
   */
  function resolveUploads(body, slug, uploads) {
    const files = [], missing = [];
    const out = String(body || "").replace(UPLOAD_REF, (whole, open, name) => {
      const u = (uploads || []).find((x) => x.name === name);
      if (!u) { if (!missing.includes(name)) missing.push(name); return whole; }
      const path = `assets/img/posts/${slug}/${name}`;
      if (!files.some((f) => f.path === path)) files.push({ path, base64: u.base64 });
      return `${open}/${path}`;
    });
    return { body: out, files, missing };
  }

  /* ── 관리자 로그인과 게시 서버 ── */

  /** 댓글 화면(community.js)과 같은 모양의 로그인 상태. 기한이 지났거나 깨졌으면 null. */
  function readAdminSession(raw, nowMs) {
    try {
      const s = JSON.parse(raw || "null");
      if (!s || typeof s.token !== "string" || typeof s.exp !== "number" || s.exp * 1000 <= nowMs) return null;
      return { token: s.token, exp: s.exp, name: String(s.name || "익명"), admin: s.admin === true };
    } catch { return null; }
  }

  /** Google ID 토큰의 만료 시각(초). 읽지 못하면 0. 서명은 서버가 검증한다. */
  function credentialExp(jwt) {
    try {
      const part = String(jwt).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const p = JSON.parse(atob(part + "===".slice((part.length + 3) % 4)));
      return typeof p.exp === "number" ? p.exp : 0;
    } catch { return 0; }
  }

  async function postJson(url, body, fetchImpl) {
    let res;
    try { res = await (fetchImpl || root.fetch.bind(root))(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch { const e = new Error("서버에 연결하지 못했습니다."); e.status = 0; throw e; }
    let data = {};
    try { data = (await res.json()) || {}; } catch { /* 빈 본문 */ }
    if (!res.ok) { const e = new Error(typeof data.error === "string" && data.error.length < 200 ? data.error : `서버 오류 ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  /** Google 로그인 결과를 블로그 서버에 보내 로그인 상태를 받는다. @returns {token, exp, name, admin} */
  async function loginSession(o) {
    const d = await postJson(`${o.endpoint}/session`, { credential: o.credential }, o.fetchImpl);
    if (typeof d.token !== "string" || typeof d.exp !== "number") throw new Error("로그인 응답을 읽지 못했습니다.");
    return { token: d.token, exp: d.exp, name: String(d.name || "익명"), admin: d.admin === true };
  }

  /**
   * 게시 서버에 맡겨 커밋한다. 서버가 요청마다 관리자 계정인지 다시 확인한다.
   * @param o {endpoint, credential, message, files:[{path, base64}], expect:{mode:'create'}|{mode:'update', sha}, fetchImpl}
   * @returns {sha, url}
   */
  async function publishViaWorker(o) {
    const d = await postJson(`${o.endpoint}/publish`, { credential: o.credential, message: o.message, files: o.files, expect: o.expect }, o.fetchImpl);
    if (typeof d.sha !== "string" || typeof d.url !== "string") throw new Error("게시 서버의 응답을 읽지 못했습니다.");
    return { sha: d.sha, url: d.url };
  }

  /* ── 임시 저장 글 목록 ── */

  const draftIsEmpty = (d) => !d || (!String(d.title || "").trim() && !String(d.body || "").trim());

  /**
   * 저장된 임시 글 묶음을 읽는다. 깨진 값은 버리고, 예전 방식(한 편만 저장)의 글이 있으면 newId로 옮겨 담는다.
   * @returns {current, items:{id: {id, title, body, edit, meta, savedAt}}, migrated(옮겨 담은 글의 id 또는 "")}
   */
  function parseDrafts(raw, legacyRaw, newId) {
    const state = { current: "", items: {}, migrated: "" };
    const clean = (id, v) => ({ id, title: String(v.title || ""), body: String(v.body || ""),
      edit: v.edit && typeof v.edit.path === "string" && Array.isArray(v.edit.entries) ? v.edit : null,
      meta: v.meta && typeof v.meta === "object" ? v.meta : null, savedAt: Number(v.savedAt) || 0 });
    try {
      const d = JSON.parse(raw || "null");
      if (d && d.items && typeof d.items === "object") {
        for (const [id, v] of Object.entries(d.items)) if (v && typeof v === "object") state.items[id] = clean(id, v);
        if (typeof d.current === "string") state.current = d.current;
      }
    } catch { /* 깨진 값은 빈 목록으로 */ }
    try {
      const old = JSON.parse(legacyRaw || "null");
      if (old && typeof old === "object" && !draftIsEmpty(old) && newId) {
        state.items[newId] = clean(newId, old);
        state.migrated = newId;
        if (!state.items[state.current]) state.current = newId;
      }
    } catch { /* 무시 */ }
    return state;
  }

  /** 목록에 보일 임시 글: 빈 글은 빼고, 최근에 저장한 것부터 */
  function listDrafts(items) {
    return Object.values(items || {}).filter((d) => !draftIsEmpty(d)).sort((a, b) => b.savedAt - a.savedAt)
      .map((d) => ({ id: d.id, title: d.title.trim() || "제목 없음", snippet: summarize(d.body, 60), savedAt: d.savedAt, editing: d.edit ? d.edit.path : "" }));
  }

  /** 같은 글(파일 경로)을 고치던 임시 글의 id. 없으면 "" */
  function findDraftByPath(items, path) {
    const hit = Object.values(items || {}).find((d) => d.edit && d.edit.path === path);
    return hit ? hit.id : "";
  }

  /** 저장 시각을 '방금 전', '5분 전'처럼 */
  function draftTime(savedAt, now = Date.now()) {
    const min = Math.floor((now - savedAt) / 60000);
    if (!savedAt) return "";
    if (min < 1) return "방금 전";
    if (min < 60) return `${min}분 전`;
    if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`;
    if (min < 60 * 24 * 30) return `${Math.floor(min / 1440)}일 전`;
    return kstStamp(new Date(savedAt)).day;
  }

  /* ── 검사 ── */

  /**
   * 게시 전에 입력을 검사한다. 문제가 없으면 빈 배열.
   * @param s {title, body, slug, description, series:{mode:'none'|'existing'|'new', key, title}, image:{mode, type, size}}
   * @param known {seriesKeys[], postUrls[]}
   */
  function validate(s, known = {}) {
    const errors = [];
    if (!String(s.title || "").trim()) errors.push("제목을 입력하세요.");
    if (!String(s.body || "").trim()) errors.push("본문이 비어 있습니다.");
    if (!SLUG_RE.test(s.slug || "")) errors.push("주소는 영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다. 예: my-first-post");
    else if (!known.editing && (known.postUrls || []).includes(postUrl(s.slug))) errors.push("같은 주소의 글이 이미 있습니다. 주소를 바꾸세요.");
    if (Array.from(s.description || "").length > SUMMARY_MAX) errors.push(`요약은 ${SUMMARY_MAX}자까지입니다.`);
    const sr = s.series || { mode: "none" };
    if (sr.mode === "new") {
      if (!String(sr.title || "").trim()) errors.push("새 시리즈의 제목을 입력하세요.");
      if (!SLUG_RE.test(sr.key || "")) errors.push("시리즈 키는 영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다.");
      else if ((known.seriesKeys || []).includes(sr.key)) errors.push("같은 키의 시리즈가 이미 있습니다.");
    }
    if (sr.mode === "existing" && !(known.seriesKeys || []).includes(sr.key)) errors.push("시리즈를 선택하세요.");
    const im = s.image || { mode: "none" };
    if (im.mode === "upload") {
      if (!IMAGE_TYPES[im.type]) errors.push("썸네일은 PNG, JPG, WebP, GIF, SVG 파일만 올릴 수 있습니다.");
      else if (im.size > IMAGE_MAX_BYTES) errors.push("썸네일 파일은 2MB 이하여야 합니다.");
    }
    if (s.missingUploads && s.missingUploads.length) errors.push(`본문의 이미지 파일을 이 브라우저에서 찾지 못했습니다: ${s.missingUploads.join(", ")}. 그 이미지를 다시 넣거나 본문에서 지우세요.`);
    return errors;
  }

  /* ── GitHub에 올리기 ── */

  function b64utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decodeUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  /**
   * 파일 여러 개를 커밋 하나로 올린다 (Git Data API). 배포가 한 번만 돈다.
   * @param o {token, repo:"owner/name", branch, message, files:[{path, base64}], fetchImpl}
   * @returns {sha, url}
   */
  async function commitFiles(o) {
    const fetchImpl = o.fetchImpl || root.fetch.bind(root);
    const base = `https://api.github.com/repos/${o.repo}`;
    const call = async (method, path, body) => {
      const res = await fetchImpl(base + path, {
        method,
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${o.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.json()).message || ""; } catch { /* 본문 없음 */ }
        const err = new Error(explainStatus(res.status, detail));
        err.status = res.status;
        throw err;
      }
      return res.json();
    };
    const ref = await call("GET", `/git/ref/heads/${o.branch}`);
    const parent = ref.object.sha;
    const parentCommit = await call("GET", `/git/commits/${parent}`);
    const tree = [];
    for (const f of o.files) {
      const blob = await call("POST", "/git/blobs", { content: f.base64, encoding: "base64" });
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = await call("POST", "/git/trees", { base_tree: parentCommit.tree.sha, tree });
    const commit = await call("POST", "/git/commits", { message: o.message, tree: newTree.sha, parents: [parent] });
    await call("PATCH", `/git/refs/heads/${o.branch}`, { sha: commit.sha, force: false });
    return { sha: commit.sha, url: `https://github.com/${o.repo}/commit/${commit.sha}` };
  }

  function explainStatus(status, detail) {
    if (status === 401) return "토큰이 올바르지 않거나 만료됐습니다.";
    if (status === 403) return "이 토큰에는 저장소에 쓸 권한이 없습니다. Contents 권한을 Read and write로 주세요.";
    if (status === 404) return "저장소나 브랜치를 찾지 못했습니다. 토큰이 이 저장소를 볼 수 있는지 확인하세요.";
    if (status === 409 || status === 422) return `GitHub가 요청을 받지 않았습니다. 그사이 다른 커밋이 올라왔을 수 있으니 다시 시도하세요. (${detail || status})`;
    return `GitHub 오류 ${status}${detail ? ": " + detail : ""}`;
  }

  /** 저장소의 파일을 읽는다. 없으면 null. 공개 저장소라 토큰이 없어도 읽을 수 있다. @returns {text, sha} */
  async function readRepoFileInfo(o) {
    const fetchImpl = o.fetchImpl || root.fetch.bind(root);
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    const res = await fetchImpl(`https://api.github.com/repos/${o.repo}/contents/${o.path}?ref=${encodeURIComponent(o.branch)}`, { headers, cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) {
      const limited = res.status === 403 && !o.token;
      const e = new Error(limited ? "GitHub 요청 한도를 넘었습니다. 토큰을 입력하거나 잠시 뒤에 다시 시도하세요." : explainStatus(res.status, ""));
      e.status = res.status; throw e;
    }
    const data = await res.json();
    return { text: b64decodeUtf8(data.content), sha: data.sha };
  }
  /** 저장소의 파일 내용만 읽는다. 없으면 null. */
  async function readRepoFile(o) { const info = await readRepoFileInfo(o); return info ? info.text : null; }

  /**
   * 입력 상태에서 올릴 파일 목록을 만든다 (네트워크 없음).
   * @param s {title, body, slug, description, categories[], tags[], series:{mode,key,title,description}, image:{mode, ext, base64, svg}, uploads:[{name, base64}]}
   * @param ctx {now, seriesList:[{key,title}], seriesYaml, edit:{path, entries, liquid, original, image}}  edit가 있으면 기존 글 수정
   */
  function planFiles(s, ctx) {
    const stamp = kstStamp(ctx.now);
    const files = [];
    let image = "";
    if (ctx.edit && s.image && s.image.mode === "keep") image = ctx.edit.image || "";
    else if (s.image && s.image.mode === "auto") {
      image = `/assets/img/posts/${s.slug}.svg`;
      files.push({ path: image.slice(1), base64: b64utf8(s.image.svg) });
    } else if (s.image && s.image.mode === "upload") {
      image = `/assets/img/posts/${s.slug}.${s.image.ext}`;
      files.push({ path: image.slice(1), base64: s.image.base64 });
    }
    let series = "", seriesTitle = "";
    const sr = s.series || { mode: "none" };
    if (sr.mode === "existing") {
      series = sr.key;
      seriesTitle = ((ctx.seriesList || []).find((x) => x.key === sr.key) || {}).title || sr.key;
    } else if (sr.mode === "new") {
      series = sr.key; seriesTitle = sr.title.trim();
      files.push({ path: "_data/series.yml", base64: b64utf8(appendSeries(ctx.seriesYaml, { key: sr.key, title: seriesTitle, description: (sr.description || "").trim(), image })) });
    }
    const up = resolveUploads(s.body, s.slug, s.uploads);
    files.push(...up.files);
    const common = { title: s.title.trim(), categories: s.categories, tags: s.tags, description: (s.description || "").trim(), series, seriesTitle, body: up.body };
    const content = ctx.edit
      ? buildEditedPost({ ...common, entries: ctx.edit.entries, liquid: ctx.edit.liquid, original: ctx.edit.original, image: s.image && s.image.mode === "keep" ? { mode: "keep" } : { path: image } })
      : buildPost({ ...common, date: stamp.full, image });
    const path = ctx.edit ? ctx.edit.path : postPath(stamp.day, s.slug);
    files.unshift({ path, base64: b64utf8(content) });
    return { files, path, content, url: postUrl(s.slug) };
  }

  const api = { SUMMARY_CHARS, SUMMARY_MAX, COVER_COLORS, plainText, summarize, slugify, kstStamp, yamlStr, splitList, protectLiquid,
    buildPost, postPath, postUrl, appendSeries, coverSvg, validate, b64utf8, b64decodeUtf8, commitFiles, readRepoFile, readRepoFileInfo, planFiles, explainStatus,
    parseScalar, parseFlowList, parsePost, buildEditedPost, slugFromPath, uploadName, uploadRefs, resolveUploads,
    draftIsEmpty, parseDrafts, listDrafts, findDraftByPath, draftTime, readAdminSession, credentialExp, loginSession, publishViaWorker };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  const doc = root.document;
  if (!doc || !doc.getElementById("write-app")) return;

  /* ══════════ 화면 ══════════ */

  const $ = (id) => doc.getElementById(id);
  const store = {
    get: (k) => { try { return root.localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { root.localStorage.setItem(k, v); } catch { /* 무시 */ } },
    del: (k) => { try { root.localStorage.removeItem(k); } catch { /* 무시 */ } },
  };
  const session = {
    get: (k) => { try { return root.sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { root.sessionStorage.setItem(k, v); } catch { /* 무시 */ } },
    del: (k) => { try { root.sessionStorage.removeItem(k); } catch { /* 무시 */ } },
  };
  const DRAFT_KEY = "write-draft-v1" /* 예전 방식: 한 편만 */, DRAFTS_KEY = "write-drafts-v1", LEGACY_UPLOADS_KEY = "write-legacy-uploads", TOKEN_KEY = "write-token";
  const newDraftId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const drafts = { items: {} };

  const el = { title: $("w-title"), body: $("w-body"), preview: $("w-preview"), status: $("w-status"), open: $("w-open"),
    toggle: $("w-toggle"), dialog: $("w-dialog"), form: $("w-form"), errors: $("w-errors"), result: $("w-result"),
    summary: $("w-summary"), summaryCount: $("w-summary-count"), summaryReset: $("w-summary-reset"),
    slug: $("w-slug"), cat1: $("w-cat1"), cat2: $("w-cat2"), tags: $("w-tags"), urlHint: $("w-url-hint"),
    seriesList: $("w-series-list"), seriesNew: $("w-series-new"), newTitle: $("w-new-title"), newKey: $("w-new-key"), newDesc: $("w-new-desc"),
    thumb: $("w-thumb"), thumbFile: $("w-thumb-file"), thumbAuto: $("w-thumb-auto"), coverLabel: $("w-cover-label"),
    coverNumber: $("w-cover-number"), coverText: $("w-cover-text"), coverColors: $("w-cover-colors"),
    token: $("w-token"), remember: $("w-remember"), forget: $("w-forget"), publish: $("w-publish"), download: $("w-download"), cancel: $("w-cancel"),
    load: $("w-load"), editing: $("w-editing"), fresh: $("w-new"), thumbKeep: $("w-thumb-keep"), dialogTitle: $("w-dialog-title"),
    imageBtn: $("w-image"), imageFile: $("w-image-file"),
    gate: $("w-gate"), gateStart: $("w-gate-start"), gateGsi: $("w-gate-gsi"), gateMsg: $("w-gate-msg"), gateToken: $("w-gate-token"),
    who: $("w-who"), logout: $("w-logout"), authAdmin: $("w-auth-admin"), authToken: $("w-auth-token"), adminState: $("w-admin-state"), adminGsi: $("w-admin-gsi"),
    draftsBtn: $("w-drafts"), draftsCount: $("w-drafts-count"), draftsDialog: $("w-drafts-dialog"), draftsList: $("w-drafts-list"), draftsClose: $("w-drafts-close"),
    loadDialog: $("w-load-dialog"), loadSearch: $("w-load-search"), loadList: $("w-load-list"), loadError: $("w-load-error"), loadClose: $("w-load-close") };

  const cfg = { repo: "", branch: "main", series: [], categories: [], tags: [], postUrls: [], posts: [], publishEndpoint: "" };
  /* 관리자 확인 상태. mode: "" 잠김 / "admin" Google 로그인으로 확인됨 / "token" GitHub 토큰으로 쓰기 / "open" 로그인 설정이 없는 사이트 */
  const auth = { mode: "", name: "", credential: "", credExp: 0, endpoint: el.gate.dataset.endpoint || "", clientId: el.gate.dataset.clientId || "" };
  const ADMIN_FLAG = "blog-admin" /* 이 브라우저에서 블로그의 '새 글'·'글쓰기'·'수정' 링크를 보이게 한다 (화면 표시용) */, SESSION_KEY = "cm-session", TOKEN_MODE_KEY = "write-token-mode";
  const ui = { summaryEdited: false, slugEdited: false, coverEdited: { label: false, number: false, text: false }, newKeyEdited: false,
    color: 0, upload: null, busy: false, noticeUntil: 0 /* 안내 문구가 '임시 저장됨'에 바로 덮이지 않게 하는 시각 */,
    edit: null /* 수정 중인 글: {path, slug, sha, entries, liquid, original, image} */,
    uploads: new Map() /* 본문 이미지: 이름 → {name, type, blob, url} */,
    draftId: "" /* 지금 쓰는 임시 글 */, metaReady: false /* 시리즈 목록까지 불러와 게시 창 값을 믿을 수 있는지 */ };


  /* ── 본문 이미지 보관 (IndexedDB). 쓸 수 없는 브라우저에서는 이 탭의 메모리에만 둔다. ── */
  const idb = {
    open() {
      return new Promise((resolve) => {
        setTimeout(() => resolve(null), 3000); /* 응답이 없으면 보관 없이 진행 */
        try {
          const req = root.indexedDB.open("write-uploads", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "name" });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      if (!db) return null;
      return new Promise((resolve) => {
        setTimeout(() => resolve(null), 3000);
        try {
          const tx = db.transaction("files", mode);
          const req = fn(tx.objectStore("files"));
          tx.oncomplete = () => { db.close(); resolve(req ? req.result : null); };
          tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
        } catch { db.close(); resolve(null); }
      });
    },
    put(rec) { return this.run("readwrite", (st) => st.put(rec)); },
    all() { return this.run("readonly", (st) => st.getAll()); },
    del(name) { return this.run("readwrite", (st) => st.delete(name)); },
  };

  function rememberUpload(rec) {
    const old = ui.uploads.get(rec.name);
    if (old) URL.revokeObjectURL(old.url);
    ui.uploads.set(rec.name, { ...rec, url: URL.createObjectURL(rec.blob) });
  }
  /** 화면에 올려 둔 이미지를 비운다 (보관된 파일은 그대로) */
  function forgetUploads() {
    ui.uploads.forEach((u) => URL.revokeObjectURL(u.url));
    ui.uploads.clear();
  }
  /** 지금 쓰는 임시 글의 이미지만 보관함에서 꺼낸다 */
  async function restoreUploads() {
    const id = ui.draftId;
    const legacy = store.get(LEGACY_UPLOADS_KEY); /* 예전 방식으로 보관된 이미지가 속한 글 */
    const recs = (await idb.all()) || [];
    if (id !== ui.draftId) return; /* 기다리는 사이 다른 글로 바뀌었으면 그쪽 호출에 맡긴다 */
    forgetUploads();
    for (const r of recs) {
      if (!r.draft && legacy) { r.draft = legacy; idb.put(r); }
      else if (!r.draft || !drafts.items[r.draft] && r.draft !== id) { idb.del(r.name); continue; } /* 주인 없는 파일은 치운다 */
      if (r.draft === id) rememberUpload(r);
    }
    if (legacy) store.del(LEGACY_UPLOADS_KEY);
    render();
  }
  /** 임시 글 하나에 딸린 이미지를 보관함에서 지운다 */
  async function dropUploads(draftId) {
    const recs = (await idb.all()) || [];
    recs.filter((r) => r.draft === draftId).forEach((r) => idb.del(r.name));
  }
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const d = String(r.result); resolve(d.slice(d.indexOf(",") + 1)); };
    r.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
    r.readAsDataURL(blob);
  });
  /** 본문에서 실제로 쓰는 이미지만 base64로 읽는다 */
  async function uploadsForPublish(body) {
    const out = [];
    for (const name of uploadRefs(body)) {
      const u = ui.uploads.get(name);
      if (u) out.push({ name, base64: await blobToBase64(u.blob) });
    }
    return out;
  }

  /** 너무 큰 사진은 가로 1600px로 줄인다 (PNG·JPG·WebP). 줄일 수 없으면 원본 그대로. */
  async function shrinkImage(file) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return file;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      if (img.naturalWidth <= BODY_IMAGE_MAX_WIDTH && file.size <= IMAGE_MAX_BYTES) return file;
      const scale = Math.min(1, BODY_IMAGE_MAX_WIDTH / img.naturalWidth);
      const canvas = doc.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type, 0.85));
      return blob && blob.size < file.size ? new File([blob], file.name, { type: file.type }) : file;
    } catch { return file; } finally { URL.revokeObjectURL(url); }
  }

  function insertAtCursor(text) {
    const start = el.body.selectionStart, end = el.body.selectionEnd, v = el.body.value;
    const before = start > 0 && v[start - 1] !== "\n" ? "\n" : "";
    el.body.setRangeText(before + text, start, end, "end");
    onEdit();
  }

  async function addImages(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith("image/"));
    const problems = [];
    for (const original of files) {
      if (!IMAGE_TYPES[original.type]) { problems.push(`${original.name}: PNG, JPG, WebP, GIF, SVG만 넣을 수 있습니다`); continue; }
      const file = await shrinkImage(original);
      if (file.size > IMAGE_MAX_BYTES) { problems.push(`${original.name}: 2MB보다 큽니다`); continue; }
      const tag = Math.random().toString(36).slice(2, 7);
      const name = uploadName(original.name, file.type, tag);
      const rec = { name, type: file.type, blob: file, draft: ui.draftId };
      rememberUpload(rec);
      idb.put(rec); /* 새로 고침 뒤에도 남게 보관. 실패해도 이 탭에서는 계속 쓸 수 있다 */
      const alt = String(original.name || "").replace(/\.[^.]*$/, "").replace(/[\[\]]/g, "") || "이미지";
      insertAtCursor(`![${alt}](upload:${name})\n`);
    }
    const added = files.length - problems.length;
    const parts = [];
    if (added > 0) parts.push(`이미지 ${added}개를 넣었습니다 (게시할 때 함께 올라갑니다)`);
    parts.push(...problems);
    if (parts.length) { ui.noticeUntil = Date.now() + 8000; el.status.textContent = parts.join(" · "); }
  }

  /* 미리보기 */
  const PREVIEW_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
  function render() {
    const title = el.title.value.trim();
    /* 올린 이미지는 미리보기에서만 이 브라우저의 임시 주소로 바꿔 보여 준다 */
    const source = el.body.value.replace(UPLOAD_REF, (whole, open, name) => { const u = ui.uploads.get(name); return u ? open + u.url : whole; });
    const html = root.marked.parse(source, { gfm: true, breaks: false });
    const clean = root.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"], ALLOWED_URI_REGEXP: PREVIEW_URI });
    el.preview.innerHTML = "";
    if (title) { const h = doc.createElement("h1"); h.textContent = title; el.preview.append(h); }
    const body = doc.createElement("div");
    body.innerHTML = clean;
    body.querySelectorAll("a[href]").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
    el.preview.append(body);
    if (!title && !el.body.value.trim()) el.preview.innerHTML = '<p class="w-empty">왼쪽에 쓰면 여기에 미리보기가 나옵니다.</p>';
  }

  /* 임시 저장 */
  let saveTimer = 0;
  function persistDrafts() {
    store.set(DRAFTS_KEY, JSON.stringify({ current: ui.draftId, items: drafts.items }));
    const n = listDrafts(drafts.items).length;
    el.draftsCount.textContent = n ? String(n) : "";
  }
  /** 게시 창에서 직접 고친 값. 시리즈 목록을 불러오기 전에는 이전에 저장한 값을 그대로 둔다. */
  function collectMeta() {
    const prev = drafts.items[ui.draftId];
    if (!ui.metaReady) return prev ? prev.meta : null;
    const series = selectedSeries();
    return { summary: ui.summaryEdited ? el.summary.value : null, slug: ui.slugEdited && !ui.edit ? el.slug.value : null,
      cat1: el.cat1.value, cat2: el.cat2.value, tags: el.tags.value, series: series === "__new__" ? "" : series };
  }
  function saveDraft() {
    const d = { id: ui.draftId, title: el.title.value, body: el.body.value, edit: ui.edit, meta: collectMeta(), savedAt: Date.now() };
    if (draftIsEmpty(d)) delete drafts.items[ui.draftId]; /* 빈 글은 목록에 남기지 않는다 */
    else drafts.items[ui.draftId] = d;
    persistDrafts();
    if (draftIsEmpty(d)) return;
    if (Date.now() >= ui.noticeUntil) el.status.textContent = "임시 저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  function onEdit() {
    render();
    if (Date.now() >= ui.noticeUntil) el.status.textContent = "저장 중…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 600);
  }
  function fillFromDraft(d) {
    el.title.value = d ? d.title : ""; el.body.value = d ? d.body : "";
    ui.edit = d ? d.edit : null; ui.upload = null;
  }
  function loadDraft() {
    const state = parseDrafts(store.get(DRAFTS_KEY), store.get(DRAFT_KEY), newDraftId());
    drafts.items = state.items;
    if (state.migrated) { store.del(DRAFT_KEY); store.set(LEGACY_UPLOADS_KEY, state.migrated); }
    const d = drafts.items[state.current];
    ui.draftId = d ? d.id : newDraftId();
    fillFromDraft(d);
    if (d) el.status.textContent = "임시 저장된 글을 불러왔습니다";
    persistDrafts();
  }

  /** 게시 창의 값을 지금 글에 맞춘다: 비우고 → 수정 중이면 원래 글의 값 → 임시 저장된 값 */
  function applyDraftMeta() {
    ui.summaryEdited = false; ui.slugEdited = false; ui.newKeyEdited = false; ui.coverEdited = { label: false, number: false, text: false };
    el.summary.value = ""; el.slug.value = ""; el.cat1.value = ""; el.cat2.value = ""; el.tags.value = "";
    el.newTitle.value = ""; el.newKey.value = ""; el.newDesc.value = "";
    const pick = (name, value) => { const r = Array.from(el.form.querySelectorAll(`input[name="${name}"]`)).find((x) => x.value === value); if (r) r.checked = true; return !!r; };
    pick("series", ""); pick("thumb", "auto"); el.seriesNew.hidden = true;
    if (ui.edit) applyEditMeta();
    const m = (drafts.items[ui.draftId] || {}).meta;
    if (!m) return;
    if (typeof m.summary === "string") { el.summary.value = m.summary; ui.summaryEdited = true; }
    if (typeof m.slug === "string" && !ui.edit) { el.slug.value = m.slug; ui.slugEdited = true; }
    el.cat1.value = m.cat1 || ""; el.cat2.value = m.cat2 || ""; el.tags.value = m.tags || "";
    if (typeof m.series === "string") pick("series", m.series);
  }

  /** 다른 임시 글로 바꾼다. 지금 쓰던 글은 먼저 저장한다. */
  function switchDraft(id) {
    clearTimeout(saveTimer); saveDraft();
    const d = drafts.items[id];
    ui.draftId = d ? id : newDraftId();
    fillFromDraft(d);
    forgetUploads(); restoreUploads();
    applyDraftMeta(); render(); renderEditState(); persistDrafts();
    if (root.history && root.location.search) root.history.replaceState(null, "", root.location.pathname);
  }
  /** 빈 새 글을 시작한다. 쓰던 글은 임시 글 목록에 남는다. */
  function startNew() {
    switchDraft("");
    el.status.textContent = "";
  }
  /** 임시 글을 지운다. 지금 쓰던 글이면 빈 화면으로 돌아간다. */
  function deleteDraft(id) {
    delete drafts.items[id];
    dropUploads(id);
    if (id === ui.draftId) {
      clearTimeout(saveTimer);
      ui.draftId = newDraftId(); fillFromDraft(null); forgetUploads();
      applyDraftMeta(); render(); renderEditState(); el.status.textContent = "";
    }
    persistDrafts();
  }

  function renderDraftList() {
    clearTimeout(saveTimer); saveDraft();
    el.draftsList.innerHTML = "";
    const items = listDrafts(drafts.items);
    items.forEach((x) => {
      const li = doc.createElement("li"), open = doc.createElement("button"), text = doc.createElement("span"), title = doc.createElement("b"),
        snippet = doc.createElement("span"), meta = doc.createElement("small"), del = doc.createElement("button");
      open.type = "button"; open.className = "w-draft-open"; del.type = "button"; del.className = "w-draft-del";
      title.textContent = x.title; snippet.textContent = x.snippet; snippet.className = "w-draft-snippet";
      meta.textContent = [x.id === ui.draftId ? "지금 쓰는 글" : "", x.editing ? "기존 글 수정" : "", draftTime(x.savedAt)].filter(Boolean).join(" · ");
      text.append(title, snippet); open.append(text, meta);
      del.textContent = "삭제"; del.setAttribute("aria-label", `${x.title} 삭제`);
      open.addEventListener("click", () => { if (x.id !== ui.draftId) { switchDraft(x.id); el.status.textContent = "임시 글을 열었습니다"; } el.draftsDialog.close(); });
      del.addEventListener("click", () => { if (root.confirm(`'${x.title}' 임시 글을 지울까요? 되돌릴 수 없습니다.`)) { deleteDraft(x.id); renderDraftList(); } });
      li.append(open, del); el.draftsList.append(li);
    });
    if (!items.length) { const li = doc.createElement("li"); li.className = "w-load-empty"; li.textContent = "임시 저장된 글이 없습니다."; el.draftsList.append(li); }
  }

  /* 두 칸의 스크롤 위치를 비율로 맞춘다 */
  function syncScroll() {
    const max = el.body.scrollHeight - el.body.clientHeight;
    const pane = el.preview.parentElement;
    if (max > 0) pane.scrollTop = (el.body.scrollTop / max) * (pane.scrollHeight - pane.clientHeight);
  }

  /* 게시 창 */
  const selectedSeries = () => (el.form.querySelector('input[name="series"]:checked') || {}).value || "";
  const selectedThumb = () => (el.form.querySelector('input[name="thumb"]:checked') || {}).value || "auto";

  function seriesState() {
    const v = selectedSeries();
    if (v === "") return { mode: "none" };
    if (v === "__new__") return { mode: "new", key: el.newKey.value.trim(), title: el.newTitle.value, description: el.newDesc.value };
    return { mode: "existing", key: v };
  }

  function coverDefaults() {
    const sr = seriesState();
    const meta = cfg.series.find((x) => x.key === sr.key);
    if (!ui.coverEdited.label) el.coverLabel.value = sr.mode === "existing" ? meta.title : sr.mode === "new" ? el.newTitle.value.trim() : cfg.siteTitle || "";
    if (!ui.coverEdited.number) el.coverNumber.value = sr.mode === "existing" ? pad2(meta.count) : sr.mode === "new" ? "00" : "";
    if (!ui.coverEdited.text) el.coverText.value = Array.from(el.title.value.trim()).slice(0, 16).join("");
  }

  const currentSvg = () => coverSvg({ label: el.coverLabel.value.trim(), number: el.coverNumber.value.trim(), text: el.coverText.value.trim(), ...COVER_COLORS[ui.color] });

  function renderThumb() {
    const mode = selectedThumb();
    el.thumbAuto.hidden = mode !== "auto";
    el.thumbFile.hidden = mode !== "upload";
    el.thumb.classList.toggle("w-thumb-none", mode === "none");
    if (mode === "keep" && ui.edit && ui.edit.image) el.thumb.src = ui.edit.image;
    else if (mode === "auto") el.thumb.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(currentSvg());
    else if (mode === "upload" && ui.upload) el.thumb.src = ui.upload.dataUrl;
    else el.thumb.removeAttribute("src");
  }

  function renderSummaryCount() {
    const n = Array.from(el.summary.value).length;
    el.summaryCount.textContent = `${n} / ${SUMMARY_MAX}`;
    el.summaryCount.classList.toggle("w-over", n > SUMMARY_MAX);
  }

  function renderUrlHint() {
    el.urlHint.textContent = el.slug.value ? `${root.location.origin}${postUrl(el.slug.value)}` : "주소를 입력하세요";
  }

  function openDialog() {
    if (!ui.summaryEdited) el.summary.value = summarize(el.body.value);
    if (ui.edit) el.slug.value = ui.edit.slug;
    else if (!ui.slugEdited) el.slug.value = slugify(el.title.value);
    coverDefaults();
    renderSummaryCount(); renderUrlHint(); renderThumb();
    el.errors.hidden = true; el.result.hidden = true; el.form.hidden = false;
    renderAuthFields();
    el.dialog.showModal();
  }

  function collect() {
    const mode = selectedThumb();
    const image = mode === "keep" ? { mode: ui.edit && ui.edit.image ? "keep" : "none" }
      : mode === "auto" ? { mode, svg: currentSvg() }
      : mode === "upload" && ui.upload ? { mode, type: ui.upload.type, size: ui.upload.size, ext: IMAGE_TYPES[ui.upload.type], base64: ui.upload.base64 }
      : { mode: mode === "upload" ? "none" : mode };
    return { title: el.title.value, body: el.body.value, slug: el.slug.value.trim(), description: el.summary.value,
      categories: [el.cat1.value.trim(), el.cat2.value.trim()].filter(Boolean), tags: splitList(el.tags.value).map((t) => t.toLowerCase()),
      series: seriesState(), image, missingUploads: uploadRefs(el.body.value).filter((n) => !ui.uploads.has(n)) };
  }

  function showErrors(list) {
    el.errors.innerHTML = "";
    list.forEach((m) => { const li = doc.createElement("li"); li.textContent = m; el.errors.append(li); });
    el.errors.hidden = list.length === 0;
    if (list.length) el.errors.scrollIntoView({ block: "nearest" });
  }

  function setBusy(b, label) {
    ui.busy = b;
    [el.publish, el.download, el.cancel].forEach((x) => { x.disabled = b; });
    el.publish.textContent = b ? label || "게시 중…" : ui.edit ? "수정 게시" : "게시하기";
  }

  function check() {
    const s = collect();
    const errors = validate(s, { seriesKeys: cfg.series.map((x) => x.key), postUrls: cfg.postUrls, editing: !!ui.edit });
    showErrors(errors);
    return errors.length ? null : s;
  }

  function showResult(html) { el.form.hidden = true; el.result.hidden = false; el.result.innerHTML = ""; el.result.append(...html); }
  const link = (href, text) => { const a = doc.createElement("a"); a.href = href; a.textContent = text; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; };
  const para = (...nodes) => { const p = doc.createElement("p"); p.append(...nodes); return p; };

  async function publish() {
    const s = check();
    if (!s) return;
    const viaServer = usePublisher();
    const token = el.token.value.trim();
    if (viaServer && !credentialFresh()) { renderAuthFields(); showErrors(["Google 로그인 확인이 필요합니다. '게시 권한' 칸의 버튼으로 로그인한 뒤 다시 누르세요."]); return; }
    if (!viaServer && !token) { showErrors(["GitHub 토큰을 입력하세요. 토큰 없이 올리려면 '파일로 내려받기'를 쓰세요."]); return; }
    setBusy(true);
    try {
      const base = { token: viaServer ? "" : token, repo: cfg.repo, branch: cfg.branch };
      let seriesYaml = "";
      if (s.series.mode === "new") {
        seriesYaml = await readRepoFile({ ...base, path: "_data/series.yml" }) || "";
        if (new RegExp(`^- key: ${s.series.key}\\s*$`, "m").test(seriesYaml)) throw new Error("같은 키의 시리즈가 이미 저장소에 있습니다.");
      }
      const editing = ui.edit;
      s.uploads = await uploadsForPublish(s.body);
      const plan = planFiles(s, { now: new Date(), seriesList: cfg.series, seriesYaml, edit: editing });
      const message = `${editing ? "글 수정" : "글 게시"}: ${s.title.trim()}`;
      let done;
      if (viaServer) {
        /* 같은 이름의 글이 있는지, 불러온 뒤 바뀌었는지는 서버가 올리기 직전에 확인한다 */
        done = await publishViaWorker({ endpoint: cfg.publishEndpoint, credential: auth.credential, message, files: plan.files,
          expect: editing ? { mode: "update", sha: editing.sha } : { mode: "create" } });
      } else {
        const current = await readRepoFileInfo({ ...base, path: plan.path });
        if (!editing && current !== null) throw new Error("같은 이름의 글 파일이 이미 저장소에 있습니다. 주소를 바꾸세요.");
        if (editing && current === null) throw new Error("저장소에서 이 글 파일을 찾지 못했습니다. 지워졌거나 이름이 바뀌었습니다.");
        if (editing && current.sha !== editing.sha) throw new Error("불러온 뒤에 저장소의 글이 바뀌었습니다. 내용을 따로 복사해 두고 글을 다시 불러오세요.");
        done = await commitFiles({ ...base, message, files: plan.files });
        if (el.remember.checked) { store.set(TOKEN_KEY, token); session.del(TOKEN_KEY); } else { session.set(TOKEN_KEY, token); store.del(TOKEN_KEY); }
        store.set(ADMIN_FLAG, "1");
      }
      clearTimeout(saveTimer);
      delete drafts.items[ui.draftId]; dropUploads(ui.draftId); forgetUploads();
      ui.draftId = newDraftId(); persistDrafts();
      const h = doc.createElement("h2"); h.textContent = editing ? "수정했습니다" : "게시했습니다";
      const again = doc.createElement("button"); again.type = "button"; again.textContent = "새 글 쓰기";
      again.addEventListener("click", () => { root.location.reload(); });
      showResult([h, para("사이트에 반영되기까지 1~2분 걸립니다. 글 안의 링크나 이미지 주소가 깨져 있으면 배포 검사에서 멈추니, 글이 보이지 않으면 배포 진행 상황을 확인하세요."),
        para("글 주소: ", link(editing ? editing.url || plan.url : plan.url, root.location.origin + (editing ? editing.url || plan.url : plan.url))),
        para("커밋: ", link(done.url, done.sha.slice(0, 7)), " · ", link(`https://github.com/${cfg.repo}/actions`, "배포 진행 상황")), again]);
      fillFromDraft(null); applyDraftMeta(); render(); renderEditState();
    } catch (e) {
      showErrors([e && e.message ? e.message : "게시하지 못했습니다."]);
    } finally { setBusy(false); }
  }

  function download() {
    const s = check();
    if (!s) return;
    s.uploads = []; /* 내려받는 파일에는 이미지가 들어가지 않으므로 upload: 표시를 그대로 둔다 */
    const plan = planFiles(s, { now: new Date(), seriesList: cfg.series, seriesYaml: "", edit: ui.edit });
    const a = doc.createElement("a");
    a.href = URL.createObjectURL(new Blob([plan.content], { type: "text/markdown;charset=utf-8" }));
    a.download = plan.path.split("/").pop();
    doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const notes = [`받은 파일을 저장소의 ${plan.path} 에 넣고 커밋하면 게시됩니다.`];
    if (s.image.mode !== "none" && s.image.mode !== "keep") notes.push("썸네일 파일은 내려받기에 포함되지 않습니다. 머리말의 image 경로에 맞춰 따로 넣으세요.");
    if (uploadRefs(s.body).length) notes.push("본문에 넣은 이미지는 내려받기에 포함되지 않습니다. 파일의 (upload:이름) 부분을 직접 올린 이미지 경로로 바꾸세요.");
    if (s.series.mode === "new") notes.push("새 시리즈는 _data/series.yml 에 직접 추가해야 시리즈 탭에 소개가 나옵니다.");
    showErrors(notes);
  }

  function readUpload(file) {
    if (!file) { ui.upload = null; renderThumb(); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      ui.upload = { type: file.type, size: file.size, dataUrl, base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
      renderThumb();
    };
    reader.readAsDataURL(file);
  }

  /* ── 관리자 확인 ── */

  const usePublisher = () => auth.mode === "admin" && !!cfg.publishEndpoint;
  const credentialFresh = () => !!auth.credential && auth.credExp * 1000 > Date.now() + 60000;

  let gsiLoading = null;
  const loadGsi = () => gsiLoading || (gsiLoading = new Promise((resolve, reject) => {
    if (root.google && root.google.accounts && root.google.accounts.id) return resolve(root.google.accounts.id);
    const sc = doc.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client"; sc.async = true;
    sc.onload = () => (root.google && root.google.accounts && root.google.accounts.id ? resolve(root.google.accounts.id) : reject(new Error("gsi")));
    sc.onerror = () => { gsiLoading = null; reject(new Error("gsi")); };
    doc.head.appendChild(sc);
  }));

  /** Google 로그인 버튼을 slot에 그린다. 로그인하면 서버에 확인한 뒤 done(결과)을 부른다. */
  async function showGoogleButton(slot, say, done) {
    try {
      const gid = await loadGsi();
      gid.initialize({ client_id: auth.clientId, ux_mode: "popup", auto_select: false, callback: async (resp) => {
        try {
          const credential = resp && resp.credential;
          const sess = await loginSession({ endpoint: auth.endpoint, credential });
          if (!sess.admin) { store.del(ADMIN_FLAG); say("이 계정에는 글쓰기 권한이 없습니다. 블로그 주인 계정으로 로그인하세요."); return; }
          session.set(SESSION_KEY, JSON.stringify(sess)); /* 댓글 화면과 같은 로그인 상태(이 탭에서만) */
          store.set(ADMIN_FLAG, "1");
          auth.name = sess.name; auth.credential = credential; auth.credExp = credentialExp(credential);
          say(""); done();
        } catch (e) { say(e && e.message ? e.message : "로그인을 확인하지 못했습니다."); }
      } });
      slot.innerHTML = "";
      gid.renderButton(slot, { type: "standard", theme: "outline", size: "large", text: "signin_with", locale: "ko" });
    } catch { say("Google 로그인을 불러오지 못했습니다. 광고 차단 확장을 확인하세요."); }
  }

  function unlock(mode) {
    auth.mode = mode;
    el.gate.hidden = true;
    const admin = mode === "admin";
    el.who.hidden = !admin; el.logout.hidden = !admin;
    el.who.textContent = admin ? `관리자: ${auth.name}` : "";
  }

  function initGate() {
    if (!auth.endpoint || !auth.clientId) { unlock("open"); return; } /* 로그인 설정이 없는 사이트: 잠그지 않는다 */
    const sess = readAdminSession(session.get(SESSION_KEY), Date.now());
    if (sess && sess.admin) { auth.name = sess.name; unlock("admin"); return; }
    if (session.get(TOKEN_MODE_KEY) === "1") { unlock("token"); return; }
    el.gate.hidden = false;
    const say = (m) => { el.gateMsg.textContent = m; };
    el.gateStart.addEventListener("click", async () => {
      el.gateStart.disabled = true;
      await showGoogleButton(el.gateGsi, say, () => unlock("admin"));
      if (el.gateGsi.childElementCount) el.gateStart.hidden = true; else el.gateStart.disabled = false;
    });
    el.gateToken.addEventListener("click", () => { session.set(TOKEN_MODE_KEY, "1"); unlock("token"); });
  }

  /** 게시 창의 권한 칸: 게시 서버를 쓰면 Google 로그인 상태를, 아니면 토큰 입력을 보인다 */
  function renderAuthFields() {
    const viaServer = usePublisher();
    el.authAdmin.hidden = !viaServer; el.authToken.hidden = viaServer;
    if (!viaServer) return;
    if (credentialFresh()) { el.adminState.textContent = `${auth.name} 계정으로 확인됐습니다. 토큰 없이 게시합니다.`; el.adminGsi.innerHTML = ""; return; }
    el.adminState.textContent = "게시하려면 Google 로그인을 한 번 더 확인해야 합니다 (확인은 1시간 동안 유효).";
    showGoogleButton(el.adminGsi, (m) => { if (m) showErrors([m]); else el.errors.hidden = true; }, renderAuthFields);
  }

  /* ── 기존 글 수정 ── */

  function renderEditState() {
    const on = !!ui.edit;
    el.editing.hidden = !on; el.thumbKeep.hidden = !(on && ui.edit.image);
    el.editing.textContent = on ? `수정 중: ${ui.edit.path.replace(/^_posts\//, "")}` : "";
    el.editing.title = on ? ui.edit.path : "";
    el.open.textContent = on ? "수정 게시" : "게시하기";
    el.publish.textContent = on ? "수정 게시" : "게시하기";
    el.dialogTitle.textContent = on ? "수정 설정" : "게시 설정";
    el.slug.readOnly = on;
  }

  /** 불러온 글의 값을 게시 창에 채운다 (시리즈 목록이 만들어진 뒤에 불러야 한다) */
  function applyEditMeta() {
    if (!ui.edit) return;
    const o = ui.edit.original;
    el.summary.value = o.description || ""; ui.summaryEdited = true;
    el.slug.value = ui.edit.slug; ui.slugEdited = true;
    el.cat1.value = o.categories[0] || ""; el.cat2.value = o.categories[1] || "";
    el.tags.value = (o.tags || []).join(", ");
    const radio = Array.from(el.form.querySelectorAll('input[name="series"]')).find((r) => r.value === (o.series || ""));
    if (radio) radio.checked = true;
    el.seriesNew.hidden = true;
    const thumb = el.form.querySelector(`input[name="thumb"][value="${ui.edit.image ? "keep" : "none"}"]`);
    if (thumb) thumb.checked = true;
    ui.coverEdited = { label: false, number: false, text: false };
  }

  async function loadPost(path) {
    const item = cfg.posts.find((x) => x.path === path);
    if (!item) throw new Error("목록에 없는 글입니다.");
    /* 이 글을 고치던 임시 글이 있으면 그것을 연다. 지금 그 글을 보고 있으면 저장소에서 새로 받아 덮어쓴다(확인 뒤). */
    const existing = findDraftByPath(drafts.items, path);
    if (existing && existing !== ui.draftId) { switchDraft(existing); el.status.textContent = "이 글을 고치던 임시 글을 열었습니다"; ui.noticeUntil = Date.now() + 8000; return true; }
    if (existing && !root.confirm("고치던 내용을 버리고 저장소의 글을 다시 불러올까요?")) return false;
    const info = await readRepoFileInfo({ repo: cfg.repo, branch: cfg.branch, path, token: el.token.value.trim() });
    if (!info) throw new Error("저장소에서 이 글 파일을 찾지 못했습니다.");
    const parsed = parsePost(info.text);
    if (!parsed) throw new Error("이 글의 머리말을 읽지 못했습니다.");
    /* 쓰던 글은 임시 글 목록에 남기고, 불러온 글은 새 임시 글로 연다 */
    clearTimeout(saveTimer);
    if (existing) { dropUploads(existing); delete drafts.items[existing]; } else { saveDraft(); ui.draftId = newDraftId(); }
    ui.edit = { path, slug: slugFromPath(path), url: item.url, sha: info.sha, entries: parsed.entries, liquid: parsed.liquid, original: parsed.data, image: parsed.data.image };
    ui.upload = null; forgetUploads();
    el.title.value = parsed.data.title; el.body.value = parsed.body;
    applyDraftMeta(); render(); renderEditState(); saveDraft();
    el.status.textContent = parsed.liquid === "keep" ? "불러왔습니다 · 이 글은 Liquid 태그를 직접 씁니다" : "불러왔습니다";
    return true;
  }

  function renderLoadList() {
    const q = el.loadSearch.value.trim().toLowerCase();
    el.loadList.innerHTML = "";
    const hits = cfg.posts.filter((x) => !q || x.title.toLowerCase().includes(q) || x.path.toLowerCase().includes(q));
    hits.forEach((x) => {
      const li = doc.createElement("li"), b = doc.createElement("button"), t = doc.createElement("span"), d = doc.createElement("small");
      b.type = "button"; t.textContent = x.title; d.textContent = x.date;
      b.append(t, d);
      b.addEventListener("click", async () => {
        el.loadError.hidden = true; b.disabled = true;
        try { if (await loadPost(x.path)) el.loadDialog.close(); }
        catch (e) { el.loadError.textContent = e && e.message ? e.message : "불러오지 못했습니다."; el.loadError.hidden = false; }
        finally { b.disabled = false; }
      });
      li.append(b); el.loadList.append(li);
    });
    if (!hits.length) { const li = doc.createElement("li"); li.className = "w-load-empty"; li.textContent = "찾는 글이 없습니다."; el.loadList.append(li); }
  }

  function buildSeriesList() {
    const row = (value, title, sub, checked) => {
      const label = doc.createElement("label"); label.className = "w-series-item";
      const input = doc.createElement("input"); input.type = "radio"; input.name = "series"; input.value = value; input.checked = !!checked;
      const text = doc.createElement("span"); text.textContent = title;
      label.append(input, text);
      if (sub) { const small = doc.createElement("small"); small.textContent = sub; label.append(small); }
      return label;
    };
    el.seriesList.innerHTML = "";
    el.seriesList.append(row("", "시리즈 없음", "", true));
    cfg.series.forEach((s) => el.seriesList.append(row(s.key, s.title, `${s.count}개의 글`)));
    el.seriesList.append(row("__new__", "＋ 새 시리즈 만들기", ""));
  }

  function buildColors() {
    COVER_COLORS.forEach((c, i) => {
      const b = doc.createElement("button"); b.type = "button"; b.className = "w-swatch"; b.title = c.name;
      b.setAttribute("aria-label", `표지 색 ${c.name}`); b.setAttribute("aria-pressed", String(i === ui.color));
      b.style.background = `linear-gradient(135deg, ${c.bg} 55%, ${c.fg} 55%)`;
      b.addEventListener("click", () => { ui.color = i; el.coverColors.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-pressed", String(j === i))); renderThumb(); });
      el.coverColors.append(b);
    });
  }

  function fillDatalist(id, values) {
    const list = $(id);
    values.forEach((v) => { const o = doc.createElement("option"); o.value = v; list.append(o); });
  }

  async function loadConfig() {
    try {
      const res = await root.fetch(el.form.dataset.config, { cache: "no-store" });
      Object.assign(cfg, await res.json());
    } catch { el.status.textContent = "시리즈 목록을 불러오지 못했습니다"; }
    buildSeriesList();
    fillDatalist("w-cat1-list", cfg.categories.map((c) => c[0]).filter((v, i, a) => v && a.indexOf(v) === i));
    fillDatalist("w-cat2-list", cfg.categories.map((c) => c[1]).filter((v, i, a) => v && a.indexOf(v) === i));
    fillDatalist("w-tags-list", cfg.tags);
    applyDraftMeta(); ui.metaReady = true;
    const want = new URLSearchParams(root.location.search).get("edit");
    if (want && !(ui.edit && ui.edit.path === want)) {
      try { await loadPost(want); } catch (e) { el.status.textContent = e && e.message ? e.message : "글을 불러오지 못했습니다"; }
    }
  }

  function init() {
    initGate();
    loadDraft(); render(); buildColors(); renderEditState(); restoreUploads();
    const saved = session.get(TOKEN_KEY) || store.get(TOKEN_KEY);
    if (saved) { el.token.value = saved; el.remember.checked = !!store.get(TOKEN_KEY); }
    loadConfig();

    el.title.addEventListener("input", onEdit);
    el.body.addEventListener("input", onEdit);
    el.body.addEventListener("scroll", syncScroll, { passive: true });
    el.body.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      el.body.setRangeText("  ", el.body.selectionStart, el.body.selectionEnd, "end");
      onEdit();
    });
    el.toggle.addEventListener("click", () => {
      const on = doc.body.classList.toggle("w-show-preview");
      el.toggle.textContent = on ? "편집" : "미리보기";
      el.toggle.setAttribute("aria-pressed", String(on));
    });
    el.open.addEventListener("click", openDialog);
    el.imageBtn.addEventListener("click", () => el.imageFile.click());
    el.imageFile.addEventListener("change", async () => { await addImages(el.imageFile.files); el.imageFile.value = ""; });
    el.body.addEventListener("paste", (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); addImages(files); }
    });
    el.body.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); el.body.classList.add("w-drop"); } });
    el.body.addEventListener("dragleave", () => el.body.classList.remove("w-drop"));
    el.body.addEventListener("drop", (e) => {
      el.body.classList.remove("w-drop");
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); addImages(files); }
    });
    el.load.addEventListener("click", () => { el.loadSearch.value = ""; el.loadError.hidden = true; renderLoadList(); el.loadDialog.showModal(); el.loadSearch.focus(); });
    el.loadSearch.addEventListener("input", renderLoadList);
    el.loadClose.addEventListener("click", () => el.loadDialog.close());
    el.fresh.addEventListener("click", startNew);
    el.logout.addEventListener("click", () => { session.del(SESSION_KEY); session.del(TOKEN_MODE_KEY); store.del(ADMIN_FLAG); clearTimeout(saveTimer); saveDraft(); root.location.reload(); });
    el.draftsBtn.addEventListener("click", () => { renderDraftList(); el.draftsDialog.showModal(); });
    el.draftsClose.addEventListener("click", () => el.draftsDialog.close());
    /* 게시 창에서 고친 요약·분류·시리즈도 임시 글에 함께 저장한다 */
    const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 600); };
    el.form.addEventListener("input", (e) => { if (e.target !== el.token) saveSoon(); });
    el.form.addEventListener("change", (e) => { if (e.target !== el.token && e.target !== el.remember) saveSoon(); });
    el.cancel.addEventListener("click", () => el.dialog.close());
    el.dialog.addEventListener("cancel", (e) => { if (ui.busy) e.preventDefault(); });

    el.summary.addEventListener("input", () => { ui.summaryEdited = true; renderSummaryCount(); });
    el.summaryReset.addEventListener("click", () => { ui.summaryEdited = false; el.summary.value = summarize(el.body.value); renderSummaryCount(); });
    el.slug.addEventListener("input", () => { ui.slugEdited = true; renderUrlHint(); });
    el.form.addEventListener("change", (e) => {
      if (e.target.name === "series") { el.seriesNew.hidden = selectedSeries() !== "__new__"; coverDefaults(); renderThumb(); }
      if (e.target.name === "thumb") renderThumb();
    });
    el.newTitle.addEventListener("input", () => { if (!ui.newKeyEdited) el.newKey.value = slugify(el.newTitle.value); coverDefaults(); renderThumb(); });
    el.newKey.addEventListener("input", () => { ui.newKeyEdited = true; });
    [["label", el.coverLabel], ["number", el.coverNumber], ["text", el.coverText]].forEach(([k, input]) =>
      input.addEventListener("input", () => { ui.coverEdited[k] = true; renderThumb(); }));
    el.thumbFile.querySelector("input").addEventListener("change", (e) => readUpload(e.target.files[0]));
    el.forget.addEventListener("click", () => { store.del(TOKEN_KEY); session.del(TOKEN_KEY); el.token.value = ""; el.remember.checked = false; });
    el.form.addEventListener("submit", (e) => { e.preventDefault(); publish(); });
    el.download.addEventListener("click", download);
    root.addEventListener("beforeunload", () => { clearTimeout(saveTimer); saveDraft(); });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(typeof window !== "undefined" ? window : globalThis);
