---
title: "10장. 추천 파이프라인, 두 번째 실행에서 깨지는 코드"
date: 2026-11-22 01:40:00 +0900
categories: [MLOps, 파이프라인 실습]
tags: [kubeflow, kfp, mlflow, recommender]
description: "여섯 번 돌려 두 번 성공. 처음에만 되는 코드와, 기본값에 기대는 코드"
image:
  path: /assets/img/posts/mlops-lab-04.svg
  alt: "10장. 추천 파이프라인, 두 번째 실행에서 깨지는 코드"
series: mlops-lab
series_title: "ML 파이프라인 실습 (7~11장)"
---

{% include series-nav.html %}

> **요약** 파이프라인은 한 번 성공하는 것으로는 부족하다. 두 번째에도, 아무것도 없는 첫 실행에도, 다른 버전의 도구에서도 돌아야 한다.
{: .prompt-tip }

10장은 MovieLens 평점으로 영화 추천 모델을 만든다. 파이프라인이 두 개다.

| 파이프라인 | 단계 |
|---|---|
| 데이터 준비 | 내려받기 → 압축 풀기 → Parquet 변환 → 분할 → MinIO에 올리기 → 검사(QA) |
| 학습·검증 | 검사 → 메타데이터 → 음성 샘플링 → 학습 → 검증 → MLflow 등록 |

7~9장과 다른 점은 단계끼리 아티팩트만 주고받지 않고, **MinIO 버킷과 MLflow를 공유 저장소로 쓴다**는 것이다. 데이터 준비 파이프라인이 버킷에 올려 둔 것을 학습 파이프라인이 읽는다.

## 데이터를 줄였다

책은 평점 2,500만 건짜리 `ml-25m`을 쓴다. 메모리 7.7GB 노트북에서 CPU로 30 에폭을 돌리는 것은 무리라고 보고, 같은 형식의 작은 데이터셋으로 바꿨다.

| | ml-25m (책) | ml-latest-small (실습) |
|---|---|---|
| 압축 파일 | 262MB | 1MB |
| 평점 | 2,500만 | 100,836 |
| 사용자 | 16만 | 610 |
| 영화 | 6만 | 9,742 |

바꾸려면 코드 세 군데에 박혀 있던 `'ml-25m'`을 인자로 빼야 했다. 검사 단계의 기준도 고정값이었다.

```python
assert df.shape[0] >= 0.75 * 25 * 1e6   # 학습 데이터가 1,875만 행 이상
```

데이터셋 이름과 최소 행 수를 파이프라인 인자로 바꿨다. 에폭은 30에서 5로 줄였다.

## 실행 기록

| 실행 | 파이프라인 | 결과 | 원인 |
|---|---|---|---|
| 1 | 데이터 준비 | 실패 | `pip` 내려받기 시간 초과 |
| 2 | 데이터 준비 | 실패 | `pip` 연결 실패 |
| 3 | 데이터 준비 | 실패 | `BucketAlreadyOwnedByYou` |
| 4 | 데이터 준비 | 성공 (361초) | |
| 5 | 학습·검증 | 실패 (999초) | `cannot import name 'root_mean_squared_error'` |
| 6 | 학습·검증 | 성공 (1,075초) | |

## 실행 1~2. 네트워크

```
TimeoutError: The read operation timed out
ERROR: No matching distribution found for kfp==2.9.0
```

코드 문제가 아니었다. 같은 시각 클러스터가 8장의 3GB짜리 이미지를 받고 있었고, 두 번째는 노트북이 메모리 부족으로 느려지던 때였다.

KFP의 가벼운 컴포넌트는 Pod가 뜰 때마다 `pip install`을 한다. 단계가 7개면 설치도 7번이고, 그중 하나라도 네트워크가 끊기면 파이프라인 전체가 실패한다. 8장에서 학습 이미지를 고정한 것과 같은 이유로, 실제 운영이라면 필요한 패키지를 넣은 이미지를 만들어 두는 편이 낫다.

## 실행 3. 처음에만 되는 코드

```python
try:
    minio_client.create_bucket(Bucket=bucket)
except minio_client.exceptions.BucketAlreadyExists:
    pass
```

"버킷이 이미 있으면 넘어간다"는 의도다. 그런데 실제로 온 예외는 이것이었다.

```
botocore.errorfactory.BucketAlreadyOwnedByYou: ... you already own it.
```

S3 규격에서 두 예외는 다르다. `BucketAlreadyExists`는 다른 사람이 그 이름을 쓰고 있을 때, `BucketAlreadyOwnedByYou`는 내가 이미 만들었을 때다. 원본 코드는 앞의 것만 잡는다.

그래서 이 파이프라인은 **버킷이 없는 첫 실행에서는 성공하고, 두 번째부터 실패한다**. 실행 1에서 올리기 단계가 버킷을 만든 뒤 다른 단계가 실패했기 때문에, 세 번째 실행에서야 이 문제가 드러났다. 한 번 돌려 보고 넘어갔다면 몰랐을 것이다.

