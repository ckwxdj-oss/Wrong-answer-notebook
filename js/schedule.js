// 복습 일정 계산 (화면 코드와 분리된 순수 함수들)
// 날짜는 항상 "YYYY-MM-DD" 글자로 다룹니다. (시간대 때문에 하루 밀리는 문제 방지)

export const INTERVALS = [3, 7, 14, 30]; // 단계 0,1,2,3 의 간격(일)
export const GRADUATED = 'graduated';

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

/** 새로 등록한 문제의 첫 일정: 3일 단계, 등록일 + 3일 */
export function newSchedule(createdDate) {
  return { stage: 0, dueDate: addDays(createdDate, INTERVALS[0]) };
}

/** 화면에 보여줄 단계 이름 */
export function stageLabel(stage) {
  if (stage === GRADUATED) return '졸업';
  return `${INTERVALS[stage]}일 단계`;
}

// 평가 종류: 맞음 / 애매함 / 틀림
export const RESULTS = ['correct', 'vague', 'wrong'];

/**
 * 평가 후 다음 일정 계산. 다음 복습일은 "평가한 날(date)" 기준.
 *  - 맞음: 다음 단계 (30일 단계에서 맞으면 졸업)
 *  - 애매함: 한 단계 전 (3일 단계면 그대로 3일)
 *  - 틀림: 3일 단계부터 다시
 */
export function nextSchedule(stage, result, date) {
  if (stage === GRADUATED) throw new Error('졸업한 문제는 평가할 수 없어요');
  let s;
  if (result === 'correct') {
    if (stage >= INTERVALS.length - 1) return { stage: GRADUATED, dueDate: null };
    s = stage + 1;
  } else if (result === 'vague') {
    s = Math.max(0, stage - 1);
  } else if (result === 'wrong') {
    s = 0;
  } else {
    throw new Error('알 수 없는 평가: ' + result);
  }
  return { stage: s, dueDate: addDays(date, INTERVALS[s]) };
}

/** 문제에 평가를 적용한 새 문제 객체 (복습 기록도 한 줄 추가) */
export function applyReview(problem, result, date) {
  const next = nextSchedule(problem.stage, result, date);
  const out = {
    ...problem,
    ...next,
    reviews: [...(problem.reviews || []), { date, result, stage: problem.stage }],
  };
  if (next.stage === GRADUATED) out.graduatedDate = date;
  return out;
}

/** 졸업한 문제를 다시 복습에 넣기: 3일 단계부터 */
export function reactivate(problem, date) {
  const out = {
    ...problem,
    ...newSchedule(date),
    reviews: [...(problem.reviews || []), { date, result: 'restart', stage: problem.stage }],
  };
  delete out.graduatedDate;
  return out;
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
