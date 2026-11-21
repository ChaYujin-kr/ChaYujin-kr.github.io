/* 글쓰기 화면 (/write/)
 * - 왼쪽에 마크다운, 오른쪽에 미리보기 (marked + DOMPurify, 둘 다 저장소에 고정)
 * - 게시 창: 썸네일, 요약(기본은 본문 앞 100자), 시리즈 선택·새로 만들기, 주소, 카테고리, 태그
 * - 게시: GitHub API로 글·썸네일·시리즈 목록을 커밋 하나에 담아 올린다. 토큰은 이 브라우저에만 저장된다.
 *         토큰 없이 파일로 내려받을 수도 있다.
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
    else if ((known.postUrls || []).includes(postUrl(s.slug))) errors.push("같은 주소의 글이 이미 있습니다. 주소를 바꾸세요.");
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

  /** 저장소의 파일 내용을 읽는다. 없으면 null. */
  async function readRepoFile(o) {
    const fetchImpl = o.fetchImpl || root.fetch.bind(root);
    const res = await fetchImpl(`https://api.github.com/repos/${o.repo}/contents/${o.path}?ref=${encodeURIComponent(o.branch)}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${o.token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (res.status === 404) return null;
    if (!res.ok) { const e = new Error(explainStatus(res.status, "")); e.status = res.status; throw e; }
    return b64decodeUtf8((await res.json()).content);
  }

  /**
   * 입력 상태에서 올릴 파일 목록을 만든다 (네트워크 없음).
   * @param s {title, body, slug, description, categories[], tags[], series:{mode,key,title,description}, image:{mode, ext, base64, svg}}
   * @param ctx {now, seriesList:[{key,title}], seriesYaml}
   */
  function planFiles(s, ctx) {
    const stamp = kstStamp(ctx.now);
    const files = [];
    let image = "";
    if (s.image && s.image.mode === "auto") {
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
    const content = buildPost({ title: s.title.trim(), date: stamp.full, categories: s.categories, tags: s.tags,
      description: (s.description || "").trim(), image, series, seriesTitle, body: s.body });
    const path = postPath(stamp.day, s.slug);
    files.unshift({ path, base64: b64utf8(content) });
    return { files, path, content, url: postUrl(s.slug) };
  }

  const api = { SUMMARY_CHARS, SUMMARY_MAX, COVER_COLORS, plainText, summarize, slugify, kstStamp, yamlStr, splitList, protectLiquid,
    buildPost, postPath, postUrl, appendSeries, coverSvg, validate, b64utf8, b64decodeUtf8, commitFiles, readRepoFile, planFiles, explainStatus };
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
  const DRAFT_KEY = "write-draft-v1", TOKEN_KEY = "write-token";

  const el = { title: $("w-title"), body: $("w-body"), preview: $("w-preview"), status: $("w-status"), open: $("w-open"),
    toggle: $("w-toggle"), dialog: $("w-dialog"), form: $("w-form"), errors: $("w-errors"), result: $("w-result"),
    summary: $("w-summary"), summaryCount: $("w-summary-count"), summaryReset: $("w-summary-reset"),
    slug: $("w-slug"), cat1: $("w-cat1"), cat2: $("w-cat2"), tags: $("w-tags"), urlHint: $("w-url-hint"),
    seriesList: $("w-series-list"), seriesNew: $("w-series-new"), newTitle: $("w-new-title"), newKey: $("w-new-key"), newDesc: $("w-new-desc"),
    thumb: $("w-thumb"), thumbFile: $("w-thumb-file"), thumbAuto: $("w-thumb-auto"), coverLabel: $("w-cover-label"),
    coverNumber: $("w-cover-number"), coverText: $("w-cover-text"), coverColors: $("w-cover-colors"),
    token: $("w-token"), remember: $("w-remember"), forget: $("w-forget"), publish: $("w-publish"), download: $("w-download"), cancel: $("w-cancel") };

  const cfg = { repo: "", branch: "main", series: [], categories: [], tags: [], postUrls: [] };
  const ui = { summaryEdited: false, slugEdited: false, coverEdited: { label: false, number: false, text: false }, newKeyEdited: false,
    color: 0, upload: null, busy: false };

  store.set("write-enabled", "1"); /* 이 브라우저에서는 사이드바에 '글쓰기' 링크가 보인다 (metadata-hook.html) */

  /* 미리보기 */
  function render() {
    const title = el.title.value.trim();
    const html = root.marked.parse(el.body.value, { gfm: true, breaks: false });
    const clean = root.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"] });
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
  function saveDraft() {
    store.set(DRAFT_KEY, JSON.stringify({ title: el.title.value, body: el.body.value, savedAt: Date.now() }));
    el.status.textContent = "임시 저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  function onEdit() {
    render();
    el.status.textContent = "저장 중…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 600);
  }
  function loadDraft() {
    try {
      const d = JSON.parse(store.get(DRAFT_KEY) || "null");
      if (d) { el.title.value = d.title || ""; el.body.value = d.body || ""; el.status.textContent = "임시 저장된 글을 불러왔습니다"; }
    } catch { /* 깨진 임시 저장은 무시 */ }
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
    if (mode === "auto") el.thumb.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(currentSvg());
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
    if (!ui.slugEdited) el.slug.value = slugify(el.title.value);
    coverDefaults();
    renderSummaryCount(); renderUrlHint(); renderThumb();
    el.errors.hidden = true; el.result.hidden = true; el.form.hidden = false;
    el.dialog.showModal();
  }

  function collect() {
    const mode = selectedThumb();
    const image = mode === "auto" ? { mode, svg: currentSvg() }
      : mode === "upload" && ui.upload ? { mode, type: ui.upload.type, size: ui.upload.size, ext: IMAGE_TYPES[ui.upload.type], base64: ui.upload.base64 }
      : { mode: mode === "upload" ? "none" : mode };
    return { title: el.title.value, body: el.body.value, slug: el.slug.value.trim(), description: el.summary.value,
      categories: [el.cat1.value.trim(), el.cat2.value.trim()].filter(Boolean), tags: splitList(el.tags.value).map((t) => t.toLowerCase()),
      series: seriesState(), image };
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
    el.publish.textContent = b ? label || "게시 중…" : "게시하기";
  }

  function check() {
    const s = collect();
    const errors = validate(s, { seriesKeys: cfg.series.map((x) => x.key), postUrls: cfg.postUrls });
    showErrors(errors);
    return errors.length ? null : s;
  }

  function showResult(html) { el.form.hidden = true; el.result.hidden = false; el.result.innerHTML = ""; el.result.append(...html); }
  const link = (href, text) => { const a = doc.createElement("a"); a.href = href; a.textContent = text; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; };
  const para = (...nodes) => { const p = doc.createElement("p"); p.append(...nodes); return p; };

  async function publish() {
    const s = check();
    if (!s) return;
    const token = el.token.value.trim();
    if (!token) { showErrors(["GitHub 토큰을 입력하세요. 토큰 없이 올리려면 '파일로 내려받기'를 쓰세요."]); return; }
    setBusy(true);
    try {
      const base = { token, repo: cfg.repo, branch: cfg.branch };
      let seriesYaml = "";
      if (s.series.mode === "new") {
        seriesYaml = await readRepoFile({ ...base, path: "_data/series.yml" }) || "";
        if (new RegExp(`^- key: ${s.series.key}\\s*$`, "m").test(seriesYaml)) throw new Error("같은 키의 시리즈가 이미 저장소에 있습니다.");
      }
      const plan = planFiles(s, { now: new Date(), seriesList: cfg.series, seriesYaml });
      if (await readRepoFile({ ...base, path: plan.path }) !== null) throw new Error("같은 이름의 글 파일이 이미 저장소에 있습니다. 주소를 바꾸세요.");
      const done = await commitFiles({ ...base, message: `글 게시: ${s.title.trim()}`, files: plan.files });
      if (el.remember.checked) { store.set(TOKEN_KEY, token); session.del(TOKEN_KEY); } else { session.set(TOKEN_KEY, token); store.del(TOKEN_KEY); }
      store.del(DRAFT_KEY);
      const h = doc.createElement("h2"); h.textContent = "게시했습니다";
      const again = doc.createElement("button"); again.type = "button"; again.textContent = "새 글 쓰기";
      again.addEventListener("click", () => { root.location.reload(); });
      showResult([h, para("사이트에 반영되기까지 1~2분 걸립니다. 글 안의 링크나 이미지 주소가 깨져 있으면 배포 검사에서 멈추니, 글이 보이지 않으면 배포 진행 상황을 확인하세요."),
        para("글 주소: ", link(plan.url, root.location.origin + plan.url)),
        para("커밋: ", link(done.url, done.sha.slice(0, 7)), " · ", link(`https://github.com/${cfg.repo}/actions`, "배포 진행 상황")), again]);
      el.title.value = ""; el.body.value = ""; render();
    } catch (e) {
      showErrors([e && e.message ? e.message : "게시하지 못했습니다."]);
    } finally { setBusy(false); }
  }

  function download() {
    const s = check();
    if (!s) return;
    const plan = planFiles(s, { now: new Date(), seriesList: cfg.series, seriesYaml: "" });
    const a = doc.createElement("a");
    a.href = URL.createObjectURL(new Blob([plan.content], { type: "text/markdown;charset=utf-8" }));
    a.download = plan.path.split("/").pop();
    doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const notes = [`받은 파일을 저장소의 ${plan.path} 에 넣고 커밋하면 게시됩니다.`];
    if (s.image.mode !== "none") notes.push("썸네일 파일은 내려받기에 포함되지 않습니다. 머리말의 image 경로에 맞춰 따로 넣으세요.");
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
  }

  function init() {
    loadDraft(); render(); buildColors();
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
    root.addEventListener("beforeunload", () => { if (el.title.value || el.body.value) saveDraft(); });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(typeof window !== "undefined" ? window : globalThis);
