---
title: "2023년 코드가 2026년에 깨지는 이유: 3장 실습 트러블슈팅"
date: 2026-10-31 22:00:00 +0900
categories: [MLOps, 실습 노트]
tags: [docker, kubernetes, helm, dependency, reproducibility]
---

《Design a Machine Learning System (From Scratch)》 3장은 FastAPI 앱을 Docker, Kubernetes, Helm, GitLab CI까지 올리는 실습이다. 코드는 그대로인데 거의 모든 단계에서 막혔다. 원인은 대부분 하나였다. **2023년에 고정해 둔 것들이 2026년에는 사라졌거나 바뀌어 있었다.**

## 깨진 지점

| 단계 | 증상 | 원인 | 해결 |
|---|---|---|---|
| 로컬 실행 | 설치 실패 | 고정된 numpy 1.25, pydantic 1.10이 시스템 Python 3.14를 지원하지 않음 | `uv`로 Python 3.10 설치 |
| 테스트 | `Client.__init__() got an unexpected keyword argument 'app'` | **고정 안 한** httpx가 최신(0.28)으로 깔려 starlette 0.27과 충돌 | `httpx<0.28` 고정 |
| Docker 빌드 | `apt-get update` 404 | 베이스 이미지 `python:3.10-slim-buster`의 Debian 저장소 종료 | `slim-bookworm`으로 교체 |
| Helm | Redis `ErrImagePull` | `bitnami/redis` 해당 태그가 Docker Hub에서 삭제됨 | `bitnamilegacy/redis`로 저장소 변경 |
| HPA | 적용 안 됨 | 삭제된 `autoscaling/v2beta1` API 사용 | (비활성 상태라 영향 없음) |

## 두 가지 방향의 실패

재미있는 건 실패의 방향이 반대라는 점이다.

- **고정해서 깨진 것:** numpy, pydantic, 베이스 이미지, Redis 태그. 고정한 버전이 세상에서 사라졌다.
- **고정 안 해서 깨진 것:** httpx. 나머지는 2023년에 멈춰 있는데 혼자 2026년 버전이 깔렸다.

결국 "고정하느냐 마느냐"보다 **함께 움직여야 하는 것들이 같은 시점에 묶여 있느냐**가 문제다. 일부만 고정하면 고정된 쪽과 안 된 쪽 사이가 벌어진다.

## 버그처럼 보였지만 정상이었던 것

| 증상 | 실제 |
|---|---|
| `ubuntu` 파드가 `CrashLoopBackOff` | 실행할 명령이 없어서 종료 코드 0으로 끝나고 재시작을 반복. 유지하려면 `command: ["sleep", "infinity"]` |
| 일부 파드가 계속 `Terminating` | 같은 `app: fast-api` 라벨 때문에 Deployment가 기존 ReplicaSet을 흡수해 0으로 줄임 |
| LoadBalancer `EXTERNAL-IP <pending>` | kind에는 외부 IP 할당 기능이 없음. NodePort로 호출하면 된다 |

빨간 상태가 항상 고장은 아니다. 상태 이름보다 **종료 코드와 이벤트**를 먼저 본다.

## 코드 버그도 하나 있었다

`pod-using-secrets`가 `CreateContainerConfigError`로 멈췄다. Secret을 `configMapKeyRef`로 참조하고 있었고, 키 이름도 `database-username`과 `database_username`으로 어긋나 있었다. `secretKeyRef`와 올바른 키로 고쳤더니 이번엔 `kubectl apply`가 거부됐다.

```
Forbidden: pod updates may not change fields other than ...
```

파드의 환경 변수는 생성 후 바꿀 수 없다. 지우고 다시 만들어야 한다.

## 그래서 지금은

이후 실습에서는 이렇게 하고 있다.

- 이미지 태그는 날짜가 박힌 구체적인 태그를 쓰되, 오프라인 대비로 `docker save`로 따로 보관한다.
- 파이썬 패키지는 `pip download`로 휠을 받아둔다.
- 실습 환경 버전(Python, 주요 패키지, K8s 도구)을 README 맨 위에 적는다.

## 한 줄 정리

재현성은 코드가 아니라 코드가 기대는 바깥 세상에 달려 있다. 고정할 거면 함께 움직이는 것들을 같은 시점에 묶어서 고정하자.
