// IndexedDB 저장소 (브라우저 안의 작은 데이터베이스)
//
// 서랍(저장소) 5개:
//   subjects  과목 (단원 목록 포함)
//   reasons   틀린 이유
//   problems  오답 (작은 미리보기 사진 포함)
//   images    큰 사진들 (문제 사진, 풀이 사진, 펜 풀이)
//   settings  설정 값

export const MAIN_DB = 'wrongnote';
export const TEST_DB = 'wrongnote-test';
const VERSION = 1;
export const STORES = ['subjects', 'reasons', 'problems', 'images', 'settings'];

let current = null;
let currentName = null;

function openDB(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('subjects', { keyPath: 'id' });
      d.createObjectStore('reasons', { keyPath: 'id' });
      const p = d.createObjectStore('problems', { keyPath: 'id' });
      p.createIndex('subjectId', 'subjectId');
      p.createIndex('dueDate', 'dueDate');
      d.createObjectStore('images', { keyPath: 'id' });
      d.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** 데이터베이스 열기 (테스트 모드면 TEST_DB 이름으로) */
export async function use(name = MAIN_DB) {
  if (current && currentName === name) return;
  if (current) current.close();
  current = await openDB(name);
  currentName = name;
  await seedIfEmpty();
}

export function currentDbName() { return currentName; }

/** 저장 작업 하나를 실행하고 끝날 때까지 기다림 */
function run(storeNames, mode, body) {
  return new Promise((resolve, reject) => {
    const t = current.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames)
      ? Object.fromEntries(storeNames.map((n) => [n, t.objectStore(n)]))
      : t.objectStore(storeNames);
    let result;
    const out = body(stores);
    if (out instanceof IDBRequest) out.onsuccess = () => { result = out.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('저장이 취소되었어요'));
  });
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const put = (store, obj) => run(store, 'readwrite', (s) => s.put(obj));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));

export async function getSetting(key, fallback) {
  const row = await get('settings', key);
  return row === undefined ? fallback : row.value;
}
export const setSetting = (key, value) => put('settings', { key, value });

/** 오답 저장: 사진 추가(putImages), 안 쓰는 사진 삭제(delImageIds), 오답 기록 저장을 한 번에 */
export function saveProblem(problem, putImages = [], delImageIds = []) {
  return run(['problems', 'images'], 'readwrite', (s) => {
    putImages.forEach((img) => s.images.put(img));
    delImageIds.forEach((id) => s.images.delete(id));
    s.problems.put(problem);
  });
}

/** 오답 삭제 (연결된 사진도 함께) */
export function deleteProblem(problem) {
  return run(['problems', 'images'], 'readwrite', (s) => {
    Object.values(problem.images || {}).forEach((id) => id && s.images.delete(id));
    s.problems.delete(problem.id);
  });
}

// ---------- 처음 실행할 때 기본 데이터 ----------
const unit = (id, group, name) => ({ id, group, name });

export const DEFAULT_SUBJECTS = [
  {
    id: 'math', name: '수학', type: 'solution', order: 0,
    units: [
      unit('m1-explog', '수학1', '지수함수와 로그함수'),
      unit('m1-trig', '수학1', '삼각함수'),
      unit('m1-seq', '수학1', '수열'),
      unit('m2-limit', '수학2', '함수의 극한과 연속'),
      unit('m2-diff', '수학2', '미분'),
      unit('m2-int', '수학2', '적분'),
      unit('ps-count', '확률과 통계', '경우의 수'),
      unit('ps-prob', '확률과 통계', '확률'),
      unit('ps-stat', '확률과 통계', '통계'),
    ],
  },
];

export const DEFAULT_REASONS = [
  { id: 'calc', name: '계산 실수', order: 0 },
  { id: 'concept', name: '개념 부족', order: 1 },
  { id: 'missed', name: '조건 놓침', order: 2, needsDetail: true, detailLabel: '어떤 조건을 놓쳤나요? (예: x>0, 정수 조건)' },
  { id: 'direction', name: '풀이 방향 못 잡음', order: 3 },
  { id: 'time', name: '시간 부족', order: 4 },
];

async function seedIfEmpty() {
  if (await getSetting('seeded', false)) return;
  await run(['subjects', 'reasons', 'settings'], 'readwrite', (s) => {
    DEFAULT_SUBJECTS.forEach((x) => s.subjects.put(structuredClone(x)));
    DEFAULT_REASONS.forEach((x) => s.reasons.put({ ...x }));
    s.settings.put({ key: 'seeded', value: true });
  });
}