```python
except (minio_client.exceptions.BucketAlreadyExists,
        minio_client.exceptions.BucketAlreadyOwnedByYou):
    pass
```

## 실행 5. 기본값에 기댄 코드

```
ImportError: cannot import name 'root_mean_squared_error' from 'sklearn.metrics'
  (/usr/local/lib/python3.8/site-packages/sklearn/metrics/__init__.py)
```

경로에 `python3.8`이 보인다. 학습·검증 컴포넌트는 `base_image`를 적지 않았다.

```python
@component(packages_to_install=["scikit-metrics", "torch", ..., "mlflow", "pandas"])
def validate_model(...):
```

이미지를 적지 않으면 KFP SDK의 기본 이미지가 쓰이는데, 내 SDK(kfp 2.9.0)의 기본값은 `python:3.8`이다. 컴파일된 YAML에서 확인할 수 있다.

```bash
grep -h "image:" compiled_pipelines/training_pipeline.yaml | sort | uniq -c
#   1  image: python:3.11
#   6  image: python:3.8
```

Python 3.8에 설치되는 scikit-learn은 1.3까지이고, `root_mean_squared_error`는 1.4에서 생겼다. 같은 코드가 SDK 버전에 따라 다른 Python에서 돌고, 그에 따라 다른 버전의 라이브러리가 깔린다.

모든 컴포넌트에 `base_image="python:3.11"`을 적었다. `mlflow`도 서버와 같은 2.17.2로 고정했다. 고정하지 않으면 서버보다 새 버전의 클라이언트가 설치된다.

## 읽다가 미리 고친 것

돌리기 전에 코드를 읽으면서 고친 것이 두 군데 있다. 실패를 직접 보지는 않았다.

**분할 단계의 쓰이지 않는 두 줄**

```python
n_users = ratings_df.user_id.max()
n_items = ratings_df.item_id.max()
```

열 이름은 `userId`, `movieId`다. 이대로면 `AttributeError`가 난다. 계산한 값은 어디에도 쓰이지 않아서 두 줄을 지웠다.

**등록 단계의 첫 실행**

```python
current_staging = None
try:
    current_staging = client.get_model_version_by_alias(name, "staging")
except RestException:
    print("No staging model found. Auto upgrade current run to staging.")

if current_staging.run_id == model_run_id:   # None이면 여기서 죽는다
    return
```

스테이징 모델이 없는 첫 실행을 처리하려고 `try`를 썼는데, 바로 다음 줄이 `None.run_id`를 읽는다. `None` 검사를 넣었다. 이것도 버킷 문제와 반대 방향의 같은 종류다. 이쪽은 **첫 실행에서만 깨진다**.

## 결과

| 항목 | 값 |
|---|---|
| 학습 행 (음성 샘플 포함) | 81,727 |
| 테스트 / 검증 행 | 10,084 / 15,125 |
| 학습 손실 (5 에폭) | 1.436 → 1.143 |
| 테스트 손실 | 1.098 → 0.942 |
| precision@50 | 0.855 |
| recall@50 | 0.736 |
| rms | 0.247 |
| 등록 | `recommender_production` v1, 별칭 `staging` |

손실은 L1이라서 0.942는 "평점을 평균 0.94점 틀린다"는 뜻이다. 5 에폭으로는 아직 내려가는 중이다.

### rms 0.247은 믿을 수 없다

평균 0.94점씩 틀리는 모델의 RMSE가 0.247일 수는 없다. 검증 코드를 보면 이유가 있다.

```python
for users, movies, ratings in val_dataloader:
    output = recommendation_model(users, movies)
    y_pred.append(output.sum().item() / len(users))    # 배치의 평균 예측
    y_true.append(ratings.sum().item() / len(users))   # 배치의 평균 평점
...
rms = root_mean_squared_error(y_true, y_pred)
```

평점 하나하나가 아니라 **32개 묶음의 평균끼리** 비교한다. 개별 오차는 평균을 내는 동안 서로 지워진다. 이 숫자는 등록 단계에서 새 모델을 올릴지 정하는 기준으로도 쓰인다.

지표는 이름이 아니라 계산식을 보고 믿어야 한다.

## 정리

- 파이프라인은 최소 두 번 돌린다. 빈 상태에서 한 번, 이미 돌린 상태에서 한 번.
- "이미 있으면 넘어간다"는 코드는 실제로 어떤 예외가 오는지 확인한다.
- `base_image`를 생략하지 않는다. 기본값은 SDK 버전마다 다르다.
- 클라이언트 라이브러리 버전은 서버에 맞춘다.
- 로그에 찍힌 경로(`python3.8`)가 가장 빠른 단서였다.
