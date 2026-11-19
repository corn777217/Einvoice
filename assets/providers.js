// 公用事業變動載具定義與解析邏輯（app 與測試共用）
//
// 每家的號碼結構與歸戶頁表單皆於 2026-11 實際查驗：
//   台電  service.taipower.com.tw/einvoice/post1           #period #serial #checksum ＋圖形驗證碼
//   台水  www.water.gov.tw/einvoice/CloudInvoice/Transfer   #card_no1 ＋圖形驗證碼
//   欣泰  eci.tradevan.com.tw（關貿）先選公司再填            #selltargetcode #carrierId #invoiceMonth ＋圖形驗證碼
//   欣桃  www.shintaogas.com.tw/HOME/invoice/carrier         用戶號碼、姓名、發票號碼、載具流水號、檢核碼（無驗證碼）

/** 民國年＋期別：例 11406 = 114 年第 06 期 */
const PERIOD = '1[0-9]{2}(?:0[1-9]|1[0-2])';

export const PROVIDERS = [
  {
    id: 'taipower',
    name: '台灣電力',
    short: '台電',
    kind: '電費',
    typeCode: 'ED0003',
    // 年期別(5) + 流水號(10) + 檢核碼(15)
    segments: [
      { key: 'period', label: '年期別', re: PERIOD, len: 5 },
      { key: 'serial', label: '流水號', re: '[A-Z0-9]{10}', len: 10 },
      { key: 'check', label: '檢核碼', re: '[0-9]{15}', len: 15 },
    ],
    url: 'https://service.taipower.com.tw/einvoice/post1',
    captcha: true,
    // 複製模式：依序要貼進歸戶頁的欄位（台電頁面貼上 30 碼會自動分段）
    pasteFields: ['carrier', 'period', 'serial', 'check'],
    tip: '台電頁面在第一格貼上完整 30 碼會自動分到三格。',
  },
  {
    id: 'water',
    name: '台灣自來水',
    short: '台水',
    kind: '水費',
    typeCode: 'EE0001',
    // 年期別(5) + 流水號(10) + 檢核碼(6)
    segments: [
      { key: 'period', label: '年期別', re: PERIOD, len: 5 },
      { key: 'serial', label: '流水號', re: '[A-Z0-9]{10}', len: 10 },
      { key: 'check', label: '檢核碼', re: '[A-Z0-9]{6}', len: 6 },
    ],
    url: 'https://www.water.gov.tw/einvoice/CloudInvoice/Transfer?nodeId=4622',
    captcha: true,
    pasteFields: ['carrier'],
    tip: '台水只有一格「載具號碼」，貼上完整 21 碼即可。',
  },
  {
    id: 'htgas',
    name: '欣泰石油氣',
    short: '欣泰',
    kind: '瓦斯費',
    typeCode: null,
    // 年期別(5) + 流水號(10) + 檢核碼(9)（關貿頁面說明）
    segments: [
      { key: 'period', label: '年期別', re: PERIOD, len: 5 },
      { key: 'serial', label: '流水號', re: '[A-Z0-9]{10}', len: 10 },
      { key: 'check', label: '檢核碼', re: '[A-Z0-9]{9}', len: 9 },
    ],
    url: 'https://eci.tradevan.com.tw/APSSIC/gov/gov001!toQueryPage.action',
    captcha: true,
    profile: [{ key: 'custNo', label: '用戶號碼', hint: '帳單上的用戶號碼' }],
    extras: [{ key: 'invoiceMonth', label: '發票月份', hint: 'YYYY/MM，通常是繳費月份', defaultValue: () => currentMonth() }],
    pasteFields: ['custNo', 'carrier', 'invoiceMonth'],
    tip: '關貿頁面要先在「公司別」選欣泰石油氣、按確認，再填用戶號碼與變動載具，查到發票後按「歸戶」。',
  },
  {
    id: 'shintao',
    name: '欣桃天然氣',
    short: '欣桃',
    kind: '瓦斯費',
    typeCode: 'ED0015',
    // 欣桃頁面把載具拆成「載具流水號」「載具檢核碼」兩格，官方未公布長度，
    // 只能從帳單上標示的兩段文字辨識；整串時需在設定裡指定流水號長度。
    segments: null,
    url: 'https://www.shintaogas.com.tw/HOME/invoice/carrier',
    captcha: false,
    profile: [
      { key: 'custNo', label: '用戶號碼', hint: '10 碼' },
      { key: 'custName', label: '用戶姓名', hint: '帳單上的用戶姓名' },
    ],
    extras: [{ key: 'invoiceNo', label: '發票號碼', hint: '例：AB12345678' }],
    pasteFields: ['custNo', 'custName', 'invoiceNo', 'serial', 'check'],
    tip: '欣桃頁面沒有圖形驗證碼，確認資料後按「確認送出」。',
  },
];

