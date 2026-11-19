import {
  PROVIDERS, byId, parseValue, parseText, parseAs, expectedLength, assembleBarcodes,
  findInvoiceNo, findCustNo, describePeriod, currentMonth,
} from './providers.js';

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/iife/reader/index.js';
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
const STORE_KEY = 'einv.v1';
const BARCODE_FORMATS = ['Code39', 'Code128', 'Code93', 'Codabar', 'ITF', 'QRCode', 'DataMatrix', 'PDF417'];
const MAX_SIDE = 2560;

const $ = (s, r = document) => r.querySelector(s);
const el = {
  screen: $('#btnScreen'), camera: $('#btnCamera'), file: $('#fileInput'),
  live: $('#live'), video: $('#video'), liveStatus: $('#liveStatus'), liveHint: $('#liveHint'),
  liveBadge: $('#liveBadge'), ocr: $('#btnOcr'), stop: $('#btnStop'),
  text: $('#textInput'), parse: $('#btnParse'), textHint: $('#textHint'),
  todoList: $('#todoList'), todoEmpty: $('#todoEmpty'), todoCount: $('#todoCount'),
  otherSec: $('#otherSec'), otherList: $('#otherList'),
  doneList: $('#doneList'), doneCount: $('#doneCount'),
  manualForm: $('#manualForm'), manualProvider: $('#manualProvider'), manualValue: $('#manualValue'), manualMsg: $('#manualMsg'),
  profileFields: $('#profileFields'), providerTable: $('#providerTable'),
  shintaoLen: $('#shintaoLen'), shintaoTotal: $('#shintaoTotal'),
  pill: $('#autofillPill'), pillText: $('#autofillText'), autofillStatus: $('#autofillStatus'),
  toast: $('#toast'), drop: $('#drop'), tpl: $('#tplItem'),
};

// ---------------------------------------------------------------- 狀態
const state = loadState();

function loadState() {
  const empty = { items: [], others: [], settings: { profiles: {}, shintaoSerialLen: null, shintaoTotalLen: null } };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.items)) {
      return { ...empty, ...s, settings: { ...empty.settings, ...s.settings, profiles: { ...(s.settings?.profiles || {}) } } };
    }
  } catch (_) {}
  return empty;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}

const parseOpts = () => ({
  shintaoSerialLen: Number(state.settings.shintaoSerialLen) || null,
  shintaoTotalLen: Number(state.settings.shintaoTotalLen) || null,
});

const profileOf = (pid) => (state.settings.profiles[pid] ||= {});

// ---------------------------------------------------------------- 加入結果
const SOURCE_LABEL = { value: '條碼', text: '文字', labeled: '文字', ocr: 'OCR・請核對', manual: '手動' };

/**
 * @param {Array} cands  parseValue/parseText 的結果
 * @param {{text?: string, source?: string}} ctx
 * @returns {number} 新增筆數
 */
function addCandidates(cands, ctx = {}) {
  let added = 0;
  const text = ctx.text || '';
  for (const c of cands) {
    const id = `${c.provider}:${c.carrier}`;
    const existing = state.items.find((x) => x.id === id);
    if (existing) {
      if (existing.status === 'done') toast(`${byId[c.provider].short} ${describePeriod(c.period) || ''} 這筆已經歸戶過了`);
      flash(id);
      continue;
    }
    const p = byId[c.provider];
    const extras = {};
    for (const f of p.extras || []) {
      if (f.key === 'invoiceNo') extras.invoiceNo = findInvoiceNo(text);
      else if (f.defaultValue) extras[f.key] = f.defaultValue();
    }
    // 帳單文字上若有用戶號碼且尚未設定，順手記住
    if (p.profile?.some((f) => f.key === 'custNo')) {
      const cn = findCustNo(text);
      if (cn && !profileOf(p.id).custNo) profileOf(p.id).custNo = cn;
    }
    // 欣桃：從分欄文字學會拆分長度
    if (c.provider === 'shintao' && c.source === 'labeled') {
      state.settings.shintaoSerialLen = c.parts.serial.length;
      state.settings.shintaoTotalLen = c.parts.serial.length + c.parts.check.length;
    }
    state.items.unshift({
      id, provider: c.provider, carrier: c.carrier, parts: c.parts, extras,
      source: ctx.source || c.source || 'manual', status: 'todo', addedAt: Date.now(),
    });
    added++;
    freshIds.add(id);
  }
  if (added) {
    save();
    renderAll();
    notifyFound(added);
  }
  return added;
}

