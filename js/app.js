// 앱의 화면과 동작
import * as db from './db.js';
import {
  toDateStr, addDays, newSchedule, stageLabel, GRADUATED,
  nextSchedule, applyReview, reactivate, dailyQueue, overdueDays, INTERVALS,
} from './schedule.js';
import { pickFile, cropImage, makeThumb, canvasToBlob } from './image.js';
import { PenCanvas } from './pen.js';
import { reasonStats, conditionStats, unitStats, weeklyStats, overallRate } from './stats.js';
import { h, fill, $, uid, toast, choose, UrlBag } from './ui.js';

// ---------- 공용 상태 ----------
const state = {
  subjects: [],
  reasons: [],
  sel: { subjectId: null, units: {} }, // 마지막으로 고른 과목/단원
  dailyMax: 10,
  testMode: false,
  testToday: null,
};

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

async function loadMeta() {
  state.subjects = (await db.getAll('subjects')).sort(byOrder);
  state.reasons = (await db.getAll('reasons')).sort(byOrder);
  state.sel = await db.getSetting('lastSelection', { subjectId: null, units: {} });
  state.dailyMax = await db.getSetting('dailyMax', 10);
}

/** 오늘 날짜. 테스트 모드에서는 내가 정한 날짜 */
function today() { return state.testMode ? state.testToday : toDateStr(new Date()); }

const subjectById = (id) => state.subjects.find((s) => s.id === id);
const reasonById = (id) => state.reasons.find((r) => r.id === id);
const TYPE_LABEL = { solution: '풀이형', reason: '근거 메모형' };

function unitName(subject, unitId) {
  const u = subject?.units.find((x) => x.id === unitId);
  if (!u) return '단원 없음';
  return u.group ? `${u.group} › ${u.name}` : u.name;
}
function problemLabel(p) {
  const s = subjectById(p.subjectId);
  return `${s ? s.name : '(삭제된 과목)'} · ${unitName(s, p.unitId)}`;
}
function fmtDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}
function reasonTags(p) {
  return (p.reasonIds || []).map(reasonById).filter(Boolean).map((r) => h('span', { class: 'tag' }, r.name));
}
function statusBadge(p) {
  return p.stage === GRADUATED
    ? h('span', { class: 'badge grad' }, '🎓 졸업')
    : h('span', { class: 'badge' }, `복습 중 · ${stageLabel(p.stage)}`);
}
/** 다음 복습일 표시: 지났으면 빨간색 "○일 지남" */
function dueBadge(p) {
  if (p.stage === GRADUATED || !p.dueDate) return null;
  const t = today();
  const od = overdueDays(p, t);
  if (od > 0) return h('span', { class: 'badge late' }, `${od}일 지남`);
  if (p.dueDate === t) return h('span', { class: 'badge due' }, '오늘 복습');
  const [, m, d] = p.dueDate.split('-').map(Number);
  return h('span', { class: 'muted' }, `${m}/${d} 복습`);
}

// ---------- 화면 이동 ----------
const bags = {}; // 화면별 사진 주소 모음
const bagFor = (name) => { (bags[name] ||= new UrlBag()).clear(); return bags[name]; };

const screens = {
  home: { title: '오답노트', tab: 'home', render: renderHome },
  review: { title: '복습', tab: 'home', render: renderReview },
  graduated: { title: '졸업 모아보기', tab: 'home', render: renderGraduated },
  add: { title: '오답 등록', tab: 'add', render: showAdd },
  list: { title: '오답 목록', tab: 'list', render: renderList },
  detail: { title: '오답 상세', tab: 'list', render: renderDetail },
  edit: { title: '오답 수정', tab: 'list', render: renderEdit },
  stats: { title: '통계', tab: 'stats', render: renderStats },
  settings: { title: '설정', tab: 'settings', render: renderSettings },
};

export function go(path) { location.hash = '#' + path; }

async function route() {
  const [rawName, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const name = screens[rawName] ? rawName : 'home';
  const sc = screens[name];
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== 'screen-' + name; });
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.go === sc.tab));
  $('#title').textContent = sc.title;
  if (name !== 'edit') closeEditForm();
  await sc.render($('#screen-' + name), arg && decodeURIComponent(arg));
  if (name !== 'add') window.scrollTo(0, 0);
}

// ---------- 홈 ----------
async function renderHome(el) {
  const problems = await db.getAll('problems');
  const t = today();
  const { queue, deferred, doneToday } = dailyQueue(problems, t, state.dailyMax);
  const late = queue.filter((p) => overdueDays(p, t) > 0).length;
  const active = problems.filter((p) => p.stage !== GRADUATED).length;
  const nextDue = problems.filter((p) => p.stage !== GRADUATED && p.dueDate > t).map((p) => p.dueDate).sort()[0];

  fill(el,
    h('div', { class: 'card hero' },
      h('div', { class: 'today' }, fmtDate(t)),
      queue.length > 0
        ? [h('div', { class: 'big-num' }, queue.length, h('small', null, '개')),
          h('div', { class: 'hero-sub' }, '오늘 복습할 문제'),
          late > 0 && h('div', { class: 'late-text' }, `그중 ${late}개는 복습 날짜가 지났어요`)]
        : h('div', { class: 'done-msg' },
          doneToday > 0 ? `오늘 복습 끝! 🎉 (${doneToday}개 완료)` : '오늘은 복습할 문제가 없어요 😊',
          nextDue && h('div', { class: 'hint' }, `다음 복습: ${fmtDate(nextDue)}`)),
      deferred.length > 0 && h('p', { class: 'hint' }, `하루 최대 ${state.dailyMax}개라서 ${deferred.length}개는 다음 날로 넘어가요.`),
      h('button', { class: 'btn primary big', disabled: queue.length === 0, onclick: () => go('review') }, '▶ 복습 시작')),
    h('button', { class: 'btn big', onclick: () => go('add') }, '➕ 오답 등록'),
    h('div', { class: 'card' },
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', null, problems.length), h('span', null, '전체 오답')),
        h('div', { class: 'stat' }, h('b', null, active), h('span', null, '복습 중')),
        h('div', { class: 'stat' }, h('b', null, problems.length - active), h('span', null, '졸업'))),
      h('button', { class: 'btn', style: { width: '100%', marginTop: '12px' }, onclick: () => go('graduated') }, '🎓 졸업 모아보기')));
}

// ---------- 복습 ----------
let session = null; // 이번 복습에서 맞음/애매함/틀림 개수

