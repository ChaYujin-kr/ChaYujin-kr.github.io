# 외부 라이브러리 (직접 호스팅)

글쓰기 화면(`/write/`)의 미리보기에만 쓴다. 토큰을 다루는 화면이라 실행 중에 외부 CDN에서 받지 않고 저장소에 고정해 둔다.

| 파일 | 패키지 | 버전 | 라이선스 | sha256 |
|---|---|---|---|---|
| marked.min.js | marked | 12.0.2 | MIT | 15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894 |
| purify.min.js | dompurify | 3.2.6 | MPL-2.0 OR Apache-2.0 | 89e1fa7647cb495370d3a997ace4387f5d15d9f4c5af12352c53daa400956287 |

받은 곳: `https://cdn.jsdelivr.net/npm/<패키지>@<버전>/…` (npm 배포본 그대로). 올릴 때는 버전과 해시를 이 표에 함께 고친다.
