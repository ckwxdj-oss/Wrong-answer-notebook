// 통계 계산 자동 테스트. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasonStats, conditionStats, unitStats, weeklyStats, overallRate } from '../js/stats.js';

const reasons = [
  { id: 'calc', name: '계산 실수' },
  { id: 'missed', name: '조건 놓침', needsDetail: true },
  { id: 'time', name: '시간 부족' },
];
const subject = {
  id: 'math', units: [{ id: 'u1', group: '수학1', name: '삼각함수' }, { id: 'u2', group: '수학2', name: '미분' }],
};

test('틀린 이유별 개수와 비율 (합치면 100%)', () => {
  const ps = [
    { reasonIds: ['calc', 'missed'] },
    { reasonIds: ['calc'] },
    { reasonIds: ['calc', 'deleted-reason'] },
  ];
  const s = reasonStats(ps, reasons);
  assert.deepEqual(s.map((r) => [r.id, r.count]), [['calc', 3], ['missed', 1], ['time', 0]]);
  assert.equal(s[0].ratio, 0.75);
  assert.equal(s.reduce((a, r) => a + r.ratio, 0), 1);
});

test('놓친 조건 목록: 쉼표로 나누고, 띄어쓰기만 다르면 같은 것으로, 많은 순', () => {
  const ps = [
    { reasonDetails: { missed: 'x>0, 정수 조건' } },
    { reasonDetails: { missed: 'x > 0' } },
    { reasonDetails: { missed: '정수조건' } },
    { reasonDetails: { missed: 'x>0' } },
    { reasonDetails: {} },
  ];
  const [missed] = conditionStats(ps, reasons);
  assert.equal(missed.name, '조건 놓침');
  assert.deepEqual(missed.items.map((i) => [i.text, i.count]), [['x>0', 3], ['정수 조건', 2]]);
});

test('단원별 오답 수 (복습 중 / 졸업, 지워진 단원은 "단원 없음")', () => {
  const ps = [
    { subjectId: 'math', unitId: 'u1', stage: 0 },
    { subjectId: 'math', unitId: 'u1', stage: 'graduated' },
    { subjectId: 'math', unitId: 'gone', stage: 2 },
    { subjectId: 'eng', unitId: 'u1', stage: 0 },
  ];
  const s = unitStats(ps, subject);
  assert.deepEqual(s.map((r) => [r.name, r.total, r.active, r.grad]), [
    ['삼각함수', 2, 1, 1], ['미분', 0, 0, 0], ['단원 없음', 1, 1, 0]]);
});

test('최근 4주 등록 수와 복습 정답률', () => {
  const today = '2026-12-28';
  const ps = [
    { createdDate: '2026-11-30', reviews: [] }, // 4주(12/1~12/28)보다 이전 → 안 셈
    { createdDate: '2026-12-01', reviews: [{ date: '2026-12-04', result: 'correct' }, { date: '2026-12-11', result: 'wrong' }] },
    { createdDate: '2026-12-28', reviews: [{ date: '2026-12-25', result: 'vague' }, { date: '2026-12-26', result: 'restart' }] },
  ];
  const w = weeklyStats(ps, today);
  assert.deepEqual(w.map((x) => [x.start, x.end]), [
    ['2026-12-01', '2026-12-07'], ['2026-12-08', '2026-12-14'], ['2026-12-15', '2026-12-21'], ['2026-12-22', '2026-12-28']]);
  assert.deepEqual(w.map((x) => x.registered), [1, 0, 0, 1]);
  assert.deepEqual(w.map((x) => x.reviews), [1, 1, 0, 1], '"다시 복습에 넣음"은 복습 횟수에 안 셈');
  assert.deepEqual(w.map((x) => x.rate), [1, 0, null, 0]);
});

test('전체 정답률', () => {
  const r = overallRate([{ reviews: [{ result: 'correct' }, { result: 'vague' }] }, { reviews: [{ result: 'correct' }, { result: 'restart' }] }]);
  assert.deepEqual(r, { reviews: 3, correct: 2, rate: 2 / 3 });
});