async function renderReview(el) {
  const bag = bagFor('review');
  const t = today();
  const problems = await db.getAll('problems');
  const { queue, deferred } = dailyQueue(problems, t, state.dailyMax);
  if (!session || session.date !== t) session = { date: t, correct: 0, vague: 0, wrong: 0 };

  if (!queue.length) {
    const n = session.correct + session.vague + session.wrong;
    fill(el,
      h('div', { class: 'card center' },
        h('div', { class: 'big-emoji' }, '🎉'),
        h('h2', null, n ? '오늘 복습 끝!' : '지금은 복습할 문제가 없어요'),
        n > 0 && h('p', null, `⭕ 맞음 ${session.correct} · 🔺 애매함 ${session.vague} · ❌ 틀림 ${session.wrong}`),
        deferred.length > 0 && h('p', { class: 'hint' }, `남은 ${deferred.length}개는 다음 날 복습에 나와요.`)),
      h('button', { class: 'btn primary big', onclick: () => go('home') }, '🏠 홈으로'));
    return;
  }

  const p = queue[0];
  const od = overdueDays(p, t);
  const probImg = await imageEl(p.images?.problem, bag);
  const answerArea = h('div');
  let busy = false;

  async function grade(result) {
    if (busy) return;
    busy = true;
    const updated = applyReview(p, result, t);
    await db.put('problems', updated);
    session[result]++;
    toast(updated.stage === GRADUATED ? '🎓 졸업했어요!' : `다음 복습: ${fmtDate(updated.dueDate)}`);
    await renderReview(el);
    window.scrollTo(0, 0);
  }
  const gradeBtn = (result, cls, label) => {
    const next = nextSchedule(p.stage, result, t);
    const what = next.stage === GRADUATED ? '졸업' : `${INTERVALS[next.stage]}일 뒤`;
    return h('button', { class: `btn grade ${cls}`, onclick: () => grade(result) }, h('div', null, label), h('small', null, what));
  };

  const revealBtn = h('button', {
    class: 'btn primary big',
    onclick: async () => {
      revealBtn.remove();
      fill(answerArea,
        await solutionCards(p, bag),
        h('div', { class: 'card' },
          h('h2', null, '어땠나요?'),
          h('div', { class: 'grade-row' },
            gradeBtn('correct', 'ok', '⭕ 맞음'),
            gradeBtn('vague', 'meh', '🔺 애매함'),
            gradeBtn('wrong', 'bad', '❌ 틀림'))));
      answerArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  }, '👀 풀이 보기');

  fill(el,
    h('div', { class: 'review-top' },
      h('span', null, `남은 문제 ${queue.length}개`),
      od > 0 && h('span', { class: 'badge late' }, `${od}일 지남`)),
    h('div', { class: 'card' },
      h('div', { class: 'item-title big' }, p.starred && '⭐ ', problemLabel(p)),
      h('div', { class: 'meta' }, statusBadge(p)),
      probImg,
      h('p', { class: 'hint' }, '종이에 다시 풀어본 다음 "풀이 보기"를 눌러요.')),
    revealBtn,
    answerArea);
}

async function imageEl(imgId, bag) {
  if (!imgId) return null;
  const row = await db.get('images', imgId);
  return row ? h('img', { class: 'photo-preview', src: bag.url(row.blob), alt: '' }) : null;
}

/** 저장해 둔 풀이 / 답과 근거 / 틀린 이유·메모 카드들 (복습·상세 화면에서 같이 사용) */
async function solutionCards(p, bag) {
  const [drawImg, photoImg] = await Promise.all([imageEl(p.images?.drawing, bag), imageEl(p.images?.solutionPhoto, bag)]);
  const subject = subjectById(p.subjectId);
  const src = p.source || {};
  const srcText = [src.book, src.page && `${src.page}쪽`, src.num && `${src.num}번`].filter(Boolean).join(' · ');
  const details = Object.entries(p.reasonDetails || {}).map(([rid, text]) =>
    h('div', { class: 'detail-note' }, `${reasonById(rid)?.name || '기타'}: ${text}`));
  return [
    (subject?.type === 'reason' || p.myAnswer || p.answerBasis) && h('div', { class: 'card' },
      h('h2', null, '답과 근거'),
      h('h3', null, '내가 고른 답과 이유'), h('p', { class: 'pre' }, p.myAnswer || '-'),
      h('h3', null, '정답 근거'), h('p', { class: 'pre' }, p.answerBasis || '-')),
    (drawImg || photoImg) && h('div', { class: 'card' },
      h('h2', null, '풀이'),
      drawImg && [h('h3', null, '✍️ 펜 풀이'), drawImg],
      photoImg && [h('h3', null, '📄 풀이 사진'), photoImg]),
    h('div', { class: 'card' },
      h('h2', null, '틀린 이유'),
      h('div', null, reasonTags(p)), details,
      srcText && [h('h3', null, '출처'), h('p', null, srcText)],
      p.memo && [h('h3', null, '메모'), h('p', null, p.memo)]),
  ];
}

// ---------- 오답 등록 / 수정 폼 ----------
let addForm = null;   // 등록 화면 폼 (화면을 옮겨도 쓰던 내용 유지)
let editForm = null;
let lastBook = '';    // 교재 이름은 다음 문제에도 그대로

function showAdd(el) {
  if (!addForm) {
    addForm = createProblemForm(null, {
      onSaved: () => {
        toast('저장했어요 ✓ 다음 문제를 등록하세요');
        addForm.destroy();
        addForm = null;
        showAdd(el);
        window.scrollTo(0, 0);
      },
    });
    fill(el, addForm.el);
  }
}

function closeEditForm() {
  if (editForm) { editForm.destroy(); editForm = null; }
}

async function renderEdit(el, id) {
  closeEditForm();
  const p = await db.get('problems', id);
  if (!p) { fill(el, h('p', null, '오답을 찾을 수 없어요.')); return; }
  editForm = createProblemForm(p, {
    onSaved: () => { toast('수정했어요 ✓'); go('detail/' + p.id); },
    onCancel: () => go('detail/' + p.id),
  });
  fill(el, editForm.el);
}

function createProblemForm(existing, { onSaved, onCancel }) {
  const isEdit = !!existing;
  const urls = new UrlBag();
  let pen = null;

  // 처음 고를 과목/단원
  let subjectId = existing?.subjectId;
  if (!subjectById(subjectId)) subjectId = subjectById(state.sel.subjectId) ? state.sel.subjectId : state.subjects[0]?.id;
  let unitId = existing ? existing.unitId : state.sel.units?.[subjectId] ?? null;

  const f = {
    reasonIds: new Set(existing?.reasonIds || []),
    details: { ...(existing?.reasonDetails || {}) },
    problem: { blob: null, original: null, id: existing?.images?.problem || null, changed: false },
    photo: { blob: null, id: existing?.images?.solutionPhoto || null, changed: false },
    drawingId: existing?.images?.drawing || null,
    drawingMode: existing?.images?.drawing ? 'keep' : 'pen', // keep | pen
    starred: !!existing?.starred,
  };

  // ----- 과목 / 단원 -----
  const subjectChips = h('div', { class: 'chips' });
  const unitBox = h('div');
  function renderSubjects() {
    fill(subjectChips, ...state.subjects.map((s) => h('button', {
      class: 'chip' + (s.id === subjectId ? ' on' : ''),
      onclick: () => {
        subjectId = s.id;
        unitId = state.sel.units?.[s.id] ?? null;
        renderSubjects(); renderUnits(); updateType();
      },
    }, s.name)));
  }
  function renderUnits() {
    const s = subjectById(subjectId);
    if (!s || !s.units.length) { fill(unitBox, h('p', { class: 'hint' }, '단원이 없어요. 설정에서 추가할 수 있어요.')); return; }
    if (!s.units.some((u) => u.id === unitId)) unitId = null;
    const groups = new Map();
    s.units.forEach((u) => { const g = u.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(u); });
    fill(unitBox, ...[...groups].map(([g, units]) => h('div', null,
      g && h('div', { class: 'group-label' }, g),
      h('div', { class: 'chips' }, units.map((u) => h('button', {
        class: 'chip' + (u.id === unitId ? ' on' : ''),
        onclick: () => { unitId = u.id; renderUnits(); },
      }, u.name))))));
  }

  // ----- 문제 사진 -----
  const photoBox = h('div');
  async function takeProblemPhoto(camera) {
    const file = await pickFile(camera);
    if (!file) return;
    const blob = await cropImage(file);
    if (!blob) return;
    f.problem = { ...f.problem, blob, original: file, changed: true };
    renderPhoto();
  }
  async function recrop() {
    let src = f.problem.original || f.problem.blob;
    if (!src && f.problem.id) src = (await db.get('images', f.problem.id))?.blob;
    if (!src) return;
    const blob = await cropImage(src);
    if (!blob) return;
    f.problem = { ...f.problem, blob, changed: true };
    renderPhoto();
  }
  async function renderPhoto() {
    let blob = f.problem.blob;
    if (!blob && f.problem.id) blob = (await db.get('images', f.problem.id))?.blob;
    fill(photoBox, 
      blob ? h('img', { class: 'photo-preview', src: urls.url(blob), alt: '문제 사진' })
        : h('div', { class: 'photo-empty' }, '아직 사진이 없어요'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => takeProblemPhoto(true) }, '📷 카메라로 찍기'),
        h('button', { class: 'btn', onclick: () => takeProblemPhoto(false) }, '🖼 갤러리에서 고르기'),
        blob && h('button', { class: 'btn', onclick: recrop }, '✂️ 다시 자르기')));
  }

  // ----- 풀이 (풀이형) -----
  const drawBox = h('div');
  const solPhotoBox = h('div');
  function renderDrawing() {
    if (f.drawingMode === 'keep' && f.drawingId) {
      const holder = h('div', { class: 'drawing-holder' });
      db.get('images', f.drawingId).then((img) => {
        if (img) fill(holder, h('img', { class: 'photo-preview', src: urls.url(img.blob), alt: '펜 풀이' }));
      });
      fill(drawBox, holder, h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { f.drawingMode = 'pen'; renderDrawing(); } }, '✍️ 새로 그리기'),
        h('button', { class: 'btn danger', onclick: () => { if (confirm('펜 풀이를 지울까요?')) { f.drawingMode = 'pen'; f.drawingRemoved = true; renderDrawing(); } } }, '🗑 그림 지우기')));
    } else {
      if (!pen) { const host = h('div'); pen = new PenCanvas(host); pen.host = host; }
      fill(drawBox, pen.host);
    }
  }
  async function takeSolutionPhoto(camera) {
    const file = await pickFile(camera);
    if (!file) return;
    const blob = await cropImage(file);
    if (!blob) return;
    f.photo = { ...f.photo, blob, changed: true };
    renderSolPhoto();
  }
  async function renderSolPhoto() {
    let blob = f.photo.blob;
    if (!blob && f.photo.id && !f.photo.changed) blob = (await db.get('images', f.photo.id))?.blob;
    fill(solPhotoBox, 
      blob && h('img', { class: 'photo-preview', src: urls.url(blob), alt: '풀이 사진' }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => takeSolutionPhoto(true) }, '📷 카메라'),
        h('button', { class: 'btn', onclick: () => takeSolutionPhoto(false) }, '🖼 갤러리'),
        blob && h('button', { class: 'btn danger', onclick: () => { f.photo = { blob: null, id: f.photo.id, changed: true }; renderSolPhoto(); } }, '✕ 사진 빼기')));
  }
  const solutionCard = h('div', { class: 'card' },
    h('h2', null, '2. 풀이'),
    h('h3', null, '✍️ S펜으로 쓰기'), drawBox,
    h('h3', null, '📄 종이에 쓴 풀이 사진'), solPhotoBox);

  // ----- 근거 메모 (근거 메모형) -----
  const myAnswer = h('textarea', { rows: 3, placeholder: '예: ③번. 2문단에서 ~라고 해서', value: existing?.myAnswer || '' });
  const answerBasis = h('textarea', { rows: 3, placeholder: '예: 정답 ⑤번. 3문단 첫 문장이 근거', value: existing?.answerBasis || '' });
  const memoCard = h('div', { class: 'card' },
    h('h2', null, '2. 답과 근거'),
    h('label', { class: 'field' }, h('span', null, '내가 고른 답과 이유'), myAnswer),
    h('label', { class: 'field' }, h('span', null, '정답 근거'), answerBasis));

  function updateType() {
    const type = subjectById(subjectId)?.type || 'solution';
    solutionCard.hidden = type !== 'solution';
    memoCard.hidden = type !== 'reason';
  }

  // ----- 틀린 이유 -----
  const reasonBox = h('div');
  function renderReasons() {
    const detailInputs = state.reasons.filter((r) => r.needsDetail && f.reasonIds.has(r.id)).map((r) =>
      h('label', { class: 'field' },
        h('span', null, r.detailLabel || `${r.name}: 자세히 적기`),
        h('input', { type: 'text', value: f.details[r.id] || '', oninput: (e) => { f.details[r.id] = e.target.value; } })));
    fill(reasonBox, 
      h('div', { class: 'chips' }, state.reasons.map((r) => h('button', {
        class: 'chip' + (f.reasonIds.has(r.id) ? ' on' : ''),
        onclick: () => { f.reasonIds.has(r.id) ? f.reasonIds.delete(r.id) : f.reasonIds.add(r.id); renderReasons(); },
      }, r.name))),
      detailInputs);
  }

  // ----- 선택 입력 -----
  const src = existing?.source || {};
  const book = h('input', { type: 'text', placeholder: '교재 이름', value: isEdit ? src.book || '' : lastBook });
  const page = h('input', { type: 'text', inputmode: 'numeric', placeholder: '페이지', value: src.page || '' });
  const num = h('input', { type: 'text', placeholder: '문제 번호', value: src.num || '' });
  const memo = h('input', { type: 'text', placeholder: '한 줄 메모', value: existing?.memo || '' });
  const starBtn = h('button', { class: 'btn star', onclick: () => { f.starred = !f.starred; syncStar(); } });
  const syncStar = () => { starBtn.textContent = f.starred ? '⭐ 중요 문제' : '☆ 중요 표시'; starBtn.classList.toggle('on', f.starred); };
  syncStar();
  const optional = h('details', { class: 'card', open: isEdit && (src.book || src.page || src.num || existing.memo) ? true : null },
    h('summary', null, '4. 선택 입력 (출처 · 메모 · 중요)'),
    h('div', { class: 'source-row' }, book, page, num),
    memo,
    starBtn);

  // ----- 저장 -----
  const saveBtn = h('button', { class: 'btn primary big', onclick: save }, isEdit ? '💾 수정 저장' : '💾 저장');

  async function save() {
    if (!f.problem.blob && !f.problem.id) { alert('문제 사진을 넣어주세요.'); return; }
    if (!f.reasonIds.size) { alert('틀린 이유를 하나 이상 골라주세요.'); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
    try {
      const putImgs = [];
      const delImgs = [];
      const images = { problem: f.problem.id, solutionPhoto: f.photo.id, drawing: f.drawingId };
      let thumb = existing?.thumb;
      if (f.problem.changed) {
        const id = uid();
        putImgs.push({ id, blob: f.problem.blob });
        if (images.problem) delImgs.push(images.problem);
        images.problem = id;
        thumb = await makeThumb(f.problem.blob);
      }
      if (f.photo.changed) {
        if (images.solutionPhoto) delImgs.push(images.solutionPhoto);
        images.solutionPhoto = null;
        if (f.photo.blob) { const id = uid(); putImgs.push({ id, blob: f.photo.blob }); images.solutionPhoto = id; }
      }
      if (f.drawingMode === 'pen') {
        if (pen && pen.hasInk()) {
          const id = uid();
          putImgs.push({ id, blob: await pen.toBlob() });
          if (images.drawing) delImgs.push(images.drawing);
          images.drawing = id;
        } else if (f.drawingRemoved && images.drawing) {
          delImgs.push(images.drawing);
          images.drawing = null;
        }
      }
      const reasonIds = [...f.reasonIds];
      const reasonDetails = {};
      reasonIds.forEach((id) => { const t = (f.details[id] || '').trim(); if (t) reasonDetails[id] = t; });

      const d = today();
      const record = existing ? { ...existing } : {
        id: uid(), createdDate: d, createdAt: Date.now(), ...newSchedule(d), reviews: [],
      };
      Object.assign(record, {
        subjectId, unitId, reasonIds, reasonDetails, images, thumb,
        myAnswer: myAnswer.value.trim(), answerBasis: answerBasis.value.trim(),
        source: { book: book.value.trim(), page: page.value.trim(), num: num.value.trim() },
        memo: memo.value.trim(), starred: f.starred, updatedAt: Date.now(),
      });
      await db.saveProblem(record, putImgs, delImgs);

      if (!isEdit) {
        lastBook = record.source.book;
        state.sel = { subjectId, units: { ...(state.sel.units || {}), [subjectId]: unitId } };
        await db.setSetting('lastSelection', state.sel);
      }
      onSaved(record);
    } catch (err) {
      console.error(err);
      alert('저장하지 못했어요: ' + (err?.name === 'QuotaExceededError' ? '저장 공간이 부족해요.' : err.message));
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '💾 수정 저장' : '💾 저장';
    }
  }

  const el = h('div', { class: 'form' },
    h('div', { class: 'card' },
      h('h2', null, '과목 · 단원'), subjectChips, unitBox),
    h('div', { class: 'card' },
      h('h2', null, '1. 문제 사진'), photoBox),
    solutionCard,
    memoCard,
    h('div', { class: 'card' },
      h('h2', null, '3. 틀린 이유 (여러 개 선택 가능)'), reasonBox),
    optional,
    saveBtn,
    isEdit && h('button', { class: 'btn big', onclick: onCancel }, '취소'));

  renderSubjects(); renderUnits(); renderPhoto(); renderDrawing(); renderSolPhoto(); renderReasons(); updateType();

  return {
    el,
    destroy() { urls.clear(); pen?.destroy(); },
  };
}

