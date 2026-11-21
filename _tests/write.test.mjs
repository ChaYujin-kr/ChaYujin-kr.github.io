import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const W = createRequire(import.meta.url)("../assets/js/write.js");

test("요약: 본문 앞 100자, 마크다운 기호와 코드 블록은 뺀다", () => {
  const md = "## 제목\n\n**굵은** 글과 [링크](https://example.com), `코드`.\n\n```python\nprint('버려진다')\n```\n\n> 인용문\n\n- 항목 하나\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const s = W.summarize(md);
  assert.equal(s, "제목 굵은 글과 링크, 코드. 인용문 항목 하나 a b 1 2");
  assert.equal(W.summarize("snake_case 는 그대로 <script>x = 1</script>끝 <b>굵게</b>"), "snake_case 는 그대로 끝 굵게");
  assert.ok(!s.includes("버려진다"));
  assert.equal(Array.from(W.summarize("가".repeat(300))).length, 100);
  assert.equal(W.summarize("가나다", 2), "가나");
  assert.equal(W.summarize(""), "");
});

test("요약: 이모지가 반으로 잘리지 않는다", () => {
  const s = W.summarize("😀".repeat(150));
  assert.equal(Array.from(s).length, 100);
  assert.equal(s, "😀".repeat(100));
});

test("주소 조각: 영문·숫자만, 한글 제목은 빈 문자열", () => {
  assert.equal(W.slugify("My First Post!"), "my-first-post");
  assert.equal(W.slugify("  KFP 2.9 — 파이프라인  "), "kfp-2-9");
  assert.equal(W.slugify("한글 제목"), "");
  assert.equal(W.slugify("Café déjà vu"), "cafe-deja-vu");
});

test("날짜: 브라우저 시간대와 상관없이 한국 시간", () => {
  const t = W.kstStamp(new Date("2026-11-21T16:30:05Z"));
  assert.equal(t.day, "2026-11-22");
  assert.equal(t.full, "2026-11-22 01:30:05 +0900");
});

test("글 파일: 머리말과 시리즈 박스", () => {
  const out = W.buildPost({ title: '따옴표 "있는" 제목: 콜론', date: "2026-11-22 01:30:05 +0900", categories: ["MLOps", "실습 시리즈"],
    tags: ["kfp"], description: "요약", image: "/assets/img/posts/a.svg", series: "mlops-drift", seriesTitle: "MLOps 실습 시리즈", body: "본문\r\n둘째 줄\n\n" });
  assert.equal(out, [
    "---", 'title: "따옴표 \\"있는\\" 제목: 콜론"', "date: 2026-11-22 01:30:05 +0900", 'categories: ["MLOps", "실습 시리즈"]', 'tags: ["kfp"]',
    'description: "요약"', "image:", "  path: /assets/img/posts/a.svg", '  alt: "따옴표 \\"있는\\" 제목: 콜론"', "series: mlops-drift",
    'series_title: "MLOps 실습 시리즈"', "---", "", "{% include series-nav.html %}", "", "본문\n둘째 줄", "",
  ].join("\n"));
});

test("글 파일: 시리즈·썸네일·분류가 없으면 그 줄이 없다", () => {
  const out = W.buildPost({ title: "제목", date: "2026-11-22 01:30:05 +0900", categories: [], tags: [], description: "", image: "", series: "", body: "본문" });
  assert.equal(out, '---\ntitle: "제목"\ndate: 2026-11-22 01:30:05 +0900\n---\n본문\n');
});