function addOther(text, format) {
  if (state.others.some((o) => o.text === text)) return;
  state.others.unshift({ text, format, at: Date.now() });
  state.others = state.others.slice(0, 30);
  save();
  renderOthers();
}

/** 這組條碼能否組出載具 */
function carriersIn(results) {
  const opts = parseOpts();
  const { carriers, used } = assembleBarcodes(results, opts);
  const singles = results.filter((r, i) => !used.has(i)).flatMap((r) => parseValue(r.text, opts));
  return [...carriers, ...singles];
}

function handleBarcodes(results, source) {
  const opts = parseOpts();
  const src = source === 'ocr' ? 'ocr' : 'value';
  const { carriers, used } = assembleBarcodes(results, opts);
  let added = 0;
  if (carriers.length) {
    added += addCandidates(carriers.map((c) => ({ ...c, source: src })), { source: src });
    // 先前畫面只掃到部分條碼時，會被放進「其他條碼」，組合成功後移除
    const usedTexts = new Set([...used].map((i) => results[i].text));
    const before = state.others.length;
    state.others = state.others.filter((o) => !usedTexts.has(o.text));
    if (state.others.length !== before) { save(); renderOthers(); }
  }
  results.forEach((r, i) => {
    if (used.has(i)) return;
    const cands = parseValue(r.text, opts);
    if (cands.length) added += addCandidates(cands, { source: src });
    else addOther(r.text, r.format);
  });
  return added;
}

function handleText(text, source = 'text') {
  const cands = parseText(text, parseOpts()).map((c) => ({ ...c, source: source === 'ocr' ? 'ocr' : c.source }));
  const added = addCandidates(cands, { text, source: source === 'ocr' ? 'ocr' : undefined });
  return { found: cands.length, added };
}

// ---------------------------------------------------------------- 外部函式庫（延遲載入）
const scripts = {};
function loadScript(url) {
  return (scripts[url] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => { delete scripts[url]; reject(new Error('無法載入 ' + url)); };
    document.head.appendChild(s);
  }));
}

async function loadZXing() {
  await loadScript(ZXING_URL);
  return window.ZXingWASM;
}

async function decode(imageData) {
  const Z = await loadZXing();
  const res = await Z.readBarcodes(imageData, {
    tryHarder: true,
    formats: BARCODE_FORMATS,
    maxNumberOfSymbols: 32,
  });
  return res
    .filter((r) => r.text && r.isValid !== false)
    .map((r) => ({ text: r.text, format: r.format, position: r.position }));
}

/**
 * 解碼一張畫面；組不出載具時把畫面放大 2 倍再掃一次。
 * 帳單縮小顯示時條碼線條只有 1 像素寬，放大後辨識率明顯提高。
 */
async function decodeSmart(img) {
  const first = await decode(img);
  if (carriersIn(first).length) return first;
  const scale = Math.min(2, 4096 / Math.max(img.width, img.height));
  if (scale < 1.4) return first;
  const up = upscale(img, scale);
  const second = (await decode(up)).map((r) => ({ ...r, position: scalePosition(r.position, 1 / scale) }));
  const seen = new Set(second.map((r) => r.text));
  return [...second, ...first.filter((r) => !seen.has(r.text))];
}

function upscale(img, scale) {
  const src = toCanvas(img);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function scalePosition(p, s) {
  if (!p) return p;
  const f = (pt) => ({ x: pt.x * s, y: pt.y * s });
  return { topLeft: f(p.topLeft), topRight: f(p.topRight), bottomRight: f(p.bottomRight), bottomLeft: f(p.bottomLeft) };
}

let ocrWorker = null;
async function ocr(imageData, onProgress) {
  await loadScript(TESS_URL);
  if (!ocrWorker) {
    ocrWorker = await window.Tesseract.createWorker('eng', 1, {
      logger: (m) => onProgress?.(m),
    });
    await ocrWorker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-: ',
      preserve_interword_spaces: '1',
    });
  }
  // 放大兩倍並轉灰階，螢幕文字的辨識率會好很多
  const scale = imageData.width < 1600 ? 2 : 1;
  const src = toCanvas(imageData);
  const c = document.createElement('canvas');
  c.width = imageData.width * scale;
  c.height = imageData.height * scale;
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const { data } = await ocrWorker.recognize(c);
  return data.text || '';
}

