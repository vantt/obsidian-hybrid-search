# Fork `vantt/obsidian-hybrid-search`

Fork của [flowing-abyss/obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) (OHS), giữ mã upstream nguyên vẹn. Phần riêng của fork chỉ nằm trong:

- `vantt/`: tài liệu, chuỗi bản vá, gói ngôn ngữ, eval, script.
- `.claude/skills/ohs-*`: hướng dẫn cho agent.
- `.github/workflows/vantt-*`: CI của fork.

**Đọc trước:** [PRD.md](PRD.md). Tài liệu này mô tả toàn bộ việc cần làm: cách đuổi theo upstream (học từ `vantt/herdr`), CI, gói dựng sẵn, các bản vá, gói tiếng Việt, kiểm thử, cách kiểm mỗi bản upstream mới, và điện thoại.

## Trạng thái (2026-11-02)
- Đã fork. Có PRD, skill [`ohs-catchup`](../.claude/skills/ohs-catchup/SKILL.md) và [`ohs-upstream-review`](../.claude/skills/ohs-upstream-review/SKILL.md).
- Remote `upstream` đã thêm, chỉ theo `master`, đẩy bị chặn (`git remote set-url --push upstream DISABLE`).
- `vantt/.gitignore` đã có: trạng thái catchup, báo cáo JSON, thư mục `.work/`.
- **GitHub Actions đang bật**; `ci.yml`, `auto-tag.yml`, `release.yml`, `update-deps.yml` của upstream đã tắt, chỉ `vantt-*` chạy. Issues đã bật.
- CI của fork (V02): `vantt-catchup.yml` (không có cron: fork không tự theo upstream, user chốt 2026-11-02; chạy khi đẩy `vantt/patches/**` hoặc `vantt/packages/**` lên `master`, dựng lại trên tag ghim trong [`upstream.pin`](upstream.pin), hoặc chạy tay với `target_ref` (trống = tag ghim), `sync_master`, `force_rebuild`, `dry_run`, `simulate_failure`; chỉ đồng bộ `master` theo upstream khi chạy tay với `sync_master`; dựng nhánh `vantt/<tag>`, đẩy nhánh và tag `v<version>`; hỏng thì mở đúng một issue `[catchup] <ref>: <status>` nhãn `catchup`, lần hỏng sau bình luận vào issue đó) và `vantt-pr-check.yml` (chặn commit trên `master` chạm file upstream).
- Secret tuỳ chọn `VANTT_PUSH_TOKEN` (PAT `contents:write`, thêm `workflow` khi bản đồng bộ upstream mang theo file workflow upstream đã đổi): thiếu thì workflow dùng `GITHUB_TOKEN`, bị GitHub từ chối khi đẩy file workflow. Nhánh phát hành đã gỡ workflow upstream nên thường không cần PAT.
- Submodule `obsidian-plugin` (SSH trong `.gitmodules`): CI không clone nó. Workflow dùng `actions/checkout` mặc định, không có `submodules:`. OHS không dùng plugin này để build. `.gitmodules` của upstream giữ nguyên.
- Gói dựng sẵn (V03): [`vantt-bundles.yml`](../.github/workflows/vantt-bundles.yml) chạy từ `master` bằng `workflow_dispatch` (nhập `tag`; `reuse_run` để thử lại từ artifact của lần chạy trước) hoặc `workflow_call`. Không có trigger push tag: workflow của commit gắn tag không tồn tại trên nhánh phát hành, và tag đẩy bằng `GITHUB_TOKEN` không khởi chạy gì. Dựng bằng `vantt/scripts/bundle.mjs`, kiểm bằng `vantt/scripts/bundle-smoke.mjs`; chỉ khi smoke xanh mới đẩy lên Release. Release đầu tiên [`v0.17.2-vantt.1`](https://github.com/vantt/obsidian-hybrid-search/releases/tag/v0.17.2-vantt.1) (9 bản vá, `ohs-lang-vi` 0.2.0, Node 22.23.3), smoke xanh:

  | Nền | Gói | Nén (MB) | Giải nén (MB) | Trước thu gọn (MB) | Index smoke-vault (s) |
  |---|---|---|---|---|---|
  | win32-x64 | zip | 102,6 | 279,3 | 632,3 | 4,8 |
  | darwin-arm64 | tar.gz | 99,5 | 326,3 | 656,9 | 2,4 |
  | linux-x64 | tar.gz | 99,0 | 295,7 | 942,7 | 2,4 |
  | darwin-x64 | tar.gz | 87,5 | 281,6 | 618,7 | 5,1 |

  Kích thước giải nén ≈280–330 MB (nén ≈100 MB) đã được user chấp nhận 2026-11-02 (PRD 8.2). macOS Intel: `onnxruntime-node` 1.30.0 không có binding `darwin/x64`; bản mới nhất có binding là 1.23.2, và `bundle.mjs` chỉ cho `darwin-x64` thay `onnxruntime-node` và `onnxruntime-common` bằng bản đó lúc đóng gói (ghi trong `MANIFEST.json`, `.bundle.json` và release notes). Gói nén 87,5 MB, giải nén 281,6 MB, smoke xanh trên `macos-15-intel`. Ảnh hưởng của bản thay được kiểm trên cùng một máy Linux (AMD EPYC, khoá 1.30.0 so với 1.23.2): chỉ chặn khi một hạng mục nDCG@5 tụt quá 0,01 (cải thiện luôn đạt và chỉ được ghi trong release notes; `vi-synonym` được tụt tới 0,03), user chốt 2026-11-02. Mỗi nền tự đẩy gói của mình lên Release. Số eval của gói Intel: `vantt/eval/baselines/darwin-x64/`. Gói macOS chưa ký, smoke trên runner chưa kiểm cờ quarantine của Gatekeeper.
- `vantt-catchup.yml` gọi `vantt-bundles.yml` (`workflow_call`) khi một lần chạy không phải `dry_run` đẩy tag mới.
- Bản mới nhất: [`v0.17.2-vantt.4`](https://github.com/vantt/obsidian-hybrid-search/releases/tag/v0.17.2-vantt.4), đủ 4 gói kèm sha256, upstream ghim `v0.17.2`.
- Chuỗi bản vá ([`patches/series.toml`](patches/series.toml)), mỗi bản có spec và probe trong [`probes/`](probes/): P00 `fork-identity`, P01 `language-pack-api`, P02 `db-path`, P03 `vector-export`, P04 `stdio-parity`, P09 `unicode-inline-tags`, P05 `block-anchors`, P06 `restrict-paths`, P07 `index-events`.
- Gói ngôn ngữ: [`packages/ohs-lang-vi`](packages/ohs-lang-vi/) (chuẩn hoá, bỏ dấu, phục hồi dấu, Telex/VNI, gõ sai, đồng nghĩa và viết tắt từ `_ohs/lexicon.md`, alias không dấu, tách từ với từ điển học từ dữ liệu CC BY 4.0) và [`packages/ohs-lang-de`](packages/ohs-lang-de/) (chứng minh điểm cắm P01 là chung).
- Script: [`scripts/catchup.mjs`](scripts/catchup.mjs) (skill [`ohs-catchup`](../.claude/skills/ohs-catchup/SKILL.md)), `invariance.mjs`, `quality-gate.mjs` (cả `--private` và `--private-detail` cho vault thật), `review-upstream.mjs`, `bundle.mjs`, `semantic-eval.mjs`.
- Eval: bộ `vi` ở [`eval/vi/`](eval/vi/) (fixture `vi-search` `v0.11.0`, 270 câu, 17 hạng mục). Trên corpus sinh, gói `vi` nâng nDCG@5 từ 0,646 (upstream) lên 0,944; eval tiếng Anh của upstream giữ 0,735; không gói thì 58/58 câu trùng upstream.
- Báo cáo trong [`reviews/`](reviews/): review upstream [`v0.17.2.md`](reviews/v0.17.2.md) kèm biểu đồ xu hướng, eval nhánh nghĩa [`semantic-eval-2026-11-02.md`](reviews/semantic-eval-2026-11-02.md), eval vault thật [`v0.17.2-vantt.2.private.md`](reviews/v0.17.2-vantt.2.private.md) (chỉ số tổng hợp).
- Lộ trình: [plan tổng](plans/261102-0349-fork-master-roadmap/plan.md) (nguồn yêu cầu là PRD mục 14); plan con đã xong ở [`plans/archive/`](plans/archive/).

## Quy tắc
- Commit trên `master` của fork không sửa file của upstream. Thay đổi mã OHS chỉ đi qua bản vá trong `vantt/patches/`.
- Mỗi bản vá có spec (yêu cầu, bất biến, điểm chạm, cách viết lại khi xung đột) và probe hành vi.
- Không có gói ngôn ngữ thì OHS của fork phải cho kết quả giống hệt upstream cùng tag.
- Không đưa nội dung vault thật vào repo, CI hay báo cáo.
