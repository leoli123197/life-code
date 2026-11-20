// 生成「自测题抽查 200 条」复核清单：分层抽样，规则风险高的题型全收，其余按节铺满。
// 用法：node build/qreview.mjs → 工作区根目录「自测题抽查200.md」。改题干写进 questions.mjs 的 overrides.reword。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const Q = JSON.parse(await readFile(path.join(HERE, 'data', 'questions.json'), 'utf8'));
const entries = JSON.parse(await readFile(path.join(HERE, 'data', 'entries.json'), 'utf8'));
const E = new Map(entries.map(e => [e.id, e]));
const TARGET = 200;

const OUTCOME = /(能|会|就|才能|才会)(跟着)?(好转|恢复|降低|减少|省|少|多|活|便宜)|就够$/;
/** 需要重点看的题干：模板拼的场景题、读完不像一句自查的（陈述结果、短到看不出在问什么） */
const focus = a => a.style === 'scene' || OUTCOME.test(a.text) || a.text.length < 12;

const byId = new Map();                       // entry id → 抽样到的题（自动题一条一题，天然去重）
const pick = a => { if (a && !byId.has(a.entry)) byId.set(a.entry, a); };
const sorted = arr => arr.slice().sort((x, y) => x.sec - y.sec || x.n - y.n);
const plain = sorted(Q.auto.filter(a => a.style === 'plain'));

// 1) 风险最高的三种规则产物全收：场景题（模板拼的）、反向题（加了「不」）、以及带人群标签的
sorted(Q.auto.filter(a => a.style === 'scene')).forEach(pick);
sorted(Q.auto.filter(a => a.style === 'neg')).forEach(pick);
sorted(Q.auto.filter(a => a.style === 'neg2')).filter((_, i) => i % 3 === 0).forEach(pick);
sorted(Q.auto.filter(a => a.hasWho)).filter((_, i) => i % 6 === 0).forEach(pick);
sorted(Q.auto.filter(focus)).forEach(pick);            // 规则自己都觉得别扭的先全收
// 2) 普通题里最长的最容易读不通，收一批
plain.filter(a => a.text.length > 40).slice(0, 14).forEach(pick);
// 3) 每节至少一条，保证 34 节都被看到
for (let s = 1; s <= 34; s++) { const a = plain.find(x => x.sec === s && !byId.has(x.entry)); if (a) pick(a); }
// 4) 还不满 200 就按固定步长铺普通题；超了就按同一顺序裁掉尾部普通题
for (let i = 0; byId.size < TARGET && i < plain.length; i += 7) pick(plain[i]);
if (byId.size > TARGET) {
  const extra = sorted([...byId.values()]).filter(a => a.style === 'plain').reverse();
  for (const a of extra) { if (byId.size <= TARGET) break; byId.delete(a.entry); }
}

const sample = sorted([...byId.values()]);
const STYLE_CN = { plain: '习惯陈述', neg: '反向（别/不要→不…）', neg2: '反向（书里就是「不…」开头）', scene: '场景＋该做什么' };
const ref = a => `第${a.sec}节第${a.n}条`;
const who = a => { const e = E.get(a.entry); return e && e.who.length ? e.who.map(g => g.join('+')).join(' 或 ') : '—'; };

const lines = [];
lines.push('# 自测题抽查（200 条）· 请复核措辞');
lines.push('');
lines.push(`数据来源快照：questions.json（生成于 ${Q.generated_at}，自动题 ${Q.stats.auto} 道 / 官方题 ${Q.stats.official} 道 / 规则排除 ${Q.excluded.length} 条）。本文件是从 ${Q.stats.auto} 道自动题里分层抽出的 ${sample.length} 条，官方 79 题沿用原书自查页措辞、不在抽查范围。`);
lines.push('');
lines.push('怎么复核：每条下面留了「你的意见：」一行，读得通就写「OK」，要改就直接在后面写你想说的话（例：`改成：家里不囤安眠药`）。' +
  '你标完之后我把它写进 `build/questions.mjs` 的 `overrides.reword`，重跑 `node build/questions.mjs && node build/bundle.mjs` 就生效，其余题目不动。');
