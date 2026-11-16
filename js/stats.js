// 통계 계산 (화면 코드와 분리된 순수 함수들)
import { addDays, GRADUATED, RESULTS } from './schedule.js';

/**
 * 틀린 이유별 개수와 비율
 * 한 문제에 이유를 여러 개 고를 수 있으므로, 비율은 "전체 이유 표시 수" 기준 (합치면 100%)
 */
export function reasonStats(problems, reasons) {
  const counts = new Map(reasons.map((r) => [r.id, 0]));
  let total = 0;
  problems.forEach((p) => (p.reasonIds || []).forEach((id) => {
    if (!counts.has(id)) return; // 삭제된 이유는 제외
    counts.set(id, counts.get(id) + 1);
    total++;
  }));
  return reasons
    .map((r) => ({ id: r.id, name: r.name, count: counts.get(r.id), ratio: total ? counts.get(r.id) / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * "적는 칸"이 있는 이유(예: 조건 놓침)에 적은 내용 모음.
 * 쉼표/줄바꿈으로 나누고, 띄어쓰기만 다른 것은 같은 것으로 셈. 많이 나온 순.
 * 결과: [{ id, name, items: [{ text, count }] }]
 */
export function conditionStats(problems, reasons) {
  return reasons.filter((r) => r.needsDetail).map((r) => {
    const map = new Map();
    problems.forEach((p) => {
      const text = p.reasonDetails?.[r.id];
      if (!text) return;
      text.split(/[,，、;\n]/).map((t) => t.trim()).filter(Boolean).forEach((t) => {
        const key = t.replace(/\s+/g, '').toLowerCase();
        if (!map.has(key)) map.set(key, { text: t, count: 0 });
        map.get(key).count++;
      });
    });
    const items = [...map.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'ko'));
    return { id: r.id, name: r.name, items };
  });
}

/** 한 과목의 단원별 오답 수 (복습 중 / 졸업). 단원 목록 순서대로, 지워진 단원은 "단원 없음"으로 */
export function unitStats(problems, subject) {
  const rows = subject.units.map((u) => ({ unitId: u.id, group: u.group || '', name: u.name, total: 0, active: 0, grad: 0 }));
  const byId = new Map(rows.map((r) => [r.unitId, r]));
  const none = { unitId: null, group: '', name: '단원 없음', total: 0, active: 0, grad: 0 };
  problems.filter((p) => p.subjectId === subject.id).forEach((p) => {
    const row = byId.get(p.unitId) || none;
    row.total++;
    if (p.stage === GRADUATED) row.grad++; else row.active++;
  });
  return none.total ? [...rows, none] : rows;
}

/**
 * 최근 4주(오늘 포함 28일)를 7일씩 나눈 주별 통계. 오래된 주 → 최근 주 순서
 * 정답률 = 맞음 / (맞음 + 애매함 + 틀림). 복습이 없으면 rate = null
 */
export function weeklyStats(problems, today) {
  const weeks = [];
  for (let k = 0; k < 4; k++) {
    const start = addDays(today, -27 + 7 * k);
    weeks.push({ start, end: addDays(start, 6), registered: 0, reviews: 0, correct: 0, rate: null });
  }
  const find = (d) => weeks.find((w) => d >= w.start && d <= w.end);
  problems.forEach((p) => {
    const w = p.createdDate && find(p.createdDate);
    if (w) w.registered++;
    (p.reviews || []).forEach((r) => {
      if (!RESULTS.includes(r.result)) return;
      const rw = find(r.date);
      if (!rw) return;
      rw.reviews++;
      if (r.result === 'correct') rw.correct++;
    });
  });
  weeks.forEach((w) => { w.rate = w.reviews ? w.correct / w.reviews : null; });
  return weeks;
}

/** 전체 복습 정답률 */
export function overallRate(problems) {
  let n = 0, c = 0;
  problems.forEach((p) => (p.reviews || []).forEach((r) => {
    if (!RESULTS.includes(r.result)) return;
    n++;
    if (r.result === 'correct') c++;
  }));
  return { reviews: n, correct: c, rate: n ? c / n : null };
}
