// 앱의 화면과 동작
import * as db from './db.js';
import { toDateStr, newSchedule, stageLabel, GRADUATED } from './schedule.js';
import { pickFile, cropImage, makeThumb } from './image.js';
import { PenCanvas } from './pen.js';
import { h, fill, $, uid, toast, choose, UrlBag } from './ui.js';

// ---------- 공용 상태 ----------
const state = {
  subjects: [],
  reasons: [],
  sel: { subjectId: null, units: {} }, // 마지막으로 고른 과목/단원
};

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

async function loadMeta() {
  state.subjects = (await db.getAll('subjects')).sort(byOrder);
  state.reasons = (await db.getAll('reasons')).sort(byOrder);
  state.sel = await db.getSetting('lastSelection', { subjectId: null, units: {} });
}

/** 오늘 날짜 (2단계에서 테스트 모드 날짜로 바뀔 수 있게 한 곳에서 관리) */
function today() { return toDateStr(new Date()); }

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

// ---------- 화면 이동 ----------
const bags = {}; // 화면별 사진 주소 모음
const bagFor = (name) => { (bags[name] ||= new UrlBag()).clear(); return bags[name]; };

const screens = {
  home: { title: '오답노트', tab: 'home', render: renderHome },
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
  const active = problems.filter((p) => p.stage !== GRADUATED).length;
  fill(el, 
    h('div', { class: 'card' },
      h('div', { class: 'today' }, fmtDate(today())),
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', null, problems.length), h('span', null, '전체 오답')),
        h('div', { class: 'stat' }, h('b', null, active), h('span', null, '복습 중')),
        h('div', { class: 'stat' }, h('b', null, problems.length - active), h('span', null, '졸업')))),
    h('button', { class: 'btn primary big', onclick: () => go('add') }, '➕ 오답 등록'),
    h('button', { class: 'btn big', onclick: () => go('list') }, '📋 오답 목록'),
    h('p', { class: 'hint center' }, '복습 기능은 2단계에서 추가돼요.'));
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
          h('div', { class: 'item-foot' }, statusBadge(p), h('span', { class: 'muted' }, p.createdDate))))))
      : h('div', { class: 'empty' }, all.length ? '조건에 맞는 오답이 없어요.' : '아직 등록한 오답이 없어요.', h('br'),
        !all.length && h('button', { class: 'btn primary', onclick: () => go('add') }, '➕ 첫 오답 등록하기')));
}

// ---------- 오답 상세 ----------
async function renderDetail(el, id) {
  const bag = bagFor('detail');
  const p = await db.get('problems', id);
  if (!p) { fill(el, h('p', null, '오답을 찾을 수 없어요.')); return; }
  const img = async (imgId) => {
    if (!imgId) return null;
    const row = await db.get('images', imgId);
    return row ? h('img', { class: 'photo-preview', src: bag.url(row.blob), alt: '' }) : null;
  };
  const [probImg, drawImg, photoImg] = await Promise.all([img(p.images?.problem), img(p.images?.drawing), img(p.images?.solutionPhoto)]);
  const subject = subjectById(p.subjectId);
  const src = p.source || {};
  const srcText = [src.book, src.page && `${src.page}쪽`, src.num && `${src.num}번`].filter(Boolean).join(' · ');
  const details = Object.entries(p.reasonDetails || {}).map(([rid, text]) =>
    h('div', { class: 'detail-note' }, `${reasonById(rid)?.name || '기타'}: ${text}`));

  fill(el, 
    h('div', { class: 'card' },
      h('div', { class: 'item-title big' }, p.starred && '⭐ ', problemLabel(p)),
      h('div', { class: 'meta' }, statusBadge(p),
        p.stage !== GRADUATED && h('span', null, `다음 복습: ${fmtDate(p.dueDate)}`),
        h('span', { class: 'muted' }, `등록: ${fmtDate(p.createdDate)}`)),
      probImg),
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

const RESULT_LABEL = { correct: '⭕ 맞음', vague: '🔺 애매함', wrong: '❌ 틀림' };

// ---------- 통계 (3단계) ----------
function renderStats(el) {
  fill(el, h('div', { class: 'empty' }, '통계 화면은 3단계에서 만들어요.'));
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
    h('p', { class: 'hint center' }, '하루 복습 개수, 백업, 테스트 모드는 다음 단계에서 추가돼요.'));
}

// ---------- 시작 ----------
async function start() {
  try {
    await db.use(db.MAIN_DB);
    navigator.storage?.persist?.(); // 브라우저가 데이터를 함부로 지우지 않도록 요청
    await loadMeta();
    document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    window.addEventListener('hashchange', route);
    await route();
  } catch (err) {
    console.error(err);
    document.body.prepend(h('div', { class: 'fatal' }, '앱을 시작하지 못했어요: ' + err.message));
  }
}
start();
