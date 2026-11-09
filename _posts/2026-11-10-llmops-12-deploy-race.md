---
title: "LLMOps 구축기 12. [유지보수] 블로그가 원본 파일로 보였다"
date: 2026-11-10 00:13:00 +0900
categories: [LLMOps, 구축기]
tags: [llmops, github-pages, github-actions, 캐시, 배포]
description: "배포가 두 개 경쟁하던 문제와, 고친 코드가 화면에 안 나오던 브라우저 캐시 문제"
series: llmops-assistant
series_title: "LLMOps 구축기"
---

{% include series-nav.html %}

> **요약** 푸시 한 번에 배포가 두 개 돌고 있었다. 그동안은 운 좋게 맞는 쪽이 늦게 끝났을 뿐이다.
{: .prompt-tip }

## 문제 1: 블로그가 깨졌다

어느 날 홈 화면에 `--- layout: home ---` 같은 글자가 그대로 보이고, 글 주소는 전부 404였다. 바꾼 건 CSS·JS 몇 줄뿐이었다.

## 원인 찾기

GitHub API로 그 커밋에 무슨 배포가 돌았는지 봤다(공개 저장소라 로그인 없이 된다).

```bash
curl -s "https://api.github.com/repos/<계정>/<저장소>/actions/runs?per_page=4"
curl -s "https://api.github.com/repos/<계정>/<저장소>/actions/runs/<실행ID>/jobs"
```

| 배포 | 하는 일 | 끝난 시각 |
|---|---|---|
| Build and Deploy (우리 워크플로) | Jekyll로 빌드해 배포 | 17:03:53 |
| pages build and deployment (GitHub 기본) | 저장소 파일을 **그대로** 배포 | **17:03:55** |

Pages 설정이 "브랜치에서 배포"로 남아 있어서, 푸시마다 GitHub 기본 배포도 같이 돌았다. 저장소의 `.nojekyll` 파일 때문에 기본 배포는 변환 없이 원본을 올린다. **2초 늦게 끝난 쪽이 덮어썼다.**

## 해결

Settings → Pages → Source를 **GitHub Actions**로 바꿨다. 이후 푸시마다 배포는 하나만 돈다.

## 문제 2: 고쳤는데 화면이 그대로다

다크/라이트 버튼을 상단 바에서 사이드바로 옮겼는데, 방문자 화면에는 여전히 상단 바에 있었다. 브라우저가 **예전 JS 파일을 저장(캐시)해 두고** 그걸 실행하고 있었다. 파일 이름이 같으니 새 파일인지 알 방법이 없다.

## 해결

CSS·JS 주소 뒤에 빌드 시각을 붙였다.

{% raw %}
```liquid
<script src="{{ '/assets/js/ask.js' | relative_url }}?v={{ site.time | date: '%s' }}" defer></script>
```
{% endraw %}

배포할 때마다 주소가 바뀌니 브라우저가 새로 받는다.

## 정리

- "그동안 됐다"는 "맞다"가 아니다. 경쟁 조건은 순서가 바뀌는 날 터진다.
- 화면이 안 바뀌면 코드보다 **캐시**를 먼저 의심한다. 정적 파일에는 버전을 붙인다.
- 원인은 추측보다 기록(실행 목록, 완료 시각)에서 찾는다.