// ---------------------------------------------------------------- 影像工具
function toCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

function sourceToImageData(src, w, h) {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.round(w * s);
  const ch = Math.round(h * s);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

let lastImage = null; // 最近一次的畫面／圖片，給 OCR 用

async function handleImageBlob(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch (_) {
    toast('無法讀取這張圖片');
    return;
  }
  const img = sourceToImageData(bmp, bmp.width, bmp.height);
  bmp.close?.();
  lastImage = img;
  toast('辨識條碼中…', 0);
  let results = [];
  try {
    results = await decodeSmart(img);
  } catch (e) {
    toast('條碼元件載入失敗，請確認網路連線');
    console.error(e);
    return;
  }
  const hasCarrier = carriersIn(results).length > 0;
  const added = handleBarcodes(results, 'image');
  if (hasCarrier) {
    toast(added ? `找到 ${added} 筆載具` : '這張圖的載具已在清單中');
    return;
  }
  toast('沒有找到載具條碼，改用文字辨識…', 0);
  await runOcr(img);
}

async function runOcr(img) {
  if (!img) {
    toast('沒有可辨識的畫面，請先擷取畫面或選擇圖片');
    return;
  }
  el.ocr.disabled = true;
  try {
    const text = await ocr(img, (m) => {
      if (m.status === 'recognizing text') toast(`文字辨識中… ${Math.round(m.progress * 100)}%`, 0);
      else if (/loading|initializ/.test(m.status)) toast('載入文字辨識元件（第一次需要幾秒）…', 0);
    });
    const { found, added } = handleText(text, 'ocr');
    if (found) toast(added ? `文字辨識找到 ${added} 筆，請核對號碼` : '辨識到的載具已在清單中');
    else {
      toast('文字辨識也沒有找到載具號碼');
      if (text.trim()) {
        el.text.value = text.trim();
        el.textHint.textContent = '已放入 OCR 結果，可手動修正後按「辨識」';
      }
    }
  } catch (e) {
    console.error(e);
    toast('文字辨識失敗：' + e.message);
  } finally {
    el.ocr.disabled = false;
  }
}

// ---------------------------------------------------------------- 即時擷取（畫面 / 相機）
let live = null;

async function startScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast('這個瀏覽器不支援擷取畫面');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 5, max: 10 } },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
    startLive(stream, 'screen');
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('無法擷取畫面：' + e.message);
  }
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    startLive(stream, 'camera');
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? '沒有相機權限' : '無法開啟相機：' + e.message);
  }
}

