---
title: "MLOps 실습 시리즈를 시작하며"
date: 2026-11-08 01:00:00 +0900
categories: [MLOps, 실습 시리즈]
tags: [mlops, series]
description: "드리프트 감시와 재학습 판단(6~7장), 탐지·추천 파이프라인(7~11장)까지 17편의 기록"
image:
  path: /assets/img/posts/mlops-drift-00.svg
  alt: "MLOps 실습 시리즈를 시작하며"
series: mlops-drift
series_title: "MLOps 실습 시리즈"
pin: true
---

{% include series-nav.html %}

《Design a Machine Learning System (From Scratch)》를 실습하면서 겪은 일을 한 편에 한 주제씩 정리한다. 1부(1~10편)는 6–7장의 드리프트, 2부(11~16편)는 7~11장의 파이프라인이다.

1부의 실습 시나리오는 하나다.

> 소득 예측 모델(연소득 50K 초과 여부)을 서빙하고 있는데, 마케팅 신규 채널이 열리면서 20대 단시간 근로자가 점점 많이 들어온다. 정답 라벨은 몇 달 뒤에야 도착한다.

이 상황에서 모델을 어떻게 감시하고, 경보가 울리면 무엇을 해야 할지 따라가 본다.

## 목차

### 1부. 드리프트 감시와 재학습 판단 (6–7장)

| 편 | 주제 | 한 줄 요약 |
|---|---|---|
| 1 | [AI와 일하면서 실력 지키기]({% post_url 2026-11-08-mlops-drift-01-learning-with-ai %}) | 일하는 시간과 훈련하는 시간을 나눈다 |
| 2 | [BentoML로 모델 서빙하기]({% post_url 2026-11-08-mlops-drift-02-bentoml-serving %}) | 요청 한 건은 14열인데 모델은 102열을 원한다 |
| 3 | [드리프트는 어떻게 판정될까]({% post_url 2026-11-08-mlops-drift-03-how-drift-is-judged %}) | 열 단위 판정과 데이터셋 단위 판정, 두 단계 |
| 4 | [드리프트 경보는 모델 고장이 아니다]({% post_url 2026-11-08-mlops-drift-04-drift-is-not-failure %}) | 예측이 0%가 됐는데 정확도는 99%였다 |
| 5 | [경보가 울리면 재학습? 판정 기준부터]({% post_url 2026-11-08-mlops-drift-05-threshold-before-retrain %}) | 판정 기준 하나 바꾼 효과가 재학습의 수십 배 |
| 6 | [지연 라벨을 위한 서빙 로그 설계]({% post_url 2026-11-08-mlops-drift-06-logging-for-delayed-labels %}) | 고객 ID가 없으면 평가 자체가 불가능하다 |
| 7 | [판정 규칙이 6일 내내 틀렸다]({% post_url 2026-11-08-mlops-drift-07-judge-rule-failed %}) | 지표가 고객층 변화를 성능 저하로 착각했다 |
| 8 | [KFP 파이프라인 준비하기]({% post_url 2026-11-08-mlops-drift-08-kfp-pipeline-prep %}) | MLflow 설치와 컴포넌트 간 데이터 전달 |
| 9 | [Kubeflow 노트북 설정 세 가지]({% post_url 2026-11-08-mlops-drift-09-kubeflow-notebook-settings %}) | PodDefault, 어피니티, 톨러레이션 |
| 10 | [KFP로 판단 파이프라인 돌려보기]({% post_url 2026-11-08-mlops-drift-10-kfp-pipeline-run %}) | 경보 후 네 갈래 분기, 사람이 판단할 곳은 남긴다 |

### 2부. 탐지·추천 파이프라인 (7~11장)

| 편 | 주제 | 한 줄 요약 |
|---|---|---|
| 11 | [7~11장 실습을 한 번에 돌려 봤다]({% post_url 2026-11-22-mlops-lab-00-overview %}) | 13번 실행해 5번 성공. 더 조심할 곳은 멈추지 않고 끝난 곳 |
| 12 | [7장. 컴포넌트와 아티팩트부터 다시]({% post_url 2026-11-22-mlops-lab-01-kfp-data-passing %}) | 작은 값은 파라미터, 파일은 아티팩트 |
| 13 | [8장. 학습 파이프라인이 네 번 죽었다]({% post_url 2026-11-22-mlops-lab-02-yolo-training-pipeline %}) | 라벨 어긋남은 학습이 아니라 평가를 망가뜨렸다 |
| 14 | [9장. 탐지 모델을 BentoML로 서빙]({% post_url 2026-11-22-mlops-lab-03-yolo-bentoml-serving %}) | 준비 상태 200과 추론 성공은 다르다 |
| 15 | [10장. 추천 파이프라인, 두 번째 실행에서 깨지는 코드]({% post_url 2026-11-22-mlops-lab-04-recommender-pipeline %}) | 처음에만 되는 코드, 기본값에 기대는 코드 |
| 16 | [11장. 추천 서빙, 드리프트, 설명 가능성]({% post_url 2026-11-22-mlops-lab-05-serving-drift-explain %}) | 드리프트 점수가 난수 시드를 재고 있었다 |

## 실습 환경

- 데이터: UCI Adult (48,842행, 원본 피처 14개)
- 서빙: BentoML 1.1.10 / 드리프트 감시: Evidently 0.5.0
- 파이프라인: Kubeflow Pipelines 2.4 (kind 클러스터) / 모델 관리: MLflow 2.17.2
- 2부: YOLOv8, MovieLens, BentoML 1.1.11·1.4, deepchecks 0.18.1 (메모리 7.7GB 노트북)

## 실습 코드

1부 코드는 [mlops-drift-drill](https://github.com/ChaYujin-kr/mlops-drift-drill), 2부 코드는 [mlops-pipeline-lab](https://github.com/ChaYujin-kr/mlops-pipeline-lab)에 있다.
