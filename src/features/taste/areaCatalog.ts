import type { TasteAreaVibe } from "./areaVibes";

export type TasteAreaSpot = {
  name: string;
  vibe?: TasteAreaVibe;
};

export type TasteAreaScope = "seoul" | "metro" | "trip";

export type TasteAreaSection = {
  id: string;
  label: string;
  /** 한 줄 — 이 묶음에서 무엇을 기대하는지 */
  tagline: string;
  spots: readonly TasteAreaSpot[];
};

export type TasteAreaRegion = {
  id: string;
  scope: TasteAreaScope;
  label: string;
  subtitle: string;
  hint: string;
  moods: readonly string[];
  sections: readonly TasteAreaSection[];
};

export const TASTE_AREA_CATALOG: readonly TasteAreaRegion[] = [
  {
    id: "seongsu",
    scope: "seoul",
    label: "성수·서울숲",
    subtitle: "동부 · 한강 북쪽",
    hint: "연무장·성수낙낙 카페거리, 서울숲·뚝섬 산책, 왕십리·금호 골목.",
    moods: ["카페", "전시", "골목", "한강"],
    sections: [
      {
        id: "seongsu-core",
        label: "성수 · 연무장",
        tagline: "카페·연무장·성수낙낙",
        spots: [
          { name: "성수", vibe: "카페" },
          { name: "연무장길", vibe: "골목" },
          { name: "성수낙낙", vibe: "전시" },
          { name: "사근동", vibe: "조용" },
          { name: "용답", vibe: "골목" },
          { name: "송림", vibe: "창작" },
        ],
      },
      {
        id: "seongsu-forest",
        label: "서울숲 · 뚝섬",
        tagline: "공원 산책과 한강 접근",
        spots: [
          { name: "서울숲", vibe: "산책" },
          { name: "뚝섬", vibe: "한강" },
          { name: "뚝섬유원지", vibe: "공원" },
          { name: "옥수", vibe: "한강" },
        ],
      },
      {
        id: "seongsu-east",
        label: "왕십리 · 금호",
        tagline: "역 상권·주택가 골목·마장축산",
        spots: [
          { name: "왕십리", vibe: "맛집" },
          { name: "금호", vibe: "조용" },
          { name: "응봉", vibe: "전망" },
          { name: "행당", vibe: "조용" },
          { name: "마장", vibe: "시장" },
        ],
      },
    ],
  },
  {
    id: "gwangjin",
    scope: "seoul",
    label: "건대·광진",
    subtitle: "동부 · 한강 동쪽",
    hint: "건대·화양 상권, 자양·구의·광나루 한강변.",
    moods: ["맛집", "골목", "한강", "피크닉"],
    sections: [
      {
        id: "gwangjin-core",
        label: "건대 · 화양",
        tagline: "건대입구·화양·어린이대공원",
        spots: [
          { name: "건대입구", vibe: "맛집" },
          { name: "화양", vibe: "골목" },
          { name: "능동", vibe: "조용" },
        ],
      },
      {
        id: "gwangjin-river",
        label: "자양 · 광진",
        tagline: "자양·구의·광나루 한강",
        spots: [
          { name: "자양", vibe: "한강" },
          { name: "구의", vibe: "한강" },
          { name: "광나루", vibe: "피크닉" },
          { name: "중곡", vibe: "조용" },
          { name: "송정", vibe: "골목" },
        ],
      },
    ],
  },
  {
    id: "hongdae",
    scope: "seoul",
    label: "홍대·마포",
    subtitle: "서부 · 한강 남쪽",
    hint: "홍대·연남·합정·망원, 경의선숲길과 망원 한강공원.",
    moods: ["카페", "맥주", "산책", "골목"],
    sections: [
      {
        id: "hongdae-west",
        label: "홍대 · 연남",
        tagline: "홍대·연남·합정",
        spots: [
          { name: "홍대", vibe: "맥주" },
          { name: "연남", vibe: "카페" },
          { name: "합정", vibe: "카페" },
        ],
      },
      {
        id: "hongdae-mapo",
        label: "망원 · 마포",
        tagline: "망리단·마포·한강",
        spots: [
          { name: "망원", vibe: "한강" },
          { name: "망리단길", vibe: "카페" },
          { name: "마포", vibe: "맛집" },
        ],
      },
      {
        id: "hongdae-north",
        label: "신촌 · 상암",
        tagline: "캠퍼스·DMC",
        spots: [
          { name: "신촌", vibe: "맛집" },
          { name: "상암", vibe: "전시" },
          { name: "월드컵공원", vibe: "공원" },
        ],
      },
    ],
  },
  {
    id: "euljiro",
    scope: "seoul",
    label: "을지로",
    subtitle: "중심 · 레트로",
    hint: "포장마차·인쇄골목, 청계천·광장시장·명동·동대문.",
    moods: ["포장마차", "골목", "야경", "레트로"],
    sections: [
      {
        id: "euljiro-core",
        label: "을지로",
        tagline: "포장마차·인쇄골목",
        spots: [
          { name: "을지로", vibe: "포장마차" },
          { name: "을지로4가", vibe: "카페" },
          { name: "충무로", vibe: "공연" },
        ],
      },
      {
        id: "euljiro-market",
        label: "청계 · 시장",
        tagline: "청계천·광장시장",
        spots: [
          { name: "청계천", vibe: "산책" },
          { name: "광장시장", vibe: "시장" },
        ],
      },
      {
        id: "euljiro-east",
        label: "명동 · 동대문",
        tagline: "쇼핑·패션",
        spots: [
          { name: "명동", vibe: "쇼핑" },
          { name: "동대문", vibe: "쇼핑" },
        ],
      },
    ],
  },
  {
    id: "jongno",
    scope: "seoul",
    label: "종로·북촌",
    subtitle: "고궁 · 한옥",
    hint: "북촌·서촌·익선, 광화문·인사동·혜화·대학로.",
    moods: ["한옥", "산책", "전시", "공연"],
    sections: [
      {
        id: "jongno-hanok",
        label: "한옥 · 서촌",
        tagline: "북촌·서촌·익선",
        spots: [
          { name: "북촌", vibe: "한옥" },
          { name: "서촌", vibe: "카페" },
          { name: "익선동", vibe: "한옥" },
        ],
      },
      {
        id: "jongno-center",
        label: "광화문 · 종로",
        tagline: "도심 산책·골목",
        spots: [
          { name: "광화문", vibe: "산책" },
          { name: "인사동", vibe: "골목" },
          { name: "종로", vibe: "골목" },
        ],
      },
      {
        id: "jongno-culture",
        label: "혜화 · 궁",
        tagline: "공연·궁원",
        spots: [
          { name: "혜화", vibe: "공연" },
          { name: "대학로", vibe: "공연" },
          { name: "창덕궁", vibe: "유적" },
        ],
      },
    ],
  },
  {
    id: "hannam",
    scope: "seoul",
    label: "한남·용산",
    subtitle: "언덕 · 한강",
    hint: "한남·이태원·해방촌, 리움·이촌 한강·남산.",
    moods: ["브런치", "야경", "전시", "골목"],
    sections: [
      {
        id: "hannam-core",
        label: "한남 · 이태원",
        tagline: "경리단·보광·녹사평",
        spots: [
          { name: "한남", vibe: "브런치" },
          { name: "이태원", vibe: "맛집" },
          { name: "경리단길", vibe: "카페" },
          { name: "보광", vibe: "골목" },
          { name: "녹사평", vibe: "골목" },
          { name: "한강진", vibe: "한강" },
        ],
      },
      {
        id: "hannam-haebang",
        label: "해방촌 · 남산",
        tagline: "언덕 카페·남산 산책",
        spots: [
          { name: "해방촌", vibe: "브런치" },
          { name: "후암", vibe: "조용" },
          { name: "용리단길", vibe: "골목" },
          { name: "남산", vibe: "산책" },
          { name: "남산타워", vibe: "야경" },
        ],
      },
      {
        id: "hannam-yongsan",
        label: "용산 · 이촌",
        tagline: "리움·한강·용산공원",
        spots: [
          { name: "용산", vibe: "맛집" },
          { name: "리움", vibe: "전시" },
          { name: "삼각지", vibe: "골목" },
          { name: "이촌", vibe: "한강" },
          { name: "서빙고", vibe: "조용" },
          { name: "용산공원", vibe: "공원" },
        ],
      },
    ],
  },
  {
    id: "gangnam",
    scope: "seoul",
    label: "강남·서초",
    subtitle: "남부 · 상권",
    hint: "가로수·압구정·청담, 강남·역삼·삼성·코엑스, 서초·교대·방배.",
    moods: ["맛집", "와인", "쇼핑", "야경"],
    sections: [
      {
        id: "gangnam-west",
        label: "신사 · 청담",
        tagline: "가로수·압구정·청담",
        spots: [
          { name: "신사", vibe: "쇼핑" },
          { name: "압구정", vibe: "맛집" },
          { name: "청담", vibe: "와인" },
        ],
      },
      {
        id: "gangnam-core",
        label: "강남 · 삼성",
        tagline: "강남역·역삼·코엑스",
        spots: [
          { name: "강남", vibe: "맛집" },
          { name: "역삼", vibe: "맛집" },
          { name: "삼성", vibe: "실내" },
        ],
      },
      {
        id: "gangnam-south",
        label: "서초 · 논현",
        tagline: "서초·논현·양재",
        spots: [
          { name: "서초", vibe: "맛집" },
          { name: "논현", vibe: "맛집" },
          { name: "양재", vibe: "공원" },
        ],
      },
    ],
  },
  {
    id: "jamsil",
    scope: "seoul",
    label: "잠실·송파",
    subtitle: "동남 · 호수",
    hint: "롯데월드·석촌호수·송리단길·올림픽공원.",
    moods: ["놀이", "호수", "카페", "야경"],
    sections: [
      {
        id: "jamsil-core",
        label: "잠실 · 석촌",
        tagline: "롯데·석촌호수·송리단",
        spots: [
          { name: "잠실", vibe: "놀이" },
          { name: "석촌", vibe: "호수" },
          { name: "송리단길", vibe: "카페" },
          { name: "잠실나루", vibe: "한강" },
          { name: "방이", vibe: "맛집" },
        ],
      },
      {
        id: "jamsil-songpa",
        label: "송파 · 올림픽",
        tagline: "올림픽공원·몽촌·가락",
        spots: [
          { name: "올림픽공원", vibe: "산책" },
          { name: "몽촌", vibe: "유적" },
          { name: "가락", vibe: "시장" },
          { name: "문정", vibe: "맛집" },
        ],
      },
      {
        id: "jamsil-gangdong",
        label: "강동 · 천호",
        tagline: "천호·암사·고덕",
        spots: [
          { name: "천호", vibe: "맛집" },
          { name: "암사", vibe: "유적" },
          { name: "고덕", vibe: "조용" },
          { name: "길동", vibe: "골목" },
          { name: "둔촌", vibe: "조용" },
        ],
      },
    ],
  },
  {
    id: "hangang",
    scope: "seoul",
    label: "한강·영등",
    subtitle: "강변 · 피크닉",
    hint: "여의도·문래·선유도·반포 한강공원. (동네 상권은 홍대·마포 권역)",
    moods: ["피크닉", "야경", "산책", "카페"],
    sections: [
      {
        id: "hangang-yeouido",
        label: "여의도 · 영등포",
        tagline: "63·여의공원·타임스퀘어",
        spots: [
          { name: "여의도", vibe: "피크닉" },
          { name: "여의나루", vibe: "한강" },
          { name: "영등포", vibe: "맛집" },
          { name: "당산", vibe: "골목" },
          { name: "신길", vibe: "조용" },
        ],
      },
      {
        id: "hangang-mullae",
        label: "문래 · 선유도",
        tagline: "문래창작·카페·선유도공원",
        spots: [
          { name: "문래", vibe: "창작" },
          { name: "선유도", vibe: "공원" },
          { name: "도림", vibe: "골목" },
        ],
      },
      {
        id: "hangang-banpo",
        label: "반포 · 잠원",
        tagline: "반포한강·무지개다리·피크닉",
        spots: [
          { name: "반포", vibe: "야경" },
          { name: "잠원", vibe: "한강" },
          { name: "이촌한강", vibe: "피크닉" },
          { name: "뚝섬한강", vibe: "피크닉" },
        ],
      },
    ],
  },
  {
    id: "north",
    scope: "seoul",
    label: "성북·노원",
    subtitle: "북부 · 주택가",
    hint: "성북·안암·정릉 골목, 수유·미아 상권. (공연·대학로는 종로 권역)",
    moods: ["골목", "카페", "조용", "맛집"],
    sections: [
      {
        id: "north-seongbuk",
        label: "성북 · 안암",
        tagline: "성신·고대·정릉",
        spots: [
          { name: "성신", vibe: "골목" },
          { name: "안암", vibe: "맛집" },
          { name: "성북", vibe: "골목" },
          { name: "정릉", vibe: "조용" },
          { name: "길음", vibe: "조용" },
        ],
      },
      {
        id: "north-nowon",
        label: "노원 · 수유",
        tagline: "북동부 생활권",
        spots: [
          { name: "수유", vibe: "맛집" },
          { name: "미아", vibe: "골목" },
          { name: "중계", vibe: "조용" },
        ],
      },
    ],
  },
  {
    id: "bundang",
    scope: "metro",
    label: "분당·판교",
    subtitle: "성남 · 테크·호수",
    hint: "판교 테크밸리 카페, 정자 호수·서현 상권, 분당 중앙공원 산책.",
    moods: ["카페", "호수", "산책", "맛집"],
    sections: [
      {
        id: "bundang-pangyo",
        label: "판교",
        tagline: "테크·카페·백현",
        spots: [
          { name: "판교", vibe: "카페" },
          { name: "백현", vibe: "조용" },
          { name: "서판교", vibe: "카페" },
          { name: "삼평", vibe: "골목" },
        ],
      },
      {
        id: "bundang-lake",
        label: "정자 · 호수",
        tagline: "정자·서현·수내",
        spots: [
          { name: "정자", vibe: "호수" },
          { name: "서현", vibe: "맛집" },
          { name: "수내", vibe: "조용" },
          { name: "이매", vibe: "골목" },
        ],
      },
      {
        id: "bundang-core",
        label: "분당",
        tagline: "중앙공원·야탑",
        spots: [
          { name: "분당", vibe: "산책" },
          { name: "야탑", vibe: "맛집" },
          { name: "탄천", vibe: "산책" },
        ],
      },
    ],
  },
  {
    id: "metro-suwon",
    scope: "metro",
    label: "수원·용인",
    subtitle: "경기 · 남부",
    hint: "수원 화성·행궁, 용인 카페·레저, 동탄·기흥 신도시.",
    moods: ["유적", "카페", "놀이", "맛집"],
    sections: [
      {
        id: "suwon-core",
        label: "수원",
        tagline: "화성·행궁·인계",
        spots: [
          { name: "수원", vibe: "유적" },
          { name: "행궁", vibe: "유적" },
          { name: "인계", vibe: "맛집" },
          { name: "매탄", vibe: "골목" },
        ],
      },
      {
        id: "suwon-south",
        label: "동탄 · 기흥",
        tagline: "신도시·호수공원",
        spots: [
          { name: "동탄", vibe: "카페" },
          { name: "기흥", vibe: "조용" },
          { name: "병점", vibe: "맛집" },
        ],
      },
      {
        id: "suwon-yongin",
        label: "용인",
        tagline: "보정·죽전·에버랜드",
        spots: [
          { name: "용인", vibe: "놀이" },
          { name: "보정", vibe: "카페" },
          { name: "죽전", vibe: "골목" },
        ],
      },
    ],
  },
  {
    id: "metro-incheon",
    scope: "metro",
    label: "인천·송도",
    subtitle: "서해 · 신도시",
    hint: "송도 센트럴파크, 청라·영종, 차이나타운·월미.",
    moods: ["산책", "해변", "맛집", "드라이브"],
    sections: [
      {
        id: "incheon-songdo",
        label: "송도 · 청라",
        tagline: "공원·국제도시",
        spots: [
          { name: "송도", vibe: "산책" },
          { name: "청라", vibe: "호수" },
          { name: "연수", vibe: "조용" },
        ],
      },
      {
        id: "incheon-core",
        label: "인천",
        tagline: "차이나타운·월미",
        spots: [
          { name: "인천", vibe: "맛집" },
          { name: "월미", vibe: "해변" },
          { name: "개항", vibe: "레트로" },
        ],
      },
      {
        id: "incheon-island",
        label: "영종 · 강화",
        tagline: "공항·섬 드라이브",
        spots: [
          { name: "영종", vibe: "드라이브" },
          { name: "강화", vibe: "유적" },
          { name: "을왕", vibe: "해변" },
        ],
      },
    ],
  },
  {
    id: "metro-west",
    scope: "metro",
    label: "일산·김포",
    subtitle: "경기 · 서북",
    hint: "일산 호수·라페스타, 김포·구래, 파주 출판·프리미엄 아울렛.",
    moods: ["호수", "카페", "산책", "드라이브"],
    sections: [
      {
        id: "west-ilsan",
        label: "일산 · 고양",
        tagline: "호수·백석·행신",
        spots: [
          { name: "일산", vibe: "호수" },
          { name: "백석", vibe: "맛집" },
          { name: "행신", vibe: "골목" },
          { name: "화정", vibe: "조용" },
        ],
      },
      {
        id: "west-gimpo",
        label: "김포",
        tagline: "구래·마산·한강",
        spots: [
          { name: "김포", vibe: "드라이브" },
          { name: "구래", vibe: "카페" },
          { name: "마산", vibe: "한강" },
        ],
      },
      {
        id: "west-paju",
        label: "파주",
        tagline: "출판·헤이리·임진각",
        spots: [
          { name: "파주", vibe: "카페" },
          { name: "헤이리", vibe: "전시" },
          { name: "임진각", vibe: "산책" },
        ],
      },
    ],
  },
  {
    id: "trip-jeju",
    scope: "trip",
    label: "제주",
    subtitle: "섬 · 1박+",
    hint: "애월·협재 카페 해변, 성산 일출, 서귀·중문 맛집.",
    moods: ["드라이브", "해변", "카페", "맛집"],
    sections: [
      {
        id: "jeju-northwest",
        label: "서북",
        tagline: "애월·한림·협재",
        spots: [
          { name: "애월", vibe: "카페" },
          { name: "한림", vibe: "해변" },
          { name: "협재", vibe: "해변" },
          { name: "금능", vibe: "조용" },
        ],
      },
      {
        id: "jeju-city",
        label: "제주 · 우도",
        tagline: "제주시·함덕·우도",
        spots: [
          { name: "제주", vibe: "맛집" },
          { name: "함덕", vibe: "해변" },
          { name: "우도", vibe: "드라이브" },
        ],
      },
      {
        id: "jeju-south",
        label: "남부",
        tagline: "서귀·성산·중문",
        spots: [
          { name: "서귀포", vibe: "맛집" },
          { name: "성산", vibe: "전망" },
          { name: "중문", vibe: "해변" },
          { name: "표선", vibe: "드라이브" },
        ],
      },
    ],
  },
  {
    id: "trip-busan",
    scope: "trip",
    label: "부산·경남",
    subtitle: "남해 · 바다",
    hint: "해운대·광안·서면, 경주·통영·거제 드라이브.",
    moods: ["해변", "야경", "맛집", "유적"],
    sections: [
      {
        id: "busan-beach",
        label: "해안",
        tagline: "해운대·광안·기장",
        spots: [
          { name: "해운대", vibe: "해변" },
          { name: "광안리", vibe: "야경" },
          { name: "기장", vibe: "해변" },
          { name: "다대포", vibe: "해변" },
        ],
      },
      {
        id: "busan-city",
        label: "도심",
        tagline: "서면·남포·감천",
        spots: [
          { name: "부산", vibe: "맛집" },
          { name: "서면", vibe: "맛집" },
          { name: "남포동", vibe: "맛집" },
          { name: "감천", vibe: "전망" },
        ],
      },
      {
        id: "busan-gyeongnam",
        label: "경남",
        tagline: "경주·통영·거제·포항",
        spots: [
          { name: "경주", vibe: "유적" },
          { name: "통영", vibe: "야경" },
          { name: "거제", vibe: "드라이브" },
          { name: "포항", vibe: "해변" },
        ],
      },
    ],
  },
  {
    id: "trip-honam",
    scope: "trip",
    label: "전라",
    subtitle: "서해·남해",
    hint: "전주 한옥, 군산 레트로, 여수·순천·목포 바다.",
    moods: ["한옥", "레트로", "야경", "정원"],
    sections: [
      {
        id: "honam-jeonbuk",
        label: "전북",
        tagline: "전주·군산·익산",
        spots: [
          { name: "전주", vibe: "한옥" },
          { name: "군산", vibe: "레트로" },
          { name: "익산", vibe: "유적" },
          { name: "부안", vibe: "해변" },
        ],
      },
      {
        id: "honam-jeonnam",
        label: "전남",
        tagline: "여수·순천·목포",
        spots: [
          { name: "여수", vibe: "야경" },
          { name: "순천", vibe: "정원" },
          { name: "목포", vibe: "맛집" },
          { name: "담양", vibe: "산책" },
        ],
      },
      {
        id: "honam-gwangju",
        label: "광주",
        tagline: "양동·충장·피어36",
        spots: [
          { name: "광주", vibe: "맛집" },
          { name: "양동", vibe: "골목" },
          { name: "상무", vibe: "카페" },
        ],
      },
    ],
  },
  {
    id: "trip-gangwon",
    scope: "trip",
    label: "강원",
    subtitle: "동해·산간",
    hint: "속초·강릉·양양 바다, 춘천·평창·정선 산과 카페.",
    moods: ["해변", "카페", "산책", "전망"],
    sections: [
      {
        id: "gangwon-coast",
        label: "동해안",
        tagline: "속초·강릉·양양",
        spots: [
          { name: "속초", vibe: "해변" },
          { name: "강릉", vibe: "카페" },
          { name: "양양", vibe: "해변" },
          { name: "동해", vibe: "해변" },
        ],
      },
      {
        id: "gangwon-inland",
        label: "내륙",
        tagline: "춘천·평창·정선",
        spots: [
          { name: "춘천", vibe: "맛집" },
          { name: "평창", vibe: "산책" },
          { name: "정선", vibe: "전망" },
          { name: "원주", vibe: "골목" },
        ],
      },
      {
        id: "gangwon-north",
        label: "북부",
        tagline: "고성·대관령·삼척",
        spots: [
          { name: "고성", vibe: "드라이브" },
          { name: "대관령", vibe: "전망" },
          { name: "삼척", vibe: "해변" },
        ],
      },
    ],
  },
  {
    id: "trip-near",
    scope: "trip",
    label: "근교",
    subtitle: "당일 · 드라이브",
    hint: "가평·양평·남양주·포천, 단양·충주 당일치기.",
    moods: ["드라이브", "카페", "산책", "전망"],
    sections: [
      {
        id: "near-gyeonggi-east",
        label: "경기 동부",
        tagline: "가평·양평·남양주",
        spots: [
          { name: "가평", vibe: "드라이브" },
          { name: "양평", vibe: "카페" },
          { name: "남양주", vibe: "드라이브" },
          { name: "포천", vibe: "산책" },
        ],
      },
      {
        id: "near-chungcheong",
        label: "충청",
        tagline: "단양·충주·제천",
        spots: [
          { name: "단양", vibe: "전망" },
          { name: "충주", vibe: "호수" },
          { name: "제천", vibe: "산책" },
        ],
      },
    ],
  },
];

export function flattenRegionAreas(region: TasteAreaRegion) {
  const names = region.sections.flatMap(section => section.spots.map(spot => spot.name));
  return [...new Set(names)];
}

export function findRegionByArea(area: string) {
  return TASTE_AREA_CATALOG.find(region => flattenRegionAreas(region).includes(area));
}