// ---------- 오답 목록 ----------
const filter = { subjectId: '', unitId: '', reasonId: '', status: '', starred: false };

async function renderList(el) {
  const bag = bagFor('list');
  const all = (await db.getAll('problems')).sort((a, b) => b.createdAt - a.createdAt);

  const sel = (value, options, onchange) => h('select', { onchange: (e) => { onchange(e.target.value); renderList(el); } },
    options.map(([v, label]) => h('option', { value: v, selected: v === value ? true : null }, label)));

  const subject = subjectById(filter.subjectId);
  if (!subject) filter.unitId = '';
  const filters = h('div', { class: 'card filters' },
    sel(filter.subjectId, [['', '모든 과목'], ...state.subjects.map((s) => [s.id, s.name])], (v) => { filter.subjectId = v; filter.unitId = ''; }),
    subject && sel(filter.unitId, [['', '모든 단원'], ...subject.units.map((u) => [u.id, unitName(subject, u.id)])], (v) => { filter.unitId = v; }),
    sel(filter.reasonId, [['', '모든 틀린 이유'], ...state.reasons.map((r) => [r.id, r.name])], (v) => { filter.reasonId = v; }),
    sel(filter.status, [['', '복습 중 + 졸업'], ['active', '복습 중만'], ['grad', '졸업만']], (v) => { filter.status = v; }),
    h('button', { class: 'chip' + (filter.starred ? ' on' : ''), onclick: () => { filter.starred = !filter.starred; renderList(el); } }, '⭐ 중요만'));

  const shown = all.filter((p) =>
    (!filter.subjectId || p.subjectId === filter.subjectId)
    && (!filter.unitId || p.unitId === filter.unitId)
    && (!filter.reasonId || (p.reasonIds || []).includes(filter.reasonId))
    && (!filter.status || (filter.status === 'grad') === (p.stage === GRADUATED))
    && (!filter.starred || p.starred));

  fill(el, 
    filters,
    h('p', { class: 'hint' }, `${shown.length}개 / 전체 ${all.length}개`),
    shown.length
      ? h('div', { class: 'grid' }, shown.map((p) => h('button', { class: 'item', onclick: () => go('detail/' + p.id) },
        p.thumb ? h('img', { src: bag.url(p.thumb), alt: '', loading: 'lazy' }) : h('div', { class: 'noimg' }, '사진 없음'),
        h('div', { class: 'item-body' },
          h('div', { class: 'item-title' }, p.starred && '⭐ ', problemLabel(p)),
          h('div', null, reasonTags(p)),
          h('div', { class: 'item-foot' }, statusBadge(p), dueBadge(p))))))
      : h('div', { class: 'empty' }, all.length ? '조건에 맞는 오답이 없어요.' : '아직 등록한 오답이 없어요.', h('br'),
        !all.length && h('button', { class: 'btn primary', onclick: () => go('add') }, '➕ 첫 오답 등록하기')));
}

