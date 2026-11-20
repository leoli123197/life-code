// 解析 build/raw/book/*.md + docs/*.md → build/data/{entries,sections,docs,meta}.json
// 解析规则与官方 index.html 的 parseReadme 保持一致（同一套正则、同一套派生字段），
// 这样「性价比极高 123 条」「A 级 497 条」这些数字永远和书里的在线版对得上。
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const OUT = path.join(HERE, 'data');

// ——— 官方口径：见 cost-model.mjs（逐字对齐 index.html）———
import { LABEL, LENS_LABEL, WHO_LABEL, csOf, ratioOf } from './cost-model.mjs';
export { LABEL, LENS_LABEL, WHO_LABEL };

const FIELDS = ['成本', '说人话', '收益', '证据等级', '来源', '备注'];
const KEY_EN = { '钱': 'money', '时间': 'time', '毅力': 'will', '收益': 'level', '口径': 'lens', '人群': 'who' };

// 「第 8 节第 17 条」式互指，官方 XREF_RE 的第一种写法
const XREF_FULL = /第\s*(\d+)\s*节第\s*(\d+)\s*条/g;

function body(e) { return [e.human, e.gain, e.src, e.note].join('\n'); }

/** 与官方 parseReadme 同构的行解析 */
function parseBook(md, fileName) {
  const sections = [];
  let sec = null, entry = null;
  const flush = () => { if (entry && sec) sec.entries.push(entry); entry = null; };
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    let m;
    if ((m = /^#{1,2} (\d+)\. (.+)$/.exec(line))) { flush(); sec = { no: +m[1], title: m[2].trim(), file: fileName, intro: [], entries: [] }; sections.push(sec); continue; }
    if (/^#{1,2} /.test(line)) { flush(); sec = null; continue; }
    if (!sec) continue;
    if ((m = /^### (\d+)\. (.+)$/.exec(line))) {
      flush();
      entry = { sec: sec.no, n: +m[1], title: m[2].trim(), cost: '', human: '', gain: '', grade: '', gradeNote: '', src: '', note: '', money: '', time: '', will: '', level: '', lens: '', who: [] };
      continue;
    }
    if ((m = /^\x3c!--\s*成本标签:\s*(.*?)\s*-->/.exec(line)) && entry) {
      for (const kv of m[1].split(/\s+/)) {
        const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1);
        const en = KEY_EN[k]; if (!en) continue;
        if (en === 'who') entry.who = v.split(',').map(g => g.split('+'));
        else entry[en] = v;
      }
      continue;
    }
    if (entry) {
      // 字段值偶尔换行续写（全书 31 处），续行并入当前字段
      if (entry._f && !/^- /.test(line) && line) { entry[entry._f] += '\n' + line; continue; }
      let hit = null;
      for (const f of FIELDS) if (line.startsWith(`- ${f}：`)) { hit = f; break; }
      if (hit) {
        const val = line.slice(hit.length + 3);
        if (hit === '证据等级') {
          const g = /^\s*([ABC])/.exec(val);
          entry.grade = g ? g[1] : '';
          entry.gradeNote = g ? val.slice(g[0].indexOf(g[1]) + 1).trim() : val.trim();
          entry._f = null;
        } else {
          entry[{ '成本': 'cost', '说人话': 'human', '收益': 'gain', '来源': 'src', '备注': 'note' }[hit]] = val;
          entry._f = { '成本': 'cost', '说人话': 'human', '收益': 'gain', '来源': 'src', '备注': 'note' }[hit];
        }
        continue;
      }
      entry._f = null;
      continue;
    }
    if (line && !/^\[← /.test(line) && !/^\x3c!--/.test(line)) sec.intro.push(line);
  }
  flush();
  return sections;
}

/** 派生字段：dispute / todo / cs / ratio / hay —— 逐字对齐官方 */
function derive(e) {
  e.id = `${e.sec}-${e.n}`;
  e.dispute = /^争议/.test(e.note);
  e.todo = /待核实|TODO/.test(e.src + e.gain + e.note + e.cost);
  e.cs = csOf(e);
  e.ratio = ratioOf(e);
  e.moneyLabel = LABEL.money[e.money] ?? '';
  e.timeLabel = LABEL.time[e.time] ?? '';
  e.willLabel = LABEL.will[e.will] ?? '';
  e.lensLabel = LENS_LABEL[e.lens] || e.lens;
  e.whoText = e.who.length ? e.who.map(g => g.map(v => WHO_LABEL[v] || v).join('且')).join('、') : '';
  e.hay = [e.title, e.human, e.cost, e.gain, e.note, e.src, e.grade].join('\n').replace(/\*\*/g, '').replace(/\\([*_])/g, '$1').toLowerCase();
  // 出处链接：先把 <url> 尖括号还原，再抽出所有 url
  const srcPlain = e.src.replace(/<((?:https?:\/\/)[^>]+)>/g, '$1');
  const found = srcPlain.match(/https?:\/\/[^\s]+/g) || [];
  // 遇到中文或全角标点就断（URL 后面常紧跟「：第六条」这类说明）；ASCII 括号留给 URL 本身
  // URL 一律是 ASCII：遇到第一个非 ASCII 字符（中文或全角标点）就把它和后面的内容一起截掉，
  // 再去掉行尾多余的标点。书里常有「…….htm：第六条」「…….shtml市场监管总局」这种紧挨着的写法。
  const cut = u => u.replace(/[^\x00-\x7F].*$/, '').replace(/[.,;:]+$/, '');
  e.urls = [...new Set(found.map(cut).filter(Boolean))];
  e.xref = [...new Set([...body(e).matchAll(XREF_FULL)].map(m => `${m[1]}-${m[2]}`))].filter(k => k !== e.id);
  delete e._f;
  return e;
}

/** 长文附录：# 标题 / ## 小节 / 1. 条目，供「延伸阅读」和长文类待办用 */
function parseDoc(md, name) {
  const t = /^# (.+)$/m.exec(md);
  const blocks = [];
  let cur = { h: '', text: [] };
  const push = () => { if (cur.h || cur.text.length) blocks.push(cur); cur = { h: '', text: [] }; };
  const lines = md.split(/\r?\n/).filter(l => !/^\[← /.test(l));
  const start = lines.findIndex(l => /^## /.test(l));
  for (let i = 0; i < lines.length; i++) {
    if (i < (start < 0 ? lines.length : start)) { if (!/^# /.test(lines[i]) && lines[i].trim()) cur.text.push(lines[i].trim()); continue; }
    const l = lines[i];
    if (/^## /.test(l)) { push(); cur.h = l.replace(/^## /, '').trim(); continue; }
    if (/^#{1,2} /.test(l)) continue;
    if (l.trim()) cur.text.push(l.trimEnd());
  }
  push();
  const head = /^# (.+)$/m.exec(md)?.[1]?.trim() || name;
  const items = blocks.map((b, bi) => ({
    block: bi, h: b.h,
    paras: b.text.filter(l => !/^\s*\d+\.\s/.test(l) && !/^\s*[-•*]\s/.test(l)),
    list: b.text.filter(l => /^\s*\d+\.\s/.test(l)).map((l, i) => {
      const m = /^\s*(\d+)\.\s+(.*)$/.exec(l);
      return { n: +m[1], text: m[2], xref: [...new Set([...m[2].matchAll(XREF_FULL)].map(x => `${x[1]}-${x[2]}`))] };
    }),
  }));
  return {
    name, title: head, blocks,
    intro: items[0]?.paras.join(' ') || '',
    items,
    urls: [...new Set((md.replace(/<((?:https?:\/\/)[^>]+)>/g, '$1').match(/https?:\/\/[^\s；;、）)》\]]+/g) || []))],
    hay: md.replace(/\s+/g, ' ').toLowerCase(),
  };
}

const files = (await readdir(RAW + '/book')).filter(f => f.endsWith('.md')).sort();
const sections = [], entries = [];
const digest = createHash('sha256');
for (const f of files) {
  const md = await readFile(path.join(RAW, 'book', f), 'utf8');
  digest.update(f).update(md);
  const secs = parseBook(md, f);
  for (const s of secs) {
    sections.push({ no: s.no, title: s.title, file: f, intro: s.intro, count: s.entries.length });
    for (const e of s.entries) entries.push(derive(e));
  }
}
const docFiles = (await readdir(RAW + '/docs')).filter(f => f.endsWith('.md')).sort();
const docs = [];
for (const f of docFiles) {
  const md = await readFile(path.join(RAW, 'docs', f), 'utf8');
  digest.update(f).update(md);
  docs.push(parseDoc(md, f.replace(/\.md$/, '')));
}

const stat = {
  sections: sections.length,
  entries: entries.length,
  grade: entries.reduce((a, e) => (a[e.grade] = (a[e.grade] ?? 0) + 1, a), {}),
  ratio: entries.reduce((a, e) => (a[e.ratio] = (a[e.ratio] ?? 0) + 1, a), {}),
  level: entries.reduce((a, e) => (a[e.level] = (a[e.level] ?? 0) + 1, a), {}),
  lens: entries.reduce((a, e) => (a[e.lens] = (a[e.lens] ?? 0) + 1, a), {}),
  money: entries.reduce((a, e) => (a[e.money] = (a[e.money] ?? 0) + 1, a), {}),
  time: entries.reduce((a, e) => (a[e.time] = (a[e.time] ?? 0) + 1, a), {}),
  will: entries.reduce((a, e) => (a[e.will] = (a[e.will] ?? 0) + 1, a), {}),
  dispute: entries.filter(e => e.dispute).length,
  todoTag: entries.filter(e => e.todo).length,
  withUrl: entries.filter(e => e.urls.length).length,
  xrefEdges: entries.reduce((a, e) => a + e.xref.length, 0),
  noFields: entries.filter(e => !e.cost || !e.human || !e.gain || !e.grade || !e.src).map(e => e.id),
  gradeNotes: entries.filter(e => e.gradeNote).map(e => ({ id: e.id, note: e.gradeNote })),
  docs: docs.length,
  docItems: docs.reduce((a, d) => a + d.items.reduce((x, b) => x + b.list.length, 0), 0),
  content_sha256: digest.digest('hex').slice(0, 12),
};

await mkdir(OUT, { recursive: true });
const w = async (n, o) => writeFile(path.join(OUT, n), JSON.stringify(o), 'utf8');
await w('entries.json', entries);
await w('sections.json', sections);
await w('docs.json', docs);
await w('meta.json', stat);
console.log(JSON.stringify(stat, null, 1));