export const byId = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export function currentMonth(d = new Date()) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 全形轉半形、轉大寫 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .toUpperCase();
}

/** 去除號碼中常見的分隔符號 */
export function compact(text) {
  return normalize(text).replace(/[\s\-_.·・:：|\/]/g, '');
}

function segmentRegex(p) {
  return p.segments.map((s) => `(${s.re})`).join('');
}

function totalLen(p) {
  return p.segments.reduce((n, s) => n + s.len, 0);
}

export function describePeriod(period) {
  if (!/^\d{5}$/.test(period || '')) return '';
  return `民國 ${period.slice(0, 3)} 年第 ${period.slice(3)} 期`;
}

/**
 * 建立一筆載具資料
 * @returns {{provider:string, carrier:string, parts:Object, period:string, source:string, raw:string}}
 */
export function makeCarrier(providerId, parts, source = 'manual', raw = '') {
  const p = byId[providerId];
  const carrier = p.segments
    ? p.segments.map((s) => parts[s.key]).join('')
    : `${parts.serial || ''}${parts.check || ''}`;
  return {
    provider: providerId,
    carrier,
    parts: { ...parts },
    period: parts.period || '',
    source,
    raw,
  };
}

/**
 * 從一串「整段號碼」辨識（條碼內容、手動輸入）。
 * 可帶或不帶 6 碼載具類別（如 ED0003）。
 * @param {string} value
 * @param {{shintaoSerialLen?: number}} opts
 * @returns {Array} 可能的載具（通常 0 或 1 筆）
 */
export function parseValue(value, opts = {}) {
  const v = compact(value);
  const out = [];
  if (!v) return out;

  // 有載具類別前綴：直接指定公司
  const typed = v.match(/^([A-Z]{2}\d{4})([A-Z0-9]+)$/);
  if (typed) {
    const p = PROVIDERS.find((x) => x.typeCode === typed[1]);
    if (p) {
      const hit = matchWhole(p, typed[2], opts);
      if (hit) return [hit];
    }
  }

  for (const p of PROVIDERS) {
    const hit = matchWhole(p, v, opts);
    if (hit) out.push(hit);
  }
  return out;
}

/** 指定公司解析整段號碼（手動指定其他條碼時使用） */
export function parseAs(providerId, value, opts = {}) {
  const p = byId[providerId];
  if (!p) return null;
  let v = compact(value);
  const m = v.match(/^([A-Z]{2}\d{4})(.+)$/);
  if (m && p.typeCode === m[1]) v = m[2];
  return matchWhole(p, v, opts);
}

/** 該公司號碼應有的長度（未知時回傳 null） */
export function expectedLength(providerId, opts = {}) {
  const p = byId[providerId];
  if (p?.segments) return totalLen(p);
  return opts.shintaoTotalLen || null;
}

function matchWhole(p, v, opts) {
  if (p.segments) {
    const m = v.match(new RegExp(`^${segmentRegex(p)}$`));
    if (!m) return null;
    const parts = {};
    p.segments.forEach((s, i) => (parts[s.key] = m[i + 1]));
    return makeCarrier(p.id, parts, 'value', v);
  }
  // 欣桃：需事先知道流水號長度才能從整串拆分
  if (p.id === 'shintao' && opts.shintaoSerialLen && /^[A-Z0-9]+$/.test(v)) {
    const n = opts.shintaoSerialLen;
    const total = opts.shintaoTotalLen;
    if (total && v.length !== total) return null;
    if (!total && v.length <= n) return null;
    return makeCarrier(p.id, { serial: v.slice(0, n), check: v.slice(n) }, 'value', v);
  }
  return null;
}