// ---------- 오답 상세 ----------
async function renderDetail(el, id) {
  const bag = bagFor('detail');
  const p = await db.get('problems', id);
  if (!p) { fill(el, h('p', null, '오답을 찾을 수 없어요.')); return; }
  const probImg = await imageEl(p.images?.problem, bag);

  async function restart() {
    const updated = reactivate(p, today());
    await db.put('problems', updated);
    toast(`다시 복습에 넣었어요. ${fmtDate(updated.dueDate)}에 나와요`);
    renderDetail(el, id);
  }

  fill(el,
    h('div', { class: 'card' },
      h('div', { class: 'item-title big' }, p.starred && '⭐ ', problemLabel(p)),
      h('div', { class: 'meta' }, statusBadge(p), dueBadge(p),
        p.stage !== GRADUATED && h('span', null, `다음 복습: ${fmtDate(p.dueDate)}`),
        p.graduatedDate && h('span', null, `졸업: ${fmtDate(p.graduatedDate)}`),
        h('span', { class: 'muted' }, `등록: ${fmtDate(p.createdDate)}`)),
      probImg,
      p.stage === GRADUATED && h('button', { class: 'btn primary', style: { marginTop: '12px' }, onclick: restart }, '🔁 다시 복습에 넣기')),
    await solutionCards(p, bag),
    h('div', { class: 'card' },
      h('h2', null, '복습 기록'),
      p.reviews?.length
        ? h('table', { class: 'log' },
          h('tr', null, h('th', null, '날짜'), h('th', null, '평가'), h('th', null, '그때 단계')),
          p.reviews.map((r) => h('tr', null, h('td', null, r.date), h('td', null, RESULT_LABEL[r.result] || r.result), h('td', null, stageLabel(r.stage)))))
        : h('p', { class: 'muted' }, '아직 복습 기록이 없어요.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => go('edit/' + p.id) }, '✏️ 수정'),
      h('button', { class: 'btn', onclick: async () => { p.starred = !p.starred; await db.put('problems', p); renderDetail(el, id); } },
        p.starred ? '☆ 중요 해제' : '⭐ 중요 표시'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('이 오답을 삭제할까요? 되돌릴 수 없어요.')) return;
        await db.deleteProblem(p);
        toast('삭제했어요');
        go('list');
      } }, '🗑 삭제'),
      h('button', { class: 'btn', onclick: () => history.back() }, '← 뒤로')));
}

