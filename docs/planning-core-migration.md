# Planning Core Migration

## P1-A — 정책 구조화

2026-09-26. 이번 변경은 기존 코스 선택 결과를 보존한다. 장소 수, 활동 spine,
검색, ranking, 일정 계산, 실제 경로 검증의 정책 강도는 변경하지 않는다.

### 구조

- `planningPolicy.ts`: 30개 정책 코드, `severity`, `origin`, `scope`, 표시 문구.
  `hard`/`soft`와 정책 출처를 별도 축으로 관리한다.
- `courseDesign.ts`: 문제 발생 지점에서 코드를 직접 생성한다. `problems` 문자열은
  기존 응답·repair prompt·verifier와의 호환을 위해 유지한다.
- `hardCourseProblems(string[])`: 외부/이전 호출자를 위한 호환 경계다. 과거 문자열
  패턴을 catalog의 fragment로 변환한다. 새 코스 선택은 문자열을 해석하지 않는다.
- `blocksCourse`: deterministic seed는 hard 문제만 차단하고 모델 제안은 모든
  문제를 차단하던 차이를 명시한다. **P1-A에서는 이 차이를 유지한다.**
- 여행 경험 근거 부족에 따른 repair 생략도 문구 대신 코드로 판정한다.
- `partitionPlanningIssues`: hard 위반과 soft 경고를 분리해서 읽을 수 있다.
  기존 `scoreBreakdown`은 품질 평가를 계속 담당하며 점수와 가중치는 그대로다.

`origin`은 근거의 신뢰도가 아니다. 예를 들어 거리 제한은 좌표로 계산하더라도
제한값 자체가 기존 경험 규칙이므로 `legacy_heuristic`이다. 활동·음식 종류는
현재 state에서 명시 요청과 추론의 출처를 완전히 구분할 수 없어 보수적으로
`legacy_heuristic`으로 기록한다. 이 origin만 보고 제약을 완화하면 안 된다.

### 수정과 검증의 경계

기존 `evaluateCourse` 호출 순서를 그대로 보존한다.

1. `prepareCourseForEvaluation`: 알려진 후보 추출, 일자별 legacy 순서 최적화.
2. `evaluatePreparedCourse`: 준비된 rows 평가. 장소 삽입·순서 변경·체류시간 보충 없음.
   호출자는 catalog에 존재하는 rows를 준비해서 전달한다. 원본 proposal은 별도로
   유지하여 잘못된 ID와 중복 ID를 검출한다.
3. `evaluateCourse` 호환 facade: 기존 체류시간 기본값 적용, 결과 및 수정 이력 반환.

`validateModelRows`는 이름과 달리 rewrite를 수행하므로 알고리즘을
`rewriteLegacyModelRows`로 명명하고 기존 함수는 호환 wrapper로 남긴다.
후보 필터, 식당 교체, 필수 장소 삽입, slot 제한, 최소 개수 보충, activity spine,
동선 정리, 순서·시간 배치 단계를 `PlanningTransformation`으로 기록한다.
현재 저장소에서는 `validateModelRows`의 참조가 테스트에만 존재한다. 실제 주 코스
제안 경로는 `evaluateCourse`를 사용하므로 두 경로의 영향 범위를 혼동하면 안 된다.

수정 이력은 검증 문제가 아니다. 점수나 수락 여부에 사용하지 않는다. 내부 row
ID/일자/시간/체류시간/비용만 보존하며 사용자 발화나 모델 설명은 포함하지 않는다.
API/UI 결과에 새 필드를 추가하지 않는다. 운영 `date_course_design`에는 정책 코드와
수정 단계 이름만 추가한다.

### 보존한 경계와 알려진 debt

- 3일 최소 8곳, 일별 식사/경험/근거, 카페·식사 중복 등은 여전히 hard다.
- 모델 경로는 soft 경고에도 실패한다. `verifyDateItinerary`도 기존 `problems`
  전체를 검사한다. P1-B는 severity만 바꿔서는 완료되지 않는다.
- 기존 점수는 중복 제거 전 문제 발생 수에 -100을 곱한다. scope별 구조화 issue를
  도입해도 기존 penalty와 반환 문자열의 중복 제거 시점을 유지했다.
- `courseSize`, `dateSpine`, 검색 기본값은 그대로다. P2–P4의 교체 대상이다.
- 날짜/시간/예산/필수·제외 조건과 mutation 검증은 그대로 유지한다.
- 생산 부산 요청의 정확한 후보 탈락 원인은 운영 trace가 필요하다. 이 작업으로
  부산 생성 실패가 해결됐다고 주장하지 않는다.

### 회귀 검증

수정 **전**에 고정 후보 9개를 사용해 8개 시나리오의 baseline snapshot을 저장했다.
부산 3일, 늦은 도착, 이른 출발, 휴양, 카페 투어, 짧은 저녁, 명시 hard 제약,
당일치기를 포함한다. 전체 legacy evaluation/rewritten rows/seed 결과의 SHA-256과
문제·점수·seed 수를 비교하므로 순서/시간/선택/점수 변경도 감지한다.
이 fixture는 모델 품질이나 운영 검색 성공률을 측정하는 live 평가가 아니다.

새 테스트는 17개다. 정책 호환, 문구와 무관한 severity, 경로별 차단 정책,
day/constraint/candidate scope, read-only 평가, rewrite 이력을 검사한다.
기존 executor·orchestrator·AIPlannerResult regression도 전체 suite로 실행한다.

검증 결과: `npm test` 715 passed / 12 skipped(옵트인 live 테스트),
`npm run typecheck` 통과, `npm run build` 통과, `git diff --check` 통과.
이번 실행에서는 외부 LLM API를 호출하거나 운영 배포를 하지 않았다.

## 후속 순서

1. **P1-B:** 정책 강도 조정. 최소 stop 수 등 경험 규칙과 명시 제약을 분리하고,
   모델 수락·seed 수락·최종 verifier·penalty가 같은 정책을 따르도록 함께 검토한다.
2. **P2:** 경험 흐름/일별 가용 시간/밀도/지역 전략을 표현하는 Experience Plan.
3. **P3:** 기존 검색 capability를 사용해 Experience Plan에 필요한 후보와 사실 조사.
4. **P4:** 검증된 후보 안에서 모델이 코스 구성과 밀도를 결정하도록 이전.
5. **P5:** P1의 Hard Validator / Soft Critic 경계를 새 planner에 연결하고 정교화.
6. **P6:** scope와 issue code로 실패한 부분만 repair하고 재검증.
7. 평가 통과 후 `create_itinerary` task의 실제 실행 승격을 별도로 결정.

## 계속 측정할 네 지표

| 지표 | 정의와 주의점 |
| --- | --- |
| 생성 성공률 | 전체 평가 요청 중 사용 가능한 최종 코스를 반환한 비율. mock과 live를 별도 집계 |
| hard constraint 위반률 | 생성된 코스 중 명시 필수/제외/예산/확인된 시간·경로 제약 위반이 있는 비율 |
| 불필요한 실패율 | 고정 후보 안에 독립적으로 검증된 feasible 코스가 있는데도 실패한 요청 비율 |
| 의도와 다른 과밀/빈약 비율 | 성공 코스 중 사용자 가용 시간·pace·명시 stop 수 기준을 어긴 비율 |

분모, 평가 시나리오, 정책 버전을 함께 남긴다. 기대 품질은 이전 hard-coded
장소 수로 판정하지 않는다. 늦은 도착/이른 출발/휴양/카페 투어/짧은 데이트를
각각 평가하며 unknown 비용·운영시간·이동시간을 확인 완료로 집계하지 않는다.
