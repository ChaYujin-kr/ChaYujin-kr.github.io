// assets/js/ask.js 순수 함수 테스트. 실행: node --test _tests/  (의존성 없음, Jekyll 빌드에서 제외되는 폴더)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const core = createRequire(import.meta.url)("../assets/js/ask.js");
const SITE = "https://chayujin-kr.github.io";

test("safeLinks: 블로그 글 주소만 통과", () => {
  const links = [
    { url: `${SITE}/posts/a/#%EA%B2%B0`, title: "글", heading: "결" },
    { url: "https://evil.example/posts/a/", title: "x" },
    { url: "javascript:alert(1)", title: "x" },
    { url: `${SITE}/privacy/`, title: "x" },
    { url: "//evil.example/posts/a/", title: "x" },
    { url: `${SITE}.evil.example/posts/a/`, title: "x" },
    { url: 123 }, null, "string",
  ];
  assert.deepEqual(core.safeLinks(links, SITE).map((l) => l.url), [`${SITE}/posts/a/#%EA%B2%B0`]);
  assert.deepEqual(core.safeLinks("nope", SITE), []);
  assert.equal(core.safeLinks(Array(9).fill(links[0]), SITE).length, 5);
});

test("readConsent: ai_logging === true일 때만, 저장소 오류는 거부로", () => {
  const st = (v) => ({ getItem: () => v });
  assert.equal(core.readConsent(st(JSON.stringify({ analytics: true, ai_logging: true }))), true);
  assert.equal(core.readConsent(st(JSON.stringify({ analytics: true, ai_logging: false }))), false);
  assert.equal(core.readConsent(st(JSON.stringify({ ai_logging: "true" }))), false);
  assert.equal(core.readConsent(st(null)), false);
  assert.equal(core.readConsent(st("{깨짐")), false);
  assert.equal(core.readConsent({ getItem: () => { throw new Error("blocked"); } }), false);
});

test("buildRequest: 앞뒤 공백 제거, page는 경로만", () => {
  assert.deepEqual(core.buildRequest("  질문  ", "t", true, "/posts/a/"),
    { question: "질문", turnstile_token: "t", consent_logging: true, page: "/posts/a/" });
  assert.equal(core.buildRequest("q", "t", false, "https://x").page, undefined);
});

test("interpret: 상태 코드별 화면 문구, 서버 문구가 이상하면 기본 문구", () => {
  assert.equal(core.interpret(200, { can_answer: true, answer: "답", answer_id: "id" }).kind, "answered");
  assert.equal(core.interpret(200, { can_answer: false }).kind, "no_answer");
  assert.equal(core.interpret(429, { error: "질문이 너무 잦아요." }).kind, "limited");
  assert.equal(core.interpret(503, { error: "오늘은 쉬어요." }).text, "오늘은 쉬어요.");
  assert.match(core.interpret(500, { error: "x".repeat(500) }).text, /지금은 답변할 수 없어요/);
  assert.equal(core.interpret(0, null).kind, "error");
  assert.equal(core.interpret(200, { can_answer: true, answer: "답", answer_id: 5 }).answerId, null);
});

test("cpLen·lenBucket: 이모지는 1글자", () => {
  assert.equal(core.cpLen("😀가"), 2);
  assert.deepEqual([10, 51, 150, 400].map(core.lenBucket), ["<=50", "<=100", "<=200", "<=500"]);
});
