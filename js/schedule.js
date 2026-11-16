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