const RESULT_LABEL = { correct: '⭕ 맞음', vague: '🔺 애매함', wrong: '❌ 틀림', restart: '🔁 다시 복습에 넣음' };

// ---------- 과목 고르기 칩 (통계, 졸업 모아보기에서 사용) ----------
function subjectFilter(current, onPick) {
  if (state.subjects.length < 2) return null;
  return h('div', { class: 'chips filter-chips' },
    [['', '전체'], ...state.subjects.map((s) => [s.id, s.name])].map(([id, name]) =>
      h('button', { class: 'chip' + (id === current ? ' on' : ''), onclick: () => onPick(id) }, name)));
}
const md = (str) => { const [, m, d] = str.split('-').map(Number); return `${m}/${d}`; };
const pct = (x) => Math.round(x * 100) + '%';

// ---------- 통계 ----------
let statsSubject = '';

function barRow(label, value, max, text) {
  return h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label' }, label),
    h('div', { class: 'bar-track' }, value > 0 && h('div', { class: 'bar-fill', style: { width: (value / max) * 100 + '%' } })),
    h('div', { class: 'bar-value' }, text));
}

function stackRow(label, row, max) {
  return h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label' }, label),
    h('div', { class: 'bar-track' }, row.total > 0 && h('div', { class: 'stack', style: { width: (row.total / max) * 100 + '%' } },
      row.active > 0 && h('div', { class: 'seg active', style: { flexGrow: row.active } }),
      row.grad > 0 && h('div', { class: 'seg grad', style: { flexGrow: row.grad } }))),
    h('div', { class: 'bar-value' }, row.total ? `${row.total}개 (복습 ${row.active} · 졸업 ${row.grad})` : '0개'));
}

