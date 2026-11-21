---
title: "9장. 탐지 모델을 BentoML로 서빙"
date: 2026-11-22 01:30:00 +0900
categories: [MLOps, 실습 시리즈]
tags: [bentoml, yolo, serving]
description: "메서드 이름 하나로 500, 첫 요청 34초. 서빙 코드도 라이브러리 버전에 묶여 있다"
image:
  path: /assets/img/posts/mlops-lab-03.svg
  alt: "9장. 탐지 모델을 BentoML로 서빙"
series: mlops-drift
series_title: "MLOps 실습 시리즈"
---

{% include series-nav.html %}

> **요약** 서버가 뜨고 `/readyz`가 200을 돌려줘도 추론이 되는지는 알 수 없다. 실제 이미지를 한 장 보내 봐야 한다.
{: .prompt-tip }

9장은 학습한 YOLO 모델을 HTTP로 내놓는다. 서비스에는 엔드포인트가 두 개 있다.

| 엔드포인트 | 입력 | 출력 |
|---|---|---|
| `/invocation` | 이미지 | 탐지 결과 JSON (클래스, 신뢰도, 상자 좌표) |
| `/render` | 이미지 | 상자를 그린 이미지 |

## 구조

```python
class YOLOv8Runnable(bentoml.Runnable):
    SUPPORTED_RESOURCES = ("cpu",)

    def __init__(self):
        self.model = YOLO("yolov8_custom.pt")

    @bentoml.Runnable.method(batchable=False)
    def inference(self, input_img):
        results = self.model(input_img)[0]
        return json.loads(results[0].tojson())

yolo_v8_runner = bentoml.Runner(YOLOv8Runnable)
svc = bentoml.Service("yolo_v8", runners=[yolo_v8_runner])

@svc.api(input=Image(), output=JSON())
async def invocation(input_img):
    return await yolo_v8_runner.inference.async_run([input_img])
```

6장에서 본 것과 같은 모양이다. 요청을 받는 쪽(API 서버)과 모델을 돌리는 쪽(러너)이 나뉘어 있다. 이 코드는 BentoML 1.1의 문법이라 `bentoml==1.1.11`을 설치했다.

## 떴는데 안 된다

```bash
bentoml serve service.py:svc --port 3000
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/readyz     # 200
```

준비 완료라고 나오지만 샘플 이미지 세 장을 보내면 모두 500이다. 그런데 `/render`는 200이다.

```bash
curl -s -X POST -H 'Content-Type: image/png' \
  --data-binary @sample/img.png localhost:3000/invocation
# 500
```

응답 본문은 비어 있어서 서버 로그를 봐야 한다.

```
AttributeError: 'Results' object has no attribute 'tojson'. See valid attributes below.
```

저장소의 `requirements.txt`는 `ultralytics==8.0.194`인데 나는 최신판을 설치했다. 그 사이에 `tojson()`이 `to_json()`으로 바뀌었다. 그림만 그리는 `/render`는 이 메서드를 쓰지 않아서 멀쩡했다.

```python
return json.loads(results.to_json())
```

`/readyz`는 프로세스가 요청을 받을 수 있는지만 확인한다. 모델이 올바른 답을 내는지는 보지 않는다.

## 결과

```json
[{"name":"id_card","class":0,"confidence":0.91683,
  "box":{"x1":8.46778,"y1":131.26161,"x2":255.21376,"y2":324.75699}}]
```

| 요청 | 응답 시간 |
|---|---|
| 첫 요청 | 33.9초 |
| 그 뒤 | 0.17 ~ 0.38초 |

첫 요청이 200배 느리다. 모델과 라이브러리를 메모리에 올리는 일이 첫 요청 때 일어나는 것으로 보인다. 배포 직후 첫 사용자가 이 시간을 떠안지 않게 하려면, 띄운 뒤 미리 한 번 호출해 두는 단계가 필요하다.

## 내가 학습한 모델과 비교

책이 준 가중치(`yolov8_custom.pt`)와 8장에서 로컬 GPU로 10 에폭 학습한 가중치로 샘플 세 장의 신뢰도를 비교했다.

| 샘플 | 책의 모델 | 내 모델 |
|---|---|---|
| img.png | 0.917 | 0.973 |
| img_1.png | 0.584 | 0.981 |
| img_2.png | 0.943 | 0.777 |

세 장으로는 어느 쪽이 낫다고 말할 수 없다. 다만 검증 세트에서 mAP50-95가 0.995였던 내 모델이 `img_2.png`에서는 0.777로 떨어진다. 검증 세트는 학습 데이터와 같은 종류의 영상에서 나왔다. 검증 점수가 높다고 다른 사진에서도 잘한다는 보장은 없다.

## 묶기

```bash
bentoml build
# Successfully built Bento(tag="yolo_v8:5qw3q4hfxouihb5d").
```

`bentofile.yaml`이 서비스 코드와 가중치 파일을 하나로 묶는다. 컨테이너 이미지로 만드는 `--containerize`는 이번에는 하지 않았다. 바탕 이미지가 `ultralytics/ultralytics:8.0.203-cpu`로 고정돼 있어, 그 이미지 안에서는 고치기 전의 `tojson()`이 맞는 코드다. 로컬에서 고친 코드를 그대로 이미지에 넣으면 이번에는 반대로 깨진다.

코드와 라이브러리 버전은 한 쌍이다. 한쪽만 올리면 안 된다.

## 정리

- 준비 상태 확인과 추론 성공은 다른 것이다. 배포 뒤에 실제 입력을 한 번 보낸다.
- 응답이 500이고 본문이 비어 있으면 서버 로그를 본다.
- 첫 요청은 느리다. 미리 한 번 호출해 둔다.
- 서빙 코드도 학습에 쓴 라이브러리 버전에 묶인다. `requirements.txt`의 고정 버전을 무시하지 않는다.

---

실습 코드: [mlops-pipeline-lab](https://github.com/ChaYujin-kr/mlops-pipeline-lab)
