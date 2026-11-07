---
# 시리즈별 글 목록. 글 머리말의 categories 두 번째 값(하위 카테고리)으로 묶는다.
title: 시리즈
icon: fas fa-layer-group
order: 1
---

{% assign series = site.posts | where_exp: "p", "p.categories[1] == '실습 시리즈'" | sort: "date" %}
## MLOps 실습 시리즈

신규 채널 유입으로 고객층이 바뀌는 상황에서, 소득 예측 모델을 서빙하고 드리프트를 감시하고 재학습 여부를 판단하는 과정을 따라간다. 실습 코드는 [mlops-drift-drill](https://github.com/ChaYujin-kr/mlops-drift-drill)에 있다.

{% for post in series %}
1. [{{ post.title | remove: "[MLOps 실습 시리즈] " }}]({{ post.url | relative_url }})
{%- endfor %}

{% assign notes = site.posts | where_exp: "p", "p.categories[1] == '실습 노트'" | sort: "date" %}
{% if notes.size > 0 %}
## 실습 노트

책의 각 장을 실습하면서 겪은 문제와 해결 과정.

{% for post in notes %}
- [{{ post.title }}]({{ post.url | relative_url }}) <small>{{ post.date | date: "%Y-%m-%d" }}</small>
{%- endfor %}
{% endif %}
