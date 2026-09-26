import type { AIPlannerState } from "@/features/planning/types/plan";
import { isTravelPlan } from "@/features/ai/dateBrief";
import { createServiceClient } from "@/lib/supabase/server";
import { playbookSemanticScores } from "./datePlaybookSemantic";

export type DatePlaybookStage = "interpretation" | "discovery" | "selection" | "editing" | "response";
export type DatePlaybookCard = {
  id: string;
  version: number;
  title: string;
  stage: DatePlaybookStage;
  tags: string[];
  guidance: string;
  example: string;
  priority: number;
  active: boolean;
  /** Every tag must be present. `tags` remains the broad OR match for legacy cards. */
  requiredTags?: string[];
  excludedTags?: string[];
};

/** Versioned source of truth. The sync script publishes these cards to Supabase;
 * the in-repo copy keeps local development and DB outages deterministic. */
export const DATE_PLAYBOOK: DatePlaybookCard[] = [
  {
    id: "interpret-whole-utterance", version: 1, title: "문장 전체로 여행 의도 해석", stage: "interpretation", tags: ["all"], priority: 100, active: true,
    guidance: "사용자 발화를 단어 목록으로 분해해 지역이나 활동을 추측하지 않는다. 먼저 문장 전체의 행위(여행 계획, 데이트 계획, 장소 추천, 질문, 일정 수정)와 시간 범위를 파악한 다음 지역·제약을 구조화한다. 여행가려구의 '구' 같은 어미는 행정구역이 아니다. 문장에 없는 지역·활동·날짜는 만들지 않는다.",
    example: "부산여행갈래는 목적지 부산과 여행 의향이다. 여행갈래는 별도 지역이 아니며 숙박 일수는 아직 미정이다.",
  },
  {
    id: "interpret-conversation-context", version: 1, title: "이전 대화와 수정 범위 해석", stage: "interpretation", tags: ["all"], priority: 98, active: true,
    guidance: "현재 메시지가 이전 질문에 대한 답인지, 기존 코스 수정인지, 새 코스 요청인지 최근 대화와 현재 코스를 함께 보고 결정한다. '2박3일'은 앞선 여행 목적지의 기간을 채우는 답일 수 있다. 새 장소와 예약 시간은 명시적으로 교체 요청하지 않는 한 보존한다.",
    example: "부산 여행 이야기를 하다가 2박3일이라고 답하면 부산을 유지하고 숙박 2박을 설정한다.",
  },
  {
    id: "interpret-grounded-slots", version: 1, title: "구조화된 의미와 근거 검증", stage: "interpretation", tags: ["all"], priority: 97, active: true,
    guidance: "AI는 의도, 목적지, 체류 기간, 명시한 활동, 수정 동작, 불확실한 항목을 분리해 반환한다. 목적지는 발화에 실제로 등장하는 지명이나 이전 대화의 확정 목적지만 허용한다. 불확실한 핵심 조건은 질문하고, 확인되지 않은 조건을 임의로 채우지 않는다.",
    example: "부산 여행가려구는 부산만 목적지로 기록하고 기간을 질문한다. 2박3일로 짜줘를 받으면 2박을 기록한다.",
  },
  {
    id: "experience-anchor", version: 1, title: "경험 앵커부터 정하기", stage: "discovery", tags: ["all"], priority: 94, active: true,
    guidance: "사용자가 명시한 공연·전시·영화·특정 식사를 코스의 앵커로 잡고, 나머지 검색을 앵커 주변 경험으로 좁힌다. 모든 요청에 식사→카페→산책을 강요하지 않는다.",
    example: "공연 데이트라면 공연 회차와 공연장을 먼저 확인한 뒤 근처 저녁 식사와 카페를 찾는다.",
  },
  {
    id: "photo-date-search", version: 1, title: "사진을 남기는 데이트 탐색", stage: "discovery", tags: ["all", "photo", "atmosphere"], requiredTags: ["photo"], priority: 88, active: true,
    guidance: "사진을 좋아한다면 실제 공간·채광·전망·전시 장면처럼 촬영할 대상이 있는 장소를 탐색한다. 사진 취향만으로 카페를 필수로 만들거나 인스타 인기만으로 장소를 확정하지 않는다. 촬영 제한과 붐비는 시간은 확인되지 않으면 미확인으로 남긴다.",
    example: "사진 찍는 걸 좋아하지만 카페는 싫다는 요청에는 전망 산책길과 촬영 가능한 전시를 비교한다.",
  },
  {
    id: "quiet-conversation-search", version: 1, title: "대화 중심 데이트 탐색", stage: "discovery", tags: ["all", "quiet"], requiredTags: ["quiet"], priority: 88, active: true,
    guidance: "조용한 대화가 목적이면 공연·활동 수보다 머무를 수 있는 공간과 소음 근거를 우선 조사한다. 장소 이름이나 업종만으로 한적하다고 가정하지 않으며 혼잡·대기 근거가 있으면 감점한다. 명시하지 않은 카페를 필수 경험으로 바꾸지 않는다.",
    example: "오랜만에 만나 조용히 이야기하고 싶다면 경험의 끝을 대화하기 좋은 공간으로 연결한다.",
  },
  {
    id: "first-date-pacing", version: 1, title: "첫 데이트의 대화와 활동 균형", stage: "discovery", tags: ["first_date"], requiredTags: ["first_date"], priority: 89, active: true,
    guidance: "첫 데이트는 긴 이동이나 활동 과밀을 피하고 대화가 가능한 시작점과 함께 할 경험 하나를 비교한다. 친밀함의 정도는 추정하지 않으며 사용자가 명시한 취향과 시간 조건을 우선한다.",
    example: "첫 만남에 3시간이 있다면 대화 가능한 공간과 가까운 전시 또는 산책 중 하나를 비교한다.",
  },
  {
    id: "creative-activity", version: 1, title: "함께 만드는 활동 탐색", stage: "discovery", tags: ["creative"], requiredTags: ["creative"], priority: 86, active: true,
    guidance: "공방·원데이 클래스·함께 만드는 활동은 실제 운영 프로그램과 소요시간이 확인된 경우에만 일정에 넣는다. 업체 업종만으로 당일 체험 가능성을 단정하지 않는다.",
    example: "도자기 공방이 검색되어도 해당 날짜의 체험 프로그램이 확인되지 않으면 장소 후보로만 둔다.",
  },
  {
    id: "cafe-space-search", version: 2, title: "예쁜 카페 검색어 설계", stage: "discovery", tags: ["cafe", "atmosphere"], requiredTags: ["cafe", "atmosphere"], priority: 92, active: true,
    guidance: "예쁜 카페를 요청하면 동네명+카페만 반복하지 말고 한옥·정원·통창·테라스·건축·뷰·디저트처럼 공간적 매력을 확인할 수 있는 서로 다른 검색어를 만든다. 보드게임카페는 놀이 슬롯이다.",
    example: "익선동 한옥 카페, 익선동 정원 카페, 익선동 디저트 카페를 비교하되 근거 없는 미감은 단정하지 않는다.",
  },
  {
    id: "meal-signature-search", version: 1, title: "음식 경험 중심 검색", stage: "discovery", tags: ["meal"], priority: 87, active: true,
    guidance: "식당은 막연한 맛집보다 사용자의 음식 취향·대표 메뉴·조리 특징·식사 분위기로 찾는다. 특정 음식이 없다면 서로 다른 음식 경험 후보를 확보한다.",
    example: "파스타 요청에는 양식 일반 검색과 파스타 전문점 검색을 함께 쓰고 메뉴 근거를 비교한다.",
  },
  {
    id: "event-is-not-venue", version: 2, title: "행사와 건물 분리", stage: "discovery", tags: ["performance", "exhibit", "movie", "date_specific"], requiredTags: ["cultural_event"], priority: 98, active: true,
    guidance: "공연장·전시장·영화관의 존재는 그날 볼 공연·전시·상영의 증거가 아니다. 날짜가 있으면 행사 ID·기간·회차를 먼저 확인하고, 없으면 장소 방문 후보라고만 표현한다.",
    example: "소월아트홀 검색 결과는 공연장 후보이고, 해당 날짜의 공연은 별도 공연 데이터로 확인한다.",
  },
  {
    id: "performance-evening-recipe", version: 2, title: "공연 중심 저녁 데이트", stage: "discovery", tags: ["performance", "meal"], requiredTags: ["performance", "meal"], priority: 90, active: true,
    guidance: "공연 데이트는 실제 공연 회차를 앵커로 하고 사용자가 요청한 순서를 지킨다. 공연 전 식사 후보와 공연 후 짧게 머물 카페 후보를 각각 조사하되, 영업·예매·이동은 확인 가능한 범위만 말한다.",
    example: "저녁→카페→공연 요청이면 식당·카페·공연을 그 순서로 찾고, 공연 회차가 없으면 공연장 방문 후보와 구분한다.",
  },
  {
    id: "cafe-destination-recipe", version: 2, title: "공간이 목적지인 카페 데이트", stage: "discovery", tags: ["cafe", "atmosphere"], requiredTags: ["cafe", "atmosphere"], priority: 89, active: true,
    guidance: "카페의 분위기가 핵심이면 카페를 코스 앵커로 보고 공간·뷰·건축 등 검증 가능한 특징이 다른 후보를 확보한다. 주변에는 그 분위기와 어울리는 한 가지 경험을 고르고 임의의 프랜차이즈나 보드게임카페로 대체하지 않는다.",
    example: "정원 카페를 원하면 정원 좌석 근거가 있는 후보를 먼저 비교하고 가까운 산책·전시를 선택지로 검토한다.",
  },
  {
    id: "food-destination-recipe", version: 2, title: "한 끼가 중심인 음식 데이트", stage: "discovery", tags: ["meal"], requiredTags: ["meal"], excludedTags: ["performance"], priority: 82, active: true,
    guidance: "특정 음식·식당이 핵심이면 대표 메뉴와 식사 분위기를 먼저 확인한다. 다음 장소는 같은 종류의 한 끼를 반복하지 않는 카페·공연·볼거리로 찾는다. 미식 투어를 명시한 경우에만 식사를 여러 곳 비교한다.",
    example: "파스타 저녁 뒤에 또 다른 식당 대신 공간 매력의 카페나 예약한 공연을 잇는다.",
  },
  {
    id: "neighborhood-scope", version: 1, title: "동네 범위와 앵커 주변 후보", stage: "discovery", tags: ["all"], priority: 76, active: true,
    guidance: "요청한 동네의 핵심 구역을 우선 검색하고 후보가 부족할 때만 인접 구역으로 확장한다. 같은 행정구라는 이유로 먼 장소를 코스에 넣지 않는다.",
    example: "왕십리 코스를 찾다가 후보가 부족하면 한 정거장 범위를 허용한 요청에서만 성수까지 넓힌다.",
  },
  {
    id: "venue-specific-evidence", version: 1, title: "장소별 선택 근거", stage: "selection", tags: ["all"], priority: 100, active: true,
    guidance: "이름·분류·평점·가까운 거리만으로 예쁘다, 맛있다, 공연 중이라고 판단하지 않는다. 요청한 속성과 정확한 지점의 근거가 연결된 후보를 높게 평가한다.",
    example: "카페 공간을 원했다면 그 지점의 통창·정원 같은 근거가 있는 카페가 단순 근거리 카페보다 우선이다.",
  },
  {
    id: "experience-diversity", version: 1, title: "경험 중복 제거", stage: "selection", tags: ["all"], priority: 95, active: true,
    guidance: "기본 코스는 한 끼 식사와 카페를 중심으로 서로 다른 경험을 연결한다. 명시적인 미식·카페 투어가 아니면 동일 역할이나 같은 음식 계열을 반복하지 않는다.",
    example: "칼국수 뒤에 냉면집을 추가하는 대신 산책·전시·공방처럼 다른 경험을 검토한다.",
  },
  {
    id: "anchor-route", version: 1, title: "좋은 장소를 중심으로 동선 평가", stage: "selection", tags: ["all"], priority: 92, active: true,
    guidance: "가장 매력적인 검증 장소를 앵커로 두고 전후 이동을 평가한다. 직선거리는 1차 필터일 뿐이며, 실제 보행 경로가 있으면 우회와 되돌아감을 비교한다. 사용자 순서 제약을 보존한다.",
    example: "전시가 핵심이면 전시장 인근의 식사·카페 조합을 여러 개 만들고 실제 이동 거리로 최종 비교한다.",
  },
  {
    id: "cafe-space-evidence", version: 2, title: "카페의 미감 근거", stage: "selection", tags: ["cafe", "atmosphere"], requiredTags: ["cafe", "atmosphere"], priority: 99, active: true,
    guidance: "예쁜 카페의 근거는 정확한 지점의 공간·뷰·건축·좌석·정원처럼 공간을 설명해야 한다. 메뉴만 알려진 카페는 미감 조건 충족으로 계산하지 않는다.",
    example: "디저트 메뉴만 확인한 카페보다 한옥 내부와 정원 좌석이 출처에 확인된 카페가 요청에 더 맞다.",
  },
  {
    id: "meal-fit", version: 1, title: "식당의 대표 경험 비교", stage: "selection", tags: ["meal"], priority: 88, active: true,
    guidance: "식당 후보는 실제 메뉴·재료·조리 방식과 사용자의 음식 취향을 대조한다. 평점이나 후기 수만으로 맛을 단정하지 않고, 연속 식사의 종류도 살핀다.",
    example: "파스타를 원하면 면·소스·대표 메뉴가 확인된 지점을 고르고, 근거 없는 양식당을 자동 선택하지 않는다.",
  },
  {
    id: "date-event-validity", version: 2, title: "날짜가 있는 문화 경험 검증", stage: "selection", tags: ["performance", "exhibit", "movie", "date_specific"], requiredTags: ["date_specific", "cultural_event"], priority: 100, active: true,
    guidance: "날짜가 지정된 문화 경험은 행사 ID와 개최 기간·회차·장소가 모두 일치해야 완료로 판단한다. 일정 정보가 없으면 건물 방문과 실제 관람을 구분한다.",
    example: "전시장 주소만 확인됐다면 현재 전시를 관람할 수 있다고 쓰지 않는다.",
  },
  {
    id: "couple-preferences", version: 1, title: "두 사람의 취향 활용", stage: "selection", tags: ["personalized"], priority: 85, active: true,
    guidance: "두 사람의 저장·방문·싫어요 기록은 후보 적합도에 반영하되, 사용자가 명시한 최신 요청을 덮지 않는다. 이미 자주 간 곳은 재방문 의도가 있을 때만 우선한다.",
    example: "두 사람이 저장한 카페라도 이번에 요청한 정원 분위기와 맞지 않으면 다른 후보와 비교한다.",
  },
  {
    id: "low-walking", version: 1, title: "이동 제약 보존", stage: "selection", tags: ["low_walking", "accessible"], priority: 96, active: true,
    guidance: "걷기 제약이 있으면 짧은 보행·대중교통 접근성을 먼저 확인하고 계단·언덕 정보를 모르면 단정하지 않는다. 장소 품질을 유지하면서 이동 부담을 줄이는 조합을 찾는다.",
    example: "도보를 줄여 달라면 직선거리만 짧은 코스를 편하다고 단정하지 않는다.",
  },
  {
    id: "swap-contract", version: 2, title: "교체는 대상 슬롯만 변경", stage: "editing", tags: ["edit", "swap"], requiredTags: ["edit", "swap"], priority: 100, active: true,
    guidance: "식당 변경은 식당만, 카페 변경은 순수 카페만 교체한다. 사용자가 유지하라고 한 장소의 ID와 역할을 보존하고, 후보가 없으면 원래 코스를 유지한다.",
    example: "소월아트홀은 할리스 소월아트홀점으로 대체할 수 없다.",
  },
  {
    id: "add-new-experience", version: 2, title: "추가는 새로운 경험", stage: "editing", tags: ["edit", "add"], requiredTags: ["edit", "add"], priority: 99, active: true,
    guidance: "일정 추가는 장소 수뿐 아니라 경험 종류가 실제로 늘어야 성공이다. 이미 식사와 카페가 있으면 또 다른 식당·카페를 자동 추가하지 않는다. 의도가 불명확하면 짧게 물어본다.",
    example: "식사·카페·공연 코스에 추가할 때 산책·전시·디저트 중 원하는 경험을 확인한다.",
  },
  {
    id: "explain-choice", version: 1, title: "추천 이유는 취향과 사실을 연결", stage: "response", tags: ["all"], priority: 99, active: true,
    guidance: "한 줄 코스 이유와 각 장소의 고유한 선택 이유를 말한다. 근거로 확인한 사실, 두 사람 취향의 추론, 확인이 필요한 정보를 분리한다. 주소·카테고리 반복이나 확인 가능한 장소라는 일반론을 피한다.",
    example: "한옥 공간을 원하셔서 정원 좌석이 소개된 이 카페를 골랐어요. 운영 여부는 방문 전에 확인해 주세요.",
  },
  {
    id: "uncertainty-is-useful", version: 1, title: "미확인은 미확인으로 표현", stage: "response", tags: ["all"], priority: 96, active: true,
    guidance: "검색 근거가 부족하면 맛·미감·예약·영업을 만들어내지 않는다. 무엇을 확인하지 못했고 무엇을 확인하면 좋은지 간결하게 밝힌다. 낮은 품질의 대체 코스를 완성된 AI 추천처럼 포장하지 않는다.",
    example: "카페의 공간 사진은 확인하지 못했으니, 방문 전 내부 사진을 살펴보세요.",
  },
  {
    id: "time-window-feasibility", version: 1, title: "시간 앵커와 여유 시간", stage: "selection", tags: ["date_specific", "time_specific"], priority: 97, active: true,
    guidance: "공연 시작 시각, 사용자가 지정한 순서, 식사와 이동 시간을 함께 배치한다. 출발·마감·영업 시각이 확인되지 않았다면 입장 가능이나 예약 가능을 확정하지 않는다. 성립하지 않는 코스는 장소를 억지로 채우지 않는다.",
    example: "19시 공연이면 식사와 이동을 공연 전에 끝낼 수 있는 후보만 확정 일정으로 제시한다.",
  },
  {
    id: "evidence-freshness", version: 1, title: "변동 정보는 재확인", stage: "selection", tags: ["all"], priority: 91, active: true,
    guidance: "장소의 고정된 공간 특징과 달리 공연 회차·영업·가격·좌석은 변동 정보다. 날짜가 지정되면 공급자에서 다시 조회하고, 출처가 검색 요약뿐이면 원문 확인으로 격상하지 않는다. 검증 수준을 속성별로 기록한다.",
    example: "작년 블로그의 영업시간으로 이번 주 토요일의 이용 가능성을 확정하지 않는다.",
  },
  {
    id: "budget-and-access", version: 1, title: "비용과 접근성 확인", stage: "selection", tags: ["budget", "accessible", "low_walking"], priority: 90, active: true,
    guidance: "예산·계단·휠체어·긴 도보처럼 사용자가 명시한 제약은 추정 가격이나 직선거리로 충족 처리하지 않는다. 핵심 정보가 없으면 확인이 필요한 후보로 표시하고 무리한 확정 코스를 피한다.",
    example: "메뉴 가격을 모르는 식당을 두 사람 5만원 예산 안이라고 단정하지 않는다.",
  },
  {
    id: "food-exclusion-check", version: 1, title: "음식 제외 조건 검증", stage: "selection", tags: ["all", "food_safety"], requiredTags: ["food_safety"], priority: 96, active: true,
    guidance: "사용자가 못 먹거나 제외한 재료가 장소명·메뉴 근거에 나오면 후보에서 제외한다. 메뉴 정보가 없다는 사실을 안전하다는 증거로 취급하지 않는다. 알레르기는 검색 요약이나 일반 메뉴만으로 안전성을 확정하지 않고 식당의 직접 확인이 필요하다.",
    example: "해산물을 못 먹는 요청에서는 해물·봉골레 식당을 빼고, 알레르기라면 교차 접촉까지 확인되지 않은 식당을 확정하지 않는다.",
  },
  {
    id: "weather-and-occasion", version: 2, title: "기념일과 짧은 일정의 경험", stage: "discovery", tags: ["occasion", "short_date", "nightview", "indoor"], priority: 86, active: true,
    guidance: "기념일에는 관계 맥락과 기억에 남는 경험을, 짧은 일정에는 적은 장소 수를, 야경 요청에는 실제 관람 가능 시각을 우선 조사한다. 사용자 요청이 없는 특별한 상황을 임의로 만들지 않는다.",
    example: "생일 데이트는 단순 인기 장소 나열보다 두 사람 취향에 맞는 중심 경험과 편안한 마무리를 찾는다.",
  },
  {
    id: "occasion-personalization", version: 1, title: "특별한 날의 취향 반영", stage: "selection", tags: ["occasion"], requiredTags: ["occasion"], priority: 92, active: true,
    guidance: "생일·기념일·화해처럼 관계 맥락이 있는 날은 과거 호불호와 명시한 기대를 후보 평가에 반영한다. 이벤트라는 이유만으로 고가 장소를 선택하거나 관계 감정을 단정하지 않는다.",
    example: "조용한 생일을 원한다면 붐비는 유명 장소보다 대화하기 좋은 검증된 경험을 높게 평가한다.",
  },
  {
    id: "safe-relaxation", version: 1, title: "후보 부족 시 완화 순서", stage: "response", tags: ["all"], priority: 88, active: true,
    guidance: "필수 조건을 만족하는 후보가 없으면 미확인 장소를 확정 추천하지 않는다. 어떤 조건 때문에 실패했는지 한 가지로 설명하고, 시간·지역·활동 중 사용자가 선택할 수 있는 최소 완화안을 제시한다. 기존 코스 수정은 실패 시 그대로 유지한다.",
    example: "방문일 공연 회차가 없으면 공연장을 공연 관람으로 포장하지 않고 인근 날짜를 물어본다.",
  },
  {
    id: "trip-experience-anchor", version: 1, title: "여행의 목적 경험부터 조사", stage: "discovery", tags: ["travel"], requiredTags: ["travel"], priority: 98, active: true,
    guidance: "여행은 관광지 이름을 나열하거나 식사·카페 수를 채우는 작업이 아니다. 사용자가 원하는 풍경·지역 음식·문화·휴식 중 여행의 핵심 경험을 먼저 정하고, 각 후보가 그 목적에 주는 실제 경험과 방문 근거를 조사한다. 당일치기와 숙박 여행 모두 적용한다.",
    example: "포천 호수 여행이면 호수에서 무엇을 하고 얼마나 머무를지 확인한 뒤 주변 식사와 다음 경험을 찾는다.",
  },
  {
    id: "trip-day-clusters", version: 1, title: "하루마다 한 지역 묶기", stage: "discovery", tags: ["travel"], requiredTags: ["travel"], priority: 96, active: true,
    guidance: "여러 날 여행은 매일 중심 지역 하나와 근처 보완 경험을 조사한다. 숙소 위치가 확인되면 체크인 전후·다음 날 출발 동선을 연결하고, 없으면 숙소를 임의로 가정하지 않는다. 넓은 지역을 하루에 지그재그로 횡단하는 검색 결과를 피한다.",
    example: "군산 1박2일은 첫날 근대거리 일대, 둘째 날 다른 지역을 묶되 숙소가 없다면 두 날 사이 이동은 미확정으로 둔다.",
  },
  {
    id: "trip-arrival-departure", version: 1, title: "도착과 출발 시간의 여백", stage: "discovery", tags: ["travel"], requiredTags: ["travel"], priority: 94, active: true,
    guidance: "출발지·도착 시각·귀가 시각을 모르면 첫날 오전과 마지막 날 저녁을 이용할 수 있다고 가정하지 않는다. 교통편이나 체크인·체크아웃이 확인되지 않은 구간은 관광 일정에 억지로 배정하지 않고 여유 있는 후보로 둔다.",
    example: "제주 1박2일에서 항공편을 모르면 첫날 이른 아침 관광과 마지막 날 늦은 야경을 확정하지 않는다.",
  },
  {
    id: "trip-daily-balance", version: 2, title: "일자별 경험과 식사의 균형", stage: "selection", tags: ["travel"], requiredTags: ["travel"], priority: 98, active: true,
    guidance: "각 여행일은 장소별 근거가 있는 핵심 경험과 쉬어 갈 시간을 함께 갖는다. 하루에 장소를 몰아 넣고 다른 날을 비우지 않는다. 식사는 동선과 체류 시간에 맞춰 배치하되, 미식 여행을 명시하지 않았다면 식당·카페로 일정을 채우지 않는다. 핵심 경험의 근거가 없으면 완성 여행 코스로 확정하지 않는다.",
    example: "첫날 명소 세 곳, 둘째 날 카페 한 곳뿐인 1박2일 코스는 일자별 균형을 다시 평가한다.",
  },
  {
    id: "trip-transport-feasibility", version: 1, title: "장거리 이동을 실제 일정으로 계산", stage: "selection", tags: ["travel"], requiredTags: ["travel"], priority: 97, active: true,
    guidance: "직선거리는 이동 수단·도로·환승·주차를 설명하지 못한다. 차량 여부를 추정하지 않고, 긴 이동의 시간은 최소 추정으로만 사용한다. 실제 경로가 없으면 이동 시간을 확정하지 않으며 하루 중 장거리 이동을 반복하지 않는다.",
    example: "차가 없다고 했는데 서로 30km 떨어진 명소를 짧은 산책처럼 잇지 않는다.",
  },
  {
    id: "trip-cross-day-variety", version: 1, title: "날마다 다른 여행 경험", stage: "selection", tags: ["travel"], requiredTags: ["travel"], priority: 96, active: true,
    guidance: "각 날에 관광지를 하나씩 넣었다는 이유만으로 여행이 다양하다고 판단하지 않는다. 같은 거리의 비슷한 역사 산책·포토존을 다른 날의 핵심 경험으로 반복하지 말고, 전시·자연·체험·지역 음식 등 방문 목적과 분위기가 달라지는 대안을 비교한다. 다만 특정 주제 탐방을 요청했다면 주제의 연속성을 우선한다.",
    example: "첫날 근대 건축 산책을 했다면 다음 날은 같은 골목의 사진 명소보다 해안 풍경이나 체험 가능한 박물관을 비교한다.",
  },
  {
    id: "trip-dated-attractions", version: 1, title: "여행 일자별 축제·전시 확인", stage: "selection", tags: ["travel", "date_specific"], requiredTags: ["travel", "date_specific"], priority: 99, active: true,
    guidance: "축제·계절 행사·공연은 여행 전체 기간에 열린다는 사실만으로 선택한 날짜에 관람 가능하다고 보지 않는다. 배정된 일차의 날짜, 행사 기간, 회차와 장소를 각각 맞춘다. 특정 날짜 자료가 없으면 방문 후보와 실제 관람을 구분한다.",
    example: "토요일 축제를 일요일 일정에 넣지 않고, 2일차 행사라면 2일차 날짜로 확인한다.",
  },
  {
    id: "trip-stay-contract", version: 1, title: "숙소 미확정 상태를 명시", stage: "response", tags: ["overnight"], requiredTags: ["overnight"], priority: 97, active: true,
    guidance: "숙박 여행의 관광 코스와 예약 가능한 완성 여행을 구분한다. 숙소·교통편·체크인·체크아웃이 확보되지 않았으면 추천 일정의 빈 가정을 간결하게 밝히고, 숙소 위치를 받으면 일자별 동선을 다시 맞출 수 있게 한다.",
    example: "관광 코스는 만들었지만 숙소와 도착·귀가 교통편은 아직 반영되지 않았어요.",
  },
  {
    id: "trip-day-edit", version: 1, title: "여행 수정은 일차도 보존", stage: "editing", tags: ["travel", "edit"], requiredTags: ["travel", "edit"], priority: 97, active: true,
    guidance: "여행 코스에서 한 장소를 바꿀 때 다른 날의 장소와 일차 배정을 함부로 옮기지 않는다. 일차 이동을 명시적으로 요청했다면 그 변화와 연결 이동을 다시 검사한다. 교체 후보가 없으면 원래 여행 일정을 유지한다.",
    example: "2일차 카페 변경은 1일차 관광지를 재배치하지 않는다.",
  },
];

