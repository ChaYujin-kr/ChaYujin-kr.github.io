# GTM / GA4 설정

`_` 로 시작하는 폴더라 블로그에는 게시되지 않는다.

## 1. GTM 컨테이너 가져오기

1. Google 태그 관리자 → 관리 → **컨테이너 가져오기**
2. 파일: `blog-container.json` / 작업공간: 기존 / 옵션: **병합 → 충돌하는 항목 이름 바꾸기**
3. 변수 `GA4 측정 ID` 값을 GA4의 측정 ID(`G-`로 시작)로 바꾸기
4. **미리보기**로 블로그를 열고 이벤트가 잡히는지 확인 → **제출 → 게시**

가져오는 것

| 종류 | 이름 | 내용 |
|---|---|---|
| 태그 | GA4 - Google 태그 | 모든 페이지 초기화 시. 페이지 정보(page_type, content_series, content_category, content_tags) 함께 전송 |
| 태그 | GA4 - 블로그 맞춤 이벤트 | 아래 이벤트를 이름 그대로 GA4로 전송 |
| 트리거 | 블로그 맞춤 이벤트 | `read_complete`, `translate_select`, `tts_play`, `tts_rate_change`, `series_nav_toggle`, `code_copy`, `search`, `consent_update` |
| 변수 | dlv - * | 이벤트 파라미터 (mode, language, rate, result, open, code_language, search_term, analytics_consent) |

동의 모드 기본값(동의 전 `analytics_storage: denied`)은 블로그 코드(`_includes/metadata-hook.html`)에서 GTM보다 먼저 설정된다.

## 2. GA4 관리 설정

- **데이터 보관:** 관리 → 데이터 수집 및 수정 → 데이터 보관 → 이벤트 데이터 **14개월** (개인정보 처리방침과 일치)
- **향상된 측정:** 데이터 스트림 → 향상된 측정 켜기 (스크롤, 이탈 클릭, 파일 다운로드). 검색은 블로그가 `search` 이벤트를 직접 보낸다
- **맞춤 측정기준 등록** (관리 → 맞춤 정의, 범위: 이벤트)

  | 측정기준 이름 | 이벤트 파라미터 |
  |---|---|
  | 시리즈 | content_series |
  | 카테고리 | content_category |
  | 태그 | content_tags |
  | 페이지 유형 | page_type |
  | 듣기 모드 | mode |
  | 언어 | language |
  | 번역 결과 | result |
  | 코드 언어 | code_language |

- **주요 이벤트(전환):** `read_complete`
- **Search Console 연결:** 관리 → 제품 링크 → Search Console (사이트 소유권 확인은 `_config.yml` 의 `webmaster_verifications.google`)
- **BigQuery 연결 (선택):** 관리 → 제품 링크 → BigQuery, 일별 내보내기
