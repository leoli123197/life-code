// 数据校验：对账官方口径 + 与你那份 PDF 全文逐条比对
// 用法：node build/verify.mjs
// 两份外部文本都只在本地，不进版本库：build/raw/ 由 node build/fetch.mjs 抓，book_raw.txt 是你自己
// 从 PDF 抽的全文。缺谁就把对应的检查项标成 SKIP 并说明原因，而不是让它假失败。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABEL as LABEL_PORTED, LENS_LABEL as LENS_PORTED, WHO_LABEL as WHO_PORTED, COST_W as COST_W_PORTED, ratioOf, csOf } from './cost-model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const rd = async (...p) => JSON.parse(await readFile(path.join(HERE, 'data', ...p), 'utf8'));

const entries = await rd('entries.json');
const sections = await rd('sections.json');
const docs = await rd('docs.json');
const stat = await rd('meta.json');
const rdOpt = async p => { try { return await readFile(p, 'utf8'); } catch (e) { return ''; } };
const pdfText = await rdOpt(path.join(ROOT, 'book_raw.txt'));
const officialHtml = await rdOpt(path.join(HERE, 'raw', 'index.html'));
const HAS_PDF = pdfText.length > 1000;
const HAS_OFFICIAL = officialHtml.length > 1000;

// 你那份 PDF 是官方页面渲染后打印的，比对前先抹掉三类已知噪声：
// 　1) 页码「15 / 599」和每页书眉（整行独立、前后空行、正文里不会这样出现），以及被挤进正文行的
//     「15/599高性价比人生指南1.不要早死」；
// 　2) 渲染差异：长字段被 splitGain / splitSrc 拆成分点（点号「‣」是渲染加的、分号被当分隔符吃掉）、
//     尖括号 <url> 不显示、markdown 链接只留文字；
// 　3) 排版字形：正文里的 ASCII 减号在 PDF 里排成真减号 U+2212，西文单词跨行断词时连字符被丢掉。
const norm = s => (s || '').replace(/[\s\u3000]/g, '').replace(/[*\\‣<>；;]/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[−‑]/g, '-').replace(/…/g, '...')
  .replace(/[\u2018\u2019']/g, "'").replace(/["\u201C\u201D]/g, '"')
  .replace(/-/g, '');            // 西文单词跨行断词时，PDF 会丢掉连字符
const isHeader = (l, prev, next) => /^\d{1,2}\.\s+\S.{0,40}$/.test(l) && !prev && !next && !l.includes('•');
const lines = pdfText.split(/\r?\n/);
const pdfBody = lines.filter((l, i, a) => {
  const t = l.trim(), p = (a[i - 1] || '').trim(), n = (a[i + 1] || '').trim();
  return !(/^\d+\s*\/\s*\d+$/.test(t) || isHeader(t, p, n));
}).join('\n');
// 书眉残片：整行的书眉已经按行删掉了；正文里剩下的是「15/599高性价比人生指南1.不要早死」这类被挤进
// 正文行的写法。只按观测到的固定形态删：页码分母全书只有 599（正文里的 110/120、002/146 不能碰），
// 书名「高性价比人生指南」正文出现 0 次。节名不做全局删除——它同时也是目录页的正文内容，误伤面太大。
let PDF = norm(pdfBody).replace(/\d{1,3}\/599/g, '').replace(/高性价比人生指南/g, '');
const both = norm;
// 有序分块命中：把字段切成 40 字一块，逐块在 PDF 里往后找。
// 页眉插进句子只会打断它所在的那一块，前后块照样命中，所以这个口径既能容版式噪声、又不放过内容差异。
function blockCov(text, hay = PDF) {
  const t = text;
  let hit = 0, n = 0, pos = 0;
  for (let i = 0; i < t.length; i += 40) {
    const seg = t.slice(i, i + 40);
    if (seg.length < 15) break;
    n++;
    const j = hay.indexOf(seg, pos);
    if (j >= 0) { hit++; pos = j + seg.length - 8; }
  }
  return n ? hit / n : 1;
}
const stripUrl = s => s.replace(/https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]+/g, '');
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });
const skip = (name, why) => results.push({ name, pass: null, detail: why });

