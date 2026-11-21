---
title: "7장. 컴포넌트와 아티팩트부터 다시"
date: 2026-11-22 01:10:00 +0900
categories: [MLOps, 실습 시리즈]
tags: [kubeflow, kfp, minio]
description: "KFP에서 단계 사이에 값을 넘기는 두 가지 방법, 그리고 책 코드에 숨어 있던 이미지·라벨 어긋남"
image:
  path: /assets/img/posts/mlops-lab-01.svg
  alt: "7장. 컴포넌트와 아티팩트부터 다시"
series: mlops-drift
series_title: "MLOps 실습 시리즈"
---

{% include series-nav.html %}

> **요약** 파이프라인의 단계는 서로 다른 컨테이너에서 돈다. 그래서 작은 값은 파라미터로, 파일은 아티팩트로 넘긴다. 그리고 따로 읽은 두 목록을 순서만 믿고 짝지으면 안 된다.
{: .prompt-tip }

## 용어 세 개

실습을 시작하자마자 "컴포넌트"와 "아티팩트"에서 막혔다. 5장에서 KFP를 한 번 돌려봤는데도 단어의 뜻은 모르고 있었다.

| 용어 | 뜻 |
|---|---|
| 파이프라인 | 여러 단계를 순서대로 실행하는 작업 흐름 |
| 컴포넌트 | 파이프라인의 한 단계. 코드로는 `@dsl.component`를 붙인 파이썬 함수 |
| 아티팩트 | 한 단계가 만들어 낸 파일이나 폴더 |

컴포넌트는 그냥 함수처럼 보이지만 **단계마다 Pod가 하나씩 따로 뜬다**. 이 점 때문에 평소 파이썬과 다른 일이 생긴다. 단계끼리 변수도 파일도 공유하지 못한다. 그래서 값을 넘기는 방법이 두 가지로 나뉜다.

| 방법 | 넘기는 것 | 꺼내는 법 |
|---|---|---|
| 파라미터 | 숫자, 문자열 같은 작은 값 | `task.output` |
| 아티팩트 | 파일, 폴더 | `task.outputs["이름"]` |

## 농담 파이프라인으로 확인

농담 3개를 파일로 쓰고, 단어 수를 세고, 결과를 출력하는 세 단계짜리 파이프라인이다.

```python
@dsl.component(base_image="python:3.11", packages_to_install=["pyjokes"])
def generate_joke(num_of_jokes: int, output_jokes: Output[Artifact]):
    import os
    import pyjokes

    os.makedirs(output_jokes.path, exist_ok=True)
    with open(os.path.join(output_jokes.path, "jokes.txt"), "w") as f:
        for _ in range(num_of_jokes):
            f.write(pyjokes.get_joke() + "\n")


@dsl.component(base_image="python:3.11")
def count_words(jokes_file: Input[Artifact]) -> int:
    import os

    with open(os.path.join(jokes_file.path, "jokes.txt")) as f:
        return len(f.read().split())
```

눈여겨볼 곳은 세 가지다.

- `Output[Artifact]`는 "내가 파일을 만들어 낼 자리"이고, `Input[Artifact]`는 "앞 단계가 만든 파일"이다.
- `output_jokes.path`는 KFP가 정해 준 경로다. 여기에 쓰면 단계가 끝날 때 저장소(MinIO)로 올라간다.
- `import`가 함수 안에 있다. 함수 본문만 다른 컨테이너로 옮겨져 실행되기 때문에, 파일 위쪽에 쓴 `import`는 따라가지 않는다.

실행 결과는 다음과 같다.

| 항목 | 값 |
|---|---|
| 걸린 시간 | 212초 |
| 뜬 Pod | 7개 (단계 3개 × 드라이버·실행 2개 + DAG 드라이버 1개) |
| `count_words` 반환값 | 37 |
| 마지막 단계 출력 | `Word count: 37` |

함수 세 개에 3분 반이 걸렸다. 단계마다 Pod를 띄우고 `pip install`을 다시 하기 때문이다. 로컬 함수 호출과 비교할 대상이 아니다.

아티팩트가 정말 남았는지는 MinIO 안을 직접 봤다.

```bash
MP=$(kubectl -n kubeflow get pods -l app=minio -o name | head -1)
kubectl -n kubeflow exec $MP -- sh -c \
  "find /bitnami/minio/data/mlpipeline -path '*<run_id>*' -type f"
# .../joke-artifact-pipeline/<run_id>/generate-joke/<id>/output_jokes/jokes.txt/xl.meta
```

경로가 `파이프라인 이름 / 실행 ID / 단계 이름 / 출력 이름` 순서다. 숫자 37은 여기에 없다. 파라미터는 파일이 아니라 메타데이터 저장소에 기록된다.

## 객체 탐지 데이터 준비