/**
 * 從一段文字（貼上、OCR）找出所有載具。
 * 支援：連續號碼、以空白/連字號分段的號碼、帶「年期別／流水號／檢核碼」標籤的分欄文字。
 */
export function parseText(text, opts = {}) {
  const norm = normalize(text);
  const found = new Map();
  const add = (c) => {
    if (!c) return;
    const key = `${c.provider}:${c.carrier}`;
    if (!found.has(key)) found.set(key, c);
  };

  const lines = norm.split(/\r?\n/);
  const chunks = [...lines, lines.join(' ')];

  for (const chunk of chunks) {
    // 1) 以空白分段的 token 為單位，嘗試把相鄰 1~4 個 token 接起來比對整段號碼。
    //    只有中間僅隔空白／連字號時才接，避免把「流水號 xxx 檢核碼 yyy」這類不同欄位硬湊在一起。
    const pieces = chunk.split(/([A-Z0-9\-]+)/);
    const tokens = [];
    const joinable = []; // joinable[k]：tokens[k] 與 tokens[k+1] 之間只有空白
    for (let k = 1; k < pieces.length; k += 2) {
      const t = pieces[k].replace(/-/g, '');
      if (!t) continue;
      if (tokens.length) joinable[tokens.length - 1] = /^[\s]*$/.test(pieces[k - 1]);
      tokens.push(t);
    }
    for (let i = 0; i < tokens.length; i++) {
      let acc = '';
      for (let j = i; j < Math.min(tokens.length, i + 4); j++) {
        if (j > i && !joinable[j - 1]) break;
        acc += tokens[j];
        if (acc.length > 40) break;
        for (const c of parseValue(acc, opts)) add({ ...c, source: 'text' });
      }
    }
  }

  // 2) 帳單條碼下方的文字（OCR 或複製）：類別、年期別+流水號、檢核碼分在不同行，中間夾著說明文字
  const all = norm.split(/[^A-Z0-9]+/).filter(Boolean);
  all.forEach((tok, i) => {
    if (!HEAD_RE.test(tok)) return;
    const type = all.slice(Math.max(0, i - 4), i).reverse().find((x) => TYPE_RE.test(x));
    const p = type ? PROVIDERS.find((x) => x.typeCode === type) : null;
    for (const tail of all.slice(i + 1, i + 7)) {
      const c = buildFrom(p, tok, tail, opts);
      if (c) {
        add({ ...c, source: 'text' });
        break;
      }
    }
  });

  // 3) 帶標籤的分欄文字
  for (const c of parseLabeled(norm, opts)) add(c);

  return [...found.values()];
}

function grab(text, labelRe, valueRe) {
  const m = text.match(new RegExp(`(?:${labelRe})[^A-Z0-9\\n]{0,8}(${valueRe})`));
  return m ? m[1] : '';
}

function parseLabeled(text, opts) {
  const out = [];
  const period = grab(text, '年期別|年期', PERIOD);
  const serial = grab(text, '流水號', '[A-Z0-9]{6,20}');
  const check = grab(text, '檢核碼', '[A-Z0-9]{4,20}');
  if (!serial || !check) return out;

  for (const p of PROVIDERS) {
    if (!p.segments) continue;
    const parts = { period, serial, check };
    const ok = p.segments.every((s) => parts[s.key] && new RegExp(`^${s.re}$`).test(parts[s.key]));
    if (ok) out.push({ ...makeCarrier(p.id, parts, 'labeled'), raw: `${period}${serial}${check}` });
  }

  // 欣桃：帳單上只有「載具流水號」「載具檢核碼」兩格，且非其他公司格式時歸為欣桃候選
  if (!out.length) out.push(makeCarrier('shintao', { serial, check }, 'labeled'));
  return out;
}

// ---------------------------------------------------------------- 分段條碼組合
//
// 帳單常把載具印成上下排列的多個條碼，例如台電：
//   ED0003                 ← 載具類別(6)
//   11511BBN3382911        ← 年期別(5)+流水號(10)
//   051205157475261        ← 檢核碼
// 這裡依位置（上下相鄰、左側對齊）把它們接回完整號碼。

