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
    { question: "질문", turnstile_token: "t", consent_logging: true, stream: true, page: "/posts/a/" });
  assert.equal(core.buildRequest("q", "t", false, "https://x").page, undefined);
});

test("interpret: 상태 코드별 화면 문구, 서버 문구가 이상하면 기본 문구", () => {
  assert.equal(core.interpret(200, { can_answer: true, answer: "답", answer_id: "id" }).kind, "answered");
  assert.equal(core.interpret(200, { can_answer: false }).kind, "none");
  assert.equal(core.interpret(200, { can_answer: false, answer_id: "id" }).answerId, "id");   // 못 찾은 답도 평가 가능
  assert.equal(core.interpret(429, { error: "질문이 너무 잦아요." }).kind, "limited");
  assert.equal(core.interpret(503, { error: "오늘은 쉬어요." }).text, "오늘은 쉬어요.");
  assert.match(core.interpret(500, { error: "x".repeat(500) }).text, /지금은 답할 수 없어요/);
  assert.equal(core.interpret(0, null).kind, "error");
  assert.equal(core.interpret(200, { can_answer: true, answer: "답", answer_id: 5 }).answerId, null);
});

test("cpLen·lenBucket: 이모지는 1글자", () => {
  assert.equal(core.cpLen("😀가"), 2);
  assert.deepEqual([10, 51, 150, 400].map(core.lenBucket), ["<=50", "<=100", "<=200", "<=500"]);
});

test("parseSSE: 조각이 잘려 와도 완성된 이벤트만, 깨진 건 버림", () => {
  const a = core.parseSSE('event: delta\ndata: {"text":"가"}\n\nevent: delta\ndata: {"te');
  assert.deepEqual(a.events, [{ event: "delta", data: { text: "가" } }]);
  const b = core.parseSSE(a.rest + 'xt":"가나"}\n\nevent: done\ndata: 깨짐\n\n');
  assert.deepEqual(b.events, [{ event: "delta", data: { text: "가나" } }]);
  assert.equal(b.rest, "");
});

test("formatSeconds: 10초 미만은 소수 한 자리", () => {
  assert.deepEqual([340, 3400, 12600].map(core.formatSeconds), ["0.3초", "3.4초", "13초"]);
});

test("이전 대화: 최근 3턴만, 답하지 못한 턴은 답 비움, 길이 자름, 없으면 history 키 자체를 안 보냄", () => {
  const h = [{ q: "1", kind: "answered", text: "a" }, { q: "2", kind: "none", text: "못 찾음" },
             { q: "3", kind: "answered", text: "가".repeat(700) }, { q: "4", kind: "error", text: "오류" }];
  const t = core.recentTurns(h);
  assert.deepEqual(t.map((x) => x.q), ["2", "3", "4"]);
  assert.equal(t[0].a, "");
  assert.equal(t[1].a.length, 600);
  assert.equal(t[2].a, "");
  assert.equal("history" in core.buildRequest("q", "t", false, "/"), false);
  assert.equal(core.buildRequest("q", "t", false, "/", h).history.length, 3);
});

test("답 서식: 문단·목록·굵게·코드만, 링크 문법은 글자 그대로", () => {
  const b = core.parseRich("첫 줄 **중요** `x=1`\n\n- 하나\n- 둘\n1. 셋\n```\nprint(1)\n```\n[a](http://e)");
  assert.deepEqual(b.map((x) => x.type), ["p", "list", "list", "code", "p"]);
  assert.deepEqual(b[0].inlines.map((x) => x.t), ["text", "b", "text", "code"]);
  assert.equal(b[1].items.length, 2);
  assert.equal(b[2].ordered, true);
  assert.equal(b[3].text, "print(1)");
  assert.deepEqual(b[4].inlines, [{ t: "text", v: "[a](http://e)" }]);
  assert.deepEqual(core.parseRich(""), []);
});

test("입력 목록: '- ' → '• ', Shift+Enter로 이어 쓰기(번호 +1), 빈 항목에서 목록 끝", () => {
  assert.deepEqual(core.autoBullet("- ", 2), { value: "• ", caret: 2 });
  assert.deepEqual(core.autoBullet("a\n  * ", 6), { value: "a\n  • ", caret: 6 });
  assert.equal(core.autoBullet("a - ", 4), null);               // 줄 중간의 - 는 그대로
  assert.deepEqual(core.continueList("• 하나", 4), { value: "• 하나\n• ", caret: 7 });
  assert.deepEqual(core.continueList("2. 둘", 4), { value: "2. 둘\n3. ", caret: 8 });
  assert.deepEqual(core.continueList("x\n• ", 4), { value: "x\n", caret: 2 });
  assert.equal(core.continueList("그냥 문장", 5), null);
});

test("buildFeedback: 의견이 비면 null, 1000자로 자름, 평가는 1/-1만", () => {
  assert.deepEqual(core.buildFeedback("id", 1, null, "2026-11-12T00:00:00.000Z"),
                   { answer_id: "id", rating: 1, comment: null, entered_at: "2026-11-12T00:00:00.000Z" });
  assert.equal(core.buildFeedback("id", -1, "   ", null).comment, null);
  assert.equal(core.buildFeedback("id", -1, "  좋아요 ", null).comment, "좋아요");
  assert.equal(Array.from(core.buildFeedback("id", 1, "가".repeat(1500), null).comment).length, core.FB_MAX);
  assert.equal(core.buildFeedback("id", 5, "x", 7).rating, -1);
  assert.equal(core.buildFeedback("id", 1, "x", 7).entered_at, null);
  // 수정: 글은 의견이 아니라 수정 사유로, 처음 의견을 덮지 않게 comment는 null
  assert.deepEqual(core.buildFeedback("id", 1, " 다시 보니 맞아요 ", null, true),
                   { answer_id: "id", rating: 1, comment: null, entered_at: null, edited: true, edit_reason: "다시 보니 맞아요" });
  assert.equal(core.buildFeedback("id", -1, null, null, true).edit_reason, null);
  assert.equal("edited" in core.buildFeedback("id", 1, "x", null), false);
});
