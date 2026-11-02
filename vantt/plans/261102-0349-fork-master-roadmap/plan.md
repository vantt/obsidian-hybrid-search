---
title: "Lộ trình tổng của fork vantt/obsidian-hybrid-search"
description: "Plan tổng cho agent lead: mọi việc bắt buộc V00–V25 (trừ V16) của PRD, xếp theo 6 nhóm và theo đợt chạy song song, để điều phối agent con qua /ak-plan và /ak-cook."
status: in-progress
priority: P1
effort: "~44 ngày công agent"
branch: master
tags: [infra, feature, backend, experimental]
blockedBy: []
blocks: []
created: 2026-11-02
---

# Lộ trình tổng của fork

## Overview

Plan này là đầu vào cho một goal. Agent lead đọc nó để nắm toàn bộ việc phải giao, rồi giao từng việc V-xx cho agent con. Mỗi agent con chạy `/ak-plan` để viết plan chi tiết cho đúng một việc, rồi `/ak-cook` để làm. Nguồn sự thật về yêu cầu là [`vantt/PRD.md`](../../PRD.md); plan này chỉ sắp thứ tự, chia nhóm, nêu điều kiện xong và quy tắc điều phối. Khi plan và PRD lệch nhau, PRD thắng và lead sửa plan.

## Mục tiêu phải đạt (PRD mục 2.1)

| ID | Mục tiêu | Phase |
|---|---|---|
| G1 | Có bản `vX.Y.Z-vantt.N` trong 24 giờ sau mỗi tag upstream, nếu không xung đột | 1 |
| G2 | Không có gói ngôn ngữ thì kết quả tìm giống hệt upstream cùng tag | 3, 5 |
| G3 | Có gói tiếng Việt thì tìm tiếng Việt tốt lên rõ, nhất là gõ không dấu | 4, 5 |
| G4 | Khách cài từ gói dựng sẵn cho 4 nền, không chạy `npm` | 1 |
| G5 | Mỗi bản upstream mới có báo cáo review | 6 |
| G6 | Có lệnh chính thức lấy vector và K note gần nhất (phía fork) | 2 |
| G7 | DB index đặt được ngoài vault | 2 |
| G8 | Gói `vi`: Telex/VNI, gõ sai, đồng nghĩa, viết tắt, từ ghép, alias không dấu, đoạn trích chữ gốc | 4 |
| G9 | Hợp đồng P01 chung thật: gói tiếng Đức chạy không sửa lõi | 3 |
| G10 | Chọn cấu hình nhánh nghĩa: model nhúng, `restoreForEmbedding`, reranker | 5 |
| G11 | Block anchor, tìm trong tập note, sự kiện index | 2 |

## Phases

| # | Phase | Việc | Công | Status |
|---|---|---|---|---|
| 1 | [Hạ tầng fork và theo upstream](./phase-01-fork-infrastructure.md) | V00, V01, V02, V03 | 5 | Done |
| 2 | [Bản vá lõi phục vụ dự án](./phase-02-core-patches.md) | V04–V08, V23–V25 | 7,5 | Done |
| 3 | [Điểm cắm gói ngôn ngữ](./phase-03-language-pack-api.md) | V11, V21 | 6 | Done |
| 4 | [Gói tiếng Việt `ohs-lang-vi`](./phase-04-vietnamese-pack.md) | V09, V13, V17–V20 | 16 | Done (V09, V13, V17–V20) |
| 5 | [Đo lường và cổng chất lượng](./phase-05-evaluation-quality-gates.md) | V10, V12, V15, V22 | 6,5 | In progress (V10 xong) |
| 6 | [Kiểm mỗi bản upstream mới](./phase-06-upstream-review.md) | V14, L24 | 2,5 | In progress (V14 xong, chạy lại báo cáo; L24 chờ) |

Phase là nhóm theo chủ đề, không phải thứ tự chạy. Thứ tự chạy theo việc, ở bảng dưới.

## Đợt chạy (lịch song song)

| Đợt | Bắt đầu khi | Việc chạy song song |
|---|---|---|
| Đ0 | Ngay | V00 · V09 · V10 |
| Đ1 | V00 xong | V01 |
| Đ2 | V01 xong | V02 · V04 · V05 · V06 · V07 · V11 · V23 · V24; V03 ngay sau V02 |
| Đ3 | Theo từng phụ thuộc | V08 (sau V07) · V12 (sau V10, V11) · V13 (sau V09, V10, V11) · V21 (sau V11) |
| Đ4 | Theo từng phụ thuộc | V25 (sau V08) · V14 (sau V06–V08, V12) · V17, V18, V19, V20, V22 (sau V13) |
| Đ5 | V13 xong và user gán nhãn | V15 |

