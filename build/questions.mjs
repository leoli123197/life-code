// 自测题库：官方 selfcheck.html 的 78 道人工题（结构化抽取，不执行页面代码）
//          + 其余 25 节按条目自动出题（规则表 + 排除名单落在 overrides 里，供人工抽查后定稿）
// 用法：node build/questions.mjs        →  build/data/questions.json
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rd = async p => readFile(path.join(HERE, p), 'utf8');
const entries = JSON.parse(await rd('data/entries.json'));
const sections = JSON.parse(await rd('data/sections.json'));
const html = await rd('raw/selfcheck.html');

/* ——— 0. 从 GROUPS 源码里按平衡括号切出对象，再逐字段正则取值 ——— */
function sliceArray(src, marker) {
  const i = src.indexOf(marker);
  const start = src.indexOf('[', i);
  let depth = 0, q = null, out = '';
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { out += c + src[++k]; continue; } if (c === q) q = null; out += c; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    if (c === ']' || c === '}' || c === ')') depth--;
    out += c;
    if (c === ']' && depth === 0) break;
  }
  return out;
}
/** 顶层 {…} 对象文本序列（不递归进去） */
function topObjects(block) {
  const res = []; let depth = 0, buf = '', inStr = null;
  for (let k = 0; k < block.length; k++) {
    const c = block[k];
    if (inStr) { buf += c; if (c === '\\') { buf += block[++k] || ''; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; buf += c; continue; }
    if (c === '{') { depth++; if (depth === 1) { buf = ''; continue; } }
    if (c === '}') { depth--; if (depth === 0) { res.push(buf); continue; } }
    if (depth > 0) buf += c;
  }
  return res;
}
const field = (obj, name) => {
  const m = new RegExp(`(?:^|[,\\s])` + name + `:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"|(\\d+)|([^,\\]}]+))`).exec(obj);
  if (!m) return undefined;
  if (m[1] !== undefined) return m[1].replace(/\\'/g, "'");
  if (m[2] !== undefined) return m[2];
  if (m[3] !== undefined) return +m[3];
  return m[4].trim();
};
/** when 条件解析成声明式对象，页面里只按对象判断，不执行原书代码 */
function parseWhen(obj) {
  const m = /when:\s*p\s*=>\s*([^,}]+(?:,[^,}]*\))?)\)?/.exec(obj);
  const src = m ? m[1] : null;
  if (!src) return null;
  const w = {};
  for (const a of src.matchAll(/ageAtLeast\(p\s*,\s*(\d+)\s*\)/g)) w.ageAtLeast = w.ageAtLeast ? Math.min(w.ageAtLeast, +a[1]) : +a[1];
  for (const a of src.matchAll(/p\.sex\s*===\s*'([mf])'/g)) w.sex = a[1];
  for (const a of src.matchAll(/p\.kid\s*===\s*'([yn])'/g)) w.kid4 = a[1] === 'y';
  for (const a of src.matchAll(/p\.preg\s*===\s*'([yn])'/g)) w.preg = a[1] === 'y';
  for (const a of src.matchAll(/p\.elder\s*===\s*'([yn])'/g)) w.elder = a[1] === 'y';
  return Object.keys(w).length ? w : { raw: src };
}
const byKey = (sec, key) => entries.find(e => e.sec === sec && String(e.title).includes(key)) || null;

/* ——— 0. 主题分组：34 节 → 八组（唯一来源在 topics.mjs，检索页卡片网格与侧栏分组共用） ——— */
const { THEME, THEMES } = await import('./topics.mjs');

