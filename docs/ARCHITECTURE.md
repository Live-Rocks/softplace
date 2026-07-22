# SoftPlace 系統架構

## 架構概覽

SoftPlace 是 npm workspaces monorepo。Mobile 只持有公開 Supabase 設定與 API URL；所有 OpenAI、service-role、Worker 與資料寫入權限都留在 server。

| 元件 | 責任 |
| --- | --- |
| `apps/mobile` | Expo React Native UI、Passwordless Auth session、呼叫 API、畫面輪詢 |
| `apps/server` | Auth 驗證、業務規則、OpenAI、額度、危機攔截、Ava Worker |
| `packages/shared` | Mobile／Server 共用 request、response 與 domain 型別 |
| Supabase Auth | Email OTP、access token、使用者身分 |
| Supabase Postgres | 對話、記憶、額度、Ava 狀態與 job；RLS／RPC |
| Supabase Vault／Cron | 保存 Worker secret、每分鐘觸發 Ava tick |
| OpenAI | Responses API 生成安放與 Ava 回覆 |
| Resend SMTP | 由 Supabase Auth 寄送 OTP Email |
| Zeabur | 從 GitHub `main` 自動 build／deploy Express API |

## Passwordless Auth

```mermaid
sequenceDiagram
    participant U as 使用者
    participant M as Expo Mobile
    participant A as Supabase Auth
    participant R as Resend SMTP
    participant S as Express API

    U->>M: 輸入 Email、確認已滿 18 歲
    M->>A: signInWithOtp
    A->>R: 寄送六位數 OTP
    R-->>U: Email
    U->>M: 輸入 OTP
    M->>A: verifyOtp
    A-->>M: session / access token
    M->>S: Authorization: Bearer token
    S->>A: 驗證 token
    A-->>S: auth user
```

App 使用同步 request lock、disabled 狀態與 60 秒重寄倒數降低重複寄送。新登入使用者第一次呼叫 API 時由 server 建立 `profiles`，方案預設為 `free`。

## 安放即時聊天

```mermaid
sequenceDiagram
    participant M as Mobile
    participant S as Express API
    participant DB as Supabase
    participant O as OpenAI Responses

    M->>S: POST /api/chat
    S->>S: 驗證內容、檢查危機
    alt 危機語句
        S->>DB: 保存危機 exchange
        S-->>M: 本機危機回覆與真人資源
    else 一般聊天
        S->>DB: 原子 rate limit
        S->>DB: 讀取用量、決定 light/deep
        opt 需要深度額度
            S->>DB: reserve_deep_usage
        end
        S->>DB: 最近 20 則訊息＋已確認記憶
        S->>O: instructions、history、user input、可選圖片
        O-->>S: assistant output
        S->>DB: complete_chat_success 原子保存與扣款
        S-->>M: ChatResponse
    end
```

文字深度額度不足時回退輕量；圖片固定使用深度模型，Free 不開放，深度額度不足時拒絕。OpenAI 或完成交易失敗會釋放 reservation，不保存半套對話，也不扣正式用量。

## 深度額度 reservation

```mermaid
flowchart LR
    A["請求 deep 或圖片"] --> B["reserve_deep_usage"]
    B -->|"成功"| C["呼叫 OpenAI"]
    B -->|"文字失敗"| D["回退 light"]
    B -->|"圖片失敗"| E["402"]
    C -->|"成功"| F["complete_chat_success"]
    C -->|"timeout / provider error"| G["release_deep_usage"]
    F --> H["同一交易保存兩則訊息並扣 1"]
```

`deep_usage_reservations` 避免並行請求超用；TTL 預設 120 秒。一般聊天限制預設每分鐘 12 則、每小時 120 則。危機模式在限流之前處理。

## Ava 非同步 Worker

```mermaid
sequenceDiagram
    participant M as Mobile
    participant S as Express API
    participant DB as Supabase
    participant C as Supabase Cron
    participant W as Ava Worker
    participant O as OpenAI

    M->>S: POST /api/companions/ava/messages
    S->>S: 依台北生活作息計算 due_at
    S->>DB: enqueue_companion_message
    S-->>M: 202 Accepted
    C->>W: 每分鐘 POST /internal/companion/tick
    W->>DB: 排程主動訊息、原子 claim 1 個到期 job
    W->>DB: 讀取關係、記憶、訊息與每日狀態
    W->>O: 生活情境＋對話 input
    O-->>W: Ava 回覆
    W->>DB: complete_companion_job
    M->>S: 每 12 秒輪詢 Ava messages
    S-->>M: 新訊息與 state
```