const TYPE_RE = /^[A-Z]{2}\d{4}$/;
const HEAD_RE = new RegExp(`^${PERIOD}[A-Z0-9]{10}$`); // 年期別+流水號
const PIECE_RE = /^[A-Z0-9]{3,24}$/;

function boxOf(r, i) {
  const p = r.position;
  if (!p?.topLeft) return null;
  const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
  const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** b 是否在 a 正下方附近；回傳距離分數（越小越近），不符合回傳 null */
function belowScore(a, b) {
  if (a.box && b.box) {
    const w = Math.max(a.box.right - a.box.left, b.box.right - b.box.left, 1);
    const dy = b.box.top - a.box.bottom;
    const dx = Math.abs(b.box.left - a.box.left);
    if (dy < -0.05 * w || dy > 0.8 * w || dx > 0.6 * w) return null;
    return dy + dx * 0.5;
  }
  // 沒有位置資訊時，依掃描順序
  const d = b.i - a.i;
  return d > 0 && d <= 3 ? d : null;
}

function buildFrom(p, head, tail, opts) {
  if (!p) {
    const r = parseValue(head + tail, opts);
    return r.length === 1 ? r[0] : null;
  }
  if (p.segments) return parseAs(p.id, head + tail, opts);
  if (p.id === 'shintao') return makeCarrier(p.id, { serial: head, check: tail }, 'value', head + tail);
  return null;
}

/**
 * 把一張畫面上解出的多個條碼組成載具。
 * @param {Array<{text:string, position?:Object}>} results
 * @returns {{carriers: Array, used: Set<number>}} used 為已被組合使用的 results 索引
 */
export function assembleBarcodes(results, opts = {}) {
  const items = results.map((r, i) => ({ i, v: compact(r.text), box: boxOf(r, i) }));
  const used = new Set();
  const carriers = [];
  const free = (x) => !used.has(x.i);
  const nearestBelow = (a, pred) =>
    items
      .filter((b) => b !== a && free(b) && pred(b))
      .map((b) => ({ b, s: belowScore(a, b) }))
      .filter((x) => x.s !== null)
      .sort((x, y) => x.s - y.s)
      .map((x) => x.b);

  // 1) 有載具類別條碼：類別 → 下方第一段 → 再下方第二段
  for (const t of items.filter((x) => TYPE_RE.test(x.v))) {
    const p = PROVIDERS.find((x) => x.typeCode === t.v);
    if (!p) continue;
    let done = false;
    for (const h of nearestBelow(t, (b) => PIECE_RE.test(b.v) && !TYPE_RE.test(b.v))) {
      for (const k of nearestBelow(h, (b) => PIECE_RE.test(b.v) && !TYPE_RE.test(b.v))) {
        const c = buildFrom(p, h.v, k.v, opts);
        if (c) {
          carriers.push(c);
          [t.i, h.i, k.i].forEach((i) => used.add(i));
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }

  // 2) 沒有（或讀不到）類別條碼：年期別+流水號 → 下方檢核碼，以總長度判斷公司
  for (const h of items.filter((x) => free(x) && HEAD_RE.test(x.v))) {
    for (const k of nearestBelow(h, (b) => PIECE_RE.test(b.v) && !TYPE_RE.test(b.v) && !HEAD_RE.test(b.v))) {
      const c = buildFrom(null, h.v, k.v, opts);
      if (c) {
        carriers.push(c);
        used.add(h.i);
        used.add(k.i);
        // 上方若有對應的類別條碼也一併標記
        const t = items.find((x) => free(x) && TYPE_RE.test(x.v) && belowScore(x, h) !== null);
        if (t) used.add(t.i);
        break;
      }
    }
  }
  return { carriers, used };
}

/** 發票號碼：2 碼英文 + 8 碼數字 */
export function findInvoiceNo(text) {
  const m = normalize(text).match(/(?<![A-Z])([A-Z]{2})[-\s]?(\d{8})(?!\d)/);
  return m ? m[1] + m[2] : '';
}

/** 用戶號碼（10 碼數字，帶「用戶號碼／用戶編號」標籤） */
export function findCustNo(text) {
  return grab(normalize(text), '用戶號碼|用戶編號', '\\d{10}');
}

export { totalLen };
