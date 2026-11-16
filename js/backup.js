// 백업 파일 만들기 / 불러오기
//
// 파일 형식: 한 줄에 하나씩 (JSON Lines)
//   1번째 줄: { format, version, exportedAt, counts }   ← 머리말
//   나머지 줄: { s: 서랍 이름, v: 기록 }                  ← 사진은 글자(base64)로 바꿔서 저장
// 한 줄씩 읽고 쓰기 때문에 사진이 아주 많아도 기기가 버틸 수 있어요.
import * as db from './db.js';

export const FORMAT = 'wrongnote-backup';
const SKIP_SETTINGS = ['testMode', 'testToday']; // 기기마다 다른 설정은 백업하지 않음

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.slice(r.result.indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

async function encode(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v instanceof Blob ? { __blob: v.type, data: await blobToBase64(v) } : v;
  }
  return out;
}

function decode(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v && typeof v === 'object' && '__blob' in v ? base64ToBlob(v.data, v.__blob) : v;
  }
  return out;
}

/** 지금 데이터(사진 포함)를 백업 파일(Blob) 하나로 만들기 */
export async function exportBackup(onProgress) {
  const data = {};
  for (const s of db.STORES) data[s] = await db.getAll(s);
  data.settings = data.settings.filter((x) => !SKIP_SETTINGS.includes(x.key));
  const counts = Object.fromEntries(db.STORES.map((s) => [s, data[s].length]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const blobs = [];
  let parts = [JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), counts }) + '\n'];
  let done = 0;
  for (const s of db.STORES) {
    for (const rec of data[s]) {
      parts.push(JSON.stringify({ s, v: await encode(rec) }) + '\n');
      done++;
      if (parts.length >= 20) { blobs.push(new Blob(parts)); parts = []; } // 메모리 아끼기
      if (done % 5 === 0) onProgress?.(done, total);
    }
  }
  blobs.push(new Blob(parts));
  onProgress?.(total, total);
  return { blob: new Blob(blobs, { type: 'application/jsonl' }), counts };
}

/** 파일을 한 줄씩 읽기 */
async function* readLines(file) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) yield line;
    }
  }
  if (buf.trim()) yield buf;
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { throw new Error('백업 파일이 손상되었어요.'); }
}

/** 백업 파일을 끝까지 읽어서 문제없는지 확인 (아직 아무것도 바꾸지 않음) */
export async function checkBackup(file) {
  let header = null;
  let n = 0;
  for await (const line of readLines(file)) {
    const o = parseLine(line);
    if (!header) {
      if (o.format !== FORMAT) throw new Error('오답노트 백업 파일이 아니에요.');
      header = o;
      continue;
    }
    if (!db.STORES.includes(o.s) || !o.v) throw new Error('백업 파일이 손상되었어요.');
    n++;
  }
  if (!header) throw new Error('빈 파일이에요.');
  const expected = Object.values(header.counts).reduce((a, b) => a + b, 0);
  if (n !== expected) throw new Error('백업 파일이 중간에 잘렸어요. 다시 내려받아 주세요.');
  return header;
}

/** 현재 데이터를 지우고 백업 파일 내용으로 바꾸기 (checkBackup을 먼저 통과해야 함) */
export async function importBackup(file, onProgress) {
  const header = await checkBackup(file);
  const total = Object.values(header.counts).reduce((a, b) => a + b, 0);
  await db.clearAll();
  let batch = [];
  let done = 0;
  let first = true;
  for await (const line of readLines(file)) {
    if (first) { first = false; continue; }
    const o = parseLine(line);
    if (o.s === 'settings' && SKIP_SETTINGS.includes(o.v.key)) continue;
    batch.push({ store: o.s, value: decode(o.v) });
    if (batch.length >= 25) {
      await db.putMany(batch);
      done += batch.length;
      batch = [];
      onProgress?.(done, total);
    }
  }
  if (batch.length) await db.putMany(batch);
  await db.setSetting('seeded', true);
  onProgress?.(total, total);
  return header;
}