같은 방식으로 데이터셋을 내려받아 학습·검증·테스트로 나누는 파이프라인을 돌렸다. 신분증 영상에서 뽑은 프레임에 카드 위치 상자가 붙은 데이터다.

| 항목 | 값 |
|---|---|
| 미니 데이터셋 | 압축 1.2GB, 풀면 1.7GB |
| 이미지 | 570장 (영상 19개 × 30프레임, TIF) |
| 분할 | 427 / 85 / 58 (75% / 15% / 10%) |
| 걸린 시간 | 940초 |
| MinIO에 쌓인 용량 | 3.3GB |

### 주소가 죽은 줄 알았다

실행 전에 내려받기 주소를 확인했더니 404가 나왔다.

```bash
curl -sIL https://manning.box.com/shared/static/....gz   # HTTP/2 404
```

`-I`는 HEAD 요청이다. 이 서버는 HEAD를 받지 않을 뿐이었다. 앞의 1KB만 GET으로 받아 보면 정상이다.

```bash
curl -sL -r 0-1023 -o /dev/null -w '%{http_code}\n' https://manning.box.com/shared/static/....gz
# 206
```

응답의 `content-range`로 크기도 알 수 있었다. 저장소의 `data_prep_pipeline.py`에 적힌 주소는 10.3GB짜리 전체 데이터셋이고, 미니 데이터셋 주소는 학습 파이프라인 파일에 따로 있었다. 확인하지 않고 돌렸으면 10GB를 받을 뻔했다.

### 같은 데이터가 세 번 저장된다

1.7GB 데이터가 MinIO에는 3.3GB로 쌓였다. 내려받기 단계의 출력으로 한 번, 분할 단계의 출력으로 또 한 번 저장되기 때문이다. 아티팩트로 넘긴다는 것은 **단계마다 복사본을 올리고 내려받는다**는 뜻이다. 내려받기 단계가 약 9분, 분할 단계가 약 4분 걸렸다. 분할은 파일 570쌍을 복사하는 일인데, 입력 1.7GB를 MinIO에서 받고 결과를 다시 올리는 시간이 여기에 포함된다. 데이터가 커지면 감당이 안 되고, 그래서 8장에서 볼륨(PVC)을 함께 쓰는 방식이 나온다.

## 이미지와 라벨이 어긋나 있었다

분할 단계의 코드는 이렇게 생겼다.

```python
images = list(glob.glob(os.path.join(..., "images", "**")))
labels = list(glob.glob(os.path.join(..., "labels", "**")))

x_train, x_test, y_train, y_test = train_test_split(images, labels, ...)
```

이미지 목록과 라벨 목록을 따로 읽은 다음, i번째 이미지와 i번째 라벨이 짝이라고 가정하고 함께 나눈다. 그런데 `glob`은 순서를 보장하지 않는다. 실제로 만들어진 결과를 MinIO에서 세어 봤다.

| 묶음 | 이미지 | 같은 묶음에 라벨이 있는 이미지 |
|---|---|---|
| 학습 | 427 | 325 |
| 검증 | 85 | 14 |
| 테스트 | 58 | 6 |

검증 이미지 85장 중 71장은 자기 라벨이 다른 묶음에 가 있다. 파이프라인은 초록색으로 끝났고, 마지막 단계가 출력한 파일 목록도 멀쩡해 보였다. 개수만 봐서는 알 수 없다.

고치는 방법은 정렬하고, 짝이 맞는지 확인하는 한 줄을 넣는 것이다.

```python
images = sorted(glob.glob(...))
labels = sorted(glob.glob(...))
stem = lambda p: os.path.splitext(os.path.basename(p))[0]
assert [stem(p) for p in images] == [stem(p) for p in labels]
```

고친 뒤에는 427 / 85 / 58 모두 짝이 맞았다. 이 어긋남이 모델 점수에 어떤 영향을 주는지는 다음 편에서 쟀다.

덧붙여, 압축 파일 안에는 macOS가 만든 `._CA01_01.tif` 같은 숨김 파일이 이미지 수만큼 더 들어 있다. `glob`의 `**`는 점으로 시작하는 파일을 잡지 않아서 문제가 되지 않았다. `os.listdir`를 썼다면 이것도 섞였을 것이다.

## 정리

- 단계는 서로 다른 컨테이너다. 작은 값은 파라미터, 파일은 아티팩트.
- 아티팩트는 단계마다 복사된다. 큰 데이터에는 느리고 용량을 많이 쓴다.
- 주소 확인은 HEAD가 아니라 GET으로. 크기도 같이 본다.
- 따로 읽은 두 목록을 순서로 짝짓지 않는다. 정렬하고 검사한다.
- 파이프라인이 성공으로 끝났다고 데이터가 맞는 것은 아니다.

---

실습 코드: [mlops-pipeline-lab](https://github.com/ChaYujin-kr/mlops-pipeline-lab)
