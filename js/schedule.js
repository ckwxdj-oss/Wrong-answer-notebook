// 복습 일정 계산 (화면 코드와 분리된 순수 함수들)
// 날짜는 항상 "YYYY-MM-DD" 글자로 다룹니다. (시간대 때문에 하루 밀리는 문제 방지)
//
// 복습 코스 2가지
//   보통 복습: 1일 → 3일 → 7일 → 14일 → 28일 → 졸업   (개념 부족, 조건 놓침 등)
//   짧은 복습: 1일 → 3일 → 7일 → 졸업                 (계산 실수, 시간 부족 같은 가벼운 실수만 골랐을 때)
// 숫자는 "이전 복습(또는 틀린 날)에서 며칠 뒤"인지를 뜻해요.

export const TRACKS = { normal: [1, 3, 7, 14, 28], short: [1, 3, 7] };
export const TRACK_LABEL = { normal: '보통 복습', short: '짧은 복습' };
export const GRADUATED = 'graduated';
export const RESULTS = ['correct', 'vague', 'wrong']; // 맞음 / 애매함 / 틀림

const intervals = (track) => TRACKS[track] || TRACKS.normal;

function pad(n) { return String(n).padStart(2, '0'); }

/** Date 객체 → "YYYY-MM-DD" (기기의 현지 날짜 기준) */
export function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parts(str) { return str.split('-').map(Number); }

/** "2026-12-01" + 3 → "2026-12-04" */
export function addDays(str, n) {
  const [y, m, d] = parts(str);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** to - from (일 수). diffDays("2026-12-01","2026-12-04") = 3 */
export function diffDays(from, to) {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** 틀린 이유로 복습 코스 정하기: 고른 이유가 전부 "가벼운 실수"면 짧은 복습 */
export function trackFor(reasonIds, lightIds) {
  const ids = reasonIds || [];
  return ids.length > 0 && ids.every((id) => lightIds.includes(id)) ? 'short' : 'normal';
}

/** 새로 등록한 문제의 첫 일정: 1일 단계, 틀린 날 + 1일 */
export function newSchedule(createdDate, track = 'normal') {
  return { track, stage: 0, dueDate: addDays(createdDate, intervals(track)[0]) };
}

/** 화면에 보여줄 단계 이름 */
export function stageLabel(stage, track = 'normal') {
  if (stage === GRADUATED) return '졸업';
  return `${intervals(track)[stage]}일 단계`;
}

/**
 * 평가 한 번 후 다음 일정. 다음 복습일은 "평가한 날(date)" 기준.
 *  - 맞음: 다음 단계 (마지막 단계에서 맞으면 졸업)
 *  - 애매함: 한 단계 전 (첫 단계면 그대로)
 *  - 틀림: wrongTrack 코스(이번에 틀린 이유로 정한 코스)의 첫 단계부터
 * cur = { track, stage }
 */
export function nextSchedule(cur, result, date, wrongTrack) {
  const track = cur.track || 'normal';
  if (result === 'wrong') {
    const t = wrongTrack || track;
    return { track: t, stage: 0, dueDate: addDays(date, intervals(t)[0]) };
  }
  if (!RESULTS.includes(result)) throw new Error('알 수 없는 평가: ' + result);
  if (cur.stage === GRADUATED) return { track, stage: GRADUATED, dueDate: null }; // 졸업 후 맞음/애매함은 기록만
  const iv = intervals(track);
  const stage = Math.min(cur.stage, iv.length - 1);
  if (result === 'correct') {
    if (stage >= iv.length - 1) return { track, stage: GRADUATED, dueDate: null };
    return { track, stage: stage + 1, dueDate: addDays(date, iv[stage + 1]) };
  }
  const s = Math.max(0, stage - 1); // 애매함
  return { track, stage: s, dueDate: addDays(date, iv[s]) };
}

/**
 * 틀린 날짜와 복습 기록 전체로 지금 일정을 처음부터 다시 계산.
 * 기록을 나중에 추가하거나 지우거나, 틀린 날짜를 바꿔도 항상 맞는 일정이 나와요.
 * reviews: [{ date, result, track? (틀림일 때 정한 코스) }]  ※ result 'restart' = 다시 복습에 넣기
 */
export function replaySchedule(createdDate, baseTrack, reviews = []) {
  const sorted = reviews
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i))
    .map((x) => x.r);
  let cur = newSchedule(createdDate, baseTrack);
  let graduatedDate = null;
  const out = [];
  for (const r of sorted) {
    const before = { stage: cur.stage, fromTrack: cur.track };
    if (r.result === 'restart') {
      cur = newSchedule(r.date, baseTrack);
      graduatedDate = null;
    } else {
      cur = nextSchedule(cur, r.result, r.date, r.track);
      graduatedDate = cur.stage === GRADUATED ? (graduatedDate ?? r.date) : null;
    }
    out.push({ ...r, ...before });
  }
  return { ...cur, graduatedDate, reviews: out };
}

/** 문제에 평가를 하나 더한 새 문제 객체 (extra: 틀림일 때 { track, reasonIds }) */
export function applyReview(problem, result, date, extra = {}) {
  const reviews = [...(problem.reviews || []), { date, result, ...extra }];
  return { ...problem, ...replaySchedule(problem.createdDate, problem.baseTrack, reviews) };
}

/** 졸업한 문제를 다시 복습에 넣기: 처음 코스의 1일 단계부터 */
export function reactivate(problem, date) {
  return applyReview(problem, 'restart', date);
}

/** 복습할 날이 되었는지 (날짜 글자는 크기 비교가 곧 날짜 비교) */
export function isDue(p, today) {
  return p.stage !== GRADUATED && !!p.dueDate && p.dueDate <= today;
}

/** 복습일이 며칠 지났는지 (안 지났으면 0) */
export function overdueDays(p, today) {
  if (p.stage === GRADUATED || !p.dueDate) return 0;
  return Math.max(0, diffDays(p.dueDate, today));
}

/** 그날 평가한 횟수 (맞음/애매함/틀림만 셈) */
export function reviewsDoneOn(problems, date) {
  let n = 0;
  problems.forEach((p) => (p.reviews || []).forEach((r) => {
    if (r.date === date && RESULTS.includes(r.result)) n++;
  }));
  return n;
}

/**
 * 오늘의 복습 목록
 *  - 복습일이 오늘이거나 지난 문제를, 오래 밀린 것부터(같으면 먼저 등록한 것부터)
 *  - 하루 최대 개수에서 오늘 이미 평가한 개수를 뺀 만큼만 → queue
 *  - 나머지는 다음 날로 → deferred
 */
export function dailyQueue(problems, today, max) {
  const due = problems.filter((p) => isDue(p, today)).sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
  const doneToday = reviewsDoneOn(problems, today);
  const remaining = Math.max(0, max - doneToday);
  return { queue: due.slice(0, remaining), deferred: due.slice(remaining), doneToday };
}
