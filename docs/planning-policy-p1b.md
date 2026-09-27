# P1-B — 코스 수락 정책 조정

P1-A가 만든 `PlanningIssue` 경계에 실제 강도를 적용했다. 고정 후보와 명시
제약을 가진 fixture 15개를 **변경 전후 동일하게** 평가했다. 운영 검색이나 실제
OpenAI 모델은 이 평가에 포함하지 않았다.

## 수락과 평가

- `hardIssues`가 있으면 모델 제안, deterministic seed, 최종 verifier 모두 거절한다.
- `softIssues`는 warnings로 유지하고 문제당 8점 감점한다. 경로 수락 기준은 hard만
  사용한다. `qualitySignals`는 기존 점수 세부 항목의 읽기 모델이다.
- 실제 보행 경로 한도·지정 시간 충돌은 verifier에서 별도 hard issue로 추가한다.
- 기존 표시용 `problems`는 호환을 위해 남지만 수락 판단에는 사용하지 않는다.
- 모델 repair prompt에는 hard 위반을 수정 대상으로, soft 경고를 선택적 개선
  힌트로 보낸다. soft 경고만 있는 계획에 repair 호출을 추가하지 않는다.

### Soft로 조정한 규칙

`stop_count`, `sparse_day`, `dense_day`, `missing_daily_experience`,
`missing_daily_meal`, `missing_experience_evidence`, `repeated_cafe`,
`repeated_meal`, `repeated_added_experience`, `cafe_space_evidence_missing`,
`generic_chain`, `long_hop`, `walking_burden`, `outside_area`, `low_variety`.

직선거리 기반 이동 부담은 품질 신호이며 실제 보행 검증과 구별한다. 사용자가
지역을 `core`로 제한하면 `outside_area`는 hard가 된다. 명시적으로 매일
식사를 요청하면 `missing_daily_meal`은 hard가 된다. `명시한 장소 수`는
고정 `courseSize.min`과 별개의 hard 조건이다.

### Hard로 유지한 규칙

알려지지 않은 candidate ID, 동일 장소 중복, 여행 날짜 누락, 필수 장소 누락,
제외 장소·음식, 알레르기 미확인, 확인된 예산 초과, 명시 일정·공연 날짜,
방문 회차, 시간·schedule 불가능, 명시 보존 순서, 명시 활동 누락 및
음식 종류 불일치를 유지했다. 실제 보행 경로 한도·시간 충돌도 hard다.

운영시간은 현재 발화가 **확실한 특정 시각 영업**을 요구할 때만 별도 검증한다.
정확한 지점 ID의 최근 `source_checked` 관찰이며, 요청 날짜 또는 매일
운영 범위와 시간 구간이 모두 확인돼야 한다. 일반 provider 영업시간 문자열,
오래된 자료, 다른 지점의 자료는 `unknown`으로 둔다. 이 경우 계획을 차단한다.
일반적인 경험 근거 부족은 soft이며, 후보 ID의 존재 검증과 혼동하지 않는다.

## 장소 수와 rewrite

`courseSize()`의 숫자는 당분간 legacy guidance로 남겼다. `stop_count`는
기본 soft이며 LLM prompt의 최소값은 날짜별 1곳과 필수 장소 수로 낮췄다.
fallback의 목표 stop 수는 기본 2곳/일, 늦은 도착·이른 출발·여유로운 pace에서는
더 적게 잡는다. 기존 hard schedule과 필수 장소 검증을 통과해야 수락된다.

실제 주 코스 제안은 `evaluateCourse()`의 기존 최적화 외에 장소 수를 채우는
`validateModelRows()`를 호출하지 않는다. 후자는 현재 테스트에서만 사용되는
legacy rewrite이며, 그 내부 minimum fill·activity spine은 이번에 삭제하지
않았다. **고정 proposal의 transformation 수는 16→16으로 동일**하다. 대신
실제 fallback이 목표로 만드는 장소 수가 줄었다. 완전한 rewrite 제거는
P4 Model-driven Itinerary에서 필요하다.

## 고정 후보 평가

