// 복습 일정 자동 테스트. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSchedule, applyReview, reactivate, dailyQueue, overdueDays, replaySchedule, trackFor, GRADUATED,
} from '../js/schedule.js';

const LIGHT = ['calc', 'time']; // 가벼운 실수: 계산 실수, 시간 부족

let seq = 0;
/** created 날짜에 등록한 문제 하나 만들기 (reasonIds로 코스 결정) */
function make(created, reasonIds = ['concept'], extra = {}) {
  seq++;
  const baseTrack = trackFor(reasonIds, LIGHT);
  return { id: 'p' + seq, createdAt: seq, createdDate: created, reasonIds, baseTrack, ...newSchedule(created, baseTrack), reviews: [], ...extra };
}
/** day에 복습 목록에 나오는지 */
const shows = (p, day) => dailyQueue([p], day, 10).queue.some((q) => q.id === p.id);
/** 여러 번 평가: [['2026-12-02','correct'], ...] */
const run = (p, steps) => steps.reduce((acc, [d, r, extra]) => applyReview(acc, r, d, extra), p);

// ---------- 복습 코스 정하기 ----------
test('코스: 가벼운 실수(계산 실수·시간 부족)만 골랐을 때만 짧은 복습', () => {
  assert.equal(trackFor(['calc'], LIGHT), 'short');
  assert.equal(trackFor(['calc', 'time'], LIGHT), 'short');
  assert.equal(trackFor(['calc', 'concept'], LIGHT), 'normal', '섞이면 보통 복습');
  assert.equal(trackFor(['missed'], LIGHT), 'normal');
  assert.equal(trackFor([], LIGHT), 'normal');
});

// ---------- 보통 복습: 1 → 3 → 7 → 14 → 28 ----------
test('1. 12/1 등록 → 다음 날 12/2에 처음 복습이 나옴', () => {
  const p = make('2026-12-01');
  assert.equal(p.track, 'normal');
  assert.equal(p.dueDate, '2026-12-02');
  assert.equal(shows(p, '2026-12-01'), false, '등록한 날에는 안 나옴');
  assert.equal(shows(p, '2026-12-02'), true);
});

test('2. 보통 복습 계속 맞음: 12/2 → 12/5 → 12/12 → 12/26 → 1/23 → 졸업', () => {
  let p = make('2026-12-01');
  const dues = [];
  for (const d of ['2026-12-02', '2026-12-05', '2026-12-12', '2026-12-26']) {
    p = applyReview(p, 'correct', d);
    dues.push(p.dueDate);
  }
  assert.deepEqual(dues, ['2026-12-05', '2026-12-12', '2026-12-26', '2027-01-23']);
  p = applyReview(p, 'correct', '2027-01-23');
  assert.equal(p.stage, GRADUATED);
  assert.equal(p.graduatedDate, '2027-01-23');
  assert.equal(p.reviews.length, 5, '복습 기록 5개');
});

test('3. 14일 단계에서 애매함 → 7일 뒤, 그다음 맞음 → 다시 14일 간격', () => {
  let p = run(make('2026-12-01'), [['2026-12-02', 'correct'], ['2026-12-05', 'correct'], ['2026-12-12', 'correct']]);
  assert.equal(p.dueDate, '2026-12-26', '14일 단계');
  p = applyReview(p, 'vague', '2026-12-26');
  assert.equal(p.dueDate, '2027-01-02', '7일 뒤');
  p = applyReview(p, 'correct', '2027-01-02');
  assert.equal(p.dueDate, '2027-01-16', '다시 14일 간격');
});

test('4. 1일 단계에서 애매함 → 1일 뒤 (1일 단계 그대로)', () => {
  const p = applyReview(make('2026-12-01'), 'vague', '2026-12-02');
  assert.equal(p.stage, 0);
  assert.equal(p.dueDate, '2026-12-03');
});

test('5. 틀림 → 이번에 틀린 이유로 코스를 다시 정해서 1일 뒤부터', () => {
  const base = run(make('2026-12-01'), [['2026-12-02', 'correct'], ['2026-12-05', 'correct']]); // 보통 7일 단계
  const heavy = applyReview(base, 'wrong', '2026-12-12', { track: 'normal', reasonIds: ['concept'] });
  assert.deepEqual([heavy.track, heavy.stage, heavy.dueDate], ['normal', 0, '2026-12-13']);
  const light = applyReview(base, 'wrong', '2026-12-12', { track: 'short', reasonIds: ['calc'] });
  assert.deepEqual([light.track, light.stage, light.dueDate], ['short', 0, '2026-12-13'], '계산 실수만 → 짧은 복습으로');
});

