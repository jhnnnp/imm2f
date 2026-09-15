const views = {
  home: document.querySelector('#home-view'),
  trip: document.querySelector('#trip-view'),
  map: document.querySelector('#home-view'),
  memories: document.querySelector('#memories-view')
};
const navItems = [...document.querySelectorAll('.nav-item')];
const activityPanel = document.querySelector('#activity-panel');
const placePanel = document.querySelector('#place-panel');
const toast = document.querySelector('.toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-showing');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('is-showing'), 2200);
}

function changeView(name) {
  const target = views[name];
  if (!target) {
    showToast('이 페이지는 다음 기록으로 준비하고 있어요.');
    return;
  }
  document.querySelectorAll('.view').forEach(view => view.classList.remove('is-visible'));
  target.classList.add('is-visible');
  navItems.forEach(item => item.classList.toggle('is-active', item.dataset.view === name));
  if (name === 'map') {
    document.querySelector('.map-preview').scrollIntoView({behavior:'smooth', block:'center'});
  } else {
    window.scrollTo({top:0, behavior:'smooth'});
  }
  activityPanel.hidden = false;
  placePanel.hidden = true;
}

navItems.forEach(item => item.addEventListener('click', () => changeView(item.dataset.view)));
document.querySelectorAll('[data-open-trip]').forEach(button => button.addEventListener('click', () => changeView('trip')));
document.querySelector('.back-home').addEventListener('click', () => changeView('home'));

const placeNotes = {
  '한주옥': ['첫날, 따뜻한 밥으로 천천히 여행을 시작해요.', '9월 18일 오전 9:30'],
  '초원사진관': ['오래된 영화의 한 장면처럼, 우리도 한 컷 남기기.', '9월 18일 오전 11:20'],
  '이성당': ['단팥빵 두 개와 서로의 취향 하나 더 알아가기.', '9월 18일 오후 2:00'],
  '은파호수공원': ['노을이 호수에 닿을 때까지 나란히 걷기로.', '9월 18일 오후 5:30'],
  '서울': ['우리 여행이 언제나 다시 시작되는 곳.', '지난 기록 18개'],
  '군산': ['다가오는 우리의 다음 페이지.', '9월 18일 — 20일'],
  '전주': ['둘 다 다시 가고 싶은 오래된 골목.', '지난 기록 6개']
};

document.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => {
  const name = button.dataset.place;
  const note = placeNotes[name] || ['함께 남긴 장소의 메모예요.', '날짜를 정하는 중'];
  document.querySelector('#place-title').textContent = name;
  document.querySelector('#place-desc').textContent = note[0];
  document.querySelector('#place-time').textContent = note[1];
  activityPanel.hidden = true;
  placePanel.hidden = false;
}));

document.querySelector('.close-detail').addEventListener('click', () => {
  placePanel.hidden = true;
  activityPanel.hidden = false;
});
document.querySelector('#share-button').addEventListener('click', () => showToast('둘만 볼 수 있는 여행 노트예요 ♡'));
document.querySelectorAll('.trip-tabs button').forEach((button, index) => button.addEventListener('click', () => {
  document.querySelectorAll('.trip-tabs button').forEach(tab => tab.classList.remove('is-active'));
  button.classList.add('is-active');
  if (index > 0) showToast(index === 1 ? '지도에서 네 장소를 이어 보았어요.' : '우리의 짧은 메모를 펼쳤어요.');
}));
