import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const T = createRequire(import.meta.url)("../assets/js/site-tools.js");

test("번역 제안: 한국어 브라우저·저장된 선택·거절 기록이 있으면 안 함", () => {
  assert.equal(T.suggestLang(["ko-KR", "en"], null, null), null);
  assert.equal(T.suggestLang(["en-US"], "ko", null), null);
  assert.equal(T.suggestLang(["en-US"], null, "1"), null);
  assert.equal(T.suggestLang([], null, null), null);
});

test("번역 제안: 지원 언어는 그대로, 그 밖은 영어", () => {
  assert.equal(T.suggestLang(["ja-JP"], null, null), "ja");
  assert.equal(T.suggestLang(["zh-TW"], null, null), "zh");
  assert.equal(T.suggestLang(["en-GB"], null, null), "en");
  assert.equal(T.suggestLang(["fr-FR"], null, null), "en");
});