test("본문의 Liquid 문법은 raw로 감싼다", () => {
  assert.equal(W.protectLiquid("평범한 글 { 중괄호 }"), "평범한 글 { 중괄호 }");
  assert.equal(W.protectLiquid("값은 ${{ secrets.X }}"), "{% raw %}\n값은 ${{ secrets.X }}\n{% endraw %}");
  /* 본문에 endraw가 있어도 Jekyll이 그린 결과가 원문과 같아야 한다 (Liquid의 raw 처리를 흉내 내 확인) */
  const renderRaw = (src) => {
    let out = "", rest = src;
    while (rest.length) {
      const open = rest.indexOf("{% raw %}");
      const outside = open < 0 ? rest : rest.slice(0, open);
      assert.ok(!/\{%/.test(outside.replaceAll("{{ '{' }}", "")), "raw 밖에 날것의 태그가 남으면 안 된다");
      out += outside.replaceAll("{{ '{' }}", "{");
      if (open < 0) break;
      const close = rest.indexOf("{% endraw %}", open);
      out += rest.slice(open + 9, close);
      rest = rest.slice(close + 12);
    }
    return out;
  };
  for (const body of ["{% raw %}a{% endraw %}b", "끝에 {% endraw %}", "{%- endraw -%} 와 {{ x }}"]) {
    assert.equal(renderRaw(W.protectLiquid(body)), "\n" + body.replace(/\{%-?\s*endraw\s*-?%\}/g, "{% endraw %}") + "\n", body);
  }
});

test("시리즈 목록에 덧붙이기", () => {
  const out = W.appendSeries("- key: a\n  title: \"A\"\n\n\n", { key: "new-one", title: '새 "시리즈"', description: "소개: 글", image: "/assets/img/posts/x.svg" });
  assert.equal(out, '- key: a\n  title: "A"\n- key: new-one\n  title: "새 \\"시리즈\\""\n  description: "소개: 글"\n  image: /assets/img/posts/x.svg\n');
  assert.equal(W.appendSeries("", { key: "k", title: "T" }), '\n- key: k\n  title: "T"\n');
});

test("자동 표지: 특수 문자를 이스케이프하고 긴 문구는 글자를 줄인다", () => {
  const svg = W.coverSvg({ label: "A & B", number: "07", text: "<제목>" });
  assert.ok(svg.includes("A &amp; B") && svg.includes("&lt;제목&gt;") && svg.includes(">07<"));
  assert.ok(!svg.includes("<제목>"));
  assert.ok(svg.includes('font-size="64"'));
  const long = W.coverSvg({ text: "가".repeat(30) });
  assert.ok(long.includes('font-size="34"'));
  assert.ok(!long.includes("font-size=\"220\""), "번호가 없으면 번호 글자를 그리지 않는다");
});

test("검사: 필수 값, 주소 형식, 중복", () => {
  const ok = { title: "제목", body: "본문", slug: "my-post", description: "요약", series: { mode: "none" }, image: { mode: "none" } };
  const known = { seriesKeys: ["mlops-drift"], postUrls: ["/posts/taken/"] };
  assert.deepEqual(W.validate(ok, known), []);
  assert.equal(W.validate({ ...ok, title: " " }, known).length, 1);
  assert.equal(W.validate({ ...ok, body: "" }, known).length, 1);
  for (const slug of ["", "한글", "Upper", "a--b", "-a", "a b"]) assert.equal(W.validate({ ...ok, slug }, known).length, 1, slug);
  assert.match(W.validate({ ...ok, slug: "taken" }, known)[0], /이미 있습니다/);
  assert.equal(W.validate({ ...ok, description: "가".repeat(201) }, known).length, 1);
});

test("검사: 시리즈와 썸네일", () => {
  const base = { title: "제목", body: "본문", slug: "my-post", description: "", image: { mode: "none" } };
  const known = { seriesKeys: ["mlops-drift"], postUrls: [] };
  assert.deepEqual(W.validate({ ...base, series: { mode: "existing", key: "mlops-drift" } }, known), []);
  assert.equal(W.validate({ ...base, series: { mode: "existing", key: "nope" } }, known).length, 1);
  assert.deepEqual(W.validate({ ...base, series: { mode: "new", key: "new-one", title: "새 시리즈" } }, known), []);
  assert.equal(W.validate({ ...base, series: { mode: "new", key: "mlops-drift", title: "겹침" } }, known).length, 1);
  assert.equal(W.validate({ ...base, series: { mode: "new", key: "새", title: "" } }, known).length, 2);
  assert.deepEqual(W.validate({ ...base, series: { mode: "none" }, image: { mode: "upload", type: "image/png", size: 1000 } }, known), []);
  assert.equal(W.validate({ ...base, series: { mode: "none" }, image: { mode: "upload", type: "application/pdf", size: 1000 } }, known).length, 1);
  assert.equal(W.validate({ ...base, series: { mode: "none" }, image: { mode: "upload", type: "image/png", size: 3 * 1024 * 1024 } }, known).length, 1);
});

test("base64: 한글이 깨지지 않는다", () => {
  assert.equal(W.b64decodeUtf8(W.b64utf8("한글 ✓ abc")), "한글 ✓ abc");
  assert.equal(Buffer.from(W.b64utf8("가나다"), "base64").toString("utf8"), "가나다");
});

test("올릴 파일 계획: 새 시리즈면 글·표지·시리즈 목록 세 파일", () => {
  const plan = W.planFiles(
    { title: " 새 글 ", body: "본문", slug: "new-post", description: " 요약 ", categories: ["MLOps"], tags: ["a"],
      series: { mode: "new", key: "new-series", title: " 새 시리즈 ", description: " 소개 " }, image: { mode: "auto", svg: "<svg/>" } },
    { now: new Date("2026-11-21T16:30:05Z"), seriesList: [], seriesYaml: "- key: old\n  title: \"Old\"\n" });
  assert.deepEqual(plan.files.map((f) => f.path), ["_posts/2026-11-22-new-post.md", "assets/img/posts/new-post.svg", "_data/series.yml"]);
  assert.equal(plan.url, "/posts/new-post/");
  const post = W.b64decodeUtf8(plan.files[0].base64);
  assert.ok(post.includes('title: "새 글"') && post.includes("series: new-series") && post.includes('series_title: "새 시리즈"'));
  assert.ok(post.includes("  path: /assets/img/posts/new-post.svg") && post.includes('description: "요약"'));
  const yml = W.b64decodeUtf8(plan.files[2].base64);
  assert.ok(yml.startsWith("- key: old\n") && yml.includes('- key: new-series\n  title: "새 시리즈"\n  description: "소개"\n  image: /assets/img/posts/new-post.svg\n'));
});

test("올릴 파일 계획: 기존 시리즈는 제목을 목록에서 가져오고, 올린 이미지는 확장자를 따른다", () => {
  const plan = W.planFiles(
    { title: "글", body: "본문", slug: "p", description: "", categories: [], tags: [],
      series: { mode: "existing", key: "mlops-drift" }, image: { mode: "upload", ext: "png", base64: "QUJD" } },
    { now: new Date("2026-11-21T16:30:05Z"), seriesList: [{ key: "mlops-drift", title: "MLOps 실습 시리즈" }], seriesYaml: "" });
  assert.deepEqual(plan.files.map((f) => f.path), ["_posts/2026-11-22-p.md", "assets/img/posts/p.png"]);
  assert.equal(plan.files[1].base64, "QUJD");
  assert.ok(plan.content.includes('series_title: "MLOps 실습 시리즈"'));
});

/* GitHub API 흉내: 호출 순서와 내용을 기록한다 */
function fakeGitHub(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace("https://api.github.com/repos/o/r", "");
    const method = init.method || "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    const key = `${method} ${path}`;
    if (overrides[key]) return overrides[key];
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (key === "GET /git/ref/heads/main") return ok({ object: { sha: "parent1" } });
    if (key === "GET /git/commits/parent1") return ok({ tree: { sha: "tree0" } });
    if (key === "POST /git/blobs") return ok({ sha: "blob" + calls.filter((c) => c.path === "/git/blobs").length });
    if (key === "POST /git/trees") return ok({ sha: "tree1" });
    if (key === "POST /git/commits") return ok({ sha: "commit1abcdef" });
    if (key === "PATCH /git/refs/heads/main") return ok({});
    return { ok: false, status: 404, json: async () => ({ message: "Not Found" }) };
  };
  return { calls, fetchImpl };
}

