---
title: 'V01: catchup dựng nhánh phát hành từ tag upstream'
description: 'Việc V01 của lộ trình fork: vantt/scripts/catchup.mjs (Node ESM, không phụ thuộc), test vitest trên repo git tạm kể cả diễn tập xung đột T8, skill ohs-catchup, xuất lại bản vá sau khi sửa xung đột.'
status: completed
priority: P1
effort: '2 ngày'
tags: [infra]
created: 2026-11-02
---

# V01: catchup dựng nhánh phát hành từ tag upstream

## Nguồn yêu cầu

- PRD mục 4.1 (cách herdr làm, bài học: checkout tag làm mất `vantt/`, bản vá giả để tập xung đột; chỗ yếu: không xuất lại bản vá), 4.2 (bố cục), 4.3 (định danh `<tag>-vantt.<N>`, ghi vào `package.json` lúc build).
- PRD mục 5 bước 1, 5, 6: chỉ chọn tag mà `git merge-base --is-ancestor <tag> upstream/master` đúng; không bao giờ `git push --tags`; chỉ fetch `master` của upstream; `HUSKY=0`; file `.claude/skills/ohs-*` thêm bằng `git add -f`.
- PRD mục 6 toàn bộ: 6.1 lệnh và cờ (`--ref`, `--dry-run`, `--clean`, `--continue`, `--abort`, `--skip-tests`, `--skip-quality`, `--json`, `--with-lang <lang>`, `--report <file>`), 6.2 mười ba bước và mã thoát 0/2/3/4/5/6/7, 6.3 xung đột, 6.4 xuất lại bản vá, 6.5 báo cáo JSON, 6.6 đồng bộ `master`.
- PRD mục 9.1 (`series.toml`), 9.2 (probe; catchup không chạy probe), 11.1 (tầng T1–T5 chạy trong catchup, T8 diễn tập xung đột), 11.2 (test của script fork trên repo git tạm, không mạng).
- Điều kiện xong lấy từ [phase 1 của lộ trình](../261102-0349-fork-master-roadmap/phase-01-fork-infrastructure.md): "chạy trên `v0.17.2` ra nhánh `vantt/v0.17.2` xanh với chuỗi bản vá rỗng và với bản vá giả; diễn tập xung đột trả mã 3, `--abort` trả repo sạch, `--continue` sau khi sửa thì xanh và bản vá được xuất lại."

## Quyết định

