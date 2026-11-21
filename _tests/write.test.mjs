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