test("커밋: 파일 여러 개를 커밋 하나로, 강제 푸시 없이", async () => {
  const gh = fakeGitHub();
  const out = await W.commitFiles({ token: "T", repo: "o/r", branch: "main", message: "글 게시: 제목",
    files: [{ path: "_posts/a.md", base64: "QQ==" }, { path: "assets/img/posts/a.svg", base64: "Qg==" }], fetchImpl: gh.fetchImpl });
  assert.deepEqual(gh.calls.map((c) => `${c.method} ${c.path}`), [
    "GET /git/ref/heads/main", "GET /git/commits/parent1", "POST /git/blobs", "POST /git/blobs", "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/main"]);
  assert.ok(gh.calls.every((c) => c.auth === "Bearer T"));
  assert.deepEqual(gh.calls[4].body, { base_tree: "tree0", tree: [
    { path: "_posts/a.md", mode: "100644", type: "blob", sha: "blob1" }, { path: "assets/img/posts/a.svg", mode: "100644", type: "blob", sha: "blob2" }] });
  assert.deepEqual(gh.calls[5].body, { message: "글 게시: 제목", tree: "tree1", parents: ["parent1"] });
  assert.deepEqual(gh.calls[6].body, { sha: "commit1abcdef", force: false });
  assert.equal(out.url, "https://github.com/o/r/commit/commit1abcdef");
});