const CACHE_MS = 10 * 60_000;
let cached: { expiresAt: number; cards: DatePlaybookCard[] } | null = null;
let inflight: Promise<DatePlaybookCard[]> | null = null;

async function loadPlaybook(): Promise<DatePlaybookCard[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.cards;
  if (inflight) return inflight;
  inflight = (async () => {
    const client = createServiceClient();
    if (!client) {
      console.info("date_playbook_load", { source: "bundled", reason: "database_unconfigured" });
      return DATE_PLAYBOOK;
    }
    try {
      const { data, error } = await client.from("date_planning_playbook")
        .select("id,version,title,stage,tags,guidance,example,priority,active,required_tags,excluded_tags");
      if (error || !data?.length) {
        console.info("date_playbook_load", { source: "bundled", reason: error?.code ?? "empty_database" });
        return DATE_PLAYBOOK;
      }
      // A partial or older publish must not silently remove planning rules.
      const versions = new Map(data.map(row => [row.id, row.version]));
      if (DATE_PLAYBOOK.some(card => (versions.get(card.id) ?? 0) < card.version)) {
        console.info("date_playbook_load", { source: "bundled", reason: "stale_database" });
        return DATE_PLAYBOOK;
      }
      const rows = data.filter(row => row.active && ["interpretation", "discovery", "selection", "editing", "response"].includes(row.stage))
        .map(row => ({ ...row, requiredTags: row.required_tags, excludedTags: row.excluded_tags })) as DatePlaybookCard[];
      console.info("date_playbook_load", { source: "database", cards: rows.length });
      return rows;
    } catch {
      console.info("date_playbook_load", { source: "bundled", reason: "database_error" });
      return DATE_PLAYBOOK;
    }
  })().then(cards => {
    cached = { expiresAt: Date.now() + CACHE_MS, cards };
    return cards;
  }).finally(() => { inflight = null; });
  return inflight;
}