test('6. 늦게 평가하면 평가한 날 기준으로 다음 날짜 계산', () => {
  const p = make('2026-12-01'); // 원래 12/2
  assert.equal(overdueDays(p, '2026-12-10'), 8, '8일 지남');
  assert.equal(shows(p, '2026-12-10'), true, '밀린 문제는 계속 남아 있음');
  assert.equal(applyReview(p, 'correct', '2026-12-10').dueDate, '2026-12-13', '12/10 + 3일');
  assert.equal(applyReview(p, 'vague', '2026-12-10').dueDate, '2026-12-11', '12/10 + 1일');
});

test('7. 오늘 복습 15개, 최대 10개 → 가장 오래 밀린 10개만, 5개는 다음 날로', () => {
  const day = '2026-12-20';
  const list = [];
  for (let i = 1; i <= 15; i++) list.push(make(`2026-12-${String(i).padStart(2, '0')}`)); // 복습일 12/2 ~ 12/16
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  const { queue, deferred } = dailyQueue(shuffled, day, 10);
  assert.deepEqual(queue.map((p) => p.id), list.slice(0, 10).map((p) => p.id), '가장 오래 밀린 10개');
  assert.deepEqual(deferred.map((p) => p.id), list.slice(10).map((p) => p.id));
  const after = shuffled.map((p) => (queue.some((q) => q.id === p.id) ? applyReview(p, 'correct', day) : p));
  assert.equal(dailyQueue(after, day, 10).queue.length, 0, '오늘 최대 개수를 다 채움');
  const next = dailyQueue(after, '2026-12-21', 10);
  assert.deepEqual(next.queue.map((p) => p.id).sort(), list.slice(10).map((p) => p.id).sort());
});

test('8. 졸업한 문제를 다시 복습에 넣으면 1일 단계부터', () => {
  let p = run(make('2026-12-01'), [['2026-12-02', 'correct'], ['2026-12-05', 'correct'], ['2026-12-12', 'correct'], ['2026-12-26', 'correct'], ['2027-01-23', 'correct']]);
  assert.equal(p.stage, GRADUATED);
  p = reactivate(p, '2027-03-01');
  assert.deepEqual([p.stage, p.dueDate, p.graduatedDate], [0, '2027-03-02', null]);
  p = applyReview(p, 'correct', '2027-03-02');
  assert.equal(p.dueDate, '2027-03-05', '그다음은 3일 단계');
});

// ---------- 짧은 복습: 1 → 3 → 7 ----------
test('9. 짧은 복습: 11/10 계산 실수 → 11/11 → 11/14 → 11/21 → 졸업 (3번)', () => {
  let p = make('2026-11-10', ['calc']);
  assert.deepEqual([p.track, p.dueDate], ['short', '2026-11-11']);
  p = applyReview(p, 'correct', '2026-11-11');
  assert.equal(p.dueDate, '2026-11-14');
  p = applyReview(p, 'correct', '2026-11-14');
  assert.equal(p.dueDate, '2026-11-21');
  p = applyReview(p, 'correct', '2026-11-21');
  assert.equal(p.stage, GRADUATED);
});

test('10. 짧은 복습 중 틀림: 또 가벼운 실수면 짧은 복습 1일부터, 개념 문제면 보통 복습(28일까지)으로', () => {
  const p = run(make('2026-11-10', ['calc', 'time']), [['2026-11-11', 'correct']]);
  const again = applyReview(p, 'wrong', '2026-11-14', { track: 'short', reasonIds: ['calc'] });
  assert.deepEqual([again.track, again.dueDate], ['short', '2026-11-15']);
  let moved = applyReview(p, 'wrong', '2026-11-14', { track: 'normal', reasonIds: ['concept'] });
  assert.deepEqual([moved.track, moved.dueDate], ['normal', '2026-11-15']);
  moved = run(moved, [['2026-11-15', 'correct'], ['2026-11-18', 'correct'], ['2026-11-25', 'correct'], ['2026-12-09', 'correct']]);
  assert.equal(moved.dueDate, '2027-01-06', '보통 복습이라 28일 단계까지 감');
});

