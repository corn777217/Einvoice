// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValue, parseText, findInvoiceNo, findCustNo, compact } from '../assets/providers.js';

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

test('compact', () => {
  assert.equal(compact(' ab-12 ３4 '), 'AB1234');
});