export function datePlaybookTags(message: string, state: AIPlannerState) {
  // Current structured state carries continuing preferences; old free-text
  // turns may contain a preference the user has since corrected.
  const text = message;
  const tags = new Set<string>(["all", ...state.activities]);
  if (["performance", "exhibit", "movie"].some(tag => tags.has(tag))) tags.add("cultural_event");
  if (/예쁜|아름다운|분위기|인테리어|한옥|정원|테라스|통창|전망|뷰/.test(text)) tags.add("atmosphere");
  if (/사진|인생샷|포토/.test(text) || state.preferences?.vibe.some(vibe => /사진|포토/.test(vibe))) tags.add("photo");
  if (/조용|한적|대화/.test(text) || (state.preferences?.crowdTolerance ?? 1) < 0.4) tags.add("quiet");
  if (/첫\s*(?:만남|데이트)|소개팅/.test(text)) tags.add("first_date");
  if (/공방|원데이\s*클래스|도자기|향수\s*만들|함께\s*만들/.test(text)) tags.add("creative");
  if ((state.excludedFoods?.length ?? 0) > 0) tags.add("food_safety");
  if (/공연|연극|뮤지컬|콘서트/.test(text)) tags.add("performance");
  if (/전시|갤러리|미술관|박물관/.test(text)) tags.add("exhibit");
  if (/영화|극장/.test(text)) tags.add("movie");
  if (["performance", "exhibit", "movie"].some(tag => tags.has(tag))) tags.add("cultural_event");
  if (/식당|식사|저녁|점심|음식|파스타|맛집/.test(text)
    && !/(?:식당|식사|음식|맛집).{0,12}(?:싫|안\s*가|제외|빼)/.test(text)) tags.add("meal");
  if (/카페|커피|디저트/.test(text)
    && !/(?:카페|커피|디저트).{0,12}(?:싫|안\s*가|제외|빼|별로)/.test(text)) tags.add("cafe");
  if (/적게\s*걷|걷기\s*힘|도보\s*짧|이동\s*적/.test(text) || state.walkingPreference === "short") tags.add("low_walking");
  if (/휠체어|유모차|계단\s*없/.test(text)) tags.add("accessible");
  if (state.dateLabel || /오늘|내일|이번\s*주|\d{1,2}월\s*\d{1,2}일/.test(text)) tags.add("date_specific");
  if (state.startTime || state.endTime || /\d{1,2}시|오전|오후|저녁\s*\d/.test(text)) tags.add("time_specific");
  if (state.budgetWon || /예산|만원|비용/.test(text)) tags.add("budget");
  if (/기념일|생일|프로포즈|특별한\s*날|화해/.test(text)) tags.add("occasion");
  if (/짧게|잠깐|한\s*두\s*시간/.test(text)) tags.add("short_date");
  if (state.requiredPlaces.length || state.excludedPlaces.length || state.pinOrder.length) tags.add("personalized");
  if (state.intent === "modify" || state.preserveExistingPlaces) tags.add("edit");
  if (state.addStop || /추가|한\s*곳\s*더/.test(text)) tags.add("add");
  if ((state.intent === "modify" && state.excludedPlaces.length > 0) || /변경|교체|바꿔/.test(text)) tags.add("swap");
  if (isTravelPlan(state)) tags.add("travel");
  if (state.stayKind === "overnight" || state.nights > 0) tags.add("overnight");
  if (state.stayKind === "daytrip") tags.add("daytrip");
  return tags;
}