test("커밋: 권한 오류는 알아볼 수 있는 말로 바꾸고, 가지는 건드리지 않는다", async () => {
  const gh = fakeGitHub({ "POST /git/blobs": { ok: false, status: 403, json: async () => ({ message: "Resource not accessible" }) } });
  await assert.rejects(
    W.commitFiles({ token: "T", repo: "o/r", branch: "main", message: "m", files: [{ path: "a", base64: "QQ==" }], fetchImpl: gh.fetchImpl }),
    /Contents 권한/);
  assert.ok(!gh.calls.some((c) => c.method === "PATCH"));
  assert.match(W.explainStatus(401, ""), /만료/);
});

test("저장소 파일 읽기: 없으면 null, 있으면 내용", async () => {
  const none = await W.readRepoFile({ token: "T", repo: "o/r", branch: "main", path: "x", fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(none, null);
  const got = await W.readRepoFile({ token: "T", repo: "o/r", branch: "main", path: "_data/series.yml",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: Buffer.from("- key: 가\n").toString("base64").replace(/(.{4})/g, "$1\n") }) }) });
  assert.equal(got, "- key: 가\n");
});

/* ── 기존 글 수정 ── */

const SAMPLE = `---
title: "원래 제목"
date: 2026-11-08 01:00:00 +0900
categories: [MLOps, 실습 시리즈]
tags: [mlops, series]
description: "원래 요약"
image:
  path: /assets/img/posts/a.svg
  alt: "원래 제목"
series: mlops-drift
series_title: "MLOps 실습 시리즈"
pin: true
math: true
---

{% include series-nav.html %}

첫 문단.

[다음 글]({% post_url 2026-11-08-b %})
`;

test("값 읽기: 따옴표 종류와 목록", () => {
  assert.equal(W.parseScalar(' "큰 \\"따옴표\\"" '), '큰 "따옴표"');
  assert.equal(W.parseScalar("'작은 ''따옴표'''"), "작은 '따옴표'");
  assert.equal(W.parseScalar("그냥 값  # 주석"), "그냥 값");
  assert.deepEqual(W.parseFlowList('[MLOps, "쉼표, 포함", \'c\']'), ["MLOps", "쉼표, 포함", "c"]);
  assert.deepEqual(W.parseFlowList("[]"), []);
});

