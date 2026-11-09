"""블로그 AI용 블록 DB 생성: 빌드된 _site의 글 HTML을 ## 제목 단위 블록으로 쪼갠다.

- 실행: python3 tools/build_blocks.py _site   (Jekyll 빌드 뒤, 배포 워크플로가 실행)
- 출력: _site/assets/data/blocks.json  → 게이트웨이(ask-worker)가 읽어 검색한다.
- 블록 id는 빌드된 HTML의 h2 id를 그대로 쓴다(블로그 앵커와 항상 일치).
- 요약은 블록 본문 앞 SUMMARY_CHARS 글자를 그대로 자른 것(LLM 안 씀).
- 표준 라이브러리만 사용(의존성 없음).
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

SUMMARY_CHARS = 100
SKIP_TAGS = {"script", "style", "noscript", "svg", "button"}
SKIP_CLASSES = ("series-nav", "rouge-gutter", "code-header", "post-tail")
VOID = {"br", "img", "hr", "input", "meta", "link", "source", "wbr", "col", "area", "embed", "param", "track"}
BLOCK_TAGS = {"p", "li", "pre", "tr", "h1", "h2", "h3", "h4", "h5", "blockquote", "div", "table", "br"}


class ContentParser(HTMLParser):
    """글 본문 HTML 조각의 글자를 h2마다 나눠 모은다.
    빌드된 HTML은 압축돼 </li> 같은 닫는 태그가 생략되므로 깊이를 세지 않는다.
    건너뛸 요소는 그 태그 이름의 열고 닫힘만 센다."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip_tag: str | None = None
        self.skip_n = 0
        self.in_h2 = False
        self.sections: list[dict] = [{"id": "", "heading": "(도입)", "buf": []}]

    def handle_starttag(self, tag, attrs):
        if self.skip_tag == "td" and tag in ("td", "th"):
            self.skip_tag = None          # </td>가 생략된 칸: 다음 칸이 시작되면 건너뛰기 끝
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_n += 1
            return
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag in SKIP_TAGS or any(c in cls for c in SKIP_CLASSES):
            if tag not in VOID:
                self.skip_tag, self.skip_n = tag, 1
            return
        if tag == "h2" and a.get("id"):
            self.sections.append({"id": a["id"], "heading": "", "buf": []})
            self.in_h2 = True
        elif tag in BLOCK_TAGS or tag in VOID:
            self.sections[-1]["buf"].append("\n")
        elif tag == "td":
            self.sections[-1]["buf"].append(" | ")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.skip_tag == "td" and tag in ("tr", "table", "tbody"):
            self.skip_tag = None
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_n -= 1
                if self.skip_n == 0:
                    self.skip_tag = None
            return
        if tag == "h2" and self.in_h2:
            self.in_h2 = False
        elif tag in BLOCK_TAGS:
            self.sections[-1]["buf"].append("\n")

    def handle_data(self, data):
        if self.skip_tag:
            return
        if self.in_h2:
            self.sections[-1]["heading"] += data
        else:
            self.sections[-1]["buf"].append(data)


def content_html(html: str) -> str:
    """Chirpy 글 페이지에서 본문(<div class="content"> ~ 글 꼬리 앞)만 잘라 낸다."""
    start = html.find('<div class="content">')
    if start < 0:
        return ""
    end = html.find('<div class="post-tail-wrapper', start)
    return html[start + len('<div class="content">'): end if end > 0 else len(html)]


def clean(text: str) -> str:
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{2,}", "\n", text).strip()


def meta_description(html: str) -> str:
    m = re.search(r'<meta name="description" content="([^"]*)"', html)
    return m.group(1) if m else ""


def build(site: Path) -> dict:
    index = json.loads((site / "assets/data/posts.json").read_text(encoding="utf-8"))
    posts = []
    for p in index:
        page = site / p["url"].strip("/") / "index.html"
        if not page.exists():
            continue
        html = page.read_text(encoding="utf-8")
        parser = ContentParser()
        parser.feed(content_html(html))
        sections = []
        for s in parser.sections:
            text = clean("".join(s["buf"]))
            if not text:
                continue
            heading = clean(s["heading"]) or "(도입)"
            sections.append({"id": s["id"], "heading": heading,
                             "summary": text.replace("\n", " ")[:SUMMARY_CHARS], "text": text})
        if sections:
            posts.append({"slug": p["url"].strip("/").split("/")[-1], "url": p["url"], "title": p["title"],
                          "description": meta_description(html), "tags": p.get("tags") or [],
                          "date": p.get("date", ""), "sections": sections})
    return {"version": 1, "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "posts": posts}


if __name__ == "__main__":
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
    db = build(site)
    out = site / "assets/data/blocks.json"
    out.write_text(json.dumps(db, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(p["sections"]) for p in db["posts"])
    print(f"blocks.json: 글 {len(db['posts'])}편, 블록 {n}개, {out.stat().st_size:,} bytes")
