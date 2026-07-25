# SoftPlace 維運手冊

## 環境與秘密

不得把 `.env`、API key、service-role、SMTP password、Worker secret、完整測試 UUID 或真實聊天 payload 寫入 Git、issue 或文件。

安全等級：

- **公開**：可進 Mobile bundle 或公開文件。
- **Server 設定**：不一定是 credential，但只由 server 控制。
- **秘密**：只能存在本機 server `.env`、Zeabur env、Supabase Vault 或供應商後台。
- **高敏感除錯**：會暴露聊天內容，預設必須關閉。

### Mobile `apps/mobile/.env`

| 變數 | 用途 | 等級 |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Express API base URL；staging 使用 Zeabur HTTPS，本機可用 Mac LAN IP | 公開 |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | 公開 |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key；受 RLS 保護，不是 service-role | 公開 |

### Server `apps/server/.env`

| 變數 | 用途／預設 | 等級 |
| --- | --- | --- |
| `PORT` | Express port，本機預設 `8787`；Zeabur 注入 | Server 設定 |
| `APP_ORIGIN` | CORS origin，本機常用 `http://localhost:8081`；`*` 表示允許任意 origin | Server 設定 |
| `SUPABASE_URL` | Supabase project URL | Server 設定 |
| `SUPABASE_SERVICE_ROLE_KEY` | Auth 驗證與資料庫 privileged access | 秘密 |
| `AI_PROVIDER` | `openai` 或明確本機測試用 `local` | Server 設定 |
| `OPENAI_API_KEY` | OpenAI Responses API | 秘密 |
| `OPENAI_DEEP_MODEL` | 安放深度模型，預設 `gpt-5.4-mini` | Server 設定 |
| `OPENAI_LIGHT_MODEL` | 安放輕量模型，預設 `gpt-4o-mini` | Server 設定 |
| `OPENAI_LIFE_MODEL` | Ava 模型，預設 `gpt-5.4-mini` | Server 設定 |
| `OPENAI_STORE_RESPONSES` | 是否讓 OpenAI 保存 Response，預設 `false` | 隱私設定 |
| `OPENAI_DEBUG_IO` | 印出完整文字 instructions/input/output，預設 `false` | 高敏感除錯 |
| `OPENAI_TIMEOUT_MS` | OpenAI timeout，預設 `60000` | Server 設定 |
| `OPENAI_MAX_RETRIES` | SDK retry 次數，預設 `0` | Server 設定 |
| `CHAT_RATE_LIMIT_PER_MINUTE` | 每帳號分鐘限制，預設 `12` | Server 設定 |
| `CHAT_RATE_LIMIT_PER_HOUR` | 每帳號小時限制，預設 `120` | Server 設定 |
| `DEEP_RESERVATION_TTL_SECONDS` | 深度 reservation TTL，預設 `120` | Server 設定 |
| `AVA_FEATURE_ENABLED` | Ava 全域開關，預設 `false` | Server 設定 |
| `AVA_BETA_USER_IDS` | 逗號分隔 allowlist；空值代表所有已登入帳號 | 秘密／個資 |
| `AVA_DAILY_LIMIT` | 每帳號 Ava 每日生成上限，預設 `30` | Server 設定 |
| `COMPANION_WORKER_SECRET` | 保護 `/internal/companion/tick` | 秘密 |

`OPENAI_STORE_RESPONSES=true` 與 `OPENAI_DEBUG_IO=true` 只可用虛構訊息短暫除錯；確認後立即改回 `false` 並重啟 server。

## Migration

新環境依序在 Supabase SQL Editor 執行：

1. `001_softplace_mvp.sql`：核心 enum、profile、聊天、記憶、用量、RLS。
2. `002_single_conversation.sql`：每位使用者單一主要時間線。
3. `003_remove_image_usage.sql`：移除獨立圖片用量。
4. `004_expand_memory_content.sql`：手動記憶改為 trim 後 1～300 字。
5. `005_production_hardening.sql`：Free 預設、rate limit、深度 reservation 與原子完成交易。
6. `006_fix_deep_usage_ambiguity.sql`：修正完成深度交易的 SQL 欄位歧義。
7. `007_ava_async_companion.sql`：Ava 關係、訊息、記憶、job、每日用量與 push token。
8. `008_ava_global_event_foundation.sql`：Ava 全域 2～3 天事件 run 與每日 phase 骨架；尚未改變 prompt。
9. `009_ava_event_daily_details.sql`：Ava 每日全域事件細節、原子 lease 與 30 分鐘失敗重試。

已執行的 migration 不回頭改寫；修正以新編號追加。執行前先讀 SQL，執行後保存結果並跑對應 smoke test。

## 本機啟動

首次或 dependency 不完整：

```bash
cd "/Users/a1/Documents/Codex/2026-06-27/ji3"
nvm use system
npm ci
```

Server：

```bash
npm run dev:server
curl http://localhost:8787/health
```

Expo Go：

```bash
cd apps/mobile
npm run start -- --host lan --clear
```

若 Mobile 使用 Zeabur API，只需 Expo Metro 在本機；若使用本機 API，手機與 Mac 必須同網路，且 mobile env 使用 Mac 當下的 LAN IP。

## Zeabur 部署

GitHub private repository 的 `main` 已連接 Zeabur。`git push` 後 Zeabur 依根目錄 `zbpack.json` 執行：

```bash
npm run build:server
npm run start:server
```

Zeabur 只啟動 Express，不啟動 Expo。環境變數由 Zeabur service 保存，`PORT` 由平台提供。

部署後：

```bash
curl -i https://softplace.zeabur.app/health
```