async function renderStats(el) {
  if (statsSubject && !subjectById(statsSubject)) statsSubject = '';
  const all = await db.getAll('problems');
  const ps = statsSubject ? all.filter((p) => p.subjectId === statsSubject) : all;
  const chips = subjectFilter(statsSubject, (id) => { statsSubject = id; renderStats(el); });
  if (!ps.length) { fill(el, chips, h('div', { class: 'empty' }, '아직 통계를 낼 오답이 없어요.')); return; }

  const active = ps.filter((p) => p.stage !== GRADUATED).length;
  const ov = overallRate(ps);
  const rs = reasonStats(ps, state.reasons);
  const maxR = Math.max(1, ...rs.map((r) => r.count));
  const conds = conditionStats(ps, state.reasons);
  const weeks = weeklyStats(ps, today());
  const maxW = Math.max(1, ...weeks.map((w) => w.registered));
  const weekLabel = (w, i) => (i === 3 ? `최근 7일` : `${md(w.start)}~${md(w.end)}`);
  const subjects = statsSubject ? [subjectById(statsSubject)] : state.subjects;

  const unitCards = subjects.map((s) => {
    const rows = unitStats(ps, s);
    if (!rows.some((r) => r.total) && !statsSubject) return null;
    const max = Math.max(1, ...rows.map((r) => r.total));
    let lastGroup = null;
    return h('div', { class: 'card' },
      h('h2', null, `📚 단원별 오답 수${subjects.length > 1 ? ` · ${s.name}` : ''}`),
      h('div', { class: 'legend' },
        h('span', { class: 'sw active' }), '복습 중', h('span', { class: 'sw grad' }), '졸업'),
      rows.map((r) => {
        const head = r.group !== lastGroup && r.group ? h('div', { class: 'group-label' }, r.group) : null;
        lastGroup = r.group;
        return [head, stackRow(r.name, r, max)];
      }));
  });

  fill(el,
    chips,
    h('div', { class: 'card' },
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', null, ps.length), h('span', null, '전체 오답')),
        h('div', { class: 'stat' }, h('b', null, active), h('span', null, '복습 중')),
        h('div', { class: 'stat' }, h('b', null, ps.length - active), h('span', null, '졸업')),
        h('div', { class: 'stat' }, h('b', null, ov.rate == null ? '-' : pct(ov.rate)), h('span', null, '복습 정답률')))),
    h('div', { class: 'card' },
      h('h2', null, '🤔 틀린 이유'),
      rs.map((r) => barRow(r.name, r.count, maxR, `${r.count}개 · ${pct(r.ratio)}`)),
      h('p', { class: 'hint' }, '한 문제에 이유를 여러 개 고를 수 있어서, 비율은 전체 이유 표시 수 기준이에요.')),
    conds.map((c) => h('div', { class: 'card' },
      h('h2', null, `🔎 "${c.name}"에 적은 내용`),
      c.items.length
        ? h('div', { class: 'cond-list' }, c.items.map((it) =>
          h('span', { class: 'cond' + (it.count > 1 ? ' many' : '') }, it.text, h('b', null, `${it.count}번`))))
        : h('p', { class: 'muted' }, '아직 적은 내용이 없어요.'),
      c.items.length > 0 && h('p', { class: 'hint' }, '자주 놓치는 것부터 보여줘요. 시험 볼 때 이것부터 확인하세요!'))),
    unitCards,
    h('div', { class: 'card' },
      h('h2', null, '🗓 최근 4주 등록 수'),
      weeks.map((w, i) => barRow(weekLabel(w, i), w.registered, maxW, `${w.registered}개`))),
    h('div', { class: 'card' },
      h('h2', null, '✅ 최근 4주 복습 정답률'),
      weeks.map((w, i) => barRow(weekLabel(w, i), w.rate ?? 0, 1,
        w.rate == null ? '복습 없음' : `${pct(w.rate)} (${w.correct}/${w.reviews})`)),
      h('p', { class: 'hint' }, '정답률 = 맞음 ÷ 전체 평가 수 (애매함은 정답에 넣지 않아요)')));
}

// ---------- 졸업 모아보기 ----------
let gradSubject = '';

async function renderGraduated(el) {
  if (gradSubject && !subjectById(gradSubject)) gradSubject = '';
  const bag = bagFor('graduated');
  const all = (await db.getAll('problems')).filter((p) => p.stage === GRADUATED);
  const ps = gradSubject ? all.filter((p) => p.subjectId === gradSubject) : all;
  const chips = subjectFilter(gradSubject, (id) => { gradSubject = id; renderGraduated(el); });
  if (!ps.length) {
    fill(el, chips, h('div', { class: 'empty' }, '아직 졸업한 오답이 없어요.', h('br'), '30일 단계에서 맞히면 졸업해요 🎓'));
    return;
  }

  // 과목 → 단원 순서로 묶기
  const sections = [];
  const subjects = gradSubject ? [subjectById(gradSubject)] : state.subjects;
  subjects.forEach((s) => {
    const mine = ps.filter((p) => p.subjectId === s.id);
    const unitIds = [...s.units.map((u) => u.id), null];
    unitIds.forEach((uid_) => {
      const items = mine.filter((p) => (uid_ === null ? !s.units.some((u) => u.id === p.unitId) : p.unitId === uid_));
      if (items.length) sections.push({ title: `${subjects.length > 1 ? s.name + ' · ' : ''}${unitName(s, uid_)}`, items });
    });
  });
  const orphans = ps.filter((p) => !subjectById(p.subjectId));
  if (orphans.length) sections.push({ title: '(삭제된 과목)', items: orphans });

  const secEls = sections.map((sec) => {
    const body = h('div', { class: 'grad-body' });
    let loaded = false;
    const d = h('details', { class: 'card grad-sec' },
      h('summary', null, sec.title, ' ', h('span', { class: 'tag' }, `${sec.items.length}개`)),
      body);
    d.addEventListener('toggle', async () => {
      if (!d.open || loaded) return;
      loaded = true;
      fill(body, await Promise.all(sec.items.map((p) => gradItem(p, bag))));
    });
    return d;
  });

  fill(el,
    chips,
    h('div', { class: 'row grad-head' },
      h('div', { class: 'grow' }, `졸업한 오답 ${ps.length}개 · 단원을 눌러서 펼쳐요`),
      h('button', { class: 'btn small', onclick: () => secEls.forEach((d) => { d.open = true; }) }, '모두 펼치기'),
      h('button', { class: 'btn small', onclick: () => secEls.forEach((d) => { d.open = false; }) }, '모두 접기')),
    secEls);
}

async function gradItem(p, bag) {
  const img = await imageEl(p.images?.problem, bag);
  const sol = h('div');
  const solBtn = h('button', {
    class: 'btn',
    onclick: async () => {
      if (sol.childElementCount) { fill(sol); solBtn.textContent = '👀 풀이 보기'; return; }
      fill(sol, await solutionCards(p, bag));
      solBtn.textContent = '풀이 접기';
    },
  }, '👀 풀이 보기');
  const wrap = h('div', { class: 'grad-item' },
    h('div', { class: 'item-title' }, p.starred && '⭐ ', reasonTags(p),
      p.graduatedDate && h('span', { class: 'muted' }, ` 졸업 ${fmtDate(p.graduatedDate)}`)),
    img,
    h('div', { class: 'btn-row' },
      solBtn,
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          if (!confirm('다시 복습에 넣을까요? 3일 단계부터 다시 시작해요.')) return;
          const updated = reactivate(p, today());
          await db.put('problems', updated);
          toast(`다시 복습에 넣었어요. ${fmtDate(updated.dueDate)}에 나와요`);
          wrap.remove();
        },
      }, '🔁 다시 복습에 넣기'),
      h('button', { class: 'btn', onclick: () => go('detail/' + p.id) }, '상세')),
    sol);
  return wrap;
}

