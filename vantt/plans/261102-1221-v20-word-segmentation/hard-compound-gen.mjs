// Harder vi-compound cases: the target note has the compound once; three
// distractors per case have both syllables more often, reversed or apart.
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'notes'), { recursive: true });
const pairs = [
  ['học', 'sinh'], ['khách', 'hàng'], ['ngân', 'hàng'], ['thị', 'trường'], ['giáo', 'viên'],
  ['bệnh', 'viện'], ['đầu', 'tư'], ['xe', 'máy'], ['thành', 'phố'], ['dịch', 'vụ'],
  ['kế', 'toán'], ['lãi', 'suất'], ['cà', 'chua'], ['thể', 'thao'], ['nhà', 'hàng'],
];
const filler = [
  'Sáng nay trời mưa nhẹ nên mọi người đến muộn một chút.',
  'Cuối tuần cả nhà về quê thăm ông bà.',
  'Danh sách việc cần làm được cập nhật lại vào tối thứ hai.',
  'Ghi lại vài ý chính để tuần sau bàn tiếp.',
  'Chiều nay có cuộc họp ngắn ở phòng lớn.',
  'Mọi thứ diễn ra khá suôn sẻ, không có gì đáng lo.',
];
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const golden = [];
let n = 0;
const note = (body) => {
  const p = `notes/n${String(++n).padStart(3, '0')}.md`;
  fs.writeFileSync(path.join(out, p), `# Ghi chép ${n}\n\n${body}\n`);
  return p;
};
pairs.forEach(([a, b], i) => {
  const f = (k) => filler[(i + k) % filler.length];
  const target = note(`${f(0)} Hôm qua tôi có nói chuyện về ${a} ${b} với một người bạn. ${f(1)}`);
  note(`${f(2)} Chuyện ${b} ${a} lại được nhắc tới. Ở đây ${a} thì nhiều, ${b} cũng vậy. ${f(3)} Lại ${b} rồi ${a}.`);
  note(`${f(4)} ${a[0].toUpperCase() + a.slice(1)} và ${b} là hai chuyện riêng. Người ta bàn về ${b} ${a} cả buổi. Còn ${a} thì sao?`);
  note(`${f(5)} Về ${b}: không rõ. Về ${a}: để sau. ${b} ${a}, ${b}.`);
  golden.push({ id: `hard-compound-${i + 1}`, query: `${a} ${b}`, relevant_paths: [target], partial_paths: [], category: 'hard-compound' });
  golden.push({ id: `hard-compound-folded-${i + 1}`, query: fold(`${a} ${b}`), relevant_paths: [target], partial_paths: [], category: 'hard-compound-folded' });
  golden.push({ id: `hard-compound-context-${i + 1}`, query: `nói chuyện ${a} ${b}`, relevant_paths: [target], partial_paths: [], category: 'hard-compound-context' });
});
fs.writeFileSync(path.join(out, '..', 'golden.json'), JSON.stringify(golden, null, 2));
console.log(`${n} notes, ${golden.length} queries`);
