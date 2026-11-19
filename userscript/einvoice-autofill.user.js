// ==UserScript==
// @name         變動載具歸戶：自動填入
// @namespace    https://corn777217.github.io/einvoice/
// @version      1.0.0
// @description  從「載具歸戶」工具開啟各公用事業的歸戶頁時，自動填入載具號碼。圖形驗證碼仍需自行輸入。
// @match        https://service.taipower.com.tw/einvoice/post1*
// @match        https://www.water.gov.tw/einvoice/CloudInvoice/Transfer*
// @match        https://eci.tradevan.com.tw/APSSIC/gov/gov001*
// @match        https://www.shintaogas.com.tw/HOME/*
// @match        https://corn777217.github.io/einvoice/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @include      /^http://(localhost|127\.0\.0\.1):\d+/.*$/
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.0.0';
  const KEY = 'einv.pending';
  const TTL = 15 * 60 * 1000; // 15 分鐘內有效
  const host = location.hostname;

  // ---------- 工具頁面：宣告已安裝 ----------
  if (host === 'corn777217.github.io' || host === 'localhost' || host === '127.0.0.1') {
    document.documentElement.setAttribute('data-einv-autofill', VERSION);
    return;
  }

  // ---------- 儲存（相容 Tampermonkey / Violentmonkey / iOS Userscripts） ----------
  const store = {
    async get() {
      try {
        if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(KEY, null);
        if (typeof GM_getValue === 'function') return GM_getValue(KEY, null);
      } catch (_) {}
      try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (_) { return null; }
    },
    async set(v) {
      try {
        if (typeof GM !== 'undefined' && GM.setValue) return await GM.setValue(KEY, v);
        if (typeof GM_setValue === 'function') return GM_setValue(KEY, v);
      } catch (_) {}
      try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {}
    },
    async del() {
      try {
        if (typeof GM !== 'undefined' && GM.deleteValue) return await GM.deleteValue(KEY);
        if (typeof GM_deleteValue === 'function') return GM_deleteValue(KEY);
      } catch (_) {}
      try { sessionStorage.removeItem(KEY); } catch (_) {}
    },
  };

  function decodePayload(s) {
    try {
      const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      return null;
    }
  }

  // 從網址 #einv=... 取得資料，存起來後把 hash 清掉
  async function takePending() {
    const m = location.hash.match(/[#&]einv=([A-Za-z0-9_\-]+)/);
    if (m) {
      const data = decodePayload(m[1]);
      if (data && data.p && data.v) {
        data.ts = Date.now();
        await store.set(data);
      }
      try {
        history.replaceState(history.state, '', location.href.replace(/#.*$/, ''));
      } catch (_) {}
    }
    const pending = await store.get();
    if (!pending || Date.now() - (pending.ts || 0) > TTL) return null;
    return pending;
  }

  // ---------- DOM 工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);

  function waitFor(fn, timeout = 15000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        let v = null;
        try { v = fn(); } catch (_) {}
        if (v) return resolve(v);
        if (Date.now() - t0 > timeout) return resolve(null);
        setTimeout(tick, 150);
      })();
    });
  }

  function setValue(el, value) {
    if (!el || value == null) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.style.outline = '2px solid #2f9e44';
    el.style.backgroundColor = '#ebfbee';
    return true;
  }

  function banner(html, tone = 'ok') {
    const show = () => {
      let el = document.getElementById('einv-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'einv-banner';
        el.setAttribute('role', 'status');
        el.style.cssText = [
          'position:fixed', 'z-index:2147483647', 'left:50%', 'top:12px', 'transform:translateX(-50%)',
          'max-width:min(560px,calc(100vw - 24px))', 'padding:12px 40px 12px 16px', 'border-radius:10px',
          'font:15px/1.5 system-ui,-apple-system,"Noto Sans TC","Microsoft JhengHei",sans-serif',
          'box-shadow:0 6px 24px rgba(0,0,0,.18)', 'color:#fff',
        ].join(';');
        const x = document.createElement('button');
        x.textContent = '×';
        x.setAttribute('aria-label', '關閉');
        x.style.cssText = 'position:absolute;right:8px;top:6px;border:0;background:none;color:inherit;font-size:22px;cursor:pointer';
        x.onclick = () => el.remove();
        el.appendChild(x);
        el.appendChild(document.createElement('div'));
        document.body.appendChild(el);
      }
      el.style.background = tone === 'ok' ? '#1f6f43' : tone === 'warn' ? '#a65e00' : '#3a4a5c';
      el.lastChild.innerHTML = '<b>載具歸戶小幫手</b>　' + html;
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  // ---------- 各公司 ----------
  const handlers = {
    // 台電：年期別 / 流水號 / 檢核碼 三格 + 5 位數圖形驗證碼
    async taipower(v) {
      const ok = await waitFor(() => $('#period') && $('#serial') && $('#checksum'));
      if (!ok) return banner('找不到台電歸戶欄位，頁面可能已改版，請改用複製貼上。', 'warn');
      setValue($('#period'), v.period);
      setValue($('#serial'), v.serial);
      setValue($('#checksum'), v.check);
      $('#picpassword')?.focus();
      banner('已填入載具號碼，請輸入<b>圖形驗證碼</b>後按「點我歸戶」。');
      return true;
    },

    // 台水：單一欄位 21 碼 + 圖形驗證碼
    async water(v) {
      const el = await waitFor(() => $('#card_no1'));
      if (!el) return banner('找不到台水載具號碼欄位，請改用複製貼上。', 'warn');
      setValue(el, v.carrier);
      $('#VerificationCode')?.focus();
      banner('已填入載具號碼，請輸入<b>驗證碼</b>後送出。');
      return true;
    },

    // 欣泰（關貿平台）：第 1 頁選公司 → 第 2 頁填用戶號碼 / 變動載具 / 發票月份 + 驗證碼
    async htgas(v) {
      const step = await waitFor(() => ($('#carrierId') ? 'form' : $('#cmpSlt_1') ? 'company' : null));
      if (step === 'company') {
        const opt = await waitFor(() => $('#cmpSlt_1 option[value="22000004"]'));
        if (!opt) return banner('公司清單沒有欣泰石油氣，請手動選擇。', 'warn');
        setValue($('#cmpSlt_1'), '22000004');
        banner('已選擇「欣泰石油氣」，前往下一步…', 'info');
        setTimeout(() => $('#NextBtn')?.click(), 300);
        return false; // 尚未完成，保留資料給下一頁
      }
      if (step === 'form') {
        if (v.custNo) setValue($('#selltargetcode'), v.custNo);
        setValue($('#carrierId'), v.carrier);
        if (v.invoiceMonth) {
          const opt = await waitFor(() => $(`#invoiceMonth option[value="${v.invoiceMonth}"]`), 6000);
          if (opt) setValue($('#invoiceMonth'), v.invoiceMonth);
        }
        $('#verifyCode')?.focus();
        const miss = [];
        if (!v.custNo) miss.push('用戶號碼');
        if (!v.invoiceMonth || !$('#invoiceMonth').value) miss.push('發票月份');
        banner(
          '已填入變動載具' + (miss.length ? `，請補上<b>${miss.join('、')}</b>` : '') +
            '，輸入<b>驗證碼</b>後查詢，再按結果列的「歸戶」。'
        );
        return true;
      }
      return null; // 其他頁面（例如查詢結果）不處理
    },

    // 欣桃（Angular）：依欄位標籤找輸入框
    async shintao(v) {
      if (!/\/HOME\/invoice\/carrier/.test(location.pathname)) return null;
      const items = await waitFor(() => {
        const list = [...document.querySelectorAll('s-form-item')];
        return list.length >= 5 ? list : null;
      });
      if (!items) return banner('找不到欣桃歸戶表單，請改用複製貼上。', 'warn');
      const map = { 用戶號碼: 'custNo', 用戶姓名: 'custName', 發票號碼: 'invoiceNo', 載具流水號: 'serial', 載具檢核碼: 'check' };
      const miss = [];
      for (const item of items) {
        const label = (item.querySelector('s-form-label')?.textContent || '').replace(/[\s*＊]/g, '');
        const key = map[label];
        const input = item.querySelector('input:not([disabled]):not([readonly])');
        if (!key || !input) continue;
        if (v[key]) setValue(input, v[key]);
        else miss.push(label);
      }
      banner(
        (miss.length ? `已填入，請補上<b>${miss.join('、')}</b>，` : '已填入全部欄位，') + '確認無誤後按「確認送出」。'
      );
      return true;
    },
  };

  async function run() {
    const pending = await takePending();
    if (!pending) return;
    const fn = handlers[pending.p];
    if (!fn) return;
    const hostOf = {
      taipower: 'service.taipower.com.tw',
      water: 'www.water.gov.tw',
      htgas: 'eci.tradevan.com.tw',
      shintao: 'www.shintaogas.com.tw',
    };
    if (hostOf[pending.p] !== host) return;
    if (document.readyState === 'loading') {
      await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }
    const done = await fn(pending.v);
    if (done === true) await store.del();
  }

  run();
})();