test("글 읽기: 머리말 값, 본문, 다루지 않는 항목 보관", () => {
  const p = W.parsePost(SAMPLE);
  assert.deepEqual(p.data, { title: "원래 제목", categories: ["MLOps", "실습 시리즈"], tags: ["mlops", "series"], description: "원래 요약",
    image: "/assets/img/posts/a.svg", series: "mlops-drift", seriesTitle: "MLOps 실습 시리즈" });
  assert.equal(p.body, "첫 문단.\n\n[다음 글]({% post_url 2026-11-08-b %})");
  assert.equal(p.liquid, "keep", "Liquid 태그를 직접 쓴 글은 감싸지 않는다");
  assert.deepEqual(p.entries.map((e) => e.key), ["title", "date", "categories", "tags", "description", "image", "series", "series_title", "pin", "math"]);
  assert.equal(W.parsePost("머리말이 없는 글"), null);
  const block = W.parsePost("---\ntitle: 따옴표 없는 제목\ntags:\n  - a\n  - b\nimage: /x.png\n---\n본문\r\n");
  assert.deepEqual([block.data.title, block.data.tags, block.data.image, block.body, block.liquid], ["따옴표 없는 제목", ["a", "b"], "/x.png", "본문", "auto"]);
  assert.equal(W.slugFromPath("_posts/2026-11-22-my-post.md"), "my-post");
  assert.equal(W.slugFromPath("../etc/passwd"), "");
});

const edited = (over = {}) => {
  const p = W.parsePost(SAMPLE);
  return W.buildEditedPost({ entries: p.entries, liquid: p.liquid, original: p.data, title: p.data.title, categories: p.data.categories, tags: p.data.tags,
    description: p.data.description, image: { mode: "keep" }, series: p.data.series, seriesTitle: p.data.seriesTitle, body: p.body, ...over });
};

test("고쳐 쓰기: 아무것도 안 바꾸면 파일이 그대로다", () => {
  assert.equal(edited(), SAMPLE);
});

test("고쳐 쓰기: 바꾼 항목의 줄만 달라지고 날짜·pin·math는 남는다", () => {
  const out = edited({ title: "새 제목", body: "바뀐 본문" });
  const before = SAMPLE.split("\n"), after = out.split("\n");
  assert.equal(after[1], 'title: "새 제목"');
  assert.deepEqual(after.slice(2, 13), before.slice(2, 13), "제목 말고는 머리말이 그대로");
  assert.ok(out.includes("date: 2026-11-08 01:00:00 +0900") && out.includes("pin: true") && out.includes("math: true"));
  assert.ok(out.endsWith("{% include series-nav.html %}\n\n바뀐 본문\n"));
});

test("고쳐 쓰기: 시리즈 빼기, 썸네일 바꾸기·없애기, 태그 비우기", () => {
  const noSeries = edited({ series: "", seriesTitle: "" });
  assert.ok(!noSeries.includes("series:") && !noSeries.includes("series_title:") && !noSeries.includes("series-nav.html"));
  const newImage = edited({ image: { path: "/assets/img/posts/new.png" } });
  assert.ok(newImage.includes("image:\n  path: /assets/img/posts/new.png\n  alt: \"원래 제목\"\nseries: mlops-drift"));
  const noImage = edited({ image: { path: "" } });
  assert.ok(!noImage.includes("image:") && !noImage.includes("path:"));
  assert.ok(!edited({ tags: [] }).includes("tags:"));
});

