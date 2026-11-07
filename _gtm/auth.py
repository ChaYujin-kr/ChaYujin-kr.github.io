"""Google 계정 로그인 (1회). 토큰은 ~/.config/blog-google/token.json (권한 600, 저장소 밖)에 저장.
사용법: python auth.py <내려받은 OAuth 클라이언트 JSON 경로>"""
import os, sys, pathlib
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/tagmanager.edit.containers",
    "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
    "https://www.googleapis.com/auth/tagmanager.publish",
    "https://www.googleapis.com/auth/analytics.edit",
]
TOKEN = pathlib.Path.home() / ".config/blog-google/token.json"

flow = InstalledAppFlow.from_client_secrets_file(sys.argv[1], SCOPES)
# WSL: 브라우저를 자동으로 못 열 수 있어 주소를 출력. Windows 브라우저에서 열면 localhost로 돌아옴
creds = flow.run_local_server(port=8765, open_browser=False,
                              authorization_prompt_message="이 주소를 브라우저에서 열어 로그인하세요:\n{url}\n")
TOKEN.write_text(creds.to_json())
os.chmod(TOKEN, 0o600)
print("로그인 완료 →", TOKEN)