test('11. 짧은 복습 7일 단계에서 애매함 → 3일 뒤', () => {
  const p = run(make('2026-11-10', ['calc']), [['2026-11-11', 'correct'], ['2026-11-14', 'correct'], ['2026-11-21', 'vague']]);
  assert.deepEqual([p.stage, p.dueDate], [1, '2026-11-24']);
});

// ---------- 지난 날짜로 등록 / 지난 복습 기록 ----------
test('12. 오늘(11/27) 11/10에 틀린 문제 등록 → 11/11이 복습일이라 이미 16일 지남', () => {
  const p = make('2026-11-10');
  assert.equal(p.dueDate, '2026-11-11');
  assert.equal(overdueDays(p, '2026-11-27'), 16);
  assert.equal(shows(p, '2026-11-27'), true);
});

test('13. 종이로 했던 지난 복습 기록 넣기: 순서 섞어 넣어도 날짜순으로 다시 계산', () => {
  let p = make('2026-11-10', ['concept']);
  p = applyReview(p, 'correct', '2026-11-14'); // 나중 기록을 먼저 넣음
  p = applyReview(p, 'correct', '2026-11-11');
  assert.deepEqual(p.reviews.map((r) => r.date), ['2026-11-11', '2026-11-14'], '날짜순 정렬');
  assert.deepEqual(p.reviews.map((r) => r.stage), [0, 1], '그때 단계도 다시 계산');
  assert.equal(p.dueDate, '2026-11-21', '11/14 + 7일');
});

test('14. 기록을 지우거나 틀린 날짜를 바꾸면 일정도 다시 계산', () => {
  const p = run(make('2026-11-10'), [['2026-11-11', 'correct'], ['2026-11-14', 'correct']]);
  const removed = replaySchedule(p.createdDate, p.baseTrack, p.reviews.slice(0, 1));
  assert.equal(removed.dueDate, '2026-11-14', '두 번째 기록을 지우면 3일 단계로');
  const moved = replaySchedule('2026-11-05', p.baseTrack, []);
  assert.equal(moved.dueDate, '2026-11-06', '날짜를 11/5로 바꾸면 11/6');
});

// 서비스 워커(sw.js)에 따로 적어 둔 "오늘 복습 목록" 계산이 js/schedule.js와 똑같은지
test('알림용 계산(sw.js)이 앱의 계산과 같음', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const code = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(code), 'sw.js에는 import가 없어야 예전 앱도 업데이트를 받아요');
  const listeners = {};
  const sandbox = { self: { addEventListener: (t, f) => { listeners[t] = f; } }, location: { origin: 'x' }, console };
  vm.runInNewContext(code + '\nself.__dq = dailyQueue; self.__od = overdueDays;', sandbox);
  const list = [];
  for (let i = 1; i <= 15; i++) list.push(make(`2026-12-${String(i).padStart(2, '0')}`));
  list[3] = applyReview(list[3], 'correct', '2026-12-20');
  for (const day of ['2026-12-10', '2026-12-20', '2026-12-25']) {
    const a = dailyQueue(list, day, 10); const b = sandbox.self.__dq(list, day, 10);
    assert.deepEqual(b.queue.map((p) => p.id), a.queue.map((p) => p.id), day);
    assert.deepEqual(b.queue.map((p) => sandbox.self.__od(p, day)), a.queue.map((p) => overdueDays(p, day)));
  }
  assert.ok(listeners.periodicsync && listeners.notificationclick, '알림 이벤트가 연결됨');
});

test('복습 기록에 붙인 풀이(사진)는 기록을 더 넣거나 다시 계산해도 그대로 남음', () => {
  let p = make('2026-11-10');
  p = applyReview(p, 'correct', '2026-11-14', { images: { photos: ['a', 'b'], drawing: 'c' } });
  p = applyReview(p, 'vague', '2026-11-11'); // 더 이른 날짜를 나중에 넣음 → 다시 계산
  const r = p.reviews.find((x) => x.date === '2026-11-14');
  assert.deepEqual(r.images, { photos: ['a', 'b'], drawing: 'c' });
});
