# SoftPlace 技術決策

本文件使用簡化 ADR（Architecture Decision Record）。已接受的決策保留當時原因；未來方向改變時新增 ADR，不覆寫舊決策。

## ADR-001：由 Supabase 保存敏感對話

- 日期：2026-06-28
- 狀態：Accepted
- 背景：產品需要重開 App、server 重啟與跨分頁後仍能延續對話，同時讓使用者可刪除資料。
- 決定：安放與 Ava 對話以 Supabase Postgres 為資料來源，不依賴模型供應商保存會話。
- 影響：資料生命週期與刪除權由 SoftPlace 控制；server 必須承擔 RLS、service-role、migration 與隱私維運責任。

## ADR-002：OpenAI Responses 預設 `store:false`

- 日期：2026-06-28
- 狀態：Accepted
- 背景：情緒陪伴內容高度私密，產品不需要 OpenAI Conversations 保存狀態。
- 決定：所有 Responses request 預設 `store:false`，由 Supabase 提供歷史；使用 hashed `safety_identifier`。
- 影響：OpenAI Platform Logs 預設不提供完整可展開 Response；除錯時只能以虛構內容短暫開啟 store/debug，完成後關閉。

## ADR-003：單一時間線與最近 20 則上下文

- 日期：2026-07-09
- 狀態：Accepted
- 背景：MVP 需要連續感，但不應每次把全部歷史塞給模型，也尚未證明摘要或 RAG 的必要性。
- 決定：每位使用者維持一條安放時間線；UI 可分頁載入完整歷史，OpenAI 每次只收到最近 20 則與已確認記憶。
- 影響：成本與上下文大小可控；很長以前的具體細節可能無法被回想。摘要、embedding 與 RAG 延後到實測出現明確需求。

## ADR-004：輕量與深度是注意力深度，不是溫度高低

- 日期：2026-07-19
- 狀態：Accepted
- 背景：共用長 prompt 讓兩種模式互相污染，切回輕量後仍容易延續深度篇幅。
- 決定：保留共同的自然、溫柔人格，但每次只注入實際模式規則。輕量預設 `gpt-4o-mini`；深度預設 `gpt-5.4-mini`。
- 影響：模式與模型、prompt、額度一同路由；差異是強提示而非硬性句數保證，仍需用真實對話持續校準。

## ADR-005：圖片共用深度額度

- 日期：2026-07-19
- 狀態：Accepted
- 背景：獨立圖片額度增加資料表、API 與 UI 複雜度，且圖片本質上已使用深度模型。
- 決定：取消 `image_messages_used`。Plus／Pro 圖片成功只扣一次深度額度；Free 不開放圖片；資料庫只保留 `image_present`。
- 影響：用量顯示與扣款較直覺；圖片沒有獨立統計。原圖仍不永久保存。

## ADR-006：使用 Passwordless Email OTP

- 日期：2026-07-19
- 狀態：Accepted
- 背景：少量封測需要比 Email／密碼更單純的第一次操作，Expo Go 又不適合先做複雜 OAuth redirect。
- 決定：Supabase Auth 搭配 Resend custom SMTP，寄送六位數 Email OTP；App 提供 60 秒重寄 cooldown 與 single-flight request lock。
- 影響：不需管理密碼；仍依賴 Email 可達性、SMTP reputation 與 Supabase Auth rate limit。第三方登入延後。

## ADR-007：深度額度採原子 reservation

- 日期：2026-07-19
- 狀態：Accepted
- 背景：read-modify-write 在並行深度請求下可能超用或少扣，provider 失敗也不能收費。
- 決定：OpenAI 前建立有 TTL 的 reservation；成功由 `complete_chat_success` 同一交易保存 user／assistant 並正式扣款，失敗則 release。
- 影響：一致性提高，但加入 RPC、reservation cleanup 與 migration 維護成本。文字可在 reserve 失敗時回退 light，圖片不可。

## ADR-008：Ava 使用非同步 Worker

- 日期：2026-07-22
- 狀態：Accepted
- 背景：Ava 必須有非立即回覆與主動訊息，不能讓 Mobile request 等待數分鐘，也不能依賴 App 一直開著。
- 決定：使用 Supabase `companion_jobs`、原子 enqueue／claim／complete RPC、每分鐘 Cron 與 Zeabur Worker endpoint。
- 影響：App 送訊息後收到 `202`，再以輪詢取得結果；需處理 lease、重試、每日額度與 Cron 維運。Push 尚未完成。

## ADR-009：Ava 生活固定以台北時間運行

- 日期：2026-07-22
- 狀態：Accepted
- 背景：生活節奏需要可預測、可測試，且目前產品主要面向台灣。
- 決定：Ava 以 `Asia/Taipei` 選擇每日生活與分時活動；同一天所有使用者共享同一生活日。OpenAI 只收到收到訊息時與目前的短情境。
- 影響：重啟與部署不改變當日生活，token 增量有限；不同時區使用者仍面對台北作息，完整生活也不是每人獨立生成。

## ADR-010：Ava 是同一 App 的第二條 beta 實驗線

- 日期：2026-07-22
- 狀態：Accepted
- 背景：非即時朋友、文字寵物與多角色都有潛力，但立即拆成新 App 會重複 Auth、部署、資料與設計成本，也會模糊尚未驗證的需求。
- 決定：Ava 先放在 SoftPlace 內，與安放使用不同資料表、API、prompt 與互動節奏；安放仍是產品核心。
- 影響：可以共用帳號與基礎設施並快速比較兩種陪伴；導航與設定複雜度增加。是否拆分 App、加入寵物或擴充角色，待實測後另立 ADR。

## ADR-011：Ava 句子泡泡只做顯示層切分

- 日期：2026-07-22
- 狀態：Accepted
- 背景：單一完整泡泡容易像小文章，但將模型輸出改成多訊息格式會影響 API、資料庫、未讀與推播。
- 決定：資料庫仍保存一筆完整 assistant 文字；Mobile 依中文句末標點與空白行切成最多 3 個視覺泡泡，同時顯示。
- 影響：不改資料契約即可改善閱讀節奏，歷史與新訊息一致；它不模擬逐則送達，切句仍可能需要依實機案例調整。
