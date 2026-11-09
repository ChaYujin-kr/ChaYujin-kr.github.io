"""구성도 SVG 생성. 로고: Simple Icons 13.21.0 (CC0), 상표는 각 회사 소유."""
import re, sys, pathlib, html
ICONS = pathlib.Path(sys.argv[1]); OUT = pathlib.Path(sys.argv[2])
COL = {"cloudflare":"#F38020","cloudflareworkers":"#F38020","openai":"#111111","github":"#181717","githubpages":"#222222",
       "githubactions":"#2088FF","jekyll":"#CC0000","sqlite":"#003B57","typescript":"#3178C6","python":"#3776AB"}
def icon(name, x, y, s=26):
    d = re.search(r' d="([^"]+)"', (ICONS/f"{name}.svg").read_text()).group(1)
    return f'<g transform="translate({x},{y}) scale({s/24})"><path d="{d}" fill="{COL[name]}"/></g>'
FONT = "Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
def box(x, y, w, h, title, lines=(), ic=None, accent="#d9d4c7"):
    t = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#ffffff" stroke="{accent}" stroke-width="1.6"/>']
    tx = x + 14
    if ic: t.append(icon(ic, x + 12, y + 12)); tx = x + 46
    t.append(f'<text x="{tx}" y="{y+31}" font-size="15" font-weight="700" fill="#1f1d1a">{html.escape(title)}</text>')
    for i, l in enumerate(lines):
        t.append(f'<text x="{x+14}" y="{y+56+i*19}" font-size="12.5" fill="#55504a">{html.escape(l)}</text>')
    return "\n".join(t)
def arrow(pts, label=None, lx=None, ly=None, dash=False, both=False, color="#4a4640"):
    p = " ".join(f"{a},{b}" for a, b in pts)
    s = [f'<polyline points="{p}" fill="none" stroke="{color}" stroke-width="2"{" stroke-dasharray=\"5 4\"" if dash else ""} marker-end="url(#ah)"{" marker-start=\"url(#ah)\"" if both else ""}/>']
    if label:
        w = 6.6 * len(label) + 12
        s.append(f'<rect x="{lx - w/2}" y="{ly-13}" width="{w}" height="18" rx="4" fill="#faf8f3"/>')
        s.append(f'<text x="{lx}" y="{ly}" font-size="12" text-anchor="middle" fill="#3d3a35">{html.escape(label)}</text>')
    return "\n".join(s)