function startLive(stream, kind) {
  stopLive();
  const track = stream.getVideoTracks()[0];
  el.video.srcObject = stream;
  el.video.play().catch(() => {});
  live = {
    stream, track, kind, busy: false, frames: 0, found: 0,
    capture: kind === 'screen' && 'ImageCapture' in window ? new ImageCapture(track) : null,
  };
  track.addEventListener('ended', stopLive);
  el.live.hidden = false;
  el.screen.classList.toggle('active', kind === 'screen');
  el.camera.classList.toggle('active', kind === 'camera');
  el.liveStatus.textContent = '載入條碼元件…';
  el.liveHint.textContent = kind === 'screen'
    ? '切換到帳單畫面並捲動，找到的載具會自動加到下方。可以一次掃多張帳單。'
    : '把條碼放在畫面中央並保持穩定。';
  loadZXing()
    .then(() => { if (live) live.timer = setInterval(scanTick, kind === 'screen' ? 800 : 400); })
    .catch(() => { el.liveStatus.textContent = '條碼元件載入失敗，請確認網路連線'; });
  el.live.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function stopLive() {
  if (!live) return;
  clearInterval(live.timer);
  live.stream.getTracks().forEach((t) => t.stop());
  live = null;
  el.video.srcObject = null;
  el.live.hidden = true;
  el.screen.classList.remove('active');
  el.camera.classList.remove('active');
}

async function grabFrame() {
  if (live.capture) {
    try {
      const bmp = await live.capture.grabFrame();
      const img = sourceToImageData(bmp, bmp.width, bmp.height);
      bmp.close?.();
      return img;
    } catch (_) { /* 改用 video */ }
  }
  const v = el.video;
  if (v.readyState < 2 || !v.videoWidth) return null;
  return sourceToImageData(v, v.videoWidth, v.videoHeight);
}

async function scanTick() {
  if (!live || live.busy) return;
  live.busy = true;
  try {
    const img = await grabFrame();
    if (!img || !live) return;
    lastImage = img;
    live.frames++;
    const results = await decodeSmart(img);
    if (!live) return;
    const inFrame = carriersIn(results).length;
    const added = handleBarcodes(results, live.kind);
    if (added) {
      live.found += added;
      if (live.kind === 'camera') navigator.vibrate?.(80);
    }
    el.liveStatus.textContent = live.found
      ? `已找到 ${live.found} 筆載具，繼續掃描中`
      : inFrame ? '畫面中的載具已在清單裡'
      : results.length ? `看到 ${results.length} 個條碼，但組不成載具號碼` : '掃描中，尚未看到條碼';
    if (!live.found && !inFrame && live.frames === 8) {
      el.liveHint.textContent = '一直找不到？把帳單放大（例如 PDF 縮放到 150% 以上）讓條碼變粗，或按「改用文字辨識」讀取條碼下方的號碼。';
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (live) live.busy = false;
  }
}

// 背景時用標題提示找到幾筆
let unseen = 0;
function notifyFound(n) {
  if (document.hidden) {
    unseen += n;
    document.title = `(${unseen}) 載具歸戶`;
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unseen = 0;
    document.title = '載具歸戶';
  }
});

// ---------------------------------------------------------------- 開啟歸戶頁 / 複製
function valuesOf(item) {
  return {
    ...item.parts,
    carrier: item.carrier,
    ...profileOf(item.provider),
    ...item.extras,
  };
}

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function missingFields(item) {
  const p = byId[item.provider];
  const v = valuesOf(item);
  return [...(p.profile || []), ...(p.extras || [])].filter((f) => !v[f.key]).map((f) => f.label);
}

function openItem(item) {
  const p = byId[item.provider];
  const v = valuesOf(item);
  const url = `${p.url}#einv=${b64url(JSON.stringify({ p: p.id, v }))}`;
  const copyValue = p.id === 'shintao' ? v.serial : v.carrier;
  // 先寫剪貼簿（需要頁面仍在焦點），再開新分頁
  copy(copyValue, null, true);
  window.open(url, '_blank', 'noopener');
  item.status = 'opened';
  item.openedAt = Date.now();
  save();
  renderTodo();
  const miss = missingFields(item);
  const base = autofillVersion() ? '已開啟歸戶頁，會自動填入號碼' : '已複製號碼並開啟歸戶頁，到頁面上貼上即可';
  toast(miss.length ? `${base}（還缺：${miss.join('、')}）` : base, 4500);
}

async function copy(text, label, silent = false) {
  if (!text) return false;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  if (!silent) toast(ok ? `已複製${label ? ' ' + label : ''}：${text}` : '複製失敗，請手動選取');
  return ok;
}

const FIELD_LABEL = {
  carrier: '完整號碼', period: '年期別', serial: '流水號', check: '檢核碼',
  custNo: '用戶號碼', custName: '用戶姓名', invoiceNo: '發票號碼', invoiceMonth: '發票月份',
};

// ---------------------------------------------------------------- 繪製
const freshIds = new Set();

function renderAll() {
  renderTodo();
  renderOthers();
  renderDone();
}

function renderTodo() {
  const todo = state.items.filter((x) => x.status !== 'done');
  el.todoCount.textContent = todo.length;
  el.todoEmpty.hidden = todo.length > 0;
  el.todoList.replaceChildren(...todo.map(renderItem));
  freshIds.clear();
}

function renderItem(item) {
  const p = byId[item.provider];
  const node = el.tpl.content.firstElementChild.cloneNode(true);
  node.style.setProperty('--pc', `var(--c-${p.id})`);
  node.dataset.id = item.id;
  if (item.status === 'opened') node.classList.add('opened');
  if (freshIds.has(item.id)) node.classList.add('fresh');

  $('.tag', node).textContent = `${p.short} ${p.kind}`;
  $('.period', node).textContent = describePeriod(item.parts.period);
  const src = $('.src', node);
  src.textContent = SOURCE_LABEL[item.source] || item.source;
  if (item.source === 'ocr') src.classList.add('warn');

  // 號碼分段顯示
  const num = $('.number', node);
  const segs = p.segments || [{ key: 'serial', label: '流水號' }, { key: 'check', label: '檢核碼' }];
  for (const s of segs) {
    const span = document.createElement('span');
    span.className = 'seg';
    span.append(item.parts[s.key] || '—');
    const small = document.createElement('small');
    small.textContent = s.label;
    span.append(small);
    num.append(span);
  }
  num.addEventListener('click', () => copy(p.id === 'shintao' ? item.parts.serial : item.carrier, '號碼'));

  // 額外欄位（固定資料＋每期資料）
  const extras = $('.extras', node);
  for (const f of p.profile || []) {
    extras.append(fieldInput(f, profileOf(p.id)[f.key], (val) => {
      profileOf(p.id)[f.key] = val;
      save();
      renderProfiles();
    }, '會記住'));
  }
  for (const f of p.extras || []) {
    extras.append(fieldInput(f, item.extras[f.key], (val) => {
      item.extras[f.key] = val;
      save();
    }));
  }

  // 複製按鈕
  const chips = $('.chips', node);
  const v = () => valuesOf(item);
  for (const key of p.pasteFields) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    const label = key === 'carrier' ? `完整 ${item.carrier.length} 碼` : FIELD_LABEL[key];
    b.textContent = label;
    b.title = `複製${FIELD_LABEL[key]}`;
    b.addEventListener('click', async () => {
      const val = v()[key];
      if (!val) return toast(`尚未填寫${FIELD_LABEL[key]}`);
      if (await copy(val, FIELD_LABEL[key])) {
        b.classList.add('copied');
        setTimeout(() => b.classList.remove('copied'), 1500);
      }
    });
    chips.append(b);
  }

  $('.open', node).addEventListener('click', () => openItem(item));
  $('.open', node).textContent = item.status === 'opened' ? '再開一次' : `開啟${p.short}歸戶頁`;
  $('.tip', node).textContent = p.tip;
  $('.done', node).textContent = item.status === 'opened' ? '已完成歸戶 ✓' : '標記已完成';
  $('.done', node).addEventListener('click', () => {
    item.status = 'done';
    item.doneAt = Date.now();
    save();
    renderAll();
    toast(`${p.short} ${describePeriod(item.parts.period)} 已完成`);
  });
  $('.remove', node).addEventListener('click', () => {
    state.items = state.items.filter((x) => x !== item);
    save();
    renderAll();
  });
  return node;
}

