# Fork `vantt/obsidian-hybrid-search`

Fork của [flowing-abyss/obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) (OHS), giữ mã upstream nguyên vẹn. Phần riêng của fork chỉ nằm trong:

- `vantt/`: tài liệu, chuỗi bản vá, gói ngôn ngữ, eval, script.
- `.claude/skills/ohs-*`: hướng dẫn cho agent.
- `.github/workflows/vantt-*`: CI của fork.

**Đọc trước:** [PRD.md](PRD.md). Tài liệu này mô tả toàn bộ việc cần làm: cách đuổi theo upstream (học từ `vantt/herdr`), CI, gói dựng sẵn, các bản vá, gói tiếng Việt, kiểm thử, cách kiểm mỗi bản upstream mới, và điện thoại.

## Trạng thái (2026-11-02)
- Đã fork. Đã thêm PRD và skill [`ohs-upstream-review`](../.claude/skills/ohs-upstream-review/SKILL.md).
- Remote `upstream` đã thêm, chỉ theo `master`, đẩy bị chặn (`git remote set-url --push upstream DISABLE`).
- `vantt/.gitignore` đã có: trạng thái catchup, báo cáo JSON, thư mục `.work/`.
- **GitHub Actions trên fork đang tắt**, để CI và cron của upstream không chạy. Bật lại theo PRD mục 5 khi đã có workflow `vantt-*` (việc V02, cần user xác nhận).
- Submodule `obsidian-plugin` (SSH trong `.gitmodules`): CI không clone nó. Workflow dùng `actions/checkout` mặc định, không có `submodules:`. OHS không dùng plugin này để build. `.gitmodules` của upstream giữ nguyên.
- Chưa có script, bản vá hay gói nào. Lộ trình và thứ tự làm: [plan tổng](plans/261102-0349-fork-master-roadmap/plan.md) (nguồn yêu cầu là PRD mục 14).

## Quy tắc
- Commit trên `master` của fork không sửa file của upstream. Thay đổi mã OHS chỉ đi qua bản vá trong `vantt/patches/`.
- Mỗi bản vá có spec (yêu cầu, bất biến, điểm chạm, cách viết lại khi xung đột) và probe hành vi.
- Không có gói ngôn ngữ thì OHS của fork phải cho kết quả giống hệt upstream cùng tag.
- Không đưa nội dung vault thật vào repo, CI hay báo cáo.