export function selectDatePlaybook(cards: DatePlaybookCard[], tags: ReadonlySet<string>, stage: DatePlaybookStage, limit = 5) {
  return cards.filter(card => card.active && card.stage === stage
    && card.tags.some(tag => tags.has(tag))
    && (card.requiredTags ?? []).every(tag => tags.has(tag))
    && !(card.excludedTags ?? []).some(tag => tags.has(tag)))
    .map(card => ({ card, score: card.priority + card.tags.filter(tag => tag !== "all" && tags.has(tag)).length * 12 }))
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, limit).map(item => item.card);
}

export async function retrieveDatePlaybook(message: string, state: AIPlannerState, stage: DatePlaybookStage, limit = 5, extraTags: string[] = []) {
  const tags = datePlaybookTags(message, state);
  extraTags.forEach(tag => tags.add(tag));
  const all = await loadPlaybook();
  const query = [message, state.objective, ...(state.preferences?.vibe ?? []), ...(state.discovery?.priorities ?? [])]
    .filter(Boolean).join(" ").slice(0, 700);
  const similarity = !query ? new Map<string, number>() : await playbookSemanticScores(query, all, stage);
  const cards = similarity.size ? all.filter(card => card.active && card.stage === stage
    && (card.requiredTags ?? []).every(tag => tags.has(tag))
    && !(card.excludedTags ?? []).some(tag => tags.has(tag)))
    .map(card => ({ card, score: (similarity.get(card.id) ?? 0) * 100
      + card.priority * 0.18 + card.tags.filter(tag => tag !== "all" && tags.has(tag)).length * 5 }))
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, limit).map(item => item.card)
    : selectDatePlaybook(all, tags, stage, limit);
  console.info("date_playbook_retrieval", { stage, ids: cards.map(card => card.id) });
  return cards.map(card => ({ id: card.id, title: card.title, guidance: card.guidance, example: card.example }));
}
