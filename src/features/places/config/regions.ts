export type PlaceSubArea = {
  id: string;
  label: string;
  query: string;
  coordinates: [number, number];
  areaCode: number;
  sigunguCode?: number;
  radius: number;
};

export type PlaceAreaGroup = {
  id: string;
  label: string;
  query: string;
  coordinates: [number, number];
  areaCode: number;
  sigunguCode?: number;
  areas: ReadonlyArray<PlaceSubArea>;
};

export type PlaceArea = {
  query: string;
  coordinates: [number, number];
  areaCode: number;
  sigunguCode?: number;
  radius?: number;
};

type Coords = [number, number];

function area(
  id: string,
  label: string,
  query: string,
  coordinates: Coords,
  areaCode: number,
  extras?: { sigunguCode?: number; radius?: number },
): PlaceSubArea {
  return {
    id,
    label,
    query,
    coordinates,
    areaCode,
    sigunguCode: extras?.sigunguCode,
    radius: extras?.radius ?? 3000,
  };
}

export const PLACE_AREA_GROUPS: ReadonlyArray<PlaceAreaGroup> = [
  {
    id: "seoul",
    label: "서울",
    query: "서울",
    coordinates: [126.978, 37.5665],
    areaCode: 1,
    areas: [
      area("hongdae", "홍대/합정", "홍대", [126.9236, 37.5563], 1, { sigunguCode: 13, radius: 2800 }),
      area("yeonnam", "연남/연희", "연남동", [126.9255, 37.5662], 1, { sigunguCode: 13, radius: 2200 }),
      area("mangwon", "망원/상수", "망원동", [126.91, 37.547], 1, { sigunguCode: 13, radius: 2200 }),
      area("seongsu", "성수/서울숲", "성수동", [127.0559, 37.5446], 1, { sigunguCode: 16, radius: 2500 }),
      area("hannam", "한남/이태원", "이태원", [126.9946, 37.5345], 1, { sigunguCode: 21, radius: 2500 }),
      area("gangnam", "강남/신사", "강남 신사", [127.0286, 37.5172], 1, { sigunguCode: 1, radius: 3200 }),
      area("seocho", "서초/반포", "서초", [127.007, 37.504], 1, { sigunguCode: 15, radius: 3000 }),
      area("jamsil", "잠실/송파", "잠실", [127.1, 37.5145], 1, { sigunguCode: 18, radius: 3000 }),
      area("jongno", "종로/북촌", "북촌", [126.984, 37.5794], 1, { sigunguCode: 23, radius: 2500 }),
      area("euljiro", "을지로/명동", "을지로", [126.997, 37.566], 1, { sigunguCode: 24, radius: 2500 }),
      area("yeouido", "여의도/영등포", "여의도", [126.9245, 37.5219], 1, { sigunguCode: 20, radius: 3000 }),
      area("gundae", "건대/광진", "건대", [127.069, 37.5405], 1, { sigunguCode: 6, radius: 2500 }),
    ],
  },
  {
    id: "gyeonggi",
    label: "경기",
    query: "경기",
    coordinates: [127.0286, 37.2636],
    areaCode: 31,
    areas: [
      area("suwon", "수원", "수원", [127.0286, 37.2636], 31, { sigunguCode: 13, radius: 5000 }),
      area("bundang", "분당/판교", "분당", [127.1189, 37.3827], 31, { sigunguCode: 12, radius: 4500 }),
      area("ilsan", "일산", "일산", [126.7706, 37.6779], 31, { sigunguCode: 2, radius: 4500 }),
      area("paju", "파주/헤이리", "파주", [126.78, 37.7599], 31, { sigunguCode: 27, radius: 8000 }),
      area("gapyeong", "가평/양평", "가평", [127.5106, 37.8315], 31, { sigunguCode: 1, radius: 12000 }),
      area("hanam", "하남/미사", "하남", [127.2146, 37.5393], 31, { sigunguCode: 30, radius: 4500 }),
      area("yongin", "용인/기흥", "용인", [127.1148, 37.2753], 31, { sigunguCode: 23, radius: 7000 }),
    ],
  },
  {
    id: "incheon",
    label: "인천",
    query: "인천",
    coordinates: [126.7052, 37.4563],
    areaCode: 2,
    areas: [
      area("songdo", "송도", "송도", [126.6782, 37.4102], 2, { sigunguCode: 8, radius: 4000 }),
      area("bupyeong", "구월/부평", "부평", [126.7218, 37.507], 2, { sigunguCode: 6, radius: 4000 }),
      area("ganghwa", "강화", "강화", [126.4878, 37.7466], 2, { sigunguCode: 1, radius: 10000 }),
    ],
  },
  {
    id: "gangwon",
    label: "강원",
    query: "강원",
    coordinates: [128.8761, 37.7519],
    areaCode: 32,
    areas: [
      area("gangneung", "강릉", "강릉", [128.8761, 37.7519], 32, { sigunguCode: 1, radius: 8000 }),
      area("sokcho", "속초/양양", "속초", [128.5918, 38.207], 32, { sigunguCode: 5, radius: 12000 }),
      area("chuncheon", "춘천", "춘천", [127.7298, 37.8813], 32, { sigunguCode: 13, radius: 7000 }),
      area("pyeongchang", "평창/정선", "평창", [128.4399, 37.3705], 32, { sigunguCode: 15, radius: 15000 }),
    ],
  },
  {
    id: "busan",
    label: "부산",
    query: "부산",
    coordinates: [129.0756, 35.1796],
    areaCode: 6,
    areas: [
      area("haeundae", "해운대/센텀", "해운대", [129.1636, 35.1631], 6, { sigunguCode: 16, radius: 4000 }),
      area("gwangan", "광안리", "광안리", [129.1186, 35.1532], 6, { sigunguCode: 12, radius: 2500 }),
      area("seomyeon", "서면", "서면", [129.059, 35.157], 6, { sigunguCode: 7, radius: 2500 }),
      area("nampo", "남포/자갈치", "남포동", [129.026, 35.097], 6, { sigunguCode: 15, radius: 2500 }),
      area("gijang", "기장", "기장", [129.2222, 35.2444], 6, { sigunguCode: 3, radius: 8000 }),
    ],
  },
  {
    id: "jeju",
    label: "제주",
    query: "제주",
    coordinates: [126.5312, 33.4996],
    areaCode: 39,
    areas: [
      area("jejusi", "제주시", "제주시", [126.5312, 33.4996], 39, { sigunguCode: 4, radius: 7000 }),
      area("aewol", "애월/한림", "애월", [126.3295, 33.462], 39, { sigunguCode: 4, radius: 10000 }),
      area("seogwipo", "서귀포", "서귀포", [126.56, 33.2541], 39, { sigunguCode: 3, radius: 8000 }),
      area("seongsan", "성산/우도", "성산", [126.908, 33.462], 39, { sigunguCode: 3, radius: 10000 }),
    ],
  },
  {
    id: "chungcheong",
    label: "충청",
    query: "충청",
    coordinates: [127.3845, 36.3504],
    areaCode: 3,
    areas: [
      area("daejeon", "대전", "대전", [127.3845, 36.3504], 3, { radius: 8000 }),
      area("cheongju", "청주", "청주", [127.489, 36.6424], 33, { radius: 7000 }),
      area("cheonan", "천안", "천안", [127.1139, 36.8151], 34, { radius: 7000 }),
    ],
  },
  {
    id: "jeolla",
    label: "전라",
    query: "전라",
    coordinates: [127.148, 35.8242],
    areaCode: 35,
    areas: [
      area("jeonju", "전주", "전주", [127.148, 35.8242], 35, { sigunguCode: 1, radius: 5000 }),
      area("yeosu", "여수", "여수", [127.6622, 34.7604], 36, { sigunguCode: 13, radius: 7000 }),
      area("gwangju", "광주", "광주", [126.8526, 35.1595], 5, { radius: 7000 }),
      area("gunsan", "군산", "군산", [126.7116, 35.9871], 35, { sigunguCode: 2, radius: 6000 }),
    ],
  },
  {
    id: "gyeongsang",
    label: "경상",
    query: "경상",
    coordinates: [128.6014, 35.8714],
    areaCode: 4,
    areas: [
      area("daegu", "대구", "대구", [128.6014, 35.8714], 4, { radius: 8000 }),
      area("gyeongju", "경주", "경주", [129.2247, 35.8562], 37, { sigunguCode: 2, radius: 8000 }),
      area("pohang", "포항", "포항", [129.365, 36.019], 37, { sigunguCode: 17, radius: 7000 }),
      area("ulsan", "울산", "울산", [129.3114, 35.5384], 7, { radius: 8000 }),
      area("changwon", "창원", "창원", [128.6811, 35.2279], 38, { sigunguCode: 1, radius: 7000 }),
    ],
  },
];

