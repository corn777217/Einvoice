# 載具歸戶

公用事業（水、電、瓦斯）的電子發票使用「變動載具」，每期號碼都不同，必須逐期手動歸戶到手機條碼。這個工具把流程縮短為：

1. **取得號碼**：擷取畫面（電腦）／相機掃描／貼上圖片／貼上文字，自動找出載具條碼或號碼
2. **開啟歸戶頁**：依公司開啟對應的歸戶頁面，並把號碼複製到剪貼簿
3. **自動填入**（選用）：安裝使用者腳本後，歸戶頁的欄位會自動填好，只剩圖形驗證碼要自己輸入

純前端、無後端；所有資料只存在瀏覽器 localStorage。

## 支援的公司

| 公司 | 載具類別 | 號碼結構 | 歸戶頁 | 圖形驗證碼 |
|---|---|---|---|---|
| 台灣電力 | ED0003 | 年期別 5 + 流水號 10 + 檢核碼 15 = 30 碼 | service.taipower.com.tw/einvoice/post1 | 有 |
| 台灣自來水 | EE0001 | 5 + 10 + 6 = 21 碼 | www.water.gov.tw/einvoice/CloudInvoice/Transfer | 有 |
| 欣泰石油氣 | — | 5 + 10 + 9 = 24 碼，另需用戶號碼、發票月份 | eci.tradevan.com.tw（關貿） | 有 |
| 欣桃天然氣 | ED0015 | 載具流水號＋載具檢核碼，另需用戶號碼、姓名、發票號碼 | www.shintaogas.com.tw/HOME/invoice/carrier | 無 |

表單欄位於 2026-11 實際查驗。各公司網站改版時自動填入可能失效，仍可用複製按鈕貼上。

稅費（房屋稅、地價稅、牌照稅、燃料費）不開立統一發票，沒有載具可歸戶。

## 檔案

```
index.html                    主程式（PWA）
assets/providers.js           各公司號碼格式與解析（app 與測試共用）
assets/app.js                 擷取、條碼／OCR 辨識、清單、開啟歸戶頁
assets/style.css
sw.js, manifest.webmanifest   離線快取、Android 分享目標
userscript/einvoice-autofill.user.js   自動填入腳本（Tampermonkey / Violentmonkey / iOS Userscripts）
tests/parse.test.mjs          解析單元測試：node --test tests/parse.test.mjs
tests/browser.html            瀏覽器整合測試（需本機伺服器）
tests/frames.html             手機寬度淺色／深色版面檢查
```

外部函式庫（執行時從 jsDelivr 載入，版本固定）：

- [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.6：條碼辨識（Code39/128、QR 等，可一次辨識多個）
- [tesseract.js](https://github.com/naptha/tesseract.js) 6.0.1：找不到條碼時的文字辨識（只在需要時載入）

## 本機執行

擷取畫面與相機需要 https 或 localhost：

```sh
python -m http.server 8765 --bind 127.0.0.1
# 開啟 http://127.0.0.1:8765/
```

## 版本號

- 版本資訊在 [version.js](version.js)，顯示在標題旁與頁尾，並作為 service worker 的快取名稱。
- `.git/hooks/pre-commit` 會在每次 commit 執行 `node scripts/bump-version.mjs`：版本號沒手動改就自動 +1 修訂號，並把建置時間更新為 commit 時間。要升次版號／主版號時，直接改 `version.js` 的 `version` 再 commit 即可。
- hook 不會跟著 repo 走，換電腦 clone 後要重新建立：
  ```sh
  printf '#!/bin/sh\nnode scripts/bump-version.mjs && git add version.js\n' > .git/hooks/pre-commit
  ```
- 頁面開啟時與切回分頁時，會略過快取直接讀伺服器上的 `version.js`；GitHub Pages 部署完成後，畫面上方會出現「已發布新版本」提示。

## 自動填入的運作方式

工具開啟歸戶頁時會在網址後面加上 `#einv=<base64url JSON>`（hash 不會傳到對方伺服器）。使用者腳本在該頁讀取後存入腳本儲存空間、清掉 hash，再依頁面填入欄位；欣泰（關貿）需要先選公司再跳頁，所以資料會保留到第二頁填完為止，15 分鐘後失效。腳本不會替你送出表單。
