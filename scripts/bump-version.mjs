// 更新 version.js（由 .git/hooks/pre-commit 呼叫，也可手動執行：node scripts/bump-version.mjs）
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../version.js', import.meta.url));
const RE = /version:\s*'(\d+)\.(\d+)\.(\d+)',\s*build:\s*'[^']*'/;

const src = readFileSync(FILE, 'utf8');
const m = src.match(RE);
if (!m) {
  console.error('version.js 格式不符，未更新版本');
  process.exit(1);
}
let [, major, minor, patch] = m.map(Number);
const current = `${major}.${minor}.${patch}`;

// 與上一個 commit 比較：版本號沒有手動改過才自動 +1
let previous = null;
try {
  const head = execSync('git show HEAD:version.js', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const hm = head.match(RE);
  if (hm) previous = `${hm[1]}.${hm[2]}.${hm[3]}`;
} catch (_) { /* 第一次加入 version.js */ }

const next = previous === current ? `${major}.${minor}.${patch + 1}` : current;

const build = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date()); // 2026-11-19 12:00

writeFileSync(FILE, src.replace(RE, `version: '${next}', build: '${build}'`));
console.log(`version.js → ${next} (${build})`);
