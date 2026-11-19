// 版本資訊：頁面（window）與 service worker（importScripts）共用。
// commit 時 pre-commit hook 會執行 scripts/bump-version.mjs：
//   - version 沒有手動改 → 自動 +1 修訂號（1.2.0 → 1.2.1）
//   - build 一律更新為 commit 時間（台北時間）
self.EINV_VERSION = { version: '1.2.1', build: '2026-11-19 13:24' };
