// 사진 고르기, 줄이기/압축, 자르기
import { h } from './ui.js';

export const MAX_SIDE = 1600;   // 저장할 사진의 긴 쪽 최대 크기(px)
export const QUALITY = 0.8;     // JPEG 품질 (0~1)
export const THUMB_SIDE = 360;  // 목록용 미리보기 크기

/** 카메라(capture=true) 또는 갤러리에서 사진 파일 하나 고르기 */
export function pickFile(capture) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    if (capture) inp.setAttribute('capture', 'environment');
    inp.addEventListener('change', () => resolve(inp.files[0] || null));
    inp.addEventListener('cancel', () => resolve(null));
    inp.click();
  });
}

/** 사진(Blob/File)을 캔버스로 불러오기. 긴 쪽이 maxSide보다 크면 줄임 */
export async function loadToCanvas(blob, maxSide) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const s = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * s));
    c.height = Math.max(1, Math.round(h0 * s));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasToBlob(c, type = 'image/jpeg', q = QUALITY) {
  return new Promise((resolve) => c.toBlob(resolve, type, q));
}

/** 목록용 작은 미리보기 만들기 */
export async function makeThumb(blob) {
  return canvasToBlob(await loadToCanvas(blob, THUMB_SIDE), 'image/jpeg', 0.7);
}

/** 사진 줄이기만 (자르기 없이) */
export async function compress(blob) {
  return canvasToBlob(await loadToCanvas(blob, MAX_SIDE));
}

/** 자르기 화면을 띄우고, 잘라서 압축한 사진(Blob)을 돌려줌. 취소하면 null */
export async function cropImage(blob) {
  const src = await loadToCanvas(blob, 2400);
  return openCropper(src);
}

function rotate90(src) {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return c;
}

function openCropper(firstSource) {
  return new Promise((resolve) => {
    let source = firstSource;
    // 자르는 영역: 사진 크기에 대한 비율(0~1)로 기억
    let r = { x: 0, y: 0, w: 1, h: 1 };
    let dw = 0, dh = 0;

    const handles = ['nw', 'ne', 'sw', 'se'].map((k) => h('div', { class: 'crop-h ' + k, 'data-h': k }));
    const box = h('div', { class: 'crop-box' }, handles);
    const inner = h('div', { class: 'crop-inner' });
    const stage = h('div', { class: 'crop-stage' }, inner);

    const finish = async (ok) => {
      window.removeEventListener('resize', layout);
      if (!ok) { overlay.remove(); resolve(null); return; }
      const sx = r.x * source.width, sy = r.y * source.height;
      const sw = r.w * source.width, sh = r.h * source.height;
      const s = Math.min(1, MAX_SIDE / Math.max(sw, sh));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(sw * s));
      out.height = Math.max(1, Math.round(sh * s));
      out.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
      const blob = await canvasToBlob(out);
      overlay.remove();
      resolve(blob);
    };

    const overlay = h('div', { class: 'cropper' },
      h('div', { class: 'crop-title' }, '모서리를 끌어서 필요한 부분만 남겨주세요'),
      stage,
      h('div', { class: 'crop-bar' },
        h('button', { class: 'btn', onclick: () => finish(false) }, '취소'),
        h('button', { class: 'btn', onclick: () => { source = rotate90(source); r = { x: 0, y: 0, w: 1, h: 1 }; layout(); } }, '↻ 회전'),
        h('button', { class: 'btn', onclick: () => { r = { x: 0, y: 0, w: 1, h: 1 }; place(); } }, '전체 선택'),
        h('button', { class: 'btn primary', onclick: () => finish(true) }, '✓ 자르기 완료')));
    document.body.append(overlay);

    function layout() {
      const sw = stage.clientWidth - 48, sh = stage.clientHeight - 48;
      const scale = Math.min(sw / source.width, sh / source.height);
      dw = source.width * scale;
      dh = source.height * scale;
      source.style.width = dw + 'px';
      source.style.height = dh + 'px';
      inner.style.width = dw + 'px';
      inner.style.height = dh + 'px';
      inner.replaceChildren(source, box);
      place();
    }
    function place() {
      Object.assign(box.style, {
        left: r.x * dw + 'px', top: r.y * dh + 'px', width: r.w * dw + 'px', height: r.h * dh + 'px',
      });
    }

    // 끌기 (손가락, 펜 모두 가능)
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, mode: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, r0: { ...r } };
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = (e.clientX - drag.x) / dw, dy = (e.clientY - drag.y) / dh;
      const minW = 48 / dw, minH = 48 / dh;
      const a = drag.r0;
      let x1 = a.x, y1 = a.y, x2 = a.x + a.w, y2 = a.y + a.h;
      const m = drag.mode;
      if (m === 'move') {
        const nx = Math.min(Math.max(0, a.x + dx), 1 - a.w);
        const ny = Math.min(Math.max(0, a.y + dy), 1 - a.h);
        r = { x: nx, y: ny, w: a.w, h: a.h };
      } else {
        if (m.includes('w')) x1 = Math.min(Math.max(0, a.x + dx), x2 - minW);
        if (m.includes('e')) x2 = Math.max(Math.min(1, x2 + dx), x1 + minW);
        if (m.includes('n')) y1 = Math.min(Math.max(0, a.y + dy), y2 - minH);
        if (m.includes('s')) y2 = Math.max(Math.min(1, y2 + dy), y1 + minH);
        r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      place();
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    window.addEventListener('resize', layout);
    requestAnimationFrame(layout);
  });
}