// ---------- 설정 ----------
async function renderSettings(el) {
  const problems = await db.getAll('problems');
  const rerender = async () => { await loadMeta(); renderSettings(el); };

  async function addSubject() {
    const name = prompt('새 과목 이름 (예: 영어)');
    if (!name?.trim()) return;
    const type = await choose('기록 방식을 골라주세요', [
      { value: 'solution', label: '풀이형', desc: '수학, 과학처럼 풀이 과정을 적는 과목' },
      { value: 'reason', label: '근거 메모형', desc: '국어, 영어처럼 답의 이유·근거를 적는 과목' }]);
    if (!type) return;
    await db.put('subjects', { id: uid(), name: name.trim(), type, units: [], order: state.subjects.length });
    rerender();
  }
  async function editSubject(s) {
    const name = prompt('과목 이름', s.name);
    if (name == null) return;
    const type = await choose(`"${name.trim() || s.name}" 기록 방식`, [
      { value: 'solution', label: '풀이형' + (s.type === 'solution' ? ' (지금)' : '') },
      { value: 'reason', label: '근거 메모형' + (s.type === 'reason' ? ' (지금)' : '') }]);
    await db.put('subjects', { ...s, name: name.trim() || s.name, type: type || s.type });
    rerender();
  }
  async function deleteSubject(s) {
    const n = problems.filter((p) => p.subjectId === s.id).length;
    if (n) { alert(`이 과목에 오답이 ${n}개 있어서 지울 수 없어요. 오답을 먼저 지워주세요.`); return; }
    if (state.subjects.length <= 1) { alert('과목은 최소 1개가 있어야 해요.'); return; }
    if (!confirm(`"${s.name}" 과목을 삭제할까요?`)) return;
    await db.del('subjects', s.id);
    rerender();
  }
  async function addUnit(s) {
    const group = prompt('대분류 (예: 수학1). 없으면 비워두세요.', s.units.at(-1)?.group || '');
    if (group == null) return;
    const name = prompt('단원 이름');
    if (!name?.trim()) return;
    s.units.push({ id: uid(), group: group.trim(), name: name.trim() });
    await db.put('subjects', s);
    rerender();
  }
  async function editUnit(s, u) {
    const group = prompt('대분류 (없으면 비워두세요)', u.group || '');
    if (group == null) return;
    const name = prompt('단원 이름', u.name);
    if (!name?.trim()) return;
    Object.assign(u, { group: group.trim(), name: name.trim() });
    await db.put('subjects', s);
    rerender();
  }
  async function deleteUnit(s, u) {
    const n = problems.filter((p) => p.unitId === u.id).length;
    if (!confirm(`"${u.name}" 단원을 삭제할까요?` + (n ? `\n이 단원의 오답 ${n}개는 "단원 없음"이 돼요.` : ''))) return;
    s.units = s.units.filter((x) => x !== u);
    await db.put('subjects', s);
    rerender();
  }
  async function moveUnit(s, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= s.units.length) return;
    [s.units[i], s.units[j]] = [s.units[j], s.units[i]];
    await db.put('subjects', s);
    rerender();
  }
  async function addReason() {
    const name = prompt('새 틀린 이유 (예: 문제 잘못 읽음)');
    if (!name?.trim()) return;
    await db.put('reasons', { id: uid(), name: name.trim(), order: state.reasons.length });
    rerender();
  }
  async function editReason(r) {
    const name = prompt('틀린 이유 이름', r.name);
    if (!name?.trim()) return;
    await db.put('reasons', { ...r, name: name.trim() });
    rerender();
  }
  async function toggleDetail(r) {
    await db.put('reasons', { ...r, needsDetail: !r.needsDetail });
    rerender();
  }
  async function deleteReason(r) {
    const n = problems.filter((p) => (p.reasonIds || []).includes(r.id)).length;
    if (!confirm(`"${r.name}"을(를) 삭제할까요?` + (n ? `\n오답 ${n}개에서 이 이유 표시가 사라져요.` : ''))) return;
    await db.del('reasons', r.id);
    rerender();
  }

  const est = await navigator.storage?.estimate?.();
  const mb = (b) => (b / 1024 / 1024).toFixed(1) + 'MB';

  fill(el, 
    h('div', { class: 'card' },
      h('h2', null, '📚 과목과 단원'),
      state.subjects.map((s) => h('div', { class: 'subject-block' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('b', null, s.name), ' ', h('span', { class: 'tag' }, TYPE_LABEL[s.type])),
          h('button', { class: 'btn small', onclick: () => editSubject(s) }, '✏️ 수정'),
          h('button', { class: 'btn small danger', onclick: () => deleteSubject(s) }, '🗑')),
        h('ul', { class: 'unit-list' }, s.units.map((u, i) => h('li', { class: 'row' },
          h('span', { class: 'grow' }, u.group && h('span', { class: 'muted' }, u.group + ' › '), u.name),
          h('button', { class: 'btn small', onclick: () => moveUnit(s, i, -1), 'aria-label': '위로' }, '↑'),
          h('button', { class: 'btn small', onclick: () => moveUnit(s, i, 1), 'aria-label': '아래로' }, '↓'),
          h('button', { class: 'btn small', onclick: () => editUnit(s, u) }, '✏️'),
          h('button', { class: 'btn small danger', onclick: () => deleteUnit(s, u) }, '🗑')))),
        h('button', { class: 'btn', onclick: () => addUnit(s) }, '+ 단원 추가'))),
      h('button', { class: 'btn primary', onclick: addSubject }, '+ 과목 추가')),
    h('div', { class: 'card' },
      h('h2', null, '🤔 틀린 이유'),
      h('ul', { class: 'unit-list' }, state.reasons.map((r) => h('li', { class: 'row' },
        h('span', { class: 'grow' }, r.name),
        h('button', { class: 'chip small' + (r.needsDetail ? ' on' : ''), onclick: () => toggleDetail(r) }, r.needsDetail ? '✓ 적는 칸' : '적는 칸'),
        h('button', { class: 'btn small', onclick: () => editReason(r) }, '✏️'),
        h('button', { class: 'btn small danger', onclick: () => deleteReason(r) }, '🗑')))),
      h('p', { class: 'hint' }, '"적는 칸"을 켜면 그 이유를 골랐을 때 자세히 적는 칸이 나와요.'),
      h('button', { class: 'btn primary', onclick: addReason }, '+ 틀린 이유 추가')),
    h('div', { class: 'card' },
      h('h2', null, '💾 저장 공간'),
      h('p', null, `오답 ${problems.length}개 저장됨`),
      est && h('p', { class: 'muted' }, `사용 중: ${mb(est.usage)} / 사용 가능: 약 ${mb(est.quota)}`)),
    reviewSettingsCard(el),
    testModeCard(el),
    h('p', { class: 'hint center' }, '백업은 4단계에서 추가돼요.'));
}

