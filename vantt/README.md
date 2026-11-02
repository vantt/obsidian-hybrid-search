# Fork `vantt/obsidian-hybrid-search`

Fork của [flowing-abyss/obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) (OHS), giữ mã upstream nguyên vẹn. Phần riêng của fork chỉ nằm trong:

- `vantt/`: tài liệu, chuỗi bản vá, gói ngôn ngữ, eval, script.
- `.claude/skills/ohs-*`: hướng dẫn cho agent.
- `.github/workflows/vantt-*`: CI của fork.

**Đọc trước:** [PRD.md](PRD.md). Tài liệu này mô tả toàn bộ việc cần làm: cách đuổi theo upstream (học từ `vantt/herdr`), CI, gói dựng sẵn, các bản vá, gói tiếng Việt, kiểm thử, cách kiểm mỗi bản upstream mới, và điện thoại.

## Trạng thái (2026-11-02)
- Đã fork. Đã thêm PRD và skill [`ohs-upstream-review`](../.claude/skills/ohs-upstream-review/SKILL.md).
- **GitHub Actions trên fork đang tắt**, để CI và cron của upstream không chạy. Bật lại theo PRD mục 5 khi đã có workflow `vantt-*`.
- Chưa có script, bản vá hay gói nào. Thứ tự làm: PRD mục 14.

## Quy tắc
- Commit trên `master` của fork không sửa file của upstream. Thay đổi mã OHS chỉ đi qua bản vá trong `vantt/patches/`.
- Mỗi bản vá có spec (yêu cầu, bất biến, điểm chạm, cách viết lại khi xung đột) và probe hành vi.
- Không có gói ngôn ngữ thì OHS của fork phải cho kết quả giống hệt upstream cùng tag.
- Không đưa nội dung vault thật vào repo, CI hay báo cáo.