test("고쳐 쓰기: 없던 항목을 넣으면 머리말 끝에 붙는다", () => {
  const p = W.parsePost("---\ntitle: 제목\ndate: 2026-01-01 00:00:00 +0900\n---\n본문\n");
  const out = W.buildEditedPost({ entries: p.entries, liquid: p.liquid, original: p.data, title: "제목", categories: ["A"], tags: [], description: "요약",
    image: { path: "" }, series: "s", seriesTitle: "S", body: p.body });
  assert.equal(out, '---\ntitle: 제목\ndate: 2026-01-01 00:00:00 +0900\ncategories: ["A"]\ndescription: "요약"\nseries: s\nseries_title: "S"\n---\n\n{% include series-nav.html %}\n\n본문\n');
});

test("고쳐 쓰기: Liquid를 직접 쓴 글은 감싸지 않고, 이 화면이 감싼 글은 풀었다가 다시 감싼다", () => {
  assert.ok(edited().includes("{% post_url 2026-11-08-b %}") && !edited().includes("{% raw %}"));
  const made = W.buildPost({ title: "t", date: "2026-11-22 01:30:05 +0900", categories: [], tags: [], body: "값 ${{ a }} 와 {% endraw %} 글자" });
  const p = W.parsePost(made);
  assert.equal(p.body, "값 ${{ a }} 와 {% endraw %} 글자");
  assert.equal(p.liquid, "auto");
  const again = W.buildEditedPost({ entries: p.entries, liquid: p.liquid, original: p.data, title: "t", categories: [], tags: [], description: "", image: { mode: "keep" }, series: "", body: p.body });
  assert.equal(W.parsePost(again).body, p.body);
  assert.ok(again.includes("{% raw %}"));
});

test("올릴 파일 계획: 수정은 원래 경로에, 썸네일 유지면 글 파일 하나만", () => {
  const p = W.parsePost(SAMPLE);
  const edit = { path: "_posts/2026-11-08-a.md", entries: p.entries, liquid: p.liquid, original: p.data, image: p.data.image };
  const s = { title: "새 제목", body: p.body, slug: "a", description: "원래 요약", categories: ["MLOps", "실습 시리즈"], tags: ["mlops", "series"],
    series: { mode: "existing", key: "mlops-drift" }, image: { mode: "keep" } };
  const plan = W.planFiles(s, { now: new Date("2026-12-01T00:00:00Z"), seriesList: [{ key: "mlops-drift", title: "MLOps 실습 시리즈" }], seriesYaml: "", edit });
  assert.deepEqual(plan.files.map((f) => f.path), ["_posts/2026-11-08-a.md"]);
  assert.ok(plan.content.includes('title: "새 제목"') && plan.content.includes("date: 2026-11-08 01:00:00 +0900") && plan.content.includes("path: /assets/img/posts/a.svg"));
  const withCover = W.planFiles({ ...s, image: { mode: "auto", svg: "<svg/>" } }, { now: new Date(), seriesList: [{ key: "mlops-drift", title: "MLOps 실습 시리즈" }], seriesYaml: "", edit });
  assert.deepEqual(withCover.files.map((f) => f.path), ["_posts/2026-11-08-a.md", "assets/img/posts/a.svg"]);
});

test("검사: 수정 중에는 자기 주소가 이미 있어도 된다", () => {
  const s = { title: "제목", body: "본문", slug: "taken", description: "", series: { mode: "none" }, image: { mode: "keep" } };
  assert.equal(W.validate(s, { seriesKeys: [], postUrls: ["/posts/taken/"] }).length, 1);
  assert.deepEqual(W.validate(s, { seriesKeys: [], postUrls: ["/posts/taken/"], editing: true }), []);
});

test("저장소 파일 읽기: 토큰이 없으면 인증 헤더를 보내지 않고, sha를 함께 돌려준다", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = init.headers; return { ok: true, status: 200, json: async () => ({ content: Buffer.from("본문").toString("base64"), sha: "abc" }) }; };
  assert.deepEqual(await W.readRepoFileInfo({ repo: "o/r", branch: "main", path: "p", token: "", fetchImpl }), { text: "본문", sha: "abc" });
  assert.ok(!("Authorization" in seen));
  await W.readRepoFileInfo({ repo: "o/r", branch: "main", path: "p", token: "T", fetchImpl });
  assert.equal(seen.Authorization, "Bearer T");
  await assert.rejects(W.readRepoFileInfo({ repo: "o/r", branch: "main", path: "p", token: "", fetchImpl: async () => ({ ok: false, status: 403 }) }), /요청 한도/);
});

