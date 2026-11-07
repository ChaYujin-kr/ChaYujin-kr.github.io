"""GTM 태그·트리거·변수 생성 및 게시, GA4 관리 설정. 이미 있는 항목은 건너뜀(여러 번 실행해도 안전).
사용법: python setup_google.py          (변경 내용만 출력)
        python setup_google.py --apply  (실제 반영)"""
import json, pathlib, sys
from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2.credentials import Credentials

APPLY = "--apply" in sys.argv
GTM_PUBLIC_ID, GA4_ID = "GTM-MJMC3GPS", "G-EEX290JCDV"
HERE = pathlib.Path(__file__).parent
TOKEN = pathlib.Path.home() / ".config/blog-google/token.json"

creds = Credentials.from_authorized_user_file(str(TOKEN))
if not creds.valid:
    creds.refresh(Request()); TOKEN.write_text(creds.to_json())
http = AuthorizedSession(creds)


def call(method, url, **kw):
    r = http.request(method, url, **kw)
    if r.status_code >= 400:
        raise SystemExit(f"{method} {url}\n→ {r.status_code} {r.text[:500]}")
    return r.json() if r.text else {}


def step(msg, fn=None):
    print(("✔ " if APPLY else "· ") + msg)
    return fn() if (APPLY and fn) else None


# ───────────────────────── GTM ─────────────────────────
GTM = "https://tagmanager.googleapis.com/tagmanager/v2"
spec = json.loads((HERE / "blog-container.json").read_text(encoding="utf-8"))["containerVersion"]

container = next((c for a in call("GET", f"{GTM}/accounts").get("account", [])
                  for c in call("GET", f"{GTM}/{a['path']}/containers").get("container", [])
                  if c["publicId"] == GTM_PUBLIC_ID), None) or sys.exit(f"{GTM_PUBLIC_ID} 컨테이너를 찾지 못함")
ws = call("GET", f"{GTM}/{container['path']}/workspaces")["workspace"][0]
W = f"{GTM}/{ws['path']}"
print(f"GTM {GTM_PUBLIC_ID} · 작업공간 '{ws['name']}'")

# 내보내기 형식(대문자) → API 형식(camelCase)
ENUM = {"CUSTOM_EVENT": "customEvent", "MATCH_REGEX": "matchRegex", "TEMPLATE": "template", "LIST": "list",
        "MAP": "map", "INTEGER": "integer", "BOOLEAN": "boolean"}
def api(obj):
    if isinstance(obj, list): return [api(x) for x in obj]
    if isinstance(obj, dict):
        return {k: (ENUM.get(v, v) if k == "type" and isinstance(v, str) else api(v))
                for k, v in obj.items() if k not in ("accountId", "containerId", "variableId", "triggerId", "tagId")}
    return obj

existing_vars = {v["name"] for v in call("GET", f"{W}/variables").get("variable", [])}
for v in spec["variable"]:
    if v["name"] in existing_vars: print("  (있음) 변수", v["name"]); continue
    step(f"변수 만들기: {v['name']}", lambda v=v: call("POST", f"{W}/variables", json=api(v)))

builtins = {b["type"] for b in call("GET", f"{W}/built_in_variables").get("builtInVariable", [])}
if "event" not in builtins:
    step("기본 제공 변수 켜기: Event", lambda: call("POST", f"{W}/built_in_variables", params={"type": "event"}))

trig_ids = {}
existing_trigs = {t["name"]: t["triggerId"] for t in call("GET", f"{W}/triggers").get("trigger", [])}
for t in spec["trigger"]:
    if t["name"] in existing_trigs:
        trig_ids[t["triggerId"]] = existing_trigs[t["name"]]; print("  (있음) 트리거", t["name"]); continue
    made = step(f"트리거 만들기: {t['name']}", lambda t=t: call("POST", f"{W}/triggers", json=api(t)))
    trig_ids[t["triggerId"]] = made["triggerId"] if made else "(새 ID)"

