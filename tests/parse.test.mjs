// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValue, parseText, findInvoiceNo, findCustNo, compact, assembleBarcodes, filterCarrierText } from '../assets/providers.js';

const TP = '11211AAA9999999001100110011000'; // 台電官方說明 PDF 範例
const WA = '10801BBAA0000011B3281'; // 台水頁面範例
const HT = '11410AB12345678123456789'; // 欣泰格式 5+10+9

test('台電 30 碼', () => {
  const [c, ...rest] = parseValue(TP);
  assert.equal(rest.length, 0);
  assert.equal(c.provider, 'taipower');
  assert.deepEqual(c.parts, { period: '11211', serial: 'AAA9999999', check: '001100110011000' });
});

test('台電帶載具類別前綴、全形、空白', () => {
  const [c] = parseValue('ＥＤ0003 11211 AAA9999999 001100110011000');
  assert.equal(c.provider, 'taipower');
  assert.equal(c.carrier, TP);
});

test('台水 21 碼', () => {
  const [c] = parseValue(WA);
  assert.equal(c.provider, 'water');
  assert.deepEqual(c.parts, { period: '10801', serial: 'BBAA000001', check: '1B3281' });
});

test('欣泰 24 碼', () => {
  const [c] = parseValue(HT);
  assert.equal(c.provider, 'htgas');
  assert.equal(c.parts.check, '123456789');
});

test('繳費條碼（超商三段）不會被誤認', () => {
  for (const v of ['141130AB1', '1234567890123456', '113100000012345', '0012345678']) {
    assert.deepEqual(parseValue(v), [], v);
  }
});

test('期別不合理時拒絕', () => {
  assert.deepEqual(parseValue('11213AAA9999999001100110011000'), []);
});

test('從帳單文字中找出多筆載具', () => {
  const text = `
    台灣電力公司 繳費憑證
    電號 01-23-4567-89-0   應繳總金額 1,234 元
    載具號碼：11211 AAA9999999 001100110011000
    ---
    台灣自來水 水號 1-23-456789-0
    變動載具：10801-BBAA000001-1B3281
  `;
  const r = parseText(text).map((c) => `${c.provider}:${c.carrier}`).sort();
  assert.deepEqual(r, [`taipower:${TP}`, `water:${WA}`]);
});

test('分欄標籤文字（OCR 常見）', () => {
  const text = '年期別 11211\n流水號 AAA9999999\n檢核碼 001100110011000';
  const r = parseText(text);
  assert.equal(r.length, 1);
  assert.equal(r[0].provider, 'taipower');
});

test('欣桃標籤文字', () => {
  const text = '載具類別 ED0015\n載具流水號 1141012345678\n載具檢核碼 ABCD1234\n發票號碼 XY-12345678\n用戶號碼 0123456789';
  const r = parseText(text);
  assert.equal(r.length, 1);
  assert.equal(r[0].provider, 'shintao');
  assert.deepEqual(r[0].parts, { serial: '1141012345678', check: 'ABCD1234' });
  assert.equal(findInvoiceNo(text), 'XY12345678');
  assert.equal(findCustNo(text), '0123456789');
});

test('欣桃整串依設定長度拆分', () => {
  const r = parseValue('ED00151141012345678ABCD1234', { shintaoSerialLen: 13 });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].parts, { serial: '1141012345678', check: 'ABCD1234' });
});

// 台電帳單「本期載具號碼」：類別、年期別+流水號、檢核碼為上下三個條碼（座標仿實際帳單）
const box = (l, t, r, b) => ({ topLeft: { x: l, y: t }, topRight: { x: r, y: t }, bottomRight: { x: r, y: b }, bottomLeft: { x: l, y: b } });
const tpHead = '11511BBN1234567';
const tpTail = '012345678901234';

test('分段條碼：類別＋年期別流水號＋檢核碼', () => {
  const res = [
    { text: tpTail, position: box(11, 191, 310, 236) },
    { text: 'ED0003', position: box(11, 30, 130, 95) },
    { text: tpHead, position: box(11, 120, 310, 165) },
    { text: '141130AB1', position: box(600, 500, 800, 540) }, // 繳費條碼
  ];
  const { carriers, used } = assembleBarcodes(res);
  assert.equal(carriers.length, 1);
  assert.equal(carriers[0].provider, 'taipower');
  assert.equal(carriers[0].carrier, tpHead + tpTail);
  assert.deepEqual([...used].sort(), [0, 1, 2]);
});

test('分段條碼：讀不到類別條碼時以長度判斷', () => {
  const res = [
    { text: tpHead, position: box(11, 120, 310, 165) },
    { text: tpTail, position: box(11, 191, 310, 236) },
  ];
  const { carriers } = assembleBarcodes(res);
  assert.equal(carriers[0]?.provider, 'taipower');
});

test('分段條碼：兩張帳單並排時不會交錯組合', () => {
  const tail2 = '999999999999999';
  const res = [
    { text: tpHead, position: box(11, 120, 310, 165) },
    { text: '11512CCN7654321', position: box(700, 120, 1000, 165) },
    { text: tail2, position: box(700, 191, 1000, 236) },
    { text: tpTail, position: box(11, 191, 310, 236) },
  ];
  const got = assembleBarcodes(res).carriers.map((c) => c.carrier).sort();
  assert.deepEqual(got, [tpHead + tpTail, '11512CCN7654321' + tail2].sort());
});

test('分段條碼：欣桃依類別條碼拆成流水號與檢核碼', () => {
  const res = [
    { text: 'ED0015', position: box(10, 0, 120, 40) },
    { text: '11410ABC123', position: box(10, 60, 260, 100) },
    { text: 'XYZ98765', position: box(10, 120, 220, 160) },
  ];
  const { carriers } = assembleBarcodes(res);
  assert.equal(carriers[0]?.provider, 'shintao');
  assert.deepEqual(carriers[0].parts, { serial: '11410ABC123', check: 'XYZ98765' });
});

test('分段條碼文字（OCR／複製帳單）', () => {
  const text = '本期載具號碼 Carrier\nED0003 載具類別(6位)\n年期別(5位)\n11511BBN1234567 載具流水號(10位)\n檢核碼(15位)\n012345678901234';
  const r = parseText(text);
  assert.equal(r.length, 1);
  assert.equal(r[0].carrier, tpHead + tpTail);
});

test('compact', () => {
  assert.equal(compact(' ab-12 ３4 '), 'AB1234');
});

const billText = `台灣電力公司 繳費憑證
電號 01-23-4567-89-0 計費期間 115/09/16~115/11/14
應繳總金額 1,234 元 繳費期限 115/12/05
本期載具號碼 Carrier
ED0003 載具類別(6位)
年期別(5位) 載具流水號(10位)
11511BBN1234567
檢核碼(15位)
012345678901234
客服專線 1911`;

test('過濾剪貼簿：能組成載具時只留分段號碼', () => {
  assert.equal(filterCarrierText(billText), '11511 BBN1234567 012345678901234');
});

test('過濾剪貼簿：組不成載具時只留像號碼的片段', () => {
  const text = '本期載具號碼\n載具類別 ED0003\n年期別+流水號 11511BBN1234567\n應繳 1,234 元　日期 115/12/05\n客服 1911';
  assert.equal(filterCarrierText(text), 'ED0003\n11511BBN1234567');
});

test('過濾剪貼簿：沒有號碼時回傳空字串', () => {
  assert.equal(filterCarrierText('請於繳費期限前繳納，謝謝'), '');
});
