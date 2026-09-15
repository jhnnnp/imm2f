import type { PlanItem } from "../types/plan";

export const GUNSAN_DAY_ONE: PlanItem[] = [
  { id: "item-hanju", placeId: "hanju", placeName: "한주옥", category: "BREAKFAST", startTime: "09:30", durationMinutes: 70, expectedCost: 48000, order: 0, memo: "따뜻한 한 상으로 여행 시작" },
  { id: "item-chowon", placeId: "chowon", placeName: "초원사진관", category: "PHOTO", startTime: "11:20", durationMinutes: 50, expectedCost: 0, order: 1, memo: "골목을 천천히 걷고 사진 남기기" },
  { id: "item-lee", placeId: "lee", placeName: "이성당", category: "BAKERY", startTime: "14:00", durationMinutes: 40, expectedCost: 18000, order: 2, memo: "단팥빵 두 개와 잠깐의 쉬는 시간" },
  { id: "item-eunpa", placeId: "eunpa", placeName: "은파호수공원", category: "WALK", startTime: "17:30", durationMinutes: 120, expectedCost: 0, order: 3, memo: "해 질 무렵 호수를 따라 걷기" },
];
