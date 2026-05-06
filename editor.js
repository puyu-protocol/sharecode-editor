/* ============================================================
   editor.js – ShareCode Editor
   schema.json を読み込んでフィールド編集UIを生成
   ============================================================ */

// ─── グローバル等定 ──────────────────────────────────────────
let schema  = null;   // schema.json 配列
let bytes   = null;   // 現在編集中の Uint8Array

// ─── デフォルトシェアコード ──────────────────────────────────
const DEFAULT_CODES = {
  '2-1': 'Star/H4sIAAAAAAAACvNiYGBgZGRgYGKMMlJggAGVQn4GZMAPIwIQTFcLWwaG0HhbBiMQr3QtkGHE2GYLlrv4VhdIcgVcY9AAYhsojc5nYGi9AjRj6m9bsCVyTuxgWsObFW7xwn47BvwAAE2rvqDBAAAA',
  '2-2': 'Star/H4sIAAAAAAAACvNiYGBgZGRgYGKKMlJggAHNQn4GZMAPIwIQzNUWtgwMu+NtGYxAvJtrgQwjxjZbsNzFt7pAkivgGoMGENtAaXQ+A8PrK0Azfv+2BVsi58QOpjW8WeEWL+y3Y8APAHaDHcHBAAAA',
  '2-3': 'Star/H4sIAAAAAAAACvNiYGBgZGRgYGKOMlJggAHFQn4GZMAPIwIQTF5LWwYG2QRbBiMQz3YdkGHE2GYLlrv4VhdIcgVcY9AAYhsojc5nYPC9CjQj9o8t2BI5J3YwreHNCrd4Yb8dA34AABLPG6XBAAAA',
  '1-1': 'Star/H4sIAAAAAAAACvNiYGBgZAThKBt5BhiwzuVnQAb8MCIAwYw1sWVgyI22ZTAC8XpXAhlGkk22YLmLb3WBJFfANQYNILaB0uh8Boa5F4BmrP1uC7ZEzokdTGt4s4JpLiBe2G/HgB8AABwXypbBAAAA',
  '1-2': 'Star/H4sIAAAAAAAACvNiYGBgZARipigbeQYYsMzlZ0AG/DAiAME8aGLLwHAx2pbBCMT7uBLIMJJssgXLXXyrCyS5Aq4xaACxDZRG5wNtvQg0Q/CHLdgSOSd2MK3hzQqmuYB4Yb8dA34AANLUjILBAAAA',
  '1-3': 'Star/H4sIAAAAAAAACvNiYGBgZARi5igbeQYYcMjlZ0AG/DAiAMFUNbVlYDCNsWUwAvFCVwEZRpJNtmC5i291gSRXwDUGDSC2gdLofAaG1ItAM0p/2IItkXNiB9Ma3qxgmguIF/bbMeAHAMygHe7BAAAA',
};

function loadDefaultCode() {
  const gender = document.getElementById('defGender').value;
  const size   = document.getElementById('defSize').value;
  const code   = DEFAULT_CODES[`${gender}-${size}`];
  if (!code) return;
  document.getElementById('inputCode').value = code;
  loadCode();
}

// ─── 起動 ────────────────────────────────────────────────────
(async () => {
  try {
    const res = await fetch('./schema.json');
    if (!res.ok) throw new Error(`schema.json の読み込みに失敗 (${res.status})`);
    schema = await res.json();
  } catch (e) {
    showError('schema.json の読み込みエラー: ' + e.message);
  }
})();

// ─── 自動エンコード（デバウンス） ───────────────────────────────
let _encodeTimer = null;
function scheduleEncode() {
  clearTimeout(_encodeTimer);
  _encodeTimer = setTimeout(() => encodeCode(), 300);
}