/* ——— 1. 官方人工题 ——— */
const groupBlock = sliceArray(html, 'const GROUPS =');
const official = [];
const unresolved = [];
for (const g of topObjects(groupBlock)) {
  const name = field(g, 'name'), mod = field(g, 'mod');
  const qi = g.indexOf('qs:[');
  const qsBlock = g.slice(qi + 3);
  for (const q of topObjects(qsBlock)) {
    const sec = +field(q, 'sec'), key = field(q, 'key'), text = field(q, 'text');
    const hint = field(q, 'hint'), rev = field(q, 'rev');
    const e = byKey(sec, key);
    if (!e) unresolved.push(`第 ${sec} 节 标题含「${key}」`);
    official.push({
      id: `off:${sec}:${key}` + (rev ? `:v${rev}` : ''), source: 'official', sec, n: e ? e.n : null,
      entry: e ? e.id : null, key, text, hint: hint || '', rev: rev || 0, when: parseWhen(q),
      group: name, bookGroup: mod, theme: THEME[sec] || mod,
      also: topObjects(/also:\s*\[/.test(q) ? q.slice(q.indexOf('also:') + 6) : '').map(o => {
        const s = +field(o, 'sec'), k = field(o, 'key'); const t = s && k ? byKey(s, k) : null;
        return t ? { sec: s, key: k, entry: t.id } : { sec: s, key: k, entry: null };
      }),
    });
  }
}

/* ——— 3. 自动出题：规则表 + 排除名单（overrides 可人工改，改完重跑即生效）——— */
// 「没有…」开头的标题是条件句（没有授权就别测别人的系统），不是禁令，所以不列进反向开头
const NEG_START = /^(不要|别|不得|不可|不该|不应|莫|勿)/;
// 「每天/每周/每年」是剂量信息，不能当虚词删掉，所以不在 SOFT_START 里
const SOFT_START = /^(要(?!求|命|好|紧)|应该|应(?!用)|记得|优先|尽量)/;
const CAP = 46;   // 题干上限：再长就不像一道选择题了
/** 题干里不保留书里的「：」「—」写法，改成逗号；顺带清掉重复标点 */
function polish(t) {
  return String(t).replace(/[：—]/g, '，').replace(/，{2,}/g, '，').replace(/^，|，$/g, '').trim();
}
/** 超上限就按分隔符截到 CAP 字以内，截掉的后半句进 hint，题干读起来仍是一句人话 */
function clip(text) {
  if (text.length <= CAP) return [text, ''];
  let cut = -1;
  for (let i = 1; i < text.length && i <= CAP; i++) if (/，|、|；|。/.test(text[i])) cut = i;
  if (cut < 12) return [text.slice(0, CAP).trim(), text.slice(CAP).replace(/^[，、；。]*/, '')];
  return [text.slice(0, cut).trim(), text.slice(cut + 1).replace(/^[，、；。]*/, '')];
}
/** 标题 → 一句「做到了＝好习惯」的陈述。官方题一律原样沿用，这里只处理自动题 */
function statement(title) {
  const t = String(title).replace(/\s+/g, ' ').trim();
  const neg = NEG_START.test(t);
  let base = neg ? '不' + t.replace(NEG_START, '') : (t.replace(SOFT_START, '').trim() || t);
  let extra = '';
  const ci = base.search(/[：—]/);
  // 反向题的冒号后面多是「为什么」的解释，题干只留禁令本身，解释挪进提示
  if (neg && ci >= 6 && base.length - ci > 6) { extra = base.slice(ci + 1).trim(); base = base.slice(0, ci); }
  const [text, clipped] = clip(polish(base));
  return [text, [extra, clipped].filter(Boolean).join('，')];
}
/** 场景＋动作型（第 13 节这类）：题干只留场景、问「这一步你知道该怎么做吗」，动作进 hint */
const SCENE_TAIL = '时，我知道第一步该做什么';
function sceneStatement(title) {
  const head = polish(title).replace(/[？?]$/, '');
  const i = head.search(/[，,]/);
  const hasAct = i > 3 && head.length - i > 4;
  let scene = (hasAct ? head.slice(0, i) : head).replace(/^(看到|遇到|发现|如果)/, '').replace(/[。，]$/, '');
  const act = hasAct ? head.slice(i + 1).replace(/^(就|要|先|应该|立刻)/, '') : head;
  let overflow = '';
  if (scene.length + SCENE_TAIL.length > CAP) {                 // 场景太长就按顿号边界截短，截掉的部分并进动作说明
    const bounds = [...scene.matchAll(/[、，]/g)].map(m => m.index)
      .filter(x => x >= 8 && x <= CAP - SCENE_TAIL.length);
    const b = bounds.length ? bounds[bounds.length - 1] : CAP - SCENE_TAIL.length;
    overflow = scene.slice(b + 1);
    scene = scene.slice(0, b);
  }
  const hint = `书里说这一步：${(overflow ? overflow + '、' : '')}${act}`;
  return { text: scene + SCENE_TAIL, hint };
}
const SCENE_SECS = new Set([13]);
/** 明显不是可执行动作的标题：整条只在讲代价、讲原理。锚在句首或句尾，别拿「多少」这种常见字乱捞 */
const EXPLAIN = [
  /^.{0,12}(的代价|的成本|成本有多大|划不划算|意味着什么|为什么|是什么|值不值)/,
  /^(说明|解释|背景|原理|附录|注意要点)([:：，]|$)/,
  /^(多少|差多少|值多少|有多)(贵|难|久|钱)?$/,
  /(值多少钱|有多贵|有多难|要等多久|花多少时间)$/,
];
const DEFAULT_EXCLUDE = [];   // 人工点名排除的条号，写进 overrides

const covered = new Set(official.filter(q => q.entry).map(q => q.entry));
const auto = [], excluded = [];
for (const e of entries) {
  if (covered.has(e.id)) continue;
  const why = [];
  if (EXPLAIN.some(re => re.test(e.title))) why.push('标题像说明代价/原理，不是可执行动作');
  if (e.who.length === 0 && /^(这里|本节|本节讲)/.test(e.title)) why.push('像是章节说明');
  if (why.length) { excluded.push({ entry: e.id, sec: e.sec, n: e.n, title: e.title, why }); continue; }
  const isNeg = NEG_START.test(e.title);
  const style = SCENE_SECS.has(e.sec) ? 'scene' : (isNeg ? 'neg' : (polish(e.title).startsWith('不') ? 'neg2' : 'plain'));
  let text = '', hint = '';
  if (style === 'scene') ({ text, hint } = sceneStatement(e.title));
  else {
    const [t, rest] = statement(e.title);
    text = t;
    hint = rest ? '这条标题的后半句：' + rest : '';
  }
  // 人群条件不在这里重算：自动题一律回挂条目，出题时由页面用官方 fitsMe 语义
  // （人群标签 vs 基本情况）现场过滤，和模块一「我的情况」共用同一套判断，避免两处口径漂移。
  auto.push({
    id: `auto:${e.id}`, source: 'auto', sec: e.sec, n: e.n, entry: e.id, key: e.title,
    text, hint, when: null, hasWho: e.who.length > 0,
    theme: THEME[e.sec], style,
  });
}

/* ——— 4. overrides：题面改写、点名排除、保留官方题 ——— */
const overrides = {
  exclude: DEFAULT_EXCLUDE.concat(excluded.map(x => x.entry)),
  reword: {},                       // {'16-3':'想改的题干'}：手工定稿用
  keepOfficial: official.map(q => q.id),
};
const finalAuto = auto.filter(q => !overrides.exclude.includes(q.entry));
for (const [id, txt] of Object.entries(overrides.reword)) { const q = finalAuto.find(x => x.entry === id); if (q) q.text = txt; }

const byTheme = {};
for (const q of official.concat(finalAuto)) byTheme[q.theme] = (byTheme[q.theme] || 0) + 1;
const out = {
  generated_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
  profile: [
    { id: 'ageYears', text: '你的周岁年龄', type: 'number' },
    { id: 'sex', text: '你的性别', opts: [['m', '男'], ['f', '女']] },
    { id: 'preg', text: '怀孕或备孕吗', opts: [['y', '是'], ['n', '否']] },
    { id: 'kid4', text: '家里有 4 岁以下的孩子吗', opts: [['y', '有'], ['n', '没有']] },
    { id: 'kid318', text: '家有 3 到 18 岁的孩子吗', opts: [['y', '有'], ['n', '没有']] },
    { id: 'elder', text: '家里有老人要照顾吗', opts: [['y', '有'], ['n', '没有']] },
  ],
  themes: THEMES, sections: sections.map(s => ({ no: s.no, title: s.title, theme: THEME[s.no], count: s.count })),
  rules: { cap: CAP, sceneSections: [...SCENE_SECS], negStart: NEG_START.source, softStart: SOFT_START.source },
  official, auto: finalAuto, excluded, overrides,
  stats: {
    official: official.length, officialResolved: official.filter(q => q.entry).length,
    auto: finalAuto.length, excluded: excluded.length + DEFAULT_EXCLUDE.length,
    total: official.length + finalAuto.length, byTheme,
    sectionsCovered: new Set(official.concat(finalAuto).map(q => q.sec)).size,
  },
};
/* ——— 5. 题库对账：一题一条目、不重不漏、题面在阈值内；有问题就非零退出 */
const all = official.concat(finalAuto);
const problems = [];
const ids = new Set(all.map(q => q.id));
if (ids.size !== all.length) problems.push(`题目 id 重复：${all.length - ids.size} 个`);
const coveredOnce = new Map();
for (const q of all) coveredOnce.set(q.entry, (coveredOnce.get(q.entry) || 0) + 1);
const dupEntry = [...coveredOnce.entries()].filter(([, c]) => c > 1);
if (dupEntry.length) problems.push(`同一条目被多道题指向：${dupEntry.map(([k, c]) => `${k}×${c}`).join(' ')}`);
const missing = entries.filter(e => !coveredOnce.has(e.id)).map(e => e.id);
if (missing.length) problems.push(`有 ${missing.length} 个条目没有对应题目：${missing.slice(0, 8).join(' ')}${missing.length > 8 ? ' …' : ''}`);
for (const q of all) {
  if (!q.entry) problems.push(`${q.id} 未定位到条目`);
  if (!String(q.text || '').trim()) problems.push(`${q.id} 题干为空`);
  if (q.source === 'auto' && q.text.length > CAP + 1) problems.push(`${q.id} 题干 ${q.text.length} 字，超过上限 ${CAP}`);
  if (!THEMES.includes(q.theme)) problems.push(`${q.id} 主题「${q.theme}」不在八组里`);
  if (q.sec < 1 || q.sec > 34) problems.push(`${q.id} 节号越界 ${q.sec}`);
  if (q.when && q.when.raw) problems.push(`${q.id} 的出题条件没能结构化：${q.when.raw}`);
}
out.integrity = { entries: entries.length, questions: all.length, problems };

await writeFile(path.join(HERE, 'data', 'questions.json'), JSON.stringify(out), 'utf8');

console.log(`自动题 ${out.stats.auto} 道；规则排除 ${excluded.length} 条`);
console.log(`合计 ${out.stats.total} 题 · 覆盖 ${out.stats.sectionsCovered}/34 节`);
if (unresolved.length) console.log('!! 官方题定位失败：\n  ' + unresolved.join('\n  '));
console.log('按主题：' + Object.entries(byTheme).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('自动题样例：');
for (const st of ['plain', 'neg', 'neg2', 'scene']) {
  const s = finalAuto.filter(q => q.style === st).slice(0, 4);
  console.log(`  [${st}] ` + s.map(q => `${q.sec}-${q.n}「${q.text}」`).join('  '));
}
const cond = finalAuto.filter(q => q.hasWho);
// 官方题数的独立核对：GROUPS 源码里每道题都带一条 text:'…'，正则数一遍和结构化抽取比对
const rawTextCount = (groupBlock.match(/\btext:\s*'/g) || []).length;
console.log(`挂人群标签的自动题 ${cond.length} 道（出题时按基本情况现场过滤），例：` +
  cond.slice(0, 3).map(q => `${q.entry}`).join(' '));
console.log(`官方题：结构化抽取 ${official.length} 道 / 源码 text: 计数 ${rawTextCount} 个${official.length === rawTextCount ? '（一致）' : '（不一致，检查抽取）'}，定位到条目 ${out.stats.officialResolved} 道（计划里的 78 是旧快照口径）`);
if (problems.length) {
  console.log(`!! 题库对账未通过（${problems.length} 项）：\n  ` + problems.slice(0, 12).join('\n  '));
  process.exitCode = 1;
} else {
  console.log(`题库对账：${entries.length} 个条目 → ${all.length} 道题，一题一条、不重不漏，题干都在 ${CAP} 字内`);
}
