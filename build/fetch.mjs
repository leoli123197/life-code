// 抓《高性价比人生指南》正文源文件到 build/raw/
// 数据源：https://eternity4719.github.io/HowToLiveBetter/ （GitHub Pages，直连可达；
// raw.githubusercontent.com 在本机 curl 不通，所以走 Pages 域名）
// 用法：node build/fetch.mjs [--force]
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://eternity4719.github.io/HowToLiveBetter';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'build', 'raw');
const force = process.argv.includes('--force');

// 34 节正文（节号-文件名，取自 README 目录里的链接）
const BOOK = [
  '01-不要早死', '02-不要慢慢死', '03-不要浪费精力', '04-不要浪费时间', '05-不要浪费钱',
  '06-反面清单', '07-没钱的时候怎么活', '08-别把自己搭进去', '09-普通人容易踩的法律红线',
  '10-恋爱和结婚划不划算', '11-程序员和技术人容易踩的红线', '12-创业与做生意', '13-紧急情况',
  '14-账号与信息安全', '15-租房与买房', '16-得了慢性病之后怎么活', '17-家里有老人',
  '18-养孩子划不划算', '19-在职离职和工伤', '20-刚出生的孩子怎么带', '21-出国旅行与境外安全',
  '22-怎么放松', '23-学什么技能划算', '24-看病', '25-人走了以后要办什么', '26-做一个网站或平台',
  '27-怀孕和生产', '28-别为了外形把身体搞坏', '29-遭遇重大打击之后', '30-上学以后的孩子',
  '31-十八岁之后有哪几条路', '32-出国留学', '33-残疾之后怎么活', '34-家里的常备药别吃出事',
];
// 9 篇长文附录
const DOCS = [
  '结婚划不划算', '家庭应急装备清单', '遇到陌生人出事该不该停', '做平台要办哪些证',
  '生物钟和夜班', '被裁了之后先做什么', '孩子出生前后要办的事', '刚确诊慢性病之后',
  '换工作、换城市之前',
];
// 参考页：官方检索页（复用筛选语义）、官方自查页（沿用人工题库措辞）
const EXTRA = ['index.html', 'selfcheck.html', 'README.md'];

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'life-plan-workbench/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

async function pull(list, dir) {
  await mkdir(path.join(RAW, dir), { recursive: true });
  let fresh = 0, cached = 0, fail = 0;
  for (const name of list) {
    const file = path.join(RAW, dir, `${name}.md`);
    if (existsSync(file) && !force && (await readFile(file, 'utf8')).length > 1000) { cached++; continue; }
    for (let try_ = 1; try_ <= 3; try_++) {
      try {
        const txt = await get(`${BASE}/${dir}/${encodeURIComponent(name)}.md`);
        await writeFile(file, txt, 'utf8');
        fresh++;
        break;
      } catch (e) {
        if (try_ === 3) { fail++; console.error(`  失败 ${dir}/${name}: ${e.message}`); }
        else await new Promise(r => setTimeout(r, 800 * try_));
      }
    }
  }
  return { fresh, cached, fail };
}

const out = { book: await pull(BOOK, 'book'), docs: await pull(DOCS, 'docs') };
for (const f of EXTRA) {
  const file = path.join(RAW, f);
  if (existsSync(file) && !force) continue;
  try { await writeFile(file, await get(`${BASE}/${f}`), 'utf8'); }
  catch (e) { console.error(`  失败 ${f}: ${e.message}`); }
}
// 记下源版本：README 首页那行「正文提交 xxx」
let commit = 'unknown';
try {
  const rd = await readFile(path.join(RAW, 'README.md'), 'utf8');
  commit = (rd.match(/正文提交\s*\[?([0-9a-f]{7,40})/) || [])[1] || commit;
} catch {}
await writeFile(path.join(RAW, 'source.json'), JSON.stringify({
  base: BASE, fetched_at: new Date().toISOString(), commit, book: out.book, docs: out.docs,
}, null, 2), 'utf8');
console.log(`book ${out.book.fresh} 新/${out.book.cached} 缓存/${out.book.fail} 失败 · docs ${out.docs.fresh}/${out.docs.cached}/${out.docs.fail} · 正文提交 ${commit}`);
if (out.book.fail + out.docs.fail) process.exit(1);
