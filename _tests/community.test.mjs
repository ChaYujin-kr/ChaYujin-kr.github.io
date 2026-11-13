import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const core = createRequire(import.meta.url)("../assets/js/community.js");

test("slugOf: 글 주소만, 서버와 같은 규칙", () => {
  assert.equal(core.slugOf("/posts/mlops-drift-00-intro/"), "mlops-drift-00-intro");
  assert.equal(core.slugOf("/posts/abc"), "abc");
  assert.equal(core.slugOf("/posts/한글/"), null);
  assert.equal(core.slugOf("/posts/a/b/"), null);
  assert.equal(core.slugOf("/about/"), null);
  assert.equal(core.slugOf("/posts/../x/"), null);
});

test("relTime: 방금·분·시간·일, 일주일 뒤는 한국 날짜", () => {
  const now = Date.UTC(2026, 10, 12, 0, 0, 0);
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(core.relTime(ago(5), now), "방금");
  assert.equal(core.relTime(ago(300), now), "5분 전");
  assert.equal(core.relTime(ago(3 * 3600), now), "3시간 전");
  assert.equal(core.relTime(ago(2 * 86400), now), "2일 전");
  assert.equal(core.relTime("2026-10-31T16:00:00.000Z", now), "2026.11.01");   // 한국 시간으로는 다음 날
  assert.equal(core.relTime("어제", now), "");
  assert.equal(core.relTime(new Date(now + 60000).toISOString(), now), "방금");   // 시계가 조금 달라도
});

test("toTree: 답글은 부모 밑으로, 부모 없는 답글은 버림, 지워진 자리는 수에서 뺌", () => {
  const { tops, count } = core.toTree([
    { id: "a", parent_id: null, deleted: true }, { id: "b", parent_id: "a" }, { id: "c", parent_id: null },
    { id: "d", parent_id: "zzz" }, null, { parent_id: null },
  ]);
  assert.deepEqual(tops.map((t) => [t.id, t.replies.map((r) => r.id)]), [["a", ["b"]], ["c", []]]);
  assert.equal(count, 2);
  assert.deepEqual(core.toTree(undefined), { tops: [], count: 0 });
});

test("readSession: 형식이 맞고 기한이 1분 넘게 남은 것만", () => {
  const now = 1_800_000_000_000;
  const ok = JSON.stringify({ token: "t", exp: now / 1000 + 3600, name: "홍", admin: true });
  assert.deepEqual(core.readSession(ok, now), { token: "t", exp: now / 1000 + 3600, name: "홍", admin: true });
  assert.equal(core.readSession(JSON.stringify({ token: "t", exp: now / 1000 + 30 }), now), null);
  assert.equal(core.readSession("{깨짐", now), null);
  assert.equal(core.readSession(null, now), null);
  assert.equal(core.readSession(JSON.stringify({ token: "t", exp: now / 1000 + 3600, admin: "yes" }), now).admin, false);
});
