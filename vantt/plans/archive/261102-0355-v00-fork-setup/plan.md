---
title: "V00: cài đặt phần còn lại của fork"
description: "Việc V00 của lộ trình fork: .gitignore cho vantt/, cách CI xử lý submodule, trạng thái trong vantt/README.md."
status: completed
priority: P1
effort: "0,5 ngày"
tags: [infra]
created: 2026-11-02
---

# V00: cài đặt phần còn lại của fork

## Nguồn yêu cầu

PRD mục 5, bước 2, 3 và phần còn lại của bước 1; bảng V00 ở PRD mục 14.1: "`gh workflow list` chỉ có `vantt-*` bật". Điều kiện xong của lộ trình: [phase 1](../261102-0349-fork-master-roadmap/phase-01-fork-infrastructure.md).

## Quyết định

- **Submodule `obsidian-plugin`:** CI không clone. Workflow dùng `actions/checkout` mặc định (không có `submodules:`). Không sửa `.gitmodules`, không thêm rewrite `insteadOf`. Lý do: PRD mục 5 cho phép; OHS không dùng plugin này để build; `.gitignore` của upstream đã bỏ qua `/obsidian-plugin/`.
- **`.gitignore`:** ba mục theo PRD mục 5 bước 3. Gốc `.gitignore` của upstream đã có `reports/`, nên `vantt/reports/*.json` đã bị bỏ qua sẵn. Báo cáo đã phát hành phải thêm bằng `git add -f`. Không sửa `.gitignore` của upstream.
- **Remote `upstream`:** đã có từ trước (push `DISABLE`). Không làm lại.

## Việc đã làm

- [x] `vantt/.gitignore`: `.catchup-state.json`, `reports/*.json`, `.work/`. Đã kiểm bằng `git check-ignore`.
- [x] `vantt/README.md`: trạng thái, remote, submodule, link tới plan tổng.
- [x] Không bật Actions, không tắt workflow upstream (để V02, cần user xác nhận). Kiểm: `gh api repos/vantt/obsidian-hybrid-search/actions/permissions` trả `enabled: false`.

## Xong khi

- [x] `git check-ignore` khớp cả ba mẫu trong `vantt/`.
- [x] `vantt/README.md` có trạng thái khớp repo và link tới `plans/archive/261102-0349-fork-master-roadmap/plan.md`.
- [x] Actions vẫn tắt, không sửa file upstream.

## Ghi chú

- Mục `reports/*.json` trong `vantt/.gitignore` chỉ là chú thích. Cách ngăn thật là `reports/` của gốc `.gitignore` upstream.
