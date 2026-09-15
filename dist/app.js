const views = Object.fromEntries([...document.querySelectorAll('.view')].map(view => [view.id.replace('-view', ''), view]));
const navItems = [...document.querySelectorAll('.nav-item')];
const panels = [...document.querySelectorAll('.panel-view')];
const contextPanel = document.querySelector('.context-panel');
const toast = document.querySelector('.toast');
const searchDialog = document.querySelector('#search-dialog');

const places = {
  lapar: { title: '카페 라파르', category: 'CAFE · GUNSAN', address: '전북 군산시 월명동', description: '조용한 창가와 오래 머물기 좋은 오후.', duration: '90분', cost: '₩22,000', image: './assets/cafe-memory.png' },
  chowon: { title: '초원사진관', category: 'PHOTO · GUNSAN', address: '전북 군산시 신창동', description: '오래된 영화의 한 장면처럼, 우리도 한 컷 남기기.', duration: '50분', cost: '무료', image: './assets/gunsan-evening.png' },
  eunpa: { title: '은파호수공원', category: 'WALK · GUNSAN', address: '전북 군산시 나운동', description: '노을이 호수에 닿을 때까지 나란히 걷기로.', duration: '120분', cost: '무료', image: './assets/gunsan-evening.png' },
  lee: { title: '이성당', category: 'BAKERY · GUNSAN', address: '전북 군산시 중앙로', description: '단팥빵 두 개와 서로의 취향 하나 더 알아가기.', duration: '40분', cost: '₩18,000', image: './assets/cafe-memory.png' },
  book: { title: '마리서사', category: 'BOOK · GUNSAN', address: '전북 군산시 월명동', description: '여행 중 잠시 멈춰 서로에게 책 한 권 골라주기.', duration: '60분', cost: '₩30,000', image: './assets/cafe-memory.png' },
  hanju: { title: '한주옥', category: 'MEAL · GUNSAN', address: '전북 군산시 영화동', description: '첫날, 따뜻한 밥으로 천천히 여행을 시작해요.', duration: '70분', cost: '₩48,000', image: './assets/cafe-memory.png' }
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-showing');
  clearTimeout(window.onlyUsToast);
  window.onlyUsToast = setTimeout(() => toast.classList.remove('is-showing'), 2300);
}

function showPanel(name = 'default') {
  panels.forEach(panel => panel.classList.toggle('is-visible', panel.id === `${name}-panel`));
  if (window.innerWidth <= 900) contextPanel.classList.add('is-open');
}

