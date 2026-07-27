# SoftPlace 專案狀態

最後核對：`2026-07-22`

基準 commit：`634d268`

目前階段：本人使用／少量封測前的 staging

本文件是目前完成度與 roadmap 的唯一來源。README 僅提供摘要；程式存在不等於已在實機或 staging 驗證。

## 版本識別

| 名稱 | 目前值 | 說明 |
| --- | --- | --- |
| Feature milestone | `v0.3.3` | 產品／功能溝通版本 |
| Expo manifest | `0.3.0` | `apps/mobile/app.json` |
| Legacy npm package | `0.2.0` | 歷史 workspace package metadata |

三者目前刻意不統一，本輪不調整版本號。

## 狀態標籤

- **程式已驗證**：已有自動測試、typecheck 或 build 證據。
- **使用者實機確認**：已由目前測試帳號在 Android／staging 走過。
- **已實作待驗證**：程式與資料結構存在，但完整實機流程尚未確認。
- **未完成**：尚缺必要實作或部署。

## 已完成

### 核心與部署

- **使用者實機確認**：Supabase Passwordless Email OTP 註冊、登入、重寄與 session。
- **使用者實機確認**：Zeabur staging API 可從手機連線，公開健康端點為 `https://softplace.zeabur.app/health`。
- **程式已驗證**：Node 24／npm 11 monorepo build scripts 與 Zeabur Git push 自動部署骨架。
- **使用者實機確認**：migration `001～009` 已套用；既有聊天、記憶與用量在 server 重啟後保留。
- **使用者實機確認**：Resend domain、Supabase custom SMTP 與六位數 OTP Email。

### 安放

- **使用者實機確認**：單一連續聊天時間線、歷史分頁、重開 App 恢復與刪除對話。
- **使用者實機確認**：輕量／深度模型路由與模式差異。
- **使用者實機確認**：單張圖片、圖片強制深度、送出後立即清除預覽。
- **使用者實機確認**：記憶新增、修改、刪除、重開後載入與聊天注入；內容 1～300 字。
- **程式已驗證**：最近 20 則上下文、確認記憶、圖片不落庫、provider 標示。
- **程式已驗證**：每分鐘／每小時限流、深度 reservation、成功才扣額度、timeout 與失敗釋放。
- **程式已驗證**：危機語句在一般限流與 OpenAI 前攔截，回覆台灣真人資源。
- **程式已驗證**：新安放訊息由對話內流水號排序；避免 user／assistant 同時間戳在重開 App 後倒置。migration `010` 尚待 staging 套用。

### Ava beta

- **使用者實機確認**：Ava beta allowlist、非同步送訊息、延遲回覆、App 內輪詢收訊。
- **使用者實機確認**：Supabase Vault secret、每分鐘 Cron 與 Worker endpoint 回傳 `200`。
- **程式已驗證**：台北分時生活、週間／週末生活日、睡眠後回覆、近期聊天快速回覆。
- **程式已驗證**：主動訊息的安靜時間、可用狀態、未讀與 pending job 限制。
- **程式已驗證**：Ava 關係階段、低敏感記憶、每日生成額度與資料刪除。
- **已實作待驗證**：Ava 全域事件保存為 2～3 天的 run 與每日 phase；每天生成一份全域細節後低調注入回覆，需在 staging 套用 `009` 後確認跨日流程。
- **程式已驗證**：Ava assistant 回覆依句子顯示為最多 3 個泡泡，資料庫仍保存完整原文。
- **已實作待驗證**：主動訊息在長時間真實使用下的頻率、內容品質與跨日表現。

## 已知限制

- **未完成**：Android 遠端 push。Server sender、API 與資料表存在，但 Mobile 尚未安裝通知套件、註冊 token、設定 FCM V1 並產出 Preview APK。
- **未完成**：Expo Go 仍依賴 Metro；使用 LAN 模式時手機與 Mac 需在相同網路。Zeabur 只讓 API 離開本機，沒有把 Expo bundle 變成獨立 App。
- **已實作待驗證**：部分 Android 裝置的鍵盤／輸入列仍可能有少量偏移，目前採 Expo Go 相容的避讓方式。
- **已知架構限制**：Ava 主動訊息目前不帶最近真實對話，只使用主動訊息指令與當日生活背景，容易顯得脫離脈絡。
- **已知競態**：若使用者在 reply job 已被 lease、Worker 已取得 context 後再補傳訊息，message id 可能被加進 job payload，但該次生成未必讀到新訊息。
- **實驗中**：Ava 的延遲、主動性、句子泡泡與「像真人」程度仍需長期觀察；不能只以單次回覆判定。
- **實驗中**：安放 prompt 與模型語氣仍會隨上下文產生變化，輕量／深度規則不是程式硬性句數限制。
- **維運限制**：OpenAI debug logs 預設關閉；短暫開啟會增加私密內容暴露風險。

## 近期優先順序

1. 長時間實測 Ava 延遲回覆、主動訊息、未讀與跨日生活脈絡。
2. 修正 leased reply job 補傳訊息競態，定義 Worker context snapshot 邊界。
3. 讓 Ava 主動訊息安全地帶入有限近期脈絡，避免突然脫離對話。
4. 建立 Preview APK 與 Android push，移除 Metro／同網路依賴。
5. 在少量封測前補齊監控、錯誤可讀性、資料刪除與隱私說明。

## 延後項目

- 正式付款、訂閱與方案升降級。
- Google／Apple 等第三方登入。
- 公開上架、未成年人流程與多地區危機資源。
- 自動摘要、embedding、pgvector／RAG。
- 語音輸入、語音回覆與即時通話。
- 文字模擬寵物。
- 多角色、角色市場或拆分成另一個 App。
- 公開社群、配對與成人內容。

## 更新規則

- 功能完成但尚未實測時，只能標為「已實作待驗證」。
- 使用者完成 staging／實機流程後，才改為「使用者實機確認」。
- 新限制與已知競態在同一個修正 commit 更新。
- roadmap 的新增、刪除或排序只修改本文件，其他文件以連結指向此處。
