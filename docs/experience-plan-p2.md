# P2 — Experience Plan 관찰 경계

`DATE_EXPERIENCE_PLAN_SHADOW=true`일 때 코스 생성 요청에서만 별도 OpenAI structured output을
요청한다. 기본값은 꺼짐이다. 유효한 결과는 `DateContext.experiencePlan`에 저장하며
검색, 후보 적격성, ranking, 코스 생성, 검증, 사용자 응답에는 전달하지 않는다.
실패나 잘못된 JSON은 `null`로 격리하고 기존 경로가 계속 실행된다.

## 계약

- `ExperiencePlan`: objective, overallPace, tripStrategy, days, requiredElements,
  optionalElements, qualitativeNeeds, uncertainties.
- `ExperienceDayPlan`: 목적, 날짜별 밀도(light/balanced/full), 권역, 방문 경험 블록.
- `ExperienceBlock`: 목적·주 경험·일반적 방문 맥락·같은 경험을 보조하는 식사/카페/휴식/쇼핑.
  서로 다른 날에 같은 방문 맥락을 반복하려면 이유가 필요하다.
- 질적 요구는 `category + dimension + source`로 보존한다. 예를 들어
  “이쁜 카페”는 `cafe + aesthetic + explicit_user`다. 이 요구를 결과의
  전체 목록과 최소 한 경험 블록에 모두 유지해야 유효하다.
- 명시 활동만 requiredElements가 된다. 이전 memory와 legacy/default 활동은
  optionalElements의 참고 정보다. `toDateIntent()`도 명시 활동만 hard로 전달한다.

모델에는 현재 발화, 명시 제약, 승인된 semantic signal, 질적 요구, 여행 기간,
도착·출발 시간대, 필수 장소, 세션 feedback의 작은 projection만 전달한다.
후보·검색 결과나 DateContext 전체는 전달하지 않는다. 응답 스키마에 장소·후보
ID 필드는 없고, 런타임 validator는 추가 필드·ID 패턴·명시 제약의 임의 승격,
사용자 질적 요구 누락과 날짜 누락을 거절한다. 늦은 도착·이른 출발에 비해
밀도가 높거나 명시한 여유로움과 pace가 어긋난 경우는 진단 경고로만 기록한다.
밀도를 정하는 권한은 이 단계에서 LLM에 둔다.

## Legacy 비교

`ExperiencePlanComparison`은 날짜별 밀도와 `courseSize().min`, 경험 블록과
`dateSpine()`을 비교한다. `potentialRewriteConflicts`는
`legacy_minimum_fill`·`legacy_activity_spine`의 **가능성**만 나타낸다.
식사·카페를 경험 블록의 보조 요소로 둔 반면 legacy spine이 독립 slot으로
요구하면 `supportingSlotConflict`도 기록한다.
이 단계에서 실제 `validateModelRows()`를 실행해 변형하지 않는다.

고정 golden fixture에서는 “부산 2박3일 여유롭게”의 밀도가
`light → balanced → light`이며 기존 최소 장소 수는 8이다. 짧은 저녁 데이트의
단일 경험 블록도 유효하지만 legacy spine에는 meal/cafe가 있어 충돌 가능성이
기록된다. 부산 1박2일은 날짜별 권역과 목적을 나누고 식사를 방문 경험의 보조
요소로 표현한다.

## 남은 경계

모델의 지역 전략과 경험 품질은 아직 실제 검색·일정 결과로 검증되지 않는다.
자유 서술 문자열에서 미지의 상호명을 완벽하게 탐지할 수도 없다. 운영에서
flag를 켜면 코스 생성 턴마다 최대 한 번의 추가 OpenAI 호출과 최대 10초의
대기가 발생할 수 있다. P3에서 이 계획을 검색 요구로 바꿀 때도 후보 ID와
운영 사실은 기존 도구·검증을 통해서만 확정해야 한다.