/* ——— 1. 官方口径常量有没有抄错（逐字比对在线版源码）——— */
// 把在线版源码和我们移植的常量都做成「去空白 + 引号统一」的形态再比，避免格式差异误报
const canon = s => s.replace(/\s+/g, '').replace(/["`]/g, "'");
const ORE = canon(officialHtml);
const NO_OFFICIAL = '跳过：本地没有 build/raw/index.html，先跑 node build/fetch.mjs';
const OFFICIAL_CHECKS = ['三张显示表的中文措辞与在线版逐字一致', '成本权重 COST_W 与在线版一致', 'ratio 判定式与在线版一致', 'dispute / todo 判据与在线版一致'];
if (HAS_OFFICIAL) {
  const dispStrings = [
    ...Object.values(LABEL_PORTED.money), ...Object.values(LABEL_PORTED.time), ...Object.values(LABEL_PORTED.will),
    ...Object.values(LENS_PORTED), ...Object.values(WHO_PORTED),
  ];
  const missingStrings = dispStrings.filter(s => !officialHtml.includes(s));
  check(OFFICIAL_CHECKS[0], missingStrings.length === 0, missingStrings.join(','));
  const wOK = ['money:{0:0,', "money:{'0':0", "money:{`0`:0"].some(t => ORE.includes(canon(t))) &&
    ORE.includes(canon("time:{'少':0,'中':1,'多':2}")) && ORE.includes(canon("will:{'否':0,'些':1,'是':2}"));
  check(OFFICIAL_CHECKS[1], wOK, '');
  check(OFFICIAL_CHECKS[2], ORE.includes(canon("e.ratio = e.level === '大' ? (e.cs === 0 ? '极高' : (e.cs <= 2 ? '高' : '一般'))")), '');
  check(OFFICIAL_CHECKS[3], ORE.includes(canon('e.dispute = /^争议/.test(e.note);')) && ORE.includes(canon('e.todo = /待核实|TODO/.test(e.src + e.gain + e.note + e.cost);')), '');
} else OFFICIAL_CHECKS.forEach(n => skip(n, NO_OFFICIAL));
const drift = entries.filter(e => e.cs !== csOf(e) || e.ratio !== ratioOf(e));
check('每条的 cs / ratio 可按官方式复算', drift.length === 0, drift.slice(0, 5).map(e => e.id).join(','));

/* ——— 2. 数量对账 ——— */
check('条目 772', stat.entries === 772, String(stat.entries));
check('节 34', stat.sections === 34, String(stat.sections));
const hashCounts = sections.every(s => s.count === entries.filter(e => e.sec === s.no).length);
check('每节条目数与正文 ### 数一致', hashCounts, '');
const gradeOK = stat.grade.A === 497 && stat.grade.B === 223 && stat.grade.C === 52;
check('证据等级 A497 / B223 / C52', gradeOK, JSON.stringify(stat.grade));
check('性价比 极高123 / 高343 / 一般306', stat.ratio['极高'] === 123 && stat.ratio['高'] === 343 && stat.ratio['一般'] === 306, JSON.stringify(stat.ratio));
check('争议条目 90', stat.dispute === 90, String(stat.dispute));
check('来源 URL 非空 767/772', stat.withUrl === 767, String(stat.withUrl));
check('六字段无空缺', stat.noFields.length === 0, stat.noFields.join(','));
check('标签无缺失', entries.every(e => e.money && e.time && e.will && e.level && e.lens), '');
check('带后缀的证据等级 5 条例外', stat.gradeNotes.length === 5, stat.gradeNotes.map(g => g.id).join(','));

/* ——— 3. 与你 PDF 全文逐条比对 ——— */
const PDF_CHECKS = ['772 条标题在你的 PDF 全文命中', '说人话段与 PDF 逐字一致', '成本段与 PDF 逐字一致',
  '收益段与 PDF 分块一致（≥98% 块命中）', '备注段与 PDF 分块一致（≥98% 块命中）',
  '来源段（去 URL、去断词连字符）与 PDF 分块一致', 'PDF 快照版本号为 49fceab'];
if (HAS_PDF) {
const missTitle = entries.filter(e => !PDF.includes(both(e.title)));
check('772 条标题在你的 PDF 全文命中', missTitle.length === 0, missTitle.length ? missTitle.slice(0, 5).map(e => e.id + ' ' + e.title).join(' | ') : '772/772');
for (const [field, label] of [['human', '说人话'], ['cost', '成本']]) {
  const miss = entries.filter(e => !PDF.includes(both(e[field])));
  check(`${label}段与 PDF 逐字一致`, miss.length === 0, miss.length ? `缺 ${miss.length} 条：` + miss.slice(0, 8).map(e => e.id).join(',') : '772/772');
}
for (const [field, label] of [['gain', '收益'], ['note', '备注']]) {
  const low = entries.map(e => [e, blockCov(both(e[field]))]).filter(x => x[1] < 0.98);
  check(`${label}段与 PDF 分块一致（≥98% 块命中）`, low.length === 0,
    low.length ? `${low.length} 条偏低：` + low.slice(0, 6).map(x => `${x[0].id}(${(x[1] * 100).toFixed(0)}%)`).join(' ') : '772/772');
}
// 来源段：PDF 排版会把长西文单词跨行断开并丢掉连字符，所以去掉 URL、去掉连字符后再比分块
const srcLow = entries.map(e => [e, blockCov(stripUrl(both(e.src)), stripUrl(PDF))]).filter(x => x[1] < 0.98);
check('来源段（去 URL、去断词连字符）与 PDF 分块一致', srcLow.length === 0,
  srcLow.length ? `${srcLow.length} 条偏低：` + srcLow.slice(0, 6).map(x => `${x[0].id}(${(x[1] * 100).toFixed(0)}%)`).join(' ') : '772/772');
check('PDF 快照版本号为 49fceab', /正文提交 49fceab/.test(pdfText.slice(0, 2000)), (pdfText.match(/正文提交 \w+/) || [''])[0]);
} else PDF_CHECKS.forEach(n => skip(n, '跳过：本地没有 book_raw.txt（原书 PDF 抽取的全文，只在你机器上，不进版本库）'));

/* ——— 4. 结构健康度 ——— */
const ids = new Set(entries.map(e => e.id));
const broken = entries.flatMap(e => e.xref.filter(k => !ids.has(k)).map(k => `${e.id}->${k}`));
check('条目互指（第 N 节第 M 条）无死链', broken.length === 0, broken.slice(0, 8).join(' '));
check('互指边数 ≥ 400', stat.xrefEdges >= 400, String(stat.xrefEdges));
check('长文附录 9 篇', stat.docs === 9, String(stat.docs));
check('长文小步骤解析出条目', stat.docItems > 100, String(stat.docItems));
const docMissXref = docs.flatMap(d => d.items.flatMap(b => b.list.flatMap(i => i.xref.filter(k => !ids.has(k)).map(k => `${d.name}/${i.n}->${k}`))));
check('长文里引用的条号都存在', docMissXref.length === 0, docMissXref.slice(0, 8).join(' '));
check('每条都有可用的检索串 hay', entries.every(e => e.hay && e.hay.includes(e.title.toLowerCase())), '');
const dirtyUrl = entries.filter(e => e.urls.some(u => /[^\x21-\x7E]/.test(u)));
check('抽出的 URL 全是可点 ASCII、没混进中文或空白', dirtyUrl.length === 0,
  dirtyUrl.slice(0, 3).map(e => e.id + ' ' + e.urls.filter(u => /[^\x21-\x7E]/.test(u)).join(' ')).join(' | '));

/* ——— 报告 ——— */
const bad = results.filter(r => r.pass === false);
const skipped = results.filter(r => r.pass === null);
const passed = results.filter(r => r.pass === true);
for (const r of results) console.log(`${r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'SKIP'}  ${r.name}${r.detail ? '  —  ' + r.detail : ''}`);
const skipNote = skipped.length ? ` · 跳过 ${skipped.length} 项（缺本地原文）` : '';
console.log(`\n${passed.length}/${results.length - skipped.length} 通过${skipNote} · 数据指纹 ${stat.content_sha256} · ${stat.entries} 条 / ${stat.sections} 节 / ${stat.docs} 篇长文`);
process.exit(bad.length ? 1 : 0);
