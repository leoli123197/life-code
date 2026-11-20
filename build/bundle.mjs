// 打包：template.html + ui.css + app.js + cost-model.mjs + data/*.json → 单文件 HTML
// 用法：node build/bundle.mjs          （产物：高性价比人生指南工作台.html）
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const rd = async p => readFile(path.join(HERE, p), 'utf8');
const OUT = path.join(ROOT, '高性价比人生指南工作台.html');

const [tpl, css, app, modelSrc, topicsSrc] = await Promise.all([rd('template.html'), rd('ui.css'), rd('app.js'), rd('cost-model.mjs'), rd('topics.mjs')]);
const rdj = async n => JSON.parse(await rd('data/' + n));
const [entries, sections, docs, meta] = await Promise.all([rdj('entries.json'), rdj('sections.json'), rdj('docs.json'), rdj('meta.json')]);
let questions = null;
try { questions = await rdj('questions.json'); } catch (e) { /* 模块二还没生成 */ }

/* —— 快照版本：正文提交号，依次从 source.json、PDF 抽取文本、在线版页面里找 —— */
let snapshot = '';
try { snapshot = (JSON.parse(await rd('raw/source.json')).commit || '').trim(); } catch (e) { }
if (!snapshot || snapshot === 'unknown') {
  for (const f of [path.join(ROOT, 'book_raw.txt'), path.join(HERE, 'raw', 'index.html')]) {
    try {
      const m = /正文提交\s*([0-9a-f]{6,40})/.exec(await readFile(f, 'utf8'));
      if (m) { snapshot = m[1]; break; }
    } catch (e) { }
  }
}
if (!snapshot) snapshot = '未知';

/* —— 官方口径：把 cost-model.mjs 的 export 去掉，包成 window.MODEL —— */
const body = modelSrc.replace(/^export\s+/gm, '');
const names = [...modelSrc.matchAll(/^export\s+(?:const|function)\s+(\w+)/gm)].map(m => m[1]);
const modelJS = `(function(){\n${body}\nreturn {${names.join(', ')}};\n})()`;

/* —— 八大主题：同样去掉 export，包成 window.TOPICDATA（检索页卡片网格、侧栏分组、自测主题共用） —— */
const topicsBody = topicsSrc.replace(/^export\s+/gm, '');
const topicNames = [...topicsSrc.matchAll(/^export\s+(?:const|function)\s+(\w+)/gm)].map(m => m[1]);
const topicJS = `(function(){\n${topicsBody}\nreturn {${topicNames.join(', ')}};\n})()`;

const json = o => JSON.stringify(o).replace(/</g, '\\u003c');   // 注入 <script> 内，尖括号一律转义
// 检索串 hay、显示标签、长文 hay 都是运行时按同一公式复原的派生字段，不重复塞进单文件（省约 1/3 体积）
const trimEntry = ({ hay, moneyLabel, timeLabel, willLabel, lensLabel, whoText, ...rest }) => rest;
const trimDoc = ({ hay, ...rest }) => rest;
// 题库里的 key 是「用什么子串定位到条目」的构建期信息，运行时题干用 text、原文用 entry 回查，不必再带一份标题
const trimQ = ({ key, ...rest }) => rest;
const trimQuestions = q => q && { ...q, official: q.official.map(trimQ), auto: q.auto.map(trimQ) };
const appSafe = app.replace(/<\/script/gi, '<\\/script');
const builtAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

let html = tpl
  .replace('/*__CSS__*/', () => css)
  .replace('/*__APP__*/', () => appSafe)
  .replace('/*__MODEL__*/null', () => modelJS)
  .replace('/*__TOPICS__*/null', () => topicJS)
  .replace('/*__DATA__*/null', () => json({ entries: entries.map(trimEntry), sections, docs: docs.map(trimDoc), meta, questions: trimQuestions(questions) }))
  .replace('/*__BUILD__*/null', () => json({ snapshot, builtAt, sha: meta.content_sha256 }));

// questions 单独挂一个全局，模块二直接读
html = html.replace('window.BUILD =', 'window.QUESTIONS = DATA.questions; window.BUILD =');

await writeFile(OUT, html, 'utf8');
const size = (await stat(OUT)).size;
console.log(`已打包 ${path.basename(OUT)}：${(size / 1048576).toFixed(2)} MB · ${entries.length} 条 / ${sections.length} 节 / ${docs.length} 篇长文 · 快照 ${snapshot} · 指纹 ${meta.content_sha256}`);
console.log(`MODEL 暴露：${names.join(', ')}${questions ? ` · 题库 ${questions.stats.total} 题（官方 ${questions.stats.official} + 自动 ${questions.stats.auto}）· 对账 ${questions.integrity && questions.integrity.problems.length ? '未通过' : '通过'}` : ' · 题库未生成'}`);
if (html.includes('/*__')) { console.error('还有没替换掉的占位符：' + (html.match(/\/\*__[A-Z]+__\*\//g) || []).join(' ')); process.exit(1); }