function changeView(name) {
  if (!views[name]) return;
  Object.values(views).forEach(view => view.classList.remove('is-visible'));
  views[name].classList.add('is-visible');
  navItems.forEach(item => item.classList.toggle('is-active', item.dataset.view === name));
  document.title = `ONLY US — ${views[name].dataset.title}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showPanel('default');
}

document.querySelectorAll('[data-view]').forEach(element => {
  element.addEventListener('click', event => {
    if (element.classList.contains('heart')) return;
    event.preventDefault();
    changeView(element.dataset.view);
  });
  if (element.tabIndex === 0) element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') changeView(element.dataset.view);
  });
});

document.querySelectorAll('[data-place-id]').forEach(element => element.addEventListener('click', event => {
  if (event.target.closest('[data-add-plan]') || event.target.closest('.heart')) return;
  const place = places[element.dataset.placeId];
  if (!place) return;
  document.querySelector('#detail-title').textContent = place.title;
  document.querySelector('#detail-category').textContent = place.category;
  document.querySelector('#detail-address').textContent = place.address;
  document.querySelector('#detail-description').textContent = place.description;
  document.querySelector('#detail-duration').textContent = place.duration;
  document.querySelector('#detail-cost').textContent = place.cost;
  document.querySelector('#detail-image').src = place.image;
  document.querySelector('#detail-image').alt = place.title;
  showPanel('place');
}));

document.querySelectorAll('.panel-close').forEach(button => button.addEventListener('click', () => {
  showPanel('default');
  contextPanel.classList.remove('is-open');
}));

document.querySelectorAll('[data-panel="history"]').forEach(button => button.addEventListener('click', () => showPanel('history')));
document.querySelectorAll('[data-panel="activity"]').forEach(button => button.addEventListener('click', () => showPanel('default')));
document.querySelectorAll('[data-ai-recommend]').forEach(button => button.addEventListener('click', () => {
  changeView('places');
  showToast('둘의 취향에 가까운 장소를 먼저 보여드려요.');
}));

document.querySelectorAll('.heart, .detail-heart').forEach(button => button.addEventListener('click', event => {
  event.stopPropagation();
  const active = button.classList.toggle('is-on');
  button.textContent = active ? '♥' : '♡';
  button.setAttribute('aria-label', active ? '저장 취소' : '저장');
  showToast(active ? '둘의 장소에 저장했어요.' : '저장을 취소했어요.');
}));

document.querySelectorAll('[data-add-plan]').forEach(button => button.addEventListener('click', event => {
  event.stopPropagation();
  showToast('군산 여행 후보에 추가했어요.');
}));

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach(item => item.classList.remove('is-active'));
  button.classList.add('is-active');
  const filter = button.dataset.filter;
  document.querySelectorAll('.place-card').forEach(card => card.classList.toggle('is-hidden', filter !== 'all' && !card.dataset.status.includes(filter)));
}));

document.querySelector('#place-search').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.place-card').forEach(card => card.classList.toggle('is-hidden', !card.textContent.toLowerCase().includes(query)));
});

document.querySelector('#add-place').addEventListener('click', () => {
  document.querySelector('#place-search').focus();
  showToast('장소 이름을 검색해서 저장해 보세요.');
});

document.querySelectorAll('[data-trip-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-trip-tab]').forEach(tab => tab.classList.remove('is-active'));
  button.classList.add('is-active');
  const messages = { plan: '일정 편집 화면이에요.', map: 'DAY 1의 이동 경로를 강조했어요.', budget: '현재 예상 사용액은 ₩268,000이에요.', notes: '둘의 여행 메모를 펼쳤어요.' };
  showToast(messages[button.dataset.tripTab]);
}));

document.querySelectorAll('.day-rail>button:not(.add-day)').forEach((button, index) => button.addEventListener('click', () => {
  document.querySelectorAll('.day-rail>button').forEach(day => day.classList.remove('is-active'));
  button.classList.add('is-active');
  if (index > 0) showToast(`DAY ${index + 1} 일정은 다음 편집 단계에서 이어집니다.`);
}));

document.querySelector('#add-schedule').addEventListener('click', () => {
  changeView('places');
  showToast('DAY 1에 넣을 장소를 골라 주세요.');
});

let draggedItem = null;
document.querySelectorAll('.timeline-item').forEach(item => {
  item.addEventListener('dragstart', () => { draggedItem = item; item.classList.add('is-dragging'); });
  item.addEventListener('dragend', () => {
    item.classList.remove('is-dragging');
    if (draggedItem) showToast('일정 순서를 저장했어요. 새 버전 v13이 생성됐어요.');
    draggedItem = null;
  });
  item.addEventListener('dragover', event => {
    event.preventDefault();
    if (draggedItem && draggedItem !== item) item.parentNode.insertBefore(draggedItem, item);
  });
});

document.querySelector('#trip-more').addEventListener('click', () => showPanel('ai'));
document.querySelector('#generate-change').addEventListener('click', () => {
  const progress = document.querySelector('.ai-progress');
  const proposal = document.querySelector('.ai-proposal');
  progress.hidden = false;
  proposal.hidden = true;
  setTimeout(() => { progress.hidden = true; proposal.hidden = false; }, 1050);
});

document.querySelector('#apply-change').addEventListener('click', () => {
  const checked = [...document.querySelectorAll('.ai-proposal input:checked')].length;
  if (!checked) return showToast('적용할 변경을 하나 이상 골라 주세요.');
  const leeItem = document.querySelector('.timeline-item[data-id="lee"]');
  if (document.querySelectorAll('.ai-proposal input')[0].checked && leeItem) {
    const nextTravel = leeItem.nextElementSibling;
    const prevTravel = leeItem.previousElementSibling;
    leeItem.remove();
    if (nextTravel?.classList.contains('travel-line')) nextTravel.remove();
    if (prevTravel?.classList.contains('travel-line')) prevTravel.textContent = '↳ 택시 15분 · ₩9,200';
  }
  if (document.querySelectorAll('.ai-proposal input')[1].checked) {
    const eunpa = document.querySelector('.timeline-item[data-id="eunpa"] p');
    if (eunpa) eunpa.textContent = '해 질 무렵 호수를 따라 걷기 · 160분';
  }
  showPanel('history');
  showToast(`선택한 ${checked}개 변경을 적용했어요. 새 버전 v13`);
});

document.querySelector('#retry-change').addEventListener('click', () => {
  document.querySelector('.ai-proposal').hidden = true;
  document.querySelector('#ai-prompt').focus();
});

function openSearch() {
  if (!searchDialog.open) searchDialog.showModal();
}
document.querySelector('.global-search').addEventListener('click', openSearch);
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
});
document.querySelectorAll('[data-command-view]').forEach(button => button.addEventListener('click', () => changeView(button.dataset.commandView)));

document.querySelectorAll('.status-pill').forEach(button => button.addEventListener('click', () => {
  const active = button.classList.toggle('is-active');
  showToast(active ? '장소 상태를 저장했어요.' : '장소 상태를 해제했어요.');
}));

document.querySelector('.mobile-menu').addEventListener('click', () => showToast('아래 메뉴에서 이동할 수 있어요.'));
document.querySelectorAll('.empty-soft .primary-button, .simple-view>.page-title-row .primary-button, .outline-button').forEach(button => button.addEventListener('click', () => showToast('이 흐름은 다음 구현 단계에서 연결할게요.')));
