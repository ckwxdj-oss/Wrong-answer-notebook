// 화면 만들 때 쓰는 작은 도구들

/** h('div', {class:'x', onclick: fn}, '글자', 자식요소...) 로 HTML 요소를 만듭니다. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : String(k));
  }
}

/** 요소 안의 내용을 통째로 바꾸기 (목록, 빈 값도 안전하게 처리) */
export function fill(el, ...kids) {
  el.replaceChildren();
  appendKids(el, kids);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

let toastTimer;
/** 화면 아래에 잠깐 나타나는 알림 */
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

/** 큰 버튼 중에 하나를 고르는 창. 고른 value를 돌려줌 (취소하면 null) */
export function choose(title, options) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'modal-bg' },
      h('div', { class: 'modal' },
        h('h2', null, title),
        options.map((o) => h('button', { class: 'btn big choice', onclick: () => close(o.value) },
          h('div', null, o.label),
          o.desc && h('div', { class: 'choice-desc' }, o.desc))),
        h('button', { class: 'btn big', onclick: () => close(null) }, '취소')));
    document.body.append(overlay);
  });
}

/** 화면마다 만든 사진 주소(objectURL)를 모아두었다가 한꺼번에 정리 */
export class UrlBag {
  constructor() { this.urls = []; }
  url(blob) { const u = URL.createObjectURL(blob); this.urls.push(u); return u; }
  clear() { this.urls.forEach((u) => URL.revokeObjectURL(u)); this.urls = []; }
}

/** 진행 상황 창 (백업 만들기/불러오기 중) */
export function progress(title) {
  const text = h('p', null, '준비 중…');
  const overlay = h('div', { class: 'modal-bg' }, h('div', { class: 'modal center' }, h('h2', null, title), text,
    h('p', { class: 'hint' }, '끝날 때까지 앱을 닫지 말아 주세요.')));
  document.body.append(overlay);
  return {
    set(msg) { text.textContent = msg; },
    close() { overlay.remove(); },
  };
}