function fieldInput(f, value, onChange, note) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  if (!value) wrap.classList.add('missing');
  const cap = document.createElement('span');
  cap.textContent = f.label + (note ? `（${note}）` : '');
  const input = document.createElement('input');
  input.value = value || '';
  input.placeholder = f.hint || '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    wrap.classList.toggle('missing', !input.value.trim());
    onChange(input.value.trim());
  });
  wrap.append(cap, input);
  return wrap;
}

function renderOthers() {
  el.otherSec.hidden = state.others.length === 0;
  el.otherList.replaceChildren(...state.others.map((o) => {
    const row = document.createElement('div');
    row.className = 'row-item';
    const mono = document.createElement('span');
    mono.className = 'mono';
    mono.textContent = o.text;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${o.format}・${o.text.length} 碼`;
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">指定為…</option>' +
      PROVIDERS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      if (assignAs(sel.value, o.text)) {
        state.others = state.others.filter((x) => x !== o);
        save();
        renderOthers();
      } else sel.value = '';
    });
    row.append(mono, meta, sel);
    return row;
  }));
}

function assignAs(pid, text) {
  const opts = parseOpts();
  const c = parseAs(pid, text, opts);
  if (!c) {
    const need = expectedLength(pid, opts);
    const p = byId[pid];
    if (pid === 'shintao' && !opts.shintaoSerialLen) toast('請先在「設定」填入欣桃的流水號長度');
    else toast(need ? `${p.short}號碼應為 ${need} 碼，格式不符` : `不符合${p.short}號碼格式`);
    return false;
  }
  addCandidates([{ ...c, source: 'manual' }]);
  return true;
}

function renderDone() {
  const done = state.items.filter((x) => x.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  el.doneCount.textContent = done.length;
  el.doneList.replaceChildren(...done.slice(0, 60).map((item) => {
    const p = byId[item.provider];
    const row = document.createElement('div');
    row.className = 'row-item';
    row.style.borderLeft = `4px solid var(--c-${p.id})`;
    const t = document.createElement('b');
    t.textContent = p.short;
    const per = document.createElement('span');
    per.className = 'meta';
    per.textContent = describePeriod(item.parts.period);
    const mono = document.createElement('span');
    mono.className = 'mono';
    mono.textContent = item.carrier;
    const when = document.createElement('span');
    when.className = 'meta';
    when.textContent = item.doneAt ? new Date(item.doneAt).toLocaleDateString('zh-TW') : '';
    const undo = document.createElement('button');
    undo.className = 'link';
    undo.textContent = '移回待歸戶';
    undo.addEventListener('click', () => {
      item.status = 'todo';
      save();
      renderAll();
    });
    row.append(t, per, mono, when, undo);
    return row;
  }));
}

function renderProfiles() {
  const nodes = [];
  for (const p of PROVIDERS) {
    for (const f of p.profile || []) {
      nodes.push(fieldInput({ ...f, label: `${p.short} ${f.label}` }, profileOf(p.id)[f.key], (val) => {
        profileOf(p.id)[f.key] = val;
        save();
      }));
    }
  }
  el.profileFields.replaceChildren(...nodes);
  el.shintaoLen.value = state.settings.shintaoSerialLen || '';
  el.shintaoTotal.value = state.settings.shintaoTotalLen || '';
}

function renderProviderTable() {
  el.providerTable.innerHTML = PROVIDERS.map((p) => {
    const len = p.segments ? `${p.segments.reduce((n, s) => n + s.len, 0)} 碼（${p.segments.map((s) => s.len).join('+')}）` : '流水號＋檢核碼';
    const host = new URL(p.url).hostname;
    return `<tr><td>${p.name}</td><td>${len}</td><td><a href="${p.url}" target="_blank" rel="noopener">${host}</a></td><td>${p.captcha ? '有' : '無'}</td></tr>`;
  }).join('');
  el.manualProvider.innerHTML = '<option value="">自動判斷</option>' +
    PROVIDERS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
}

function flash(id) {
  const node = el.todoList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!node) return;
  node.classList.remove('fresh');
  void node.offsetWidth;
  node.classList.add('fresh');
}

let toastTimer;
function toast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
}

// ---------------------------------------------------------------- 自動填入腳本偵測
function autofillVersion() {
  return document.documentElement.getAttribute('data-einv-autofill');
}

function renderAutofill() {
  const v = autofillVersion();
  el.pill.dataset.state = v ? 'on' : 'off';
  el.pillText.textContent = v ? '自動填入已啟用' : '自動填入未安裝';
  el.autofillStatus.textContent = v
    ? `已偵測到自動填入腳本 v${v}。`
    : '目前沒有偵測到自動填入腳本（安裝後重新整理此頁）。';
}

// ---------------------------------------------------------------- 事件
el.screen.addEventListener('click', startScreen);
el.camera.addEventListener('click', startCamera);
el.stop.addEventListener('click', stopLive);
el.ocr.addEventListener('click', () => runOcr(lastImage));

el.file.addEventListener('change', async () => {
  for (const f of el.file.files) await handleImageBlob(f);
  el.file.value = '';
});

function parseTextbox() {
  const text = el.text.value;
  if (!text.trim()) return;
  const { found, added } = handleText(text);
  el.textHint.textContent = found
    ? added ? `找到 ${added} 筆載具` : '這些載具已在清單中'
    : '沒有找到符合格式的號碼，可以用「手動輸入」指定公司';
  if (found) el.text.value = '';
}
el.parse.addEventListener('click', parseTextbox);
el.text.addEventListener('paste', () => setTimeout(parseTextbox, 0));

// 整頁貼上圖片 / 文字
document.addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const img = items.find((i) => i.type.startsWith('image/'));
  if (img) {
    e.preventDefault();
    handleImageBlob(img.getAsFile());
    return;
  }
  const target = e.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const text = e.clipboardData?.getData('text');
  if (text) {
    el.text.value = text;
    parseTextbox();
  }
});

// 拖曳圖片
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  el.drop.hidden = false;
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; el.drop.hidden = true; }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.drop.hidden = true;
  for (const f of e.dataTransfer?.files || []) if (f.type.startsWith('image/')) await handleImageBlob(f);
});

// 手動輸入
$('#btnManual').addEventListener('click', () => {
  el.manualForm.hidden = !el.manualForm.hidden;
  if (!el.manualForm.hidden) el.manualValue.focus();
});
$('#manualCancel').addEventListener('click', () => (el.manualForm.hidden = true));
el.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const pid = el.manualProvider.value;
  const value = el.manualValue.value;
  if (!value.trim()) return;
  let ok;
  if (pid) ok = assignAs(pid, value);
  else {
    const cands = parseValue(value, parseOpts());
    if (cands.length) addCandidates(cands.map((c) => ({ ...c, source: 'manual' })));
    ok = cands.length > 0;
    if (!ok) el.manualMsg.textContent = '無法自動判斷公司，請在左邊選擇公司';
  }
  if (ok) {
    el.manualValue.value = '';
    el.manualMsg.textContent = '';
    el.manualForm.hidden = true;
  }
});

$('#btnClearOther').addEventListener('click', () => {
  state.others = [];
  save();
  renderOthers();
});
$('#btnClearDone').addEventListener('click', () => {
  state.items = state.items.filter((x) => x.status !== 'done');
  save();
  renderDone();
});
$('#btnReset').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (b.dataset.armed) {
    localStorage.removeItem(STORE_KEY);
    location.reload();
    return;
  }
  b.dataset.armed = '1';
  b.textContent = '再按一次確認清除';
  setTimeout(() => { delete b.dataset.armed; b.textContent = '清除全部資料'; }, 4000);
});

el.shintaoLen.addEventListener('input', () => {
  state.settings.shintaoSerialLen = Number(el.shintaoLen.value) || null;
  save();
});
el.shintaoTotal.addEventListener('input', () => {
  state.settings.shintaoTotalLen = Number(el.shintaoTotal.value) || null;
  save();
});

// ---------------------------------------------------------------- Android 分享（share_target）
async function receiveShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared') && !params.has('text')) return;
  history.replaceState(null, '', location.pathname);
  const text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n');
  if (text) {
    el.text.value = text;
    parseTextbox();
  }
  if (params.has('shared') && 'caches' in window) {
    const cache = await caches.open('einv-share');
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const blob = await res.blob();
      await cache.delete(req);
      if (blob.type.startsWith('image/')) await handleImageBlob(blob);
      else {
        const t = await blob.text();
        if (t) { el.text.value = t; parseTextbox(); }
      }
    }
  }
}

// ---------------------------------------------------------------- 啟動
if (!navigator.mediaDevices?.getDisplayMedia) el.screen.hidden = true;
if (!navigator.mediaDevices?.getUserMedia) el.camera.hidden = true;
if (!window.isSecureContext) {
  el.textHint.textContent = '提醒：必須用 https 或 localhost 開啟，才能擷取畫面與使用相機。';
}

renderProviderTable();
renderProfiles();
renderAll();
renderAutofill();
setTimeout(renderAutofill, 600);
receiveShared();

// 閒置時預先載入條碼元件，縮短第一次掃描時間
if ('requestIdleCallback' in window) requestIdleCallback(() => loadZXing().catch(() => {}));

let swReg = null;
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then((r) => (swReg = r)).catch(() => {});
}

// ---------------------------------------------------------------- 版本與更新檢查
const RUNNING = window.EINV_VERSION || { version: '?', build: '' };

function renderVersion() {
  $('#verTag').textContent = `v${RUNNING.version}`;
  $('#verFoot').textContent = `版本 v${RUNNING.version}${RUNNING.build ? `・建置 ${RUNNING.build}` : ''}`;
}

/** 直接向伺服器（GitHub Pages）讀最新的 version.js，略過所有快取 */
async function checkUpdate() {
  try {
    const res = await fetch(`version.js?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const m = (await res.text()).match(/version:\s*'([^']+)',\s*build:\s*'([^']*)'/);
    if (!m || m[1] === RUNNING.version) return;
    $('#updateText').textContent = `已發布新版本 v${m[1]}（${m[2]}），目前是 v${RUNNING.version}`;
    $('#updateBar').hidden = false;
  } catch (_) { /* 離線 */ }
}

$('#btnUpdate').addEventListener('click', async () => {
  try { await swReg?.update(); } catch (_) {}
  location.reload();
});

renderVersion();
setTimeout(checkUpdate, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });

// 測試用
window.__einv = { state, handleBarcodes, handleText, decode, decodeSmart, addCandidates };
