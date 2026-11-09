import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const R = createRequire(import.meta.url)("../assets/js/recommend.js");
const P = [
  { url: "/posts/s-00/", title: "0편", series: "s", tags: ["intro"], date: "2026-11-08T01:00" },
  { url: "/posts/s-01/", title: "1편", series: "s", tags: ["drift"], date: "2026-11-08T01:05" },
  { url: "/posts/s-02/", title: "2편", series: "s", tags: ["drift", "psi"], date: "2026-11-08T01:10" },
  { url: "/posts/note/", title: "노트", series: "", tags: ["drift", "docker"], date: "2026-10-31T22:00" },
  { url: "/posts/other/", title: "다른 글", series: "", tags: ["k8s"], date: "2026-10-01T00:00" },
];

test("기본은 시리즈 다음 편", () => {
  const r = R.recommend(P, "/posts/s-01/", {});
  assert.equal(r.primary.post.url, "/posts/s-02/");
  assert.equal(r.primary.reason, "시리즈 다음 편");
});

test("주소의 # · ? · 끝 슬래시 차이는 무시", () => {
  assert.equal(R.recommend(P, "/posts/s-01", {}).primary.post.url, "/posts/s-02/");
  assert.equal(R.recommend(P, "/posts/s-01/?x=1#a", {}).primary.post.url, "/posts/s-02/");
});

test("시리즈 마지막 편이면 점수 1등이 primary, 지금 글·다음 편 중복 없음", () => {
  const r = R.recommend(P, "/posts/s-02/", {});
  assert.notEqual(r.primary.post.url, "/posts/s-02/");
  const urls = [r.primary.post.url, ...r.more.map((m) => m.post.url)];
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(!urls.includes("/posts/s-02/"));
});

test("읽은 글은 뒤로 밀림", () => {
  const fresh = R.recommend(P, "/posts/note/", {});
  const read = R.recommend(P, "/posts/note/", { [fresh.primary.post.url]: 1 });
  assert.notEqual(read.primary.post.url, fresh.primary.post.url);
});

test("관련 없는 글(점수 0)은 more에 넣지 않고 최대 2개", () => {
  const r = R.recommend(P, "/posts/s-00/", { "/posts/s-02/": 1, "/posts/note/": 1, "/posts/other/": 1 });
  assert.ok(r.more.length <= 2);
});

test("없는 글이면 추천 없음", () => {
  assert.deepEqual(R.recommend(P, "/posts/none/", {}), { primary: null, more: [] });
});

test("기록은 최근 200개만", () => {
  let h = {};
  for (let i = 0; i < 230; i++) h = R.remember(h, `/posts/p${i}/`, i);
  assert.equal(Object.keys(h).length, 200);
  assert.ok("/posts/p229/" in h && !("/posts/p0/" in h));
});