def svg(w, h, title, desc, body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="{FONT}" role="img" aria-labelledby="t d">
<title id="t">{title}</title><desc id="d">{desc}</desc>
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4a4640"/></marker></defs>
<rect width="{w}" height="{h}" rx="16" fill="#faf8f3"/>
{body}
</svg>
'''
def group(x, y, w, h, title, ic, color):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{color}" fill-opacity=".07" stroke="{color}" stroke-dasharray="7 5" stroke-width="1.5"/>'
            + icon(ic, x + 14, y + 10, 30) + f'<text x="{x+52}" y="{y+32}" font-size="16" font-weight="700" fill="#1f1d1a">{title}</text>')

# ── 1. 실행 구조 ──
b = []
b.append('<text x="30" y="44" font-size="22" font-weight="700" fill="#1f1d1a">Blog AI Assistant · Runtime Architecture</text>')
b.append('<text x="30" y="68" font-size="13" fill="#6b655b">Least privilege per box · one question flows ① → ⑤</text>')
b.append(box(30, 230, 210, 150, "Blog", ["GitHub Pages · Jekyll", "Chat panel (ask.js)", "Renders plain text only"], "github"))
b.append(group(275, 92, 640, 520, "Cloudflare (Free plan)", "cloudflare", "#F38020"))
b.append(box(300, 145, 190, 78, "Turnstile", ["Human check (bot block)"], "cloudflare", "#f4b77d"))
b.append(box(300, 255, 300, 130, "ask-worker", ["Origin · token · rate checks", "PII masking · output guard", "Holds: OpenAI key (no DB access)"], "cloudflareworkers", "#f4b77d"))
b.append(box(650, 255, 240, 84, "Durable Object", ["5/IP per 10 min · 60/day total"], "cloudflareworkers", "#f4b77d"))
b.append(box(300, 440, 205, 100, "log-worker", ["Re-mask · 90-day retention", "No public URL"], "cloudflareworkers", "#f4b77d"))
b.append(box(530, 440, 160, 100, "D1", ["Q&A log (SQLite)", "Daily stats"], "sqlite", "#9fb3c2"))
b.append(box(715, 440, 175, 76, "report-worker", ["Ops dashboard (read-only)"], "cloudflareworkers", "#f4b77d"))
b.append(box(715, 538, 175, 52, "Access login", [], "cloudflare", "#f4b77d"))
b.append(box(955, 255, 215, 130, "OpenAI", ["gpt-5.4-mini (pinned snapshot)", "Dedicated project", "Prepaid · auto-reload off"], "openai"))
b.append(box(955, 520, 215, 78, "Operator", ["Views dashboard in browser"]))
b.append(arrow([(240, 262), (270, 262), (270, 184), (296, 184)], "token", 254, 225, dash=True))
b.append(arrow([(240, 300), (296, 300)], "① question", 268, 292))
b.append(arrow([(296, 350), (244, 350)], "⑤ answer + citations", 262, 374))
b.append(arrow([(395, 255), (395, 227)], "② verify", 430, 246))
b.append(arrow([(600, 297), (646, 297)], both=True))
b.append(arrow([(600, 360), (951, 360)], "③ question + full blog   ④ stream", 775, 352, both=True))
b.append(arrow([(400, 385), (400, 436)], "log (service binding)", 470, 416))
b.append(arrow([(505, 490), (526, 490)]))
b.append(arrow([(690, 478), (711, 478)]))
b.append(arrow([(955, 564), (894, 564)]))
b.append(arrow([(802, 538), (802, 520)]))
(OUT/"llmops-arch.svg").write_text(svg(1200, 640, "Blog AI Assistant runtime architecture",
  "The blog chat panel sends a question with a Turnstile token to the Cloudflare ask-worker, which applies rate limits and guards, calls OpenAI and streams the answer back. Logs go through log-worker into D1, and the report-worker dashboard opens only behind Access login.",
  "\n".join(b)), encoding="utf-8")

# ── 2. 개발·배포 파이프라인 ──
b = []
b.append('<text x="30" y="44" font-size="22" font-weight="700" fill="#1f1d1a">Build &amp; Deploy Pipeline</text>')
b.append('<text x="30" y="68" font-size="13" fill="#6b655b">Only scanned code ships · paid quality checks run manually</text>')
b.append('<text x="30" y="112" font-size="13" font-weight="700" fill="#7a5f37">Blog</text>')
b.append(box(30, 125, 200, 84, "Write posts", ["Markdown · Jekyll"], "jekyll"))
b.append(box(275, 125, 200, 84, "GitHub repo", ["Push to main"], "github"))
b.append(box(520, 125, 220, 84, "GitHub Actions", ["Build (SHA-pinned actions)"], "githubactions"))
b.append(box(785, 125, 200, 84, "GitHub Pages", ["Public blog"], "github"))
for x1, x2 in ((230, 271), (475, 516), (740, 781)): b.append(arrow([(x1, 167), (x2, 167)]))
b.append('<text x="30" y="262" font-size="13" font-weight="700" fill="#7a5f37">Gateway</text>')
b.append(box(30, 275, 200, 100, "Corpus & eval", ["Posts → section-id JSON", "Guards · golden set (Python)"], "python"))
b.append(box(275, 275, 200, 100, "Gateway code", ["Workers (TypeScript)", "Shared tests with Python"], "typescript"))
b.append(box(520, 275, 220, 100, "CI scans", ["gitleaks · osv-scanner", "semgrep · zizmor · SBOM"], "githubactions"))
b.append(box(785, 275, 200, 100, "wrangler deploy", ["Local · scoped API token", "(Workers + D1 only)"], "cloudflareworkers"))
b.append(box(1025, 275, 150, 100, "Cloudflare", ["3 Workers", "D1"], "cloudflare"))
for x1, x2 in ((230, 271), (475, 516), (740, 781), (985, 1021)): b.append(arrow([(x1, 325), (x2, 325)]))
b.append(arrow([(130, 209), (130, 271)], "rebuild corpus on post change", 230, 244, dash=True))
b.append(box(520, 410, 220, 84, "Quality regression", ["Golden set · manual run"], "openai"))
b.append(arrow([(630, 375), (630, 406)], "on demand", 676, 396, dash=True))
(OUT/"llmops-pipeline.svg").write_text(svg(1200, 520, "Build and deploy pipeline",
  "The blog is built by GitHub Actions and published to GitHub Pages. The gateway corpus and evaluation are built in Python, the TypeScript Workers code passes CI scans (gitleaks, osv-scanner, semgrep, zizmor, SBOM), and is deployed with wrangler using a scoped token. Quality regression runs manually.",
  "\n".join(b)), encoding="utf-8")

# ── 다크 모드 판: 라이트 색을 1:1로 바꿔 끼운다 (블로그 다크 배경 #1b1b1e에 맞춤) ──
DARK = {
    "#faf8f3": "#202024",   # 캔버스·라벨 배경
    "#ffffff": "#2a2a2f",   # 상자
    "#1f1d1a": "#ece8df",   # 제목
    "#55504a": "#b9b3a7",   # 본문
    "#6b655b": "#9b958a",   # 부제
    "#4a4640": "#c9c2b4",   # 화살표
    "#3d3a35": "#d6d0c4",   # 화살표 라벨
    "#d9d4c7": "#45423c",   # 기본 테두리
    "#f4b77d": "#a8622a",   # Cloudflare 상자 테두리
    "#9fb3c2": "#4e6676",   # D1 테두리
    "#7a5f37": "#c9b48a",   # 레인 이름
    "#111111": "#ececec",   # OpenAI 로고
    "#181717": "#ececec",   # GitHub 로고
    "#003B57": "#6fa8cc",   # SQLite 로고
    "#CC0000": "#ff6b6b",   # Jekyll 로고
    "#3776AB": "#5a9bd5",   # Python 로고
    "#3178C6": "#4d94e0",   # TypeScript 로고
}
for name in ("llmops-arch", "llmops-pipeline"):
    t = (OUT / f"{name}.svg").read_text(encoding="utf-8")
    for a, b in DARK.items():
        t = t.replace(a, b)
    (OUT / f"{name}-dark.svg").write_text(t, encoding="utf-8")