預期 HTTP `200`，body 包含 `{"ok":true,"service":"softplace-server"}`。

## Resend、SMTP 與 OTP

- 寄件網域：`softplace.online`。
- DNS provider 保存 Resend 提供的 DKIM、SPF/MX 與可選 DMARC records。
- Resend domain 必須顯示 verified。
- Supabase Auth 使用 Custom SMTP；SMTP password 只存在 Supabase 後台。
- Email template 必須顯示 `{{ .Token }}`，讓使用者回 App 輸入六位數 OTP，而不是只提供 magic link。
- App `signInWithOtp` 可建立新帳號；重寄使用既有 Email，並有 60 秒 UI cooldown。

修改 DNS、SMTP 或 template 後，以非管理員測試信箱走一次：寄碼、收信、輸入 OTP、建立 session、重開 App 保持登入。

## Ava Worker、Vault 與 Cron

Zeabur 的 `COMPANION_WORKER_SECRET` 與 Supabase Vault 的 `companion_worker_secret` 必須完全相同。

手動健康測試：

```bash
curl -X POST "https://softplace.zeabur.app/internal/companion/tick" \
  -H "Content-Type: application/json" \
  -H "x-companion-worker-secret: <secret>" \
  -d '{}'
```

空閒時預期：

```json
{"scheduled":0,"claimed":0,"completed":0}
```

Supabase 啟用 Cron、`pg_net` 與 Vault。Cron job：

- Name：`ava-companion-tick`
- Schedule：`* * * * *`
- Method：`POST`
- URL：`https://softplace.zeabur.app/internal/companion/tick`
- Body：`{}`
- Header：`Content-Type: application/json`
- Header：`x-companion-worker-secret`，從 Vault `companion_worker_secret` 讀取
- Timeout：`90000 ms`

檢查順序：Cron run status → `net._http_response` 的 `status_code/content` → Zeabur logs → `companion_jobs` 的 `status/due_at/last_error` → `companion_daily_usage`。

## Expo Go 與未來 Preview APK

Expo Go 是開發容器，需從 Metro 下載 bundle；LAN 模式通常要求同一 Wi-Fi。Zeabur API 上線不會改變這件事。

`apps/mobile/eas.json` 已有 `development` 與 `preview` APK profile，但 Android push 尚未完成。未來 Preview APK 需安裝通知套件、建立 EAS project、設定 Firebase FCM V1、註冊 Expo push token並處理通知點擊導向 Ava。完成後才可在沒有 Metro／同網路的情況下獨立使用並接收遠端通知。

## Smoke Test

每次資料庫、Auth、部署或 AI routing 改動後至少檢查：

1. `/health` 回 `200`。
2. OTP 新寄送、驗證與既有 session。
3. 安放 light 與 deep 各一則；確認實際模式與用量。
4. 圖片一則；確認預覽立即清除、圖片不永久保存。
5. 記憶新增、修改、刪除及重開載入。
6. 清除／重開 App 後聊天歷史正常。
7. Ava user message 先 queued，Cron 到期後 completed，App 收到回覆。
8. Ava proactive、quiet hours、未讀與 daily usage。
9. Logs 不含聊天全文、base64、push token 或 secret。

## Rollback

1. 若是 server deploy 問題，先在 Zeabur 回退到上一個成功 Git deployment，或 revert 對應 commit 再 push。
2. 若是新 feature，先用 env 關閉；Ava 可設 `AVA_FEATURE_ENABLED=false`。
3. 若 Worker 異常，停用 `ava-companion-tick` Cron，避免持續重試與成本。
4. 若 OpenAI 異常，保持 retry `0`；不要以 `AI_PROVIDER=local` 冒充正式 AI 回覆。
5. Migration 原則上不回滾刪資料；以追加修復 migration 恢復相容性。
6. Rollback 後重跑 `/health` 與最小 smoke test，再調查根因。

## 常見故障

### `Network request failed`

- 確認 mobile env 的 API URL；實機不能用 `localhost` 連 Mac。
- 若使用本機 API，執行 `ipconfig getifaddr en0` 重新確認 LAN IP。
- 確認 server 正在跑、port 正確、手機與 Mac 同網路。
- VPN、防火牆、訪客 Wi-Fi 或 AP isolation 可能阻擋 LAN。
- 若使用 Zeabur，先直接開 `/health` 區分 API 與 Expo 問題。

### LAN IP 自己改變

路由器 DHCP 可能在重新連線、隔天或網路切換後分配新 IP。更新 `EXPO_PUBLIC_API_BASE_URL` 並重啟 Metro；或固定使用 Zeabur HTTPS API。

### Expo SDK 不相容

Expo Go major 必須支援專案 SDK。先確認 `apps/mobile/package.json` 的 Expo 版本與手機 Expo Go；必要時升級專案或安裝相容 client，不能只重開 Metro。

### `Cannot find module`／`node_modules` 缺檔

依賴安裝可能被中斷或 local tree 損壞。從 repo 根目錄執行：

```bash
nvm use system
npm ci
```

不要逐一手動安裝缺少的 transitive package；`npm ci` 依 lockfile 重建較可靠。

### Cron `succeeded` 但 Ava 沒回

Cron succeeded 只代表 SQL command 執行。再看 HTTP response 是否 `200`、body 的 `claimed/completed`、job 是否尚未到 `due_at`、是否 failed／leased，以及 Zeabur Worker logs。

### Ava 顯示「尚未開放」

確認 `AVA_FEATURE_ENABLED=true`，且測試帳號 UUID 位於 `AVA_BETA_USER_IDS`。變更 Zeabur env 後需等待 service 重新啟動。