Đường găng: V00 → V01 → V11 → V13 → V20 (khoảng 14 ngày). Lead ưu tiên người và lượt chạy cho các việc trên đường này.

## Quy tắc điều phối (bắt buộc với lead và mọi agent con)

1. **Một việc V-xx = một agent con = một plan con.** Plan con nằm ở `vantt/plans/<timestamp>-vNN-<slug>/` (tạo bằng `ak plan create <slug> --basedir vantt/plans`; **không** dùng thư mục mặc định `plans/` ở gốc repo vì nó nằm ngoài phần riêng của fork), trích đúng mục PRD, có điều kiện xong lấy từ phase file của plan này. Agent con kết thúc bằng khối `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
2. **Commit trên `master` không chạm file của upstream.** Chỉ được sửa `vantt/`, `.claude/skills/ohs-*`, `.github/workflows/vantt-*`. File trong `.claude/` thêm bằng `git add -f`. Đặt `HUSKY=0` trong mọi script.
3. **Mã OHS chỉ đổi qua bản vá.** Làm bản vá trên nhánh làm việc tạo từ nhánh phát hành `vantt/v0.17.2` của catchup (đã có các bản vá đứng trước trong `series.toml`), rồi xuất bằng `git format-patch` vào `vantt/patches/`, kèm spec theo mẫu PRD 9.3, probe ở `vantt/probes/`, test ở `test/vantt/` nằm trong bản vá. Spec ghi đường đã chọn (pack hay bản vá lõi) theo PRD 9.0.
4. **File dùng chung, lead giữ và ghép tuần tự:** `vantt/patches/series.toml` (thứ tự P00, P01, P02, P03, P04, P09, P05, P06, P07), `vantt/scripts/catchup.mjs` (chủ là V01; V12 chỉ thêm móc), `vantt/packages/ohs-lang-vi/src/query.ts` (V13 trước, V17–V20 lần lượt). Bản vá chạm cùng file upstream (`src/search/searcher.ts`, `src/storage/db.ts`) phải dựng lại theo thứ tự series sau khi bản đứng trước đổi.
5. **Chọn model cho agent con** theo cột "Mức" trong phase file: `rẻ` (haiku) cho việc cơ học có kiểm tra rõ, `vừa` (sonnet) cho phần lớn việc, `mạnh` (opus) cho việc thiết kế khó. Agent con bí sau hai lần thử thì hỏi `kongming`, không thử lại y nguyên.
6. **Không hạ ngưỡng, không làm yếu test để qua cổng.** Hạ baseline eval chỉ qua PR có người duyệt (PRD 11.6).
7. **Không đưa nội dung vault thật của user vào repo, CI, log hay báo cáo.**

## Điểm dừng chờ user

- Bật GitHub Actions trên fork và tắt workflow upstream (V00), tạo GitHub Release đầu tiên (V03): việc ra ngoài, lead xin user xác nhận trước lần đầu.
- V15 cần user gán nhãn khoảng 60 câu trên vault thật (2 giờ).
- Q4: ký `.node` trên macOS chỉ khi smoke test cho thấy Gatekeeper chặn; cần tài khoản Apple Developer của user.
- Hạ baseline eval, bỏ một bản vá, đổi hợp đồng P01 sau khi đã phát hành gói.

## Ngoài phạm vi

- V16: việc của repo dự án `vantt/obsidian-pkm-automation` (PRD 14.3), chỉ phụ thuộc V03, V07, V08 của plan này.
- Mọi việc L-xx ở PRD 14.2, gồm gửi issue lên upstream (L08).

## Xong khi (điều kiện cho goal)

- [ ] Mọi việc V00–V15, V17–V25 có trạng thái DONE và điều kiện "Xong khi" của chúng được kiểm bằng lệnh hoặc báo cáo ghi trong phase file.
- [ ] `node vantt/scripts/catchup.mjs --with-lang vi --json` trên tag upstream mới nhất thoát 0, chạy đủ T1–T5, mọi bản vá P00–P09 được áp.
- [ ] Release `vX.Y.Z-vantt.N` có 4 gói dựng sẵn kèm sha256, smoke xanh cả 4 nền.
- [ ] Cổng chất lượng đạt mục tiêu G3 và G8 (PRD 11.6) trên corpus sinh; bất biến G2 trùng 100%.
- [ ] L24: báo cáo review có biểu đồ chỉ số qua các bản (user thêm vào goal 2026-11-02).
- [ ] Có `vantt/reviews/v0.17.2.md` theo mẫu PRD 12.5, có báo cáo V22 và số tổng hợp V15.
- [ ] `vantt/README.md` cập nhật trạng thái; PRD mục 14 đánh dấu việc đã xong.

<!-- slug: fork-master-roadmap -->
