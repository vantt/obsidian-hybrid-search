---
title: 'v13b-restore-embedding-partial-accent'
description: 'Sửa restoreForEmbedding làm hỏng câu có dấu một phần (Hội An); chốt mặc định bằng eval'
status: completed
priority: P2
effort: '0,3d'
tags: [vi-pack, v13b, v22]
created: 2026-11-02
---

# V13b: `restoreForEmbedding` với câu có dấu một phần

## Phạm vi

Lỗi V22 mục 5.1 (`vantt/reviews/semantic-eval-2026-11-02.md`). PRD 10.3 (đã sửa): "câu có dấu (hơn 50% âm tiết có dấu)". Chỉ sửa `src/{query,restore}.ts`, `src/options.ts`, test, README của gói.

## Tiêu chí xong

- [x] Chứng minh nguyên nhân bằng test đỏ trước khi sửa.
- [x] Chữ gõ có dấu không bao giờ đổi; chữ không dấu chỉ phục hồi khi đủ tin cậy; tên riêng ("An") không bị đổi.
- [x] Soát ngưỡng `accentedRatio`: giữ "lớn hơn" (khớp PRD "hơn 50%").
- [x] Eval `vi` với gói, `restoreForEmbedding` tắt/bật; bật mặc định chỉ khi không hạng mục nào tụt quá 0,01 nDCG@5 và tổng tăng.

## Nguyên nhân (đã chứng minh)

"Hội An": 1/2 âm tiết có dấu, tỉ lệ 0,5 không lớn hơn 0,5 nên không phải câu có dấu; đi nhánh phục hồi. "Hội" ghim (có dấu), "An" được phục hồi thành "ăn" (vault có "ăn" nhiều hơn), `embedQuery` = "hội ăn". Test `pack.test.ts` "keeps typed words..." đỏ với `Received: "hội ăn"` trước khi sửa. Ngưỡng `>` là đúng; đúng 0,5 vẫn là câu có dấu một phần, nên lỗi nằm ở bước dựng `embedQuery`, không ở ngưỡng.

## Sửa

`restoredText` (query.ts): chữ ghim giữ nguyên; với câu có dấu một phần, chữ không dấu chỉ đổi khi vault không bao giờ viết trần chữ đó (`RestoredToken.literalDocs = 0`) và xác suất biên của dạng phục hồi >= `embedMinConfidence`. Không có chữ nào đổi thì không đặt `embedQuery`.

## Eval (nDCG@5, 363 note, e5-small, rerank tắt)

Xem README gói mục "Kết quả eval". Tổng: tắt 0,932, bật 0,954 (+0,022); không hạng mục nào tụt; `vi-names` 1,000 ở cả hai (câu "Hội An" không còn mất). Kết luận: bật mặc định (`restoreForEmbedding: true`).
