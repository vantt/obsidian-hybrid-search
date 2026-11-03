---
title: 'v09-vi-pack-m1'
description: 'Gói ohs-lang-vi M1: normalize, fold, syllable, bảng dữ liệu, test bảng/thuộc tính/hiệu năng'
status: completed
priority: P1
effort: '2,5d'
tags: [vi-pack, v09]
created: 2026-11-02
---

# V09: ohs-lang-vi M1

## Phạm vi

Package `vantt/packages/ohs-lang-vi/` (TS thuần, không phụ thuộc runtime, vitest + fast-check là devDependency). Chỉ M1 (PRD 10.3, 10.5 bước 1):

- `normalize.ts`: NFC, chữ thường, đặt dấu `modern|classic`, sửa Ð→Đ, dấu rời, NBSP. Idempotent.
- `fold.ts`: bỏ dấu, đ→d, tuỳ chọn `foldIY`. Idempotent.
- `syllable.ts`: tách âm tiết (phụ âm đầu, âm đệm, âm chính, âm cuối, thanh), nhận diện âm tiết Việt.
- `data.ts`: bảng nguyên âm × thanh, vần đặt dấu, i/y, Telex, VNI.
- Test bảng (>= 60 cặp đặt dấu), test thuộc tính fast-check, test hiệu năng.

## Ngoài phạm vi

`views.ts` (`project`), `query.ts` (`analyzeQuery`), restore, telex.ts... thuộc V13+.

## Tiêu chí xong (phase-04)

- [x] `npm test` trong package xanh.
- [x] Phép chiếu (normalize + fold) trên 1 MB văn bản < 200 ms (`project` thật là V13; đo ghép M1).
- [x] Hàm M1 đủ nhanh để `analyzeQuery` 12 âm tiết < 20 ms khả thi (test hiệu năng cho `syllable`).
- [x] Bất biến token (PRD 10.2) giữ, có test fast-check.
- [x] Hàm thuần, không sửa văn bản gốc.

## Kết quả (2026-11-02)

- `npm test` trong package: 6 file, 334 test xanh (bảng, thuộc tính fast-check, hiệu năng). `tsc --noEmit` sạch.
- Hiệu năng trên 1 MB: normalize 48 ms (nguội), 42 ms (NFD); fold 17 ms; fold(normalize) 55 ms; trường hợp xấu nhất (toàn từ khác nhau, cache nguội) 144 ms. 10 KB: 0,6 ms.
- 12 âm tiết: normalize + fold + parse + tra bảng không dấu, kể cả dựng bảng lần đầu: 1,8 ms (nguội), 0,004 ms (nóng). `analyzeQuery` 20 ms với từ vựng 50.000 term thuộc V13.
- Quyết định khi soạn: `tonePlacement` mặc định `modern` (hoà, khoẻ, thuỷ); `IY_ONSETS` = k l m t s h v d qu (bỏ `ng`: không có `ngi`/`ngy`); `fold` cũng xử lý Ð/ð và NBSP để `fold(normalize(x)) = lower(fold(x))`; bất biến token kiểm với tokenizer unicode61 (chữ, số, Co, dấu tổ hợp là ký tự token).
- Chưa kiểm: `npm run build` (lệnh bị hook chặn trong phiên này).