// ─── Base64 / GZIP ────────────────────────────────────────────
function b64ToBytes(b64) {
  const clean  = b64.replace(/\s/g, '');
  const std    = clean.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '=='.slice(0, (4 - std.length % 4) % 4);
  const bin    = atob(padded);
  const out    = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(arr) {
  let bin = '';
  arr.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function readAllChunks(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function gunzip(compressed) {
  const ds     = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  return readAllChunks(ds.readable);
}

async function gzip(raw) {
  const cs     = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(raw);
  writer.close();
  return readAllChunks(cs.readable);
}

// ─── デコード ────────────────────────────────────────────────
async function loadCode() {
  const raw     = document.getElementById('inputCode').value.trim();
  const status  = document.getElementById('loadStatus');
  const warnBox = document.getElementById('warnBox');
  warnBox.innerHTML = '';
  status.textContent = '';

  if (!schema) { showError('schema.json がまだ読み込まれていません'); return; }

  // プレフィックス除去（最初の "/" まで）
  const slashIdx = raw.indexOf('/');
  const b64      = slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw;

  let compressed;
  try {
    compressed = b64ToBytes(b64);
  } catch (e) {
    status.textContent = '❌ Base64 デコードに失敗しました: ' + e.message;
    status.className   = 'status-error';
    return;
  }

  try {
    bytes = await gunzip(compressed);
  } catch (e) {
    status.textContent = '❌ GZIP 解凍に失敗しました: ' + e.message;
    status.className   = 'status-error';
    return;
  }

  // 固定値チェックなし（constant も uint8 として編集可能）

  status.textContent = `✅ デコード完了 (${bytes.length} バイト)`;
  status.className   = 'status-ok';
  renderFields();
}

// ─── エンコード ───────────────────────────────────────────────
async function encodeCode() {
  if (!bytes) { showError('先にシェアコードをデコードしてください'); return; }
  collectFromUI();
  try {
    const compressed = await gzip(bytes);
    const b64        = bytesToB64(compressed);
    const code       = 'Star/' + b64;
    document.getElementById('outputCode').value = code;
  } catch (e) {
    showError('エンコードに失敗しました: ' + e.message);
  }
}

async function copyOutput() {
  const val = document.getElementById('outputCode').value;
  if (!val) return;
  await navigator.clipboard.writeText(val);
  const btn = document.getElementById('copyBtn');
  btn.textContent = 'コピー済み ✓';
  setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
}

// ─── フィールド読み書き ─────────────────────────────────────
function readField(f) {
  if (!bytes || f.offset >= bytes.length) return null;
  switch (f.type) {
    case 'constant':
    case 'uint8':
    case 'unknown':
      return bytes[f.offset];
    case 'int8': {
      const v = bytes[f.offset];
      return v > 127 ? v - 256 : v;
    }
    case 'int16_le': {
      const v = bytes[f.offset] | (bytes[f.offset + 1] << 8);
      return v > 32767 ? v - 65536 : v;
    }
    case 'uint32_le':
      return (bytes[f.offset]) |
             (bytes[f.offset + 1] << 8) |
             (bytes[f.offset + 2] << 16) |
             ((bytes[f.offset + 3] << 24) >>> 0);
    case 'hsv_color':
      return {
        v: bytes[f.offset],
        s: bytes[f.offset + 1],
        h: bytes[f.offset + 2] | (bytes[f.offset + 3] << 8),
      };
    default:
      return null;
  }
}

function writeField(f, value) {
  if (!bytes) return;
  switch (f.type) {
    case 'constant':
    case 'uint8':
    case 'unknown':
      bytes[f.offset] = (value >>> 0) & 0xFF; break;
    case 'int8':
      bytes[f.offset] = ((value + 256) & 0xFF); break;
    case 'int16_le':
      bytes[f.offset]     = value & 0xFF;
      bytes[f.offset + 1] = (value >> 8) & 0xFF;
      break;
    case 'uint32_le':
      bytes[f.offset]     = (value >>> 0)  & 0xFF;
      bytes[f.offset + 1] = (value >>> 8)  & 0xFF;
      bytes[f.offset + 2] = (value >>> 16) & 0xFF;
      bytes[f.offset + 3] = (value >>> 24) & 0xFF;
      break;
    case 'hsv_color':
      bytes[f.offset]     = (value.v >>> 0) & 0xFF;
      bytes[f.offset + 1] = (value.s >>> 0) & 0xFF;
      bytes[f.offset + 2] = (value.h >>> 0) & 0xFF;
      bytes[f.offset + 3] = (value.h >>> 8) & 0xFF;
      break;
  }
  scheduleEncode();
}

// ─── UIからバイト列へ一括収集 ────────────────────────────────
function collectFromUI() {
  if (!schema || !bytes) return;
  for (const f of schema) {
    switch (f.type) {
      case 'constant':
      case 'uint8':
      case 'int8':
      case 'int16_le':
      case 'unknown': {
        const el = document.getElementById(`field-${f.offset}`);
        if (el) writeField(f, parseInt(el.value) || 0);
        break;
      }
      case 'uint32_le': {
        const el = document.getElementById(`field-${f.offset}`);
        if (el) writeField(f, parseInt(el.value) || 0);
        break;
      }
      case 'hsv_color': {
        const vh = document.getElementById(`field-${f.offset}-v`);
        const sh = document.getElementById(`field-${f.offset}-s`);
        const hh = document.getElementById(`field-${f.offset}-h`);
        if (vh && sh && hh) {
          writeField(f, {
            v: parseInt(vh.value) || 0,
            s: parseInt(sh.value) || 0,
            h: parseInt(hh.value) || 0,
          });
        }
        break;
      }
    }
  }
}

// ─── フィールド一覧レンダリング ─────────────────────────────
function renderFields() {
  const container = document.getElementById('sections');
  container.innerHTML = '';

  // ヘッダー行
  const hdr = document.createElement('div');
  hdr.className = 'field-row field-header';
  hdr.innerHTML =
    '<span class="field-offset">offset</span>' +
    '<span class="field-name">name</span>' +
    '<span class="field-id">id</span>' +
    '<span class="ctrl-wrap"></span>' +
    '<span class="field-tag" style="visibility:hidden">type</span>';
  container.appendChild(hdr);

  for (const f of schema) {
    container.appendChild(buildFieldRow(f));
  }
}

// ─── フィールド行を構築 ──────────────────────────────────────
function buildFieldRow(field) {
  const val = readField(field);

  const row = document.createElement('div');
  row.className = 'field-row';

  // オフセット
  const offset = document.createElement('span');
  offset.className = 'field-offset';
  offset.textContent = field.offset;

  // 名前
  const name = document.createElement('span');
  name.className = 'field-name';
  name.textContent = field.name;

  // ID
  const id = document.createElement('span');
  id.className = 'field-id';
  id.textContent = field.id || '';

  // タイプバッジ
  const tag = document.createElement('span');
  tag.className = `field-tag ${typeTagClass(field.type)}`;
  tag.textContent = typeLabel(field.type);

  // コントロール
  const controls = buildControl(field, val);

  row.appendChild(offset);
  row.appendChild(name);
  row.appendChild(id);
  row.appendChild(controls);
  row.appendChild(tag);

  // ノート
  if (field.note) {
    const note = document.createElement('span');
    note.className = 'field-note';
    note.textContent = field.note;
    row.appendChild(note);
  }

  return row;
}

// ─── コントロール生成 ────────────────────────────────────────
function buildControl(field, val) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl-wrap';

  switch (field.type) {
    case 'constant': {
      const el = document.createElement('input');
      el.type      = 'number';
      el.className = 'num-input';
      el.id        = `field-${field.offset}`;
      el.min = 0; el.max = 255;
      el.value = val !== null ? val : 0;
      el.addEventListener('change', () => {
        let v = parseInt(el.value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(255, v));
        el.value = v;
        writeField(field, v);
      });
      wrap.appendChild(el);
      break;
    }

    case 'uint8':
    case 'int8':
    case 'int16_le': {
      const [min, max] = field.type === 'int8' ? [-128, 127] : field.type === 'int16_le' ? [-32768, 32767] : [0, 255];
      const el = document.createElement('input');
      el.type      = 'number';
      el.className = 'num-input';
      el.id        = `field-${field.offset}`;
      el.min = min; el.max = max;
      el.value = val !== null ? val : 0;
      el.addEventListener('change', () => {
        let v = parseInt(el.value);
        if (isNaN(v)) v = 0;
        v = Math.max(min, Math.min(max, v));
        el.value = v;
        writeField(field, v);
      });
      wrap.appendChild(el);
      break;
    }

    case 'uint32_le': {
      const el = document.createElement('input');
      el.type      = 'number';
      el.className = 'num-input num-wide';
      el.id        = `field-${field.offset}`;
      el.min = 0;
      el.value = val !== null ? val : 0;
      el.addEventListener('change', () => {
        const v = parseInt(el.value) || 0;
        el.value = v;
        writeField(field, v);
      });
      wrap.appendChild(el);
      break;
    }

    case 'unknown': {
      const el = document.createElement('input');
      el.type      = 'number';
      el.className = 'num-input';
      el.id        = `field-${field.offset}`;
      el.min = 0; el.max = 255;
      el.value = val !== null ? val : 0;
      el.addEventListener('change', () => {
        const v = Math.max(0, Math.min(255, parseInt(el.value) || 0));
        el.value = v;
        writeField(field, v);
      });
      wrap.appendChild(el);
      break;
    }

    case 'hsv_color': {
      // V
      const vEl = makeHsvInput(`field-${field.offset}-v`, 'V', val ? val.v : 0, 0, 100);
      // S
      const sEl = makeHsvInput(`field-${field.offset}-s`, 'S', val ? val.s : 0, 0, 100);
      // H
      const hEl = makeHsvInput(`field-${field.offset}-h`, 'H', val ? val.h : 0, 0, 359);

      // カラースウォッチ
      const swatch = document.createElement('span');
      swatch.className = 'color-swatch';
      swatch.id = `swatch-${field.offset}`;
      if (val) swatch.style.background = hsvToCss(val.v, val.s, val.h);

      const updateSwatch = () => {
        swatch.style.background = hsvToCss(
          parseInt(vEl.querySelector('input').value) || 0,
          parseInt(sEl.querySelector('input').value) || 0,
          parseInt(hEl.querySelector('input').value) || 0
        );
        writeField(field, {
          v: parseInt(vEl.querySelector('input').value) || 0,
          s: parseInt(sEl.querySelector('input').value) || 0,
          h: parseInt(hEl.querySelector('input').value) || 0,
        });
      };

      [vEl, sEl, hEl].forEach(grp => {
        grp.querySelector('input').addEventListener('input', updateSwatch);
      });

      wrap.appendChild(vEl);
      wrap.appendChild(sEl);
      wrap.appendChild(hEl);
      wrap.appendChild(swatch);
      break;
    }
  }

  return wrap;
}

function makeHsvInput(id, label, value, min, max) {
  const grp = document.createElement('div');
  grp.className = 'hsv-group';

  const lbl = document.createElement('label');
  lbl.className = 'hsv-label';
  lbl.textContent = label;
  lbl.htmlFor = id;

  const inp = document.createElement('input');
  inp.type      = 'number';
  inp.className = 'num-input hsv-input';
  inp.id        = id;
  inp.min       = min;
  inp.max       = max;
  inp.value     = value;

  grp.appendChild(lbl);
  grp.appendChild(inp);
  return grp;
}

// ─── HSV → CSS hsl 変換（ゲーム座標系: H=0-359, S=0-100, V=0-100）
function hsvToCss(v, s, h) {
  const hDeg  = h;                 // そのまま degree
  const sNorm = s / 100;
  const vNorm = v / 100;
  // HSV → HSL
  const l     = vNorm * (1 - sNorm / 2);
  const sL    = (l === 0 || l === 1) ? 0 : (vNorm - l) / Math.min(l, 1 - l);
  return `hsl(${hDeg}, ${(sL * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;
}

// ─── タイプ情報 ──────────────────────────────────────────────
function typeTagClass(type) {
  switch (type) {
    case 'constant':  return 'tag-const';
    case 'uint8':     return 'tag-u8';
    case 'int8':      return 'tag-i8';
    case 'int16_le':  return 'tag-i16';
    case 'uint32_le': return 'tag-u32';
    case 'hsv_color': return 'tag-hsv';
    default:          return 'tag-unk';
  }
}

function typeLabel(type) {
  switch (type) {
    case 'constant':  return 'const';
    case 'uint8':     return 'u8';
    case 'int8':      return 'i8';
    case 'int16_le':  return 'i16';
    case 'uint32_le': return 'u32';
    case 'hsv_color': return 'hsv';
    default:          return '?';
  }
}

// ─── エラー表示 ──────────────────────────────────────────────
function showError(msg) {
  const status = document.getElementById('loadStatus');
  if (status) {
    status.textContent = '❌ ' + msg;
    status.className   = 'status-error';
  }
}