원본: [변경 전 자료](./planning-policy-p1b-before.json) ·
[변경 후 자료](./planning-policy-p1b-after.json). 8개 생성 사례와 7개 안전 사례,
총 15개. 이 집계의 “불필요한 실패”는 고정 후보 안에 fixture가 정의한
수락 가능한 코스가 있음에도 평가가 거절한 횟수다.

| 지표 | P1-A | P1-B |
| --- | ---: | ---: |
| 생성 수락률, 8개 | 1/8 | 8/8 |
| hard issue 수, 전체 15개 | 59 | 8 |
| soft issue 수, 전체 15개 | 1 | 54 |
| 불필요한 거절, 8개 | 7 | 0 |
| 안전 사례 잘못 수락, 7개 | 0 | 0 |
| 모델이 답하지 않는다고 가정한 seed 사용 가능률 | 2/15 | 10/15 |
| 고정 proposal transformation 수 | 16 | 16 |

부산 2박3일(A), 늦은 첫날 도착(B), 이른 출발(C), 휴양(D), 카페 투어(E),
짧은 저녁(F), 활동 요청(G), 세 날 각 한 곳(H)은 최종 verifier까지 수락된다.
G는 부산 지역을 사용하므로 **현재 엔진에서는 여행으로 분류된다**. 성수 지역의
활동적인 당일 데이트를 별도 테스트로 검증했다. 이 지역 분류는 남은 legacy debt다.

예산, 제외 음식, 필수 장소 누락, 제외 장소, 명시 시간 불가능, 알 수 없는 ID,
필수 영업시간 미확인은 모두 계속 실패한다. 별도 테스트는 실제 보행 경로 한도,
지역 제한, 명시 장소 수, 매일 식사 요구, 자료의 지점/신선도를 검사한다.

## 한계와 다음 단계

고정 후보의 부산 2박3일 **코스는 생성 가능**해졌다. 운영 서비스에서 검색된
부산 후보의 양·근거·실제 이동 경로까지 검증된 것은 아니다. 배포 이후 같은
실사용 요청과 운영 `date_course_design` trace를 재확인해야 한다.

검색 질의와 장소 eligibility/ranking은 그대로다. `courseSize`, `dateSpine`,
activity taxonomy, fallback beam, 직선거리 초기 평가, 일부 `legacy` rewrite는
남아 있다. P2 Experience Plan은 이 경계 위에 도입할 수 있지만, 운영 성공률과
hard 위반률을 별도로 계속 측정해야 한다.

## P2 이전 provenance 보완

`verifyDateItinerary()`의 문자열 호환 경로도 `legacyPlanningIssue()`의 severity를
그대로 적용한다. 미분류 문자열은 soft이며, 확인된 예산 초과처럼 알려진 hard
문구는 계속 차단한다. 명시 조건의 출처가 문자열만으로 복원되지 않는 경우에는
soft를 hard로 추측해서 승격하지 않는다.

활동·음식 종류는 현재 state 값만으로 명시 요구라고 판단하지 않는다.
`userRequests`에 남은 직접 발화나 UI의 직접 선택을 확인한 경우 누락·불일치를
hard로 처리한다. Memory 제안은 `inferred_preference`, 나머지 discovery/default
값은 `legacy_heuristic` 출처의 soft issue다. `discovery.requiredActivities`는
`state.activities`를 복사할 수 있으므로 자체적으로 명시 근거가 되지 않는다.
제외 음식 등 독립적인 hard safety 검사는 그대로다.

Legacy rewrite의 변경 기록에는 stage와 함께 `reasonCode`·`origin`을 담는다.
최소 장소 채우기는 `stop_count`, 필수 장소 삽입은 `required_place_missing`으로
추적한다. 여러 정책이 한 stage에 섞인 구간은 `legacy_*` 이유 코드를 사용하며,
이번 보완에서 rewrite 알고리즘이나 `courseSize`·`dateSpine`·`openSearchPool`의
동작은 변경하지 않았다. 향후에는 UI 선택과 사용자 발화의 출처를 state에 더
정밀하게 보존하고, 복합 rewrite stage를 분리하는 작업이 필요하다.