existing_tags = {t["name"] for t in call("GET", f"{W}/tags").get("tag", [])}
for t in spec["tag"]:
    if t["name"] in existing_tags: print("  (있음) 태그", t["name"]); continue
    body = api(t)
    body["firingTriggerId"] = [trig_ids.get(i, i) for i in t["firingTriggerId"]]   # 기본 제공 트리거 ID는 그대로
    step(f"태그 만들기: {t['name']}", lambda b=body: call("POST", f"{W}/tags", json=b))

if APPLY:
    status = call("GET", f"{W}/status")
    if status.get("workspaceChange"):
        ver = call("POST", f"{W}:create_version", json={"name": "블로그 GA4 연동", "notes": "setup_google.py"})
        if "compilerError" in ver: sys.exit(f"버전 생성 오류: {ver}")
        call("POST", f"{GTM}/{ver['containerVersion']['path']}:publish")
        print(f"✔ GTM 게시 완료 (버전 {ver['containerVersion']['containerVersionId']})")
    else:
        print("  GTM 변경 없음, 게시 생략")
else:
    print("· (변경 사항이 있으면) 새 버전 만들고 게시")

# ───────────────────────── GA4 ─────────────────────────
GA = "https://analyticsadmin.googleapis.com/v1beta"
GA_ALPHA = "https://analyticsadmin.googleapis.com/v1alpha"
prop, stream = None, None
for acc in call("GET", f"{GA}/accountSummaries").get("accountSummaries", []):
    for ps in acc.get("propertySummaries", []):
        for s in call("GET", f"{GA}/{ps['property']}/dataStreams").get("dataStreams", []):
            if s.get("webStreamData", {}).get("measurementId") == GA4_ID:
                prop, stream = ps["property"], s
if not prop: sys.exit(f"{GA4_ID} 데이터 스트림을 찾지 못함")
print(f"\nGA4 {GA4_ID} · {prop} · 스트림 '{stream.get('displayName')}'")

ret = call("GET", f"{GA}/{prop}/dataRetentionSettings")
if ret.get("eventDataRetention") != "FOURTEEN_MONTHS":
    step(f"데이터 보관 {ret.get('eventDataRetention')} → 14개월", lambda: call(
        "PATCH", f"{GA}/{prop}/dataRetentionSettings", params={"updateMask": "eventDataRetention"},
        json={"eventDataRetention": "FOURTEEN_MONTHS"}))
else:
    print("  (있음) 데이터 보관 14개월")

DIMS = {"content_series": "시리즈", "content_category": "카테고리", "content_tags": "태그", "page_type": "페이지 유형",
        "mode": "듣기 모드", "language": "언어", "result": "번역 결과", "code_language": "코드 언어"}
have = {d["parameterName"] for d in call("GET", f"{GA}/{prop}/customDimensions").get("customDimensions", [])}
for param, label in DIMS.items():
    if param in have: print("  (있음) 맞춤 측정기준", label); continue
    step(f"맞춤 측정기준: {label} ({param})", lambda p=param, l=label: call(
        "POST", f"{GA}/{prop}/customDimensions", json={"parameterName": p, "displayName": l, "scope": "EVENT"}))

keys = {k["eventName"] for k in call("GET", f"{GA}/{prop}/keyEvents").get("keyEvents", [])}
if "read_complete" not in keys:
    step("주요 이벤트: read_complete", lambda: call("POST", f"{GA}/{prop}/keyEvents",
                                                   json={"eventName": "read_complete", "countingMethod": "ONCE_PER_EVENT"}))
else:
    print("  (있음) 주요 이벤트 read_complete")

em_url = f"{GA_ALPHA}/{stream['name']}/enhancedMeasurementSettings"
em = call("GET", em_url)
want = {"streamEnabled": True, "scrollsEnabled": True, "outboundClicksEnabled": True, "fileDownloadsEnabled": True}
diff = {k: v for k, v in want.items() if em.get(k) != v}
if diff:
    step(f"향상된 측정 켜기: {', '.join(diff)}", lambda: call("PATCH", em_url, params={"updateMask": ",".join(diff)}, json=diff))
else:
    print("  (있음) 향상된 측정")

print("\n완료" if APPLY else "\n위 내용으로 반영하려면 --apply")