- **Chỉ chép file `vantt/` và `.claude/skills/ohs-*` đã được git theo dõi** (`git ls-files`) sang nhánh phát hành. File chưa theo dõi của cây làm việc (việc dở của agent khác) không lọt vào nhánh phát hành; kết quả xác định theo commit.
- **Kết thúc (xanh, hỏng hay `--abort`) catchup trả cây làm việc về nhánh ban đầu.** Nhánh `vantt/<tag>` giữ lại để đẩy hoặc xem. Bản vá xuất lại (6.4) được ghi vào `vantt/patches/` của nhánh ban đầu, chưa commit; catchup in lệnh commit.
- **Áp bản vá**: `git apply --3way` cập nhật index, commit thẳng index (không `git add -A`, để không cuốn file lạ vào). `--continue` từ chối khi còn file chưa gộp hoặc còn dấu xung đột (`git diff --cached --check`). Sửa xong mà không còn thay đổi nào thì ghi bản vá là `SKIPPED_UPSTREAM_HAS_IT`.
- **Số N của phiên bản**: tìm tag `v<ver>-vantt.N` lớn nhất trong repo; so dấu vân tay (sha256 của cây `vantt/patches` và các gói `vantt/packages/ohs-lang-*`) của tag đó với lần chạy này; trùng thì giữ N, khác thì N+1; chưa có thì 1. Catchup không fetch tag của origin; CI clone đủ tag.
- **Ref không phải tag** (`upstream/master`, sha): nhánh `vantt/upstream-master-<sha7>`, phiên bản `<version package.json>-vantt.0.g<sha7>`.
- **Mốc cho T1–T5** nằm trong `vantt/scripts/lib/tiers.mjs`: T4 chạy `vantt/scripts/invariance.mjs`, T5 chạy `vantt/scripts/quality-gate.mjs` nếu có; chưa có thì `skipped`. T3 chạy test của `vantt/packages/ohs-lang-<lang>` khi có `--with-lang <lang>`; gói chưa có thì `skipped`.
- **npm theo `devEngines` của upstream** (12.2.0): npm máy khác phiên bản thì catchup cài đúng bản vào `vantt/.work/tools/` và đặt lên đầu `PATH` cho build và test (CI upstream cài toàn cục; catchup không đổi npm toàn cục).
- **Build dùng `npm ci --ignore-scripts && npm rebuild`**: `prepare` của upstream (`.ai/setup.mjs`) báo xung đột vì `.claude/skills` là thư mục thật chứa skill `ohs-*`, và bản phát hành không cần nó. Lần chạy thật đầu tiên hỏng đúng chỗ này.
- **Đặt phiên bản cả `server.json`** (`version`, `packages[].version` của package npm), như `scripts/sync-server-json.sh` của upstream; thiếu thì `test/registry-metadata.test.ts` của upstream hỏng.
- **Dry-run** không fetch, không đổi HEAD, cây làm việc hay index thật; mô phỏng áp bản vá trên một index tạm.
- **Mục 6.6** (đồng bộ `master`) là bước của workflow V02; catchup không đụng `master`. Skill ghi cách làm.

## Việc

- [x] `vantt/patches/series.toml` rỗng, có chú thích định dạng và thứ tự P00, P01, P02, P03, P04, P09, P05, P06, P07.
- [x] `vantt/scripts/lib/`: đọc TOML, git, phiên bản, tầng test.
- [x] `vantt/scripts/catchup.mjs`.
- [x] Test vitest `vantt/scripts/test/catchup*.test.mjs`, cấu hình `vantt/scripts/vitest.config.mjs`.
- [x] Skill `.claude/skills/ohs-catchup/SKILL.md`.
- [x] Chạy thật trên `v0.17.2` trong bản clone ở scratchpad, đẩy nhánh `vantt/v0.17.2` lên origin (không đẩy tag, không tạo release).

## Xong khi

- [x] `npx vitest run --config vantt/scripts/vitest.config.mjs` xanh: chọn tag (bỏ pre-release, bỏ tag ngoài `upstream/master`), chuỗi rỗng, bản vá giả, bỏ bản vá upstream đã có, phiên bản `-vantt.N`, đọc `series.toml` lỗi cú pháp, diễn tập xung đột (mã 3, state, `--abort` sạch, `--continue` xanh và bản vá được xuất lại), đã xanh thì thoát nhanh, dry-run.
- [x] Chạy thật `node vantt/scripts/catchup.mjs --ref v0.17.2 --json` thoát 0, nhánh `vantt/v0.17.2` đã đẩy lên origin.

## Kết quả

- Test: `npx vitest run --config vantt/scripts/vitest.config.mjs` 27/27 xanh (npm máy là 11.19; repo đòi npm 12.2.0 nên chạy từ ngoài repo: `cd /tmp && npx -y npm@12.2.0 exec --prefix <repo> -- vitest run --config <repo>/vantt/scripts/vitest.config.mjs`).
- Chạy thật trong bản clone ở scratchpad: `node vantt/scripts/catchup.mjs --ref v0.17.2 --with-lang vi --json` thoát 0, `0.17.2-vantt.1`, T1 upstream 1972 test xanh, T3 `ohs-lang-vi` xanh, T4/T5 `skipped` (chưa có script). Chạy lại: "already green" trong dưới 1 giây.
- Nhánh `vantt/v0.17.2` = `0ab78df` đã đẩy lên origin. Không đẩy tag, không tạo release.