export const PLACE_MOODS: ReadonlyArray<{ id: string; label: string; query: string }> = [
  { id: "quiet", label: "조용한 곳", query: "조용한" },
  { id: "view", label: "뷰 좋은 곳", query: "뷰" },
  { id: "walk", label: "산책", query: "산책" },
];

export const DEFAULT_MAP_CENTER: [number, number] = [126.978, 37.5665];

export function areaGroupById(id: string) {
  return PLACE_AREA_GROUPS.find(item => item.id === id);
}

export function regionByQuery(query: string | undefined): PlaceArea | undefined {
  const value = query?.trim() ?? "";
  if (!value) return undefined;
  for (const group of PLACE_AREA_GROUPS) {
    const match = group.areas.find(item => item.query === value || item.label === value || item.id === value);
    if (match) {
      return {
        query: match.query,
        coordinates: match.coordinates,
        areaCode: match.areaCode,
        sigunguCode: match.sigunguCode,
        radius: match.radius,
      };
    }
    if (group.query === value || group.label === value || group.id === value) {
      return {
        query: group.query,
        coordinates: group.coordinates,
        areaCode: group.areaCode,
        sigunguCode: group.sigunguCode,
      };
    }
  }
  return undefined;
}

export function browseDiscoverInput(groupId: string, areaId = "") {
  const group = areaGroupById(groupId);
  if (!group) return { region: groupId };
  const match = areaId && areaId !== "all" ? group.areas.find(item => item.id === areaId) : undefined;
  if (match) {
    return {
      region: match.query,
      x: match.coordinates[0],
      y: match.coordinates[1],
      radius: match.radius,
    };
  }
  return { region: group.query };
}