/* ── 본문 이미지 ── */

test("본문 이미지 이름: 영문·숫자만 남기고 꼬리표와 확장자를 붙인다", () => {
  assert.equal(W.uploadName("My Screenshot (1).PNG", "image/png", "ab12c"), "my-screenshot-1-ab12c.png");
  assert.equal(W.uploadName("스크린샷.jpg", "image/jpeg", "ab12c"), "image-ab12c.jpg");
  assert.equal(W.uploadName("", "image/webp", "x"), "image-x.webp");
});

test("본문 이미지: 쓰인 것만 경로를 바꾸고 올릴 목록에 넣는다", () => {
  const body = '![a](upload:a-1.png)\n\n다시 ![a](upload:a-1.png "제목") 그리고 <img src="upload:b-2.jpg" width="300">\n\n![없음](upload:gone-9.png)';
  assert.deepEqual(W.uploadRefs(body), ["a-1.png", "b-2.jpg", "gone-9.png"]);
  const r = W.resolveUploads(body, "my-post", [{ name: "a-1.png", base64: "QQ==" }, { name: "b-2.jpg", base64: "Qg==" }, { name: "unused-3.png", base64: "Qw==" }]);
  assert.equal(r.body, '![a](/assets/img/posts/my-post/a-1.png)\n\n다시 ![a](/assets/img/posts/my-post/a-1.png "제목") 그리고 <img src="/assets/img/posts/my-post/b-2.jpg" width="300">\n\n![없음](upload:gone-9.png)');
  assert.deepEqual(r.files, [{ path: "assets/img/posts/my-post/a-1.png", base64: "QQ==" }, { path: "assets/img/posts/my-post/b-2.jpg", base64: "Qg==" }]);
  assert.deepEqual(r.missing, ["gone-9.png"]);
  assert.deepEqual(W.resolveUploads("이미지 없는 글 (upload 라는 낱말)", "p", []), { body: "이미지 없는 글 (upload 라는 낱말)", files: [], missing: [] });
});

test("올릴 파일 계획: 본문 이미지는 글과 같은 커밋에, 요약에는 이미지 문법이 들어가지 않는다", () => {
  const s = { title: "글", body: "첫 줄\n\n![그림](upload:pic-1.png)\n", slug: "with-image", description: "", categories: [], tags: [],
    series: { mode: "none" }, image: { mode: "none" }, uploads: [{ name: "pic-1.png", base64: "QUJD" }] };
  const plan = W.planFiles(s, { now: new Date("2026-11-21T16:30:05Z"), seriesList: [], seriesYaml: "" });
  assert.deepEqual(plan.files.map((f) => f.path), ["_posts/2026-11-22-with-image.md", "assets/img/posts/with-image/pic-1.png"]);
  assert.ok(plan.content.includes("![그림](/assets/img/posts/with-image/pic-1.png)") && !plan.content.includes("upload:"));
  assert.equal(W.summarize(s.body), "첫 줄");
});

test("검사: 본문이 가리키는 이미지가 브라우저에 없으면 막는다", () => {
  const s = { title: "제목", body: "본문", slug: "p", description: "", series: { mode: "none" }, image: { mode: "none" }, missingUploads: ["gone-9.png"] };
  const errors = W.validate(s, { seriesKeys: [], postUrls: [] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /gone-9\.png/);
  assert.deepEqual(W.validate({ ...s, missingUploads: [] }, { seriesKeys: [], postUrls: [] }), []);
});