Ava 生活以 `Asia/Taipei` 計算，同一日期對所有使用者選到相同生活日。完整分時表留在 server；OpenAI 只收到「訊息傳來時」與「目前」的簡短情境。Worker 每次最多 claim 1 個 job，lease 與 RPC 避免同一 job 被重複完成。

Server 已有 Expo push sender、push token API 與資料表，但 Mobile 尚未安裝並註冊 Android push token，因此目前由 Ava 頁面每 12 秒、App 其他分頁每 30 秒輪詢。

## API

除 `/health` 與 Worker endpoint 外，所有 `/api` route 都需要 Supabase Bearer token。

| Method | Route | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 服務健康檢查 |
| `POST` | `/api/chat` | 安放文字／圖片聊天 |
| `GET` | `/api/conversations/current/messages` | 單一時間線分頁 |
| `DELETE` | `/api/conversations/current` | 清除目前時間線 |
| `GET` | `/api/conversations` | 對話摘要相容介面 |
| `GET/POST` | `/api/memories` | 安放記憶列表／新增 |
| `PATCH/DELETE` | `/api/memories/:id` | 安放記憶修改／刪除 |
| `GET` | `/api/me/usage` | 方案與深度用量 |
| `GET` | `/api/companions/ava` | Ava 狀態 |
| `GET/POST` | `/api/companions/ava/messages` | Ava 時間線／送訊息 |
| `PATCH` | `/api/companions/ava/preferences` | 主動等級與安靜時間 |
| `POST` | `/api/companions/ava/read` | 標記已讀 |
| `GET/PATCH/DELETE` | `/api/companions/ava/memories...` | Ava 記憶管理 |
| `DELETE` | `/api/companions/ava/relationship` | 清除 Ava 關係資料 |
| `POST/DELETE` | `/api/push-tokens` | Push token 註冊／停用 |
| `POST` | `/internal/companion/tick` | Vault secret 保護的 Worker |

## 資料表與所有權

安放核心：`profiles`、`conversations`、`messages`、`memories`、`usage_limits`。

成本保護：`chat_rate_limit_windows`、`deep_usage_reservations`。

Ava：`companion_definitions`、`companion_daily_states`、`user_companions`、`companion_messages`、`companion_memories`、`companion_jobs`、`companion_daily_usage`、`push_tokens`。

一般使用者可透過 RLS 讀取自己的核心資料；實際 App 寫入主要由 server 使用 service-role 完成。成本保護與 Ava 資料表不開放 anon／authenticated 直接存取，只允許 service-role 與受控 RPC。

## 模型與上下文

| 路徑 | 預設模型 | 上下文 |
| --- | --- | --- |
| 安放 light | `gpt-4o-mini` | 最近 20 則＋確認記憶＋light prompt |
| 安放 deep | `gpt-5.4-mini` | 最近 20 則＋確認記憶＋deep prompt |
| 安放圖片 | deep model | 同上，加單張壓縮圖片 |
| Ava | `gpt-5.4-mini` | Worker 取得的近期訊息、關係、低敏感記憶與生活情境 |

模型名稱均由 server env 控制。`AI_PROVIDER=local` 只供明確的本機開發回覆，不會在 OpenAI 設定缺失時靜默回退。

## 隱私設計

- Mobile 不持有 `OPENAI_API_KEY`、service-role、Worker secret 或 SMTP password。
- 安放與 Ava 對話由 Supabase 保存，不使用 OpenAI Conversations 作為資料來源。
- Responses API 預設 `store:false`，並使用 hashed `safety_identifier`。
- 圖片壓縮後隨 request 傳送，不永久保存原圖；資料庫只保存 `image_present`。
- Runtime error logs 不應包含聊天全文、圖片 base64、push token 或 credential。
- `OPENAI_DEBUG_IO` 會輸出文字 input/output，只能以虛構內容短暫除錯，完成後立即關閉。
