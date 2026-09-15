import type { Place } from "../types/place";

export const PLACES: Place[] = [
  { id: "lapar", name: "카페 라파르", category: "cafe", categoryLabel: "카페", district: "군산 월명동", description: "조용한 창가와 오래 머물기 좋은 오후", durationMinutes: 90, expectedCostTwo: 22000, coordinates: [126.7086, 35.9879], image: "/assets/cafe-memory.png", visualTone: "photo", userStatus: "want", partnerStatus: "must_visit", userFit: 88, partnerFit: 96 },
  { id: "chowon", name: "초원사진관", category: "photo", categoryLabel: "사진", district: "군산 신창동", description: "오래된 골목에서 남기는 둘의 한 장", durationMinutes: 50, expectedCostTwo: 0, coordinates: [126.7108, 35.9892], visualTone: "brown", userStatus: "want", partnerStatus: "want", userFit: 92, partnerFit: 84 },
  { id: "eunpa", name: "은파호수공원", category: "nature", categoryLabel: "산책", district: "군산 나운동", description: "노을이 물 위에 머무는 느린 산책", durationMinutes: 120, expectedCostTwo: 0, coordinates: [126.6894, 35.9553], visualTone: "blue", userStatus: "revisit", partnerStatus: "revisit", userFit: 90, partnerFit: 91 },
  { id: "lee", name: "이성당", category: "cafe", categoryLabel: "베이커리", district: "군산 중앙로", description: "여행 가방에 챙겨올 단팥빵 두 개", durationMinutes: 40, expectedCostTwo: 18000, coordinates: [126.7116, 35.9871], visualTone: "brown", userStatus: "neutral", partnerStatus: "visited", userFit: 78, partnerFit: 89 },
  { id: "book", name: "마리서사", category: "book", categoryLabel: "책방", district: "군산 월명동", description: "여행 중 잠시 고르는 서로의 책", durationMinutes: 60, expectedCostTwo: 30000, coordinates: [126.7049, 35.9898], visualTone: "green", userStatus: "must_visit", partnerStatus: "want", userFit: 95, partnerFit: 82 },
  { id: "hanju", name: "한주옥", category: "restaurant", categoryLabel: "한식", district: "군산 영화동", description: "여행의 시작을 여는 따뜻한 한 상", durationMinutes: 70, expectedCostTwo: 48000, coordinates: [126.7082, 35.9906], visualTone: "brown", userStatus: "revisit", partnerStatus: "revisit", userFit: 87, partnerFit: 93 },
];