function reviewSettingsCard(el) {
  const setMax = async (n) => {
    state.dailyMax = Math.min(100, Math.max(1, n));
    await db.setSetting('dailyMax', state.dailyMax);
    renderSettings(el);
  };
  return h('div', { class: 'card' },
    h('h2', null, '📅 하루 복습 최대 개수'),
    h('div', { class: 'stepper' },
      h('button', { class: 'btn', onclick: () => setMax(state.dailyMax - 1), 'aria-label': '줄이기' }, '−'),
      h('b', null, `${state.dailyMax}개`),
      h('button', { class: 'btn', onclick: () => setMax(state.dailyMax + 1), 'aria-label': '늘리기' }, '+')),
    h('p', { class: 'hint' }, '이보다 많으면 오래 밀린 문제부터 보여주고, 나머지는 다음 날로 넘겨요.'));
}

// ---------- 테스트 모드 ----------
async function setTestMode(on) {
  await db.use(db.MAIN_DB);
  await db.setSetting('testMode', on);
  if (on) {
    await db.use(db.TEST_DB);
    state.testToday = await db.getSetting('testToday', toDateStr(new Date()));
  }
  state.testMode = on;
  await afterDataSwitch();
}

/** 데이터베이스가 바뀌었을 때(테스트 모드 켜기/끄기, 불러오기) 화면 상태 초기화 */
async function afterDataSwitch() {
  if (addForm) { addForm.destroy(); addForm = null; }
  fill($('#screen-add'));
  session = null;
  await loadMeta();
  updateTestBar();
}

async function setTestToday(d) {
  if (!d) return;
  state.testToday = d;
  await db.setSetting('testToday', d);
  updateTestBar();
}

async function nextTestDay() {
  await setTestToday(addDays(state.testToday, 1));
  toast(`오늘은 ${fmtDate(state.testToday)} (테스트)`);
  route();
}

function updateTestBar() {
  document.body.classList.toggle('testing', state.testMode);
  const bar = $('#testbar');
  bar.hidden = !state.testMode;
  if (!state.testMode) return;
  const [, m, d] = state.testToday.split('-').map(Number);
  fill(bar,
    h('span', null, `🧪 테스트 ${m}/${d}`),
    h('button', { class: 'btn small', onclick: nextTestDay }, '다음 날 ▶'));
}

/** 테스트용 예시 오답 만들기 (오늘 날짜로 등록) */
async function makeSamples(n) {
  const subject = state.subjects[0];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = `hsl(${Math.floor(Math.random() * 360)} 60% 95%)`;
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#222';
    x.font = 'bold 72px sans-serif';
    const k = Math.floor(Math.random() * 900) + 100;
    x.fillText(`예시 문제 ${k}`, 60, 160);
    x.font = '56px sans-serif';
    x.fillText(`${k % 9 + 2}x + ${k % 7 + 1} = ${k % 50}`, 60, 300);
    const blob = await canvasToBlob(c);
    const imgId = uid();
    const unit = subject?.units[Math.floor(Math.random() * (subject.units.length || 1))];
    const reason = state.reasons[Math.floor(Math.random() * state.reasons.length)];
    const d = today();
    await db.saveProblem({
      id: uid(), createdDate: d, createdAt: Date.now() + i, ...newSchedule(d), reviews: [],
      subjectId: subject?.id, unitId: unit?.id ?? null,
      reasonIds: reason ? [reason.id] : [], reasonDetails: reason?.needsDetail ? { [reason.id]: 'x>0' } : {},
      images: { problem: imgId, solutionPhoto: null, drawing: null },
      thumb: await makeThumb(blob), myAnswer: '', answerBasis: '',
      source: { book: '예시 교재', page: String(k % 200), num: String(k % 30) }, memo: '테스트용 예시', starred: false,
    }, [{ id: imgId, blob }]);
  }
}

function testModeCard(el) {
  const rerender = () => renderSettings(el);
  if (!state.testMode) {
    return h('div', { class: 'card' },
      h('h2', null, '🧪 테스트 모드'),
      h('p', null, '날짜를 마음대로 바꿔서 복습이 잘 나오는지 시험해 볼 수 있어요.'),
      h('p', { class: 'hint' }, '테스트 모드의 데이터는 진짜 오답과 따로 저장돼요. 끄면 진짜 데이터로 돌아와요.'),
      h('button', { class: 'btn primary', onclick: async () => { await setTestMode(true); toast('테스트 모드를 켰어요'); rerender(); } }, '테스트 모드 켜기'));
  }
  const dateInput = h('input', { type: 'date', value: state.testToday, onchange: async (e) => { await setTestToday(e.target.value); toast(`오늘은 ${fmtDate(state.testToday)} (테스트)`); } });
  return h('div', { class: 'card test-card' },
    h('h2', null, '🧪 테스트 모드 (켜짐)'),
    h('label', { class: 'field' }, h('span', null, '테스트 날짜'), dateInput),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: async () => { await setTestToday(addDays(state.testToday, 1)); toast(`오늘은 ${fmtDate(state.testToday)} (테스트)`); rerender(); } }, '다음 날로 ▶'),
      h('button', { class: 'btn', onclick: async () => { await setTestToday(toDateStr(new Date())); rerender(); } }, '진짜 오늘로'),
      h('button', { class: 'btn', onclick: async () => { await makeSamples(5); toast('예시 오답 5개를 만들었어요'); rerender(); } }, '예시 오답 5개 만들기')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('테스트 데이터를 모두 지울까요? (진짜 데이터는 그대로예요)')) return;
        await db.resetDb(db.TEST_DB);
        await db.use(db.TEST_DB);
        await db.setSetting('testToday', state.testToday);
        await afterDataSwitch();
        toast('테스트 데이터를 지웠어요');
        rerender();
      } }, '테스트 데이터 모두 지우기'),
      h('button', { class: 'btn', onclick: async () => { await setTestMode(false); toast('테스트 모드를 껐어요. 진짜 데이터로 돌아왔어요'); rerender(); } }, '테스트 모드 끄기')));
}

// ---------- 시작 ----------
async function start() {
  try {
    await db.use(db.MAIN_DB);
    navigator.storage?.persist?.(); // 브라우저가 데이터를 함부로 지우지 않도록 요청
    if (await db.getSetting('testMode', false)) {
      await db.use(db.TEST_DB);
      state.testMode = true;
      state.testToday = await db.getSetting('testToday', toDateStr(new Date()));
    }
    await loadMeta();
    updateTestBar();
    document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    window.addEventListener('hashchange', route);
    await route();
  } catch (err) {
    console.error(err);
    document.body.prepend(h('div', { class: 'fatal' }, '앱을 시작하지 못했어요: ' + err.message));
  }
}
start();
