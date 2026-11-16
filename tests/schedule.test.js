// 복습 일정 자동 테스트. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSchedule, applyReview, reactivate, dailyQueue, overdueDays, GRADUATED,
} from '../js/schedule.js';

let seq = 0;
/** created 날짜에 등록한 문제 하나 만들기 */
function make(created, extra = {}) {
  seq++;
  return { id: 'p' + seq, createdAt: seq, createdDate: created, ...newSchedule(created), reviews: [], ...extra };
}
/** day에 복습 목록에 나오는지 */
const shows = (p, day) => dailyQueue([p], day, 10).queue.some((q) => q.id === p.id);

test('1. 12/1 등록 → 12/4에 처음 복습이 나옴', () => {
  const p = make('2026-12-01');
  assert.equal(p.stage, 0);
  assert.equal(p.dueDate, '2026-12-04');
  assert.equal(shows(p, '2026-12-03'), false, '12/3에는 아직 안 나와야 함');
  assert.equal(shows(p, '2026-12-04'), true, '12/4에 나와야 함');
});

test('2. 계속 맞음: 12/4 → 12/11 → 12/25 → 1/24 → 졸업', () => {
  let p = make('2026-12-01');
  p = applyReview(p, 'correct', '2026-12-04');
  assert.equal(p.dueDate, '2026-12-11');
  p = applyReview(p, 'correct', '2026-12-11');
  assert.equal(p.dueDate, '2026-12-25');
  p = applyReview(p, 'correct', '2026-12-25');
  assert.equal(p.dueDate, '2027-01-24');
  p = applyReview(p, 'correct', '2027-01-24');
  assert.equal(p.stage, GRADUATED);
  assert.equal(p.dueDate, null);
  assert.equal(shows(p, '2027-06-01'), false, '졸업하면 복습에 안 나옴');
  assert.equal(p.reviews.length, 4, '복습 기록 4개');
  assert.deepEqual(p.reviews.map((r) => r.date), ['2026-12-04', '2026-12-11', '2026-12-25', '2027-01-24']);
});

test('3. 14일 단계에서 애매함 → 7일 뒤, 그다음 맞음 → 다시 14일 간격', () => {
  let p = make('2026-12-01');
  p = applyReview(p, 'correct', '2026-12-04'); // → 7일 단계
  p = applyReview(p, 'correct', '2026-12-11'); // → 14일 단계, 12/25
  assert.equal(p.stage, 2);
  p = applyReview(p, 'vague', '2026-12-25');
  assert.equal(p.stage, 1);
  assert.equal(p.dueDate, '2027-01-01', '7일 뒤');
  p = applyReview(p, 'correct', '2027-01-01');
  assert.equal(p.stage, 2);
  assert.equal(p.dueDate, '2027-01-15', '다시 14일 간격');
});

test('4. 3일 단계에서 애매함 → 3일 뒤 (3일 단계 그대로)', () => {
  let p = make('2026-12-01');
  p = applyReview(p, 'vague', '2026-12-04');
  assert.equal(p.stage, 0);
  assert.equal(p.dueDate, '2026-12-07');
});

test('5. 어느 단계든 틀림 → 3일 뒤, 3일 단계부터 다시', () => {
  for (let stage = 0; stage <= 3; stage++) {
    const p = applyReview(make('2026-12-01', { stage, dueDate: '2026-12-10' }), 'wrong', '2026-12-10');
    assert.equal(p.stage, 0, `${stage}단계에서 틀림`);
    assert.equal(p.dueDate, '2026-12-13');
  }
});

test('6. 늦게 평가하면 평가한 날 기준으로 다음 날짜 계산', () => {
  const p = make('2026-12-01'); // 원래 12/4
  assert.equal(overdueDays(p, '2026-12-10'), 6, '6일 지남');
  assert.equal(shows(p, '2026-12-10'), true, '밀린 문제는 계속 남아 있음');
  const c = applyReview(p, 'correct', '2026-12-10');
  assert.equal(c.dueDate, '2026-12-17', '12/10 + 7일');
  const v = applyReview(p, 'vague', '2026-12-10');
  assert.equal(v.dueDate, '2026-12-13', '12/10 + 3일');
  const w = applyReview(p, 'wrong', '2026-12-10');
  assert.equal(w.dueDate, '2026-12-13', '12/10 + 3일');
});

test('7. 오늘 복습 15개, 최대 10개 → 가장 오래 밀린 10개만, 5개는 다음 날로', () => {
  const day = '2026-12-20';
  // 등록일 12/1 ~ 12/15 → 복습일 12/4 ~ 12/18 (모두 오늘 이전), 순서를 섞어서 넣음
  const list = [];
  for (let i = 1; i <= 15; i++) list.push(make(`2026-12-${String(i).padStart(2, '0')}`));
  const shuffled = [...list].sort(() => Math.random() - 0.5);

  const { queue, deferred } = dailyQueue(shuffled, day, 10);
  assert.equal(queue.length, 10);
  assert.equal(deferred.length, 5);
  assert.deepEqual(queue.map((p) => p.id), list.slice(0, 10).map((p) => p.id), '가장 오래 밀린 10개');
  assert.deepEqual(deferred.map((p) => p.id), list.slice(10).map((p) => p.id));

  // 10개를 오늘 모두 평가하면, 오늘은 더 안 나옴
  const after = shuffled.map((p) => (queue.some((q) => q.id === p.id) ? applyReview(p, 'correct', day) : p));
  assert.equal(dailyQueue(after, day, 10).queue.length, 0, '오늘 최대 개수를 다 채움');
  // 다음 날에는 남은 5개가 나옴
  const next = dailyQueue(after, '2026-12-21', 10);
  assert.deepEqual(next.queue.map((p) => p.id).sort(), list.slice(10).map((p) => p.id).sort());
});

test('8. 졸업한 문제를 다시 복습에 넣으면 3일 단계부터', () => {
  let p = make('2026-12-01');
  for (const d of ['2026-12-04', '2026-12-11', '2026-12-25', '2027-01-24']) p = applyReview(p, 'correct', d);
  assert.equal(p.stage, GRADUATED);
  p = reactivate(p, '2027-03-01');
  assert.equal(p.stage, 0);
  assert.equal(p.dueDate, '2027-03-04');
  assert.equal(shows(p, '2027-03-03'), false);
  assert.equal(shows(p, '2027-03-04'), true);
  p = applyReview(p, 'correct', '2027-03-04');
  assert.equal(p.dueDate, '2027-03-11', '그다음은 다시 7일 단계');
});
