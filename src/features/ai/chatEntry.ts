/** The shortlist wizard is available when the user asks to choose candidates first. */
export function requestsCandidateExploration(message: string) {
  return /(?:장소\s*)?(?:후보|탐색).{0,12}(?:먼저|부터|시작|찾|보여|골라|선택)|(?:먼저|우선).{0,12}(?:장소|후보).{0,12}(?:골라|선택|둘러|비교)/.test(message)
    && !/후보.{0,10}(?:말고|없이|건너뛰)|바로.{0,10}(?:일정|코스)/.test(message);
}

export function isExplorationConversationAside(message: string) {
  return /^(?:안녕|안녕하세요|고마워|감사|하이|헬로|hi\b|hello\b|thanks\b)/i.test(message.trim())
    || /(?:그냥|잠깐).{0,6}(?:대화|잡담|수다)|(?:대화|잡담|수다)\s*(?:하자|할래|해줘)/.test(message);
}

export function requestsDirectPlanning(message: string) {
  return /(?:후보|선택|탐색).{0,12}(?:말고|없이|건너뛰|그만|종료)|(?:네가|알아서|자동으로).{0,15}(?:코스|일정).{0,12}(?:짜|만들)|바로.{0,12}(?:코스|일정).{0,12}(?:짜|만들)/.test(message);
}
