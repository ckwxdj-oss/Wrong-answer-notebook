// S펜 풀이 캔버스
// - S펜(pointerType 'pen')과 마우스로만 그려짐
// - 손가락/손바닥(pointerType 'touch')은 그리지 않고 화면이 스크롤됨
import { h } from './ui.js';

const LOGICAL_W = 1000;     // 내부 좌표계 가로 크기 (화면 크기와 상관없이 같은 좌표 사용)
const START_H = 1300;       // 처음 세로 길이
const EXTEND_H = 700;       // "아래로 늘리기" 한 번에 늘어나는 길이
const EXPORT_W = 1200;      // 저장할 그림의 가로 픽셀

export const PEN_COLORS = [
  { color: '#111111', name: '검정' },
  { color: '#1e5bd8', name: '파랑' },
  { color: '#d62828', name: '빨강' },
  { color: '#1f9d55', name: '초록' },
];

export class PenCanvas {
  constructor(host) {
    this.strokes = [];
    this.color = PEN_COLORS[0].color;
    this.tool = 'pen';
    this.logicalH = START_H;
    this.cur = null;
    this.activeId = null;

    this.canvas = h('canvas', { class: 'pen-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.wrap = h('div', { class: 'pen-wrap' }, this.canvas);

    this.colorBtns = PEN_COLORS.map((c) => h('button', {
      class: 'pen-color', title: c.name, 'aria-label': c.name, style: { background: c.color },
      onclick: () => { this.color = c.color; this.tool = 'pen'; this.syncToolbar(); },
    }));
    this.eraserBtn = h('button', { class: 'btn tool', onclick: () => { this.tool = 'eraser'; this.syncToolbar(); } }, '🧽 지우개');
    const toolbar = h('div', { class: 'pen-toolbar' },
      this.colorBtns,
      this.eraserBtn,
      h('button', { class: 'btn tool', onclick: () => this.undo() }, '↶ 되돌리기'),
      h('button', { class: 'btn tool danger', onclick: () => { if (this.strokes.length && confirm('풀이를 전부 지울까요?')) this.clear(); } }, '전체 지우기'));

    host.append(
      toolbar,
      h('p', { class: 'hint' }, 'S펜으로 쓰고, 손가락으로는 화면을 위아래로 움직여요.'),
      this.wrap,
      h('button', { class: 'btn extend', onclick: () => this.extend() }, '⬇️ 아래로 늘리기'));
    this.syncToolbar();
    this.bindEvents();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
  }

  syncToolbar() {
    this.colorBtns.forEach((b, i) => b.classList.toggle('on', this.tool === 'pen' && PEN_COLORS[i].color === this.color));
    this.eraserBtn.classList.toggle('on', this.tool === 'eraser');
  }

  isDrawPointer(e) { return e.pointerType === 'pen' || e.pointerType === 'mouse'; }

  bindEvents() {
    const c = this.canvas;
    // 펜이 캔버스 위에 떠 있으면(호버) 스크롤을 막아 바로 그릴 수 있게
    c.addEventListener('pointerover', (e) => { if (e.pointerType === 'pen') c.style.touchAction = 'none'; });
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'pen' && this.activeId == null) c.style.touchAction = ''; });
    // 크롬은 S펜 터치를 touchType 'stylus'로 알려줌 → 스크롤 막기
    const blockStylus = (e) => {
      if (this.activeId != null || [...e.changedTouches].some((t) => t.touchType === 'stylus')) e.preventDefault();
    };
    c.addEventListener('touchstart', blockStylus, { passive: false });
    c.addEventListener('touchmove', blockStylus, { passive: false });
    // 펜으로 그리는 중에 손바닥이 닿아도 화면이 움직이지 않게
    this.docBlock = (e) => { if (this.activeId != null) e.preventDefault(); };
    document.addEventListener('touchmove', this.docBlock, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (!this.isDrawPointer(e) || this.activeId != null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this.activeId = e.pointerId;
      const erase = this.tool === 'eraser';
      this.cur = { color: this.color, w: erase ? 28 : 3, erase, pts: [this.point(e)] };
      this.strokes.push(this.cur);
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.activeId) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const from = this.cur.pts.length - 1;
      for (const ev of (evs.length ? evs : [e])) this.cur.pts.push(this.point(ev));
      this.drawSegments(this.ctx, this.cur, from);
    });
    const end = (e) => {
      if (e.pointerId !== this.activeId) return;
      if (this.cur.pts.length === 1) { // 점 하나 찍기
        this.cur.pts.push([...this.cur.pts[0]]);
        this.drawSegments(this.ctx, this.cur, 0);
      }
      this.activeId = null;
      this.cur = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  point(e) {
    const rect = this.canvas.getBoundingClientRect();
    const s = LOGICAL_W / rect.width;
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return [(e.clientX - rect.left) * s, (e.clientY - rect.top) * s, p];
  }

  resize() {
    const cssW = this.wrap.clientWidth;
    if (!cssW) return; // 화면에 안 보일 때
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = cssW / LOGICAL_W;
    this.canvas.style.height = this.logicalH * s + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(this.logicalH * s * dpr);
    this.pxScale = s * dpr;
    this.redraw();
  }

  redraw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.pxScale, 0, 0, this.pxScale, 0, 0);
    this.strokes.forEach((st) => this.drawSegments(ctx, st, 0));
  }

  drawSegments(ctx, st, from) {
    ctx.save();
    ctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = st.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = Math.max(1, from); i < st.pts.length; i++) {
      const [x0, y0] = st.pts[i - 1];
      const [x1, y1, p] = st.pts[i];
      ctx.lineWidth = st.erase ? st.w : st.w * (0.6 + p * 0.9);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  undo() { this.strokes.pop(); this.redraw(); }
  clear() { this.strokes = []; this.logicalH = START_H; this.resize(); }
  extend() { this.logicalH += EXTEND_H; this.resize(); }

  /** 잉크(지우개 아닌 선)가 하나라도 있으면 true */
  hasInk() { return this.strokes.some((s) => !s.erase); }

  /** 흰 배경의 PNG 그림으로 내보내기 (아래쪽 빈 공간은 잘라냄) */
  async toBlob() {
    let maxY = 0;
    this.strokes.forEach((s) => { if (!s.erase) s.pts.forEach((p) => { maxY = Math.max(maxY, p[1]); }); });
    const logicalH = Math.min(this.logicalH, maxY + 60);
    const k = EXPORT_W / LOGICAL_W;
    const ink = document.createElement('canvas');
    ink.width = EXPORT_W;
    ink.height = Math.round(logicalH * k);
    const ictx = ink.getContext('2d');
    ictx.scale(k, k);
    this.strokes.forEach((s) => this.drawSegments(ictx, s, 0));
    const out = document.createElement('canvas');
    out.width = ink.width;
    out.height = ink.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(ink, 0, 0);
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }

  destroy() {
    this.ro.disconnect();
    document.removeEventListener('touchmove', this.docBlock);
  }
}
