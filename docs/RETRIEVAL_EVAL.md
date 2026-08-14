# Retrieval 離線評估

這套工具只用於評估「安放是否能從較舊對話找回適當片段」。它不連接正式聊天 prompt、不讀取 Supabase，也不代表 production RAG 已啟用。

## 資料集

`apps/server/src/evals/retrieval/dataset.v2.ts` 包含 8 位虛構使用者、64 個 logical events 與 40 個繁中 query；v1 保留供舊基線追溯。每個 event 都有固定 `user → assistant → user` 合成來源，並產生三種 chunk：

- `event_summary`：事件摘要。
- `user_only`：只保留兩則 user 訊息。
- `dialogue_window`：保留完整三則訊息與角色標記。

每個 query 對同一使用者的 logical chunk 標記：

- `mustRetrieve`：缺少就會失去重要脈絡。
- `acceptable`：找到合理，但不是必要。
- `forbidden`：即使語意相似也不該帶回。
- 未列入三組的同使用者 chunk，在計分時視為 `irrelevant`。

所有資料必須保持 `source: synthetic`。敏感或危機 chunk 只能作為 `forbidden`，不能成為正向標籤。第一版有 8 題完全沒有 must／acceptable，用來測試系統能否在沒有適當舊脈絡時 abstain。

## 執行

需求：`apps/server/.env` 內有 `OPENAI_API_KEY`。一般 tests、typecheck 與 server runtime 不會執行 embedding eval。

```bash
npm run eval:retrieval
```

常用選項：

```bash
npm run eval:retrieval -- \
  --specs=text-embedding-3-small:512,text-embedding-3-small:1536,text-embedding-3-large:3072 \
  --chunk-strategies=event_summary,user_only,dialogue_window \
  --top-k=1,3,5 \
  --thresholds=0.50,0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90 \
  --batch-size=64
```

- `--ignore-cache`：忽略既有 embedding cache 並重新產生。
- `--output-dir=/absolute/path`：改變 artifact 輸出根目錄。
- `--specs=model:dimensions,...` 是 canonical 模型介面；舊 `--models`／`--dimensions` 仍可使用，但不能和 `--specs` 混用。

快取與報告都寫入 gitignored 的 `artifacts/retrieval-eval/`：

```text
artifacts/retrieval-eval/cache/<model>-<dimensions>.json
artifacts/retrieval-eval/reports/<timestamp>/report.json
artifacts/retrieval-eval/reports/<timestamp>/report.md
```

## 指標

- **Must hit rate @ K**：具有 must 標籤的題目中，Top K 至少命中一個 must 的比例。
- **Must recall @ K**：所有 must chunk 中實際進入 Top K 的比例。
- **Forbidden hit rate @ K**：Top K 至少出現一個 forbidden 的題目比例，越低越好。
- **Sensitive/crisis hit rate @ K**：Top K 至少帶回一個敏感或危機 chunk 的題目比例。
- **Irrelevant hit rate @ K**：所有回傳結果中，未被人工標註的 irrelevant chunk 比例。
- **Abstention accuracy**：no-recall 題目在 threshold 後完全不回傳結果的比例。

報告同時比較三種 chunk 與兩種 query 組法，也列出各 corpus 的平均字數、raw vector bytes 與 serialized vector bytes。Phase 0 recommendation 固定從 small 512＋最近 user context 中，以零 sensitive/crisis、零 forbidden 為前提挑選 Recall@3 最佳的 chunk；`candidateThreshold` 仍只是診斷值，不能直接當成 production threshold。

## Phase 0 決策（2026-08-13）

- 首選候選模型：`text-embedding-3-small`，512 維。
- Query：目前訊息加最近兩則 user context。
- Chunk winner：`dialogue_window`。
- 診斷 threshold：`0.60`；Recall@3 `59.4%`、Forbidden `0%`、Sensitive/Crisis `0%`、Irrelevant `4.8%`、Abstention `100%`。
- 相同 64 chunks 的 raw vector 大小為 128 KiB；1536 維為 384 KiB，符合約三分之一的預期。

這是 synthetic Phase 0 基線，不是 production threshold。下一階段需在 Shadow mode 記錄匿名化命中、分數與延遲後再校準。

## Phase 1 Shadow 基線（2026-08-14）

- 完成 `53` 個 runs、人工完整檢閱 `25` 個 runs／`125` 個 Top 5 candidates，worker error 為 `0`。
- 人工標籤為 must `19`、acceptable `37`、irrelevant `69`、forbidden `0`。
- Threshold `0.60`：selected precision `82.6%`、query useful-hit `52.0%`、forbidden rate `0%`，共選中 `23` 個 candidates。
- Queue latency P50／P95 為 `35,325／57,571 ms`；search latency P50／P95 為 `137／203 ms`。
- `0.60` 保留為後續候選門檻，不是 production 決策；`0.65` precision 僅升至 `85.7%`，useful-hit 降至 `44.0%`。
- 本批沒有任何人工 forbidden 樣本，因此只能說「未觀察到 forbidden retrieval」，不能推論敏感／危機風險已充分驗證。

完整 v1 JSON／Markdown 報告保留在 gitignored `artifacts/retrieval-shadow/2026-08-14T08-17-10-107Z/`，不進版控。Phase 1.5 起，搜尋會排除與實際 recent user context 時間範圍重疊的 chunks；v1 基線不重算、不覆寫，也不和修正後的新 runs 直接混合比較。

## 修改資料集

新增或修改案例後先執行：

```bash
npm test
npm run typecheck
```

結構測試會檢查使用者／chunk／case ID、跨使用者引用、標籤重疊、no-recall 題數，以及敏感 chunk 是否誤標成正向結果。模型品質目前只產生人工報告，不作為 CI 硬門檻。