lines.push('');
lines.push('四条规则说明：');
lines.push('');
lines.push('- **习惯陈述**：条目标题本身就是「做什么」，只删掉开头的「要/应该/记得」，超长时在逗号处截断，截掉的部分进「提示」。');
lines.push('- **反向**：标题以「别/不要/不得」开头的，改成「不＋动作」，冒号后面的解释挪进「提示」，题干只留禁令。');
lines.push('- **场景＋该做什么**：第 13 节这类「看到 X，做 Y」的条目，题干只留场景、问「这一步你知道该怎么做吗」，Y 挪进「提示」当答案提示。');
lines.push('- **人群**：带「人群」标签的题不出给不匹配的人（怀孕、婴幼儿、3–18 岁孩子、老人、35/60 岁以上、女性），出题时按你填的基本情况现场过滤。');
lines.push('');
lines.push(`带 ⚠ 的是规则自己都觉得别扭的（场景题、句子在陈述结果、短到看不出在问什么），一共 ${sample.filter(focus).length} 条，优先看这些。`);
lines.push('');
let sec = 0, idx = 0;
for (const a of sample) {
  if (a.sec !== sec) { sec = a.sec; const s = Q.sections.find(x => x.no === sec); lines.push('', `## ${s.title}（第 ${sec} 节 · 抽 ${sample.filter(x => x.sec === sec).length} 条）`, ''); }
  idx++;
  const e = E.get(a.entry) || {};
  lines.push(`- [ ] **Q${String(idx).padStart(3, '0')}** ${focus(a) ? '⚠ ' : ''}｜ ${ref(a)} ｜ ${STYLE_CN[a.style]} ｜ 人群：${who(a)}`);
  lines.push(`  - 题干：**${a.text}**`);
  if (a.hint) lines.push(`  - 提示：${a.hint}`);
  lines.push(`  - 原文标题：${e.title || a.key}`);
  lines.push(`  - 你的意见：`);
}
lines.push('', '## 规则排除名单', '');
if (!Q.excluded.length) {
  lines.push('（空）全书 772 条标题都是动词开头的可执行动作，规则没有排除任何条目，所以题库是 79 道官方题 + 693 道自动题 = 772 道，一条不落。' +
    '真要剔除某条（比如你根本不涉及的场景），把条号写进 `build/questions.mjs` 的 `overrides.exclude`，例如 `exclude: ["32-11"]`。');
} else {
  for (const x of Q.excluded) lines.push(`- [ ] ${x.entry}（第${x.sec}节第${x.n}条）「${x.title}」—— 原因：${x.why.join('；')}`);
}
lines.push('', '## 官方 79 题的分布（原样沿用，不改动）', '');
const g = {};
for (const o of Q.official) { const k = `${o.group}（${o.theme}）`; g[k] = (g[k] || 0) + 1; }
for (const [k, v] of Object.entries(g)) lines.push(`- ${k}：${v} 道`);
lines.push('', `共 ${sample.length} 条抽样 · 覆盖 ${new Set(sample.map(a => a.sec)).size}/34 节 · 改题干只需在「你的意见」里写，我按 Q 号回填 overrides.reword`);

const out = path.join(ROOT, '自测题抽查200.md');
await writeFile(out, lines.join('\n'), 'utf8');

/* 题干规则体检（全量，不只抽样）：读不通的形态一旦出现就报数，避免规则悄悄退化 */
const BAD = [
  [/^不(有|无|别|要要|不|不)/, '反向措辞叠字'],
  [/不不|别别|要要|的的/, '重复词'],
  [/：|—/, '题干残留冒号/破折号'],
  [/？|\?/, '题干是问句'],
  [/^$|^.$/, '空题干或单字'],
];
const lint = {};
const CAP = (Q.rules && Q.rules.cap) || 46;
for (const a of Q.auto) {
  for (const [re, why] of BAD) if (re.test(a.text)) { lint[why] = (lint[why] || 0) + 1; break; }
  if (a.text.length > CAP + 1) lint['截断后仍超上限'] = (lint['截断后仍超上限'] || 0) + 1;
}
const lens = Q.auto.map(a => a.text.length);
console.log('题干体检：', Object.keys(lint).length ? lint : '无异常形态',
  `｜长度 最长 ${Math.max(...lens)}、中位 ${lens.sort((x, y) => x - y)[lens.length >> 1]}、平均 ${(lens.reduce((s, x) => s + x, 0) / lens.length).toFixed(1)}`);
console.log(`抽样 ${sample.length} 条（其中 ⚠ 重点看 ${sample.filter(focus).length} 条）· 覆盖 ${new Set(sample.map(a => a.sec)).size}/34 节 → ${out}`);
const st = {};
for (const a of sample) st[a.style] = (st[a.style] || 0) + 1;
console.log('按风格：', st);
