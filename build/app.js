/* 高性价比人生指南 · 工作台 —— 应用代码（构建时由 bundle.mjs 内联进单文件 HTML）
 * 依赖：window.DATA（entries/sections/docs/meta）、window.MODEL（官方口径常量与比较器）、window.BUILD（构建信息）
 * 口径对齐：筛选语义、hay 检索、splitGain/splitSrc 分点、XREF 引用、PILES 与 byValue 排序，逐条照官方 index.html / selfcheck.html 移植。
 */
(function () {
'use strict';
const D = window.DATA, M = window.MODEL, B = window.BUILD || {};
const E = D.entries, S = D.sections, DOC = D.docs, META = D.meta;
const $ = s => document.querySelector(s);
const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
const ITEMS = new Map(E.map(e => [e.id, e]));
const SECS = new Map(S.map(s => [String(s.no), s]));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/* ===================================================================
 * 本机存储：数组型记录一律走 upsert / softDelete / list，不整包 set 覆盖
 * =================================================================== */
const NS = 'lifeplan$';
const Store = {
  ok: true,
  mem: {},
  key(k) { return NS + k; },
  read(k, dft) {
    try { const v = localStorage.getItem(this.key(k)); return v == null ? dft : JSON.parse(v); }
    catch (e) { this.ok = false; return this.mem[k] !== undefined ? this.mem[k] : dft; }
  },
  write(k, v) {
    try { localStorage.setItem(this.key(k), JSON.stringify(v)); }
    catch (e) { this.ok = false; this.mem[k] = v; }
  },
  /* 单值配置 */
  get(k, dft) { return this.read(k, dft); },
  set(k, v) { this.write(k, v); },
  /* 数组型记录：answers / tasks / favs（备份里可能是 null，一律当空数组看） */
  list(kind) { const v = this.read(kind, null); return Array.isArray(v) ? v.filter(x => x && x.id != null) : []; },
  map(kind) { const m = new Map(); for (const x of this.list(kind)) m.set(String(x.id), x); return m; },
  upsert(kind, item) {
    const arr = this.list(kind), i = arr.findIndex(x => String(x.id) === String(item.id));
    if (i >= 0) arr[i] = Object.assign({}, arr[i], item); else arr.push(item);
    this.write(kind, arr);
    return i >= 0 ? arr[i] : item;
  },
  upsertMany(kind, items) { for (const it of items) this.upsert(kind, it); return items.length; },
  /* 软删：留着记录与理由，随时可恢复；不清空数组 */
  softDelete(kind, id, reason) { return this.upsert(kind, { id, status: 'abandoned', abandonedAt: Date.now(), reason: reason || '' }); },
  restore(kind, id) { return this.upsert(kind, { id, status: 'open', abandonedAt: null, reason: null }); },
  drop(kind, id) { this.write(kind, this.list(kind).filter(x => String(x.id) !== String(id))); },
  dropStatus(kind, st) { this.write(kind, this.list(kind).filter(x => x.status !== st)); },
  exportAll() {
    const out = { app: '高性价比人生指南工作台', exportedAt: new Date().toISOString(), snapshot: B.snapshot, fingerprint: META.content_sha256 };
    for (const k of ['answers', 'tasks', 'favs', 'profile', 'filters', 'quizRuns', 'decide', 'decideHistory', 'todoCfg']) out[k] = this.read(k, null);
    return out;
  },
  importAll(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('不是备份文件');
    const known = ['answers', 'tasks', 'favs', 'profile', 'filters', 'quizRuns', 'decide', 'decideHistory', 'todoCfg'];
    const arrKinds = ['answers', 'tasks', 'favs', 'quizRuns', 'decideHistory'];
    let n = 0;
    for (const k of known) if (obj[k] !== undefined) { this.write(k, obj[k] == null && arrKinds.indexOf(k) >= 0 ? [] : obj[k]); n++; }
    const alive = new Set(ITEMS.keys());
    // 答题记录按题目 id 存，条目号在 entry 字段上；任务按出处 ref.entry 对账
    const lost = (obj.tasks || []).filter(t => t.ref && t.ref.entry && !alive.has(String(t.ref.entry))).length
      + (obj.answers || []).filter(a => a.entry && !alive.has(String(a.entry))).length;
    return { keys: n, lost };
  }
};
const Fav = {
  _s: null,
  set() { if (!this._s) this._s = new Set(Store.list('favs').map(f => String(f.id))); return this._s; },
  reload() { this._s = null; return this.set(); },
  has(id) { return this.set().has(String(id)); },
  toggle(id) {
    const s = this.set(), on = !s.has(String(id));
    if (on) { s.add(String(id)); Store.upsert('favs', { id: String(id), at: Date.now() }); }
    else { s.delete(String(id)); Store.drop('favs', id); }
    return on;
  }
};

/* ===================================================================
 * 文本渲染：markdown 链接 / 裸 URL / 加粗 / 「第 X 节第 Y 条」引用 / 关键词高亮
 * =================================================================== */
const URL_RE = /<?(https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,=%]+)>?/;
const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
const BOLD_RE = /\*\*((?:\\\*|[^*\n])+)\*\*/;
const LINK_RE = new RegExp([MD_LINK_RE.source, URL_RE.source, BOLD_RE.source].join('|'), 'g');
const unescMd = s => s.replace(/\\([*_])/g, '$1');
function trimUrl(u) {
  let t = '';
  for (;;) {
    const ch = u.slice(-1);
    const unbalanced = ch === ')' && (u.split('(').length < u.split(')').length);
    if (!/[）。,，]/.test(ch) && !unbalanced) break;
    t = ch + t; u = u.slice(0, -1);
  }
  return [u, t];
}
function linkHTML(href, text, cls) {
  return `<a href="${esc(href)}" target="_blank" rel="noopener"${cls ? ' class="' + cls + '"' : ''}>${esc(text)}</a>`;
}
/* 关键词高亮：只在纯文本片段上做，避免把 HTML 标签切碎 */
function hl(s, terms) {
  if (!terms || !terms.length) return esc(s);
  const low = s.toLowerCase(); let out = '', i = 0;
  while (i < s.length) {
    let best = -1, bl = 0;
    for (const t of terms) { const k = low.indexOf(t, i); if (k !== -1 && (best === -1 || k < best)) { best = k; bl = t.length; } }
    if (best === -1) { out += esc(s.slice(i)); break; }
    if (best > i) out += esc(s.slice(i, best));
    out += `<mark>${esc(s.slice(best, best + bl))}</mark>`;
    i = best + bl;
  }
  return out;
}
/* 正文引用：整节指路键写 's9'，条目键写 '9-15' */
const NUMS = '[\\d、]+(?:\\s*到\\s*\\d+)?';
const XREF_RE = new RegExp(`第\\s*(\\d+)\\s*节第\\s*(${NUMS})\\s*条|本节第\\s*(${NUMS})\\s*条|第\\s*(${NUMS})\\s*条|第\\s*([\\d、]+)\\s*节`, 'g');
function xrefKeys(sec, spec) {
  const ns = [];
  for (const part of String(spec).split('、')) {
    const r = /^\s*(\d+)\s*到\s*(\d+)\s*$/.exec(part);
    if (r) { const a = +r[1], b = +r[2]; if (b >= a && b - a <= 40) for (let i = a; i <= b; i++) ns.push(i); continue; }
    const n = part.trim(); if (n) ns.push(n);
  }
  return ns.map(n => `${sec}-${n}`).filter(k => ITEMS.has(k));
}
function xrefHTML(s, terms, curSec) {
  const re = new RegExp(XREF_RE.source, 'g'); let m, out = '', last = 0;
  while ((m = re.exec(s))) {
    const keys = m[5] != null
      ? String(m[5]).split('、').map(x => x.trim()).filter(x => SECS.has(x)).map(x => 's' + x)
      : xrefKeys(m[1] != null ? m[1] : curSec, m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4] != null ? m[4] : ''));
    if (!keys.length) continue;
    out += hl(s.slice(last, m.index), terms);
    out += `<span class="xref" tabindex="0" data-keys="${keys.join(',')}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + hl(s.slice(last), terms);
}
/** 一条正文（标题/说人话/收益/备注…）转成 HTML */
function fmt(text, terms, curSec, opts) {
  opts = opts || {};
  const src = String(text == null ? '' : text); let out = '', last = 0, m;
  const re = new RegExp(LINK_RE.source, 'g');
  const push = s => { if (s) out += xrefHTML(unescMd(s), terms, curSec); };
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index)); last = m.index + m[0].length;
    if (m[1] !== undefined) { out += `<strong>${xrefHTML(unescMd(m[1]), terms, curSec)}</strong> ${linkHTML(m[2], m[2].replace(/^https?:\/\//, ''))}`; continue; }
    if (m[3] !== undefined) {
      const pair = trimUrl(m[3]);
      out += linkHTML(pair[0], pair[0].replace(/^https?:\/\//, '').replace(/\/$/, ''), 'url');
      push(pair[1]); continue;
    }
    out += `<strong>${xrefHTML(unescMd(m[4]), terms, curSec)}</strong>`;
  }
  push(src.slice(last));
  return out;
}

/* ——— 官方分点规则（逐字移植 index.html 的 splitGain / splitSrc）——— */
const GAIN_MIN_LEN = 300, GAIN_MIN_CHUNK = 25;
const GAIN_TOPIC_START = [
  /^[^，。「」《》：；（）的]{1,12}看(《|[^，。「」的]{0,10}法[：「（第])/,
  /^《[^》]{2,40}》/,
  /^(?!该|本|此|这|同|上述|但|而|所以|因此|并且|也)[一-龥]{1,12}法(第[一二三四五六七八九十百零]+条|「)/,
  /^(另一|另有一|还有一|再一|又一)(项|篇)/,
  /^(国内|国外|国内外)也有/,
  /^案例[一二三四五六七八九十]/,
  /^(同一天|同一试验|同一指南|同一研究)/,
  /^(美国|英国|欧洲|世界卫生组织|WHO|中国)[^，。]{0,20}(指南|共识|建议|学会)/,
  /^(先说|再说|最后说|先看|再看|最后看)/,
  /^一(项|篇)[^，。]{0,20}(试验|研究|综述|分析|调查)/,
  /^(芬兰|北欧|英国|美国|日本|韩国|瑞典|丹麦|挪威|德国|法国|澳大利亚|加拿大|荷兰|台湾|香港|上海|北京)[^，。]{0,25}(研究|数据库|试验|队列|调查)/,
];
function splitGain(text) {
  if (!text || text.length < GAIN_MIN_LEN) return [text];
  const sentences = []; let buf = '', depth = 0;
  for (const c of text) {
    if ('「『《（'.includes(c)) depth++;
    else if ('」』》）'.includes(c)) depth = Math.max(0, depth - 1);
    buf += c;
    if (c === '。' && depth === 0) { sentences.push(buf); buf = ''; }
  }
  if (buf) sentences.push(buf);
  const chunks = [];
  for (const s of sentences) {
    if (chunks.length && GAIN_TOPIC_START.some(re => re.test(s))) chunks.push(s);
    else if (chunks.length) chunks[chunks.length - 1] += s;
    else chunks.push(s);
  }
  const out = [];
  for (const c of chunks) { if (out.length && c.length < GAIN_MIN_CHUNK) out[out.length - 1] += c; else out.push(c); }
  if (out.length > 1 && out[0].length < GAIN_MIN_CHUNK) out.splice(0, 2, out[0] + out[1]);
  return out;
}
const SRC_OPEN = '「『（', SRC_CLOSE = '」』）';
function splitSrc(text) {
  const parts = []; let buf = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (SRC_OPEN.includes(c)) depth++;
    if (SRC_CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    const semi = c === '；' || (c === ';' && /\s/.test(text[i - 1] || '') && /\s/.test(text[i + 1] || ''));
    if (semi && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  parts.push(buf);
  return parts.map(s => s.trim()).filter(Boolean);
}
const plain = s => String(s || '').replace(/\\([*_])/g, '$1').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<((?:https?:\/\/)[^>]+)>/g, '$1');

/* ===================================================================
 * 模块一 · 分类检索
 * =================================================================== */
const DIMS = ['sec', 'ratio', 'lens', 'grade', 'money', 'time', 'will', 'who'];
const state = { q: '', sec: new Set(), ratio: new Set(), lens: new Set(), grade: new Set(), money: new Set(), time: new Set(), will: new Set(), who: new Set(), dispute: false, todo: false, fav: false, view: 'search', boardOpen: true };
let CUR_TERMS = [], CUR_KEY = '';

/* —— 八大主题：34 节 → 八块。定义在 build/topics.mjs，与自测出题用的是同一份映射，
 *    点卡片只是把这一块的节号灌进 state.sec，筛选口径仍是官方那套，不新增维度。 —— */
const TD = window.TOPICDATA || { TOPICS: [], ICONS: {} };
const TOPICS = TD.TOPICS, TICON = TD.ICONS || {};
const TOPIC_OF = new Map();
TOPICS.forEach((t, i) => t.secs.forEach(no => TOPIC_OF.set(String(no), i)));
const topicSecs = i => TOPICS[i].secs.map(String);
const topicCount = i => TOPICS[i].secs.reduce((a, no) => a + ((SECS.get(String(no)) || {}).count || 0), 0);
/** 当前 state.sec 恰好等于某一整块主题时返回下标，否则 -1 */
function topicOn() {
  for (let i = 0; i < TOPICS.length; i++) { const s = topicSecs(i); if (s.length === state.sec.size && s.every(x => state.sec.has(x))) return i; }
  return -1;
}
/** 除了章节之外没有任何筛选、也没关键词 ＝ 还在「首屏」状态 */
function bareView() {
  if (state.q.trim()) return false;
  for (const d of ['ratio', 'lens', 'grade', 'money', 'time', 'will', 'who']) if (state[d].size) return false;
  return !state.dispute && !state.todo && !state.fav;
}
function svgIcon(key, cls) {
  const p = TICON[key]; if (!p) return '';
  return `<svg class="${cls || 'tc-svg'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
/** 一块主题里三档性价比各有多少条：卡片底部那根分色条用它，口径直接沿用官方 ratioOf */
function topicRatio(i) {
  const set = new Set(topicSecs(i));
  const c = { '极高': 0, '高': 0, '一般': 0 };
  for (const e of E) if (set.has(String(e.sec))) c[e.ratio] = (c[e.ratio] || 0) + 1;
  return c;
}
function boardHTML() {
  if (!TOPICS.length) return '';
  const on = topicOn();
  return `<section class="board" id="board">
<div class="board-h"><h2>${svgIcon('battery', 'b-svg')}按主题浏览<small>${META.entries} 条分在 ${TOPICS.length} 块里，覆盖全部 ${META.sections} 节。点卡片进这一块并跳到第一节，点卡片里的节号直接跳到那一节。</small></h2>
<p class="board-tip"><button type="button" class="link-btn" id="board-all">不按主题，按书的顺序全看</button></p></div>
<div class="board-grid">${TOPICS.map((t, i) => {
    const r = topicRatio(i), sum = r['极高'] + r['高'] + r['一般'] || 1;
    const seg = (k, cls) => `<i class="${cls}" style="width:${(r[k] / sum * 100).toFixed(1)}%"></i>`;
    return `<article class="tcard" style="--tint:${t.tint}"${i === on ? ' data-on="1"' : ''}>
<button type="button" class="tc-main" data-topic="${i}" aria-pressed="${i === on}" title="只看「${esc(t.name)}」这一块的 ${topicCount(i)} 条，并跳到第一节">
<span class="tc-chip">${svgIcon(t.icon)}</span><span class="tc-h"><b class="tc-t">${esc(t.name)}</b><span class="tc-d">${esc(t.desc || t.tags[0] || '')}</span></span><span class="tc-go" aria-hidden="true">&#8599;</span></button>
<div class="tc-foot"><span class="tc-pill">${topicCount(i)} 条</span><span class="tc-secs">${t.secs.map(no => { const s = SECS.get(String(no)); return `<a href="#sec-${no}" data-go="s${no}" title="${esc(s ? s.title : '')}">第 ${no} 节</a>`; }).join('<span class="tc-dot" aria-hidden="true">·</span>')}</span></div>
<div class="tc-bar" role="img" aria-label="这块里性价比构成：极高 ${r['极高']} 条、高 ${r['高']} 条、一般 ${r['一般']} 条">${seg('极高', 'r3')}${seg('高', 'r2')}${seg('一般', 'r1')}</div>
</article>`;
  }).join('')}</div></section>`;
}
function topicBarHTML(i) {
  const t = TOPICS[i];
  return `<div class="tbar" id="tbar" style="--tint:${t.tint}"><button type="button" class="ghost-btn mini" id="topic-back">&#9666; 八大主题</button>
<span class="tb-chip">${svgIcon(t.icon)}</span>
<b>${esc(t.name)}</b><span class="tb-n">${topicCount(i)} 条 · ${t.secs.length} 节</span>
<span class="tb-secs">${t.secs.map(no => { const s = SECS.get(String(no)); return `<a href="#sec-${no}" data-go="s${no}">${no}. ${esc(s ? s.title : '')}</a>`; }).join('')}</span></div>`;
}
/** 首屏：没有筛选时给八张主题卡；点卡片＝进这一块，卡片网格收起、下面只留一条导航，
 *  内容直接顶到眼前（参考图那条吐槽就是「点主题不跳转」）。「◂ 八大主题」再把网格铺回来。 */
function renderBoard() {
  const host = $('#board-host'); if (!host) return;
  if ($('#doc-view') && !$('#doc-view').hidden) { host.innerHTML = ''; return; }
  const i = topicOn();
  if (i >= 0) { host.innerHTML = (state.boardOpen ? boardHTML() : '') + topicBarHTML(i); return; }
  host.innerHTML = bareView() ? boardHTML() : '';
}
function selectTopic(i) {
  state.sec = new Set(topicSecs(i));
  state.boardOpen = false;
  apply();
  gotoItem('s' + TOPICS[i].secs[0]);            // 跳进这一块的第一个内容，不是停在原地
}
function showBoard() { state.boardOpen = true; apply(); window.scrollTo({ top: 0 }); }
function clearTopic() { state.sec = new Set(); state.boardOpen = true; apply(); window.scrollTo({ top: 0 }); }

const CHIPS = {
  ratio: [['极高', '性价比极高'], ['高', '高'], ['一般', '一般']],
  lens: () => ['死亡率', '金钱', '时间', '自由'].filter(k => E.some(e => e.lens === k)).map(k => [k, M.LENS_LABEL[k] || k]),
  grade: [['A', 'A 级'], ['B', 'B 级'], ['C', 'C 级']],
  money: [['0', '不花钱'], ['少', '花少量钱'], ['多', '花不少钱']],
  time: [['少', '顺手'], ['中', '花几小时'], ['多', '每天占时间']],
  will: [['否', '不用毅力'], ['些', '要一点毅力'], ['是', '要很多毅力']],
  who: () => {
    const seen = [];
    for (const e of E) for (const g of e.who) for (const v of g) if (!seen.includes(v)) seen.push(v);
    return [['无', '都不是'], ...seen.map(v => [v, M.WHO_LABEL[v] || v])];
  }
};
const counts = dim => { const c = {}; for (const e of E) c[e[dim]] = (c[e[dim]] || 0) + 1; return c; };
function buildChips() {
  for (const dim of ['ratio', 'lens', 'grade', 'money', 'time', 'will', 'who']) {
    const def = typeof CHIPS[dim] === 'function' ? CHIPS[dim]() : CHIPS[dim];
    const c = counts(dim === 'who' ? 'who' : dim);
    $('#' + 'f-' + dim).innerHTML = def.map(([v, label]) => {
      const n = dim === 'who' ? E.filter(e => e.who.some(g => g.includes(v) || (v === '无' && !e.who.length))).length : (c[v] || 0);
      return `<button data-v="${esc(v)}" aria-pressed="false">${esc(label)}<i>${n}</i></button>`;
    }).join('');
  }
}
function buildSecList() {
  const row = s => {
    const toc = E.filter(e => e.sec === s.no).map(e => `<li data-toc="${e.id}"><a href="#e-${e.id}" data-go="${e.id}"><span class="tno">${e.n}.</span>${esc(plain(e.title))}</a></li>`).join('');
    return `<div class="srow" aria-current="false"><button class="fold" data-fold="${s.no}" aria-label="展开第 ${s.no} 节目录">▸</button>`
      + `<button data-v="${s.no}" title="${esc(s.title)}">${s.no}. ${esc(s.title)}</button><span class="n" data-n="${s.no}">${s.count}</span></div>`
      + `<ul class="toc" data-toc-for="${s.no}" hidden>${toc}</ul>`;
  };
  // 34 节按八大主题分组列出；没有 TOPICDATA 时退回原来的平铺（构建顺序上不会发生，留个底）
  $('#sec-list').innerHTML = TOPICS.length
    ? TOPICS.map((t, i) => `<div class="sec-g"><button type="button" class="sec-g-t" data-topic="${i}" style="--tint:${t.tint}" aria-pressed="false" title="只看「${esc(t.name)}」这一块的 ${topicCount(i)} 条，并跳到第一节">${esc(t.name)}</button><span class="sec-g-n">${topicCount(i)}</span></div>`
      + S.filter(s => TOPIC_OF.get(String(s.no)) === i).map(row).join('')).join('')
    : S.map(row).join('');
  $('#docs-n').textContent = DOC.length;
  $('#doc-list').innerHTML = DOC.map(d => `<button data-doc="${esc(d.name)}">${esc(d.title)}</button>`).join('');
}

/** 检索页以外的地方（自测三堆、决策结果、待办详情）用的卡片：cardHTML 只给内部结构，这里补上 .card 外壳。
 *  不写 id，免得和检索页里同一条目的卡片撞名。 */
function wrapCard(e, terms) {
  return `<div class="card x-card" data-id="${e.id}" data-sec="${e.sec}">${cardHTML(e, terms || [])}</div>`;
}

/** 卡片：徽标 + 六个字段 + 出处锚点；勾选框喂给模块四的待办 */
let TASK_IDS = new Set();
function cardHTML(e, terms) {
  const fav = Fav.has(e.id);
  const badges = [`<span class="badge ratio ${e.ratio}">性价比${e.ratio}</span>`,
    `<span class="badge grade ${e.grade}">证据 ${e.grade}${e.gradeNote ? ' · ' + esc(plain(e.gradeNote)) : ''}</span>`,
    `<span class="badge">收益${e.level}</span>`,
    `<span class="badge lens">${esc(e.lensLabel)}</span>`,
    `<span class="badge cost">${esc(e.moneyLabel)} · ${esc(e.timeLabel)} · ${esc(e.willLabel)}</span>`,
    e.dispute ? '<span class="badge dispute">有争议</span>' : '',
    e.todo ? '<span class="badge dispute">待核实</span>' : ''].join('');
  const gain = splitGain(e.gain);
  const gainHTML = gain.length > 1 ? `<ul>${gain.map(p => `<li>${fmt(p, terms, e.sec)}</li>`).join('')}</ul>` : fmt(e.gain, terms, e.sec);
  const srcParts = splitSrc(e.src);
  const srcHTML = srcParts.length > 1 ? `<ol>${srcParts.map(p => `<li>${fmt(p, terms, e.sec)}</li>`).join('')}</ol>` : fmt(e.src, terms, e.sec);
  const note = splitGain(e.note);
  const noteHTML = note.length > 1 ? `<ul>${note.map(p => `<li>${fmt(p, terms, e.sec)}</li>`).join('')}</ul>` : fmt(e.note, terms, e.sec);
  return `<div class="card-h"><h3>${fmt(e.title, terms, e.sec)}</h3></div>
<div class="badges">${badges}</div>
${e.human ? `<div class="fld human">${fmt(e.human, terms, e.sec)}</div>` : ''}
<div class="fld cost"><span class="lbl">成本</span>${fmt(e.cost, terms, e.sec)}</div>
<div class="fld gain"><span class="lbl">收益 · ${esc(e.lensLabel)}</span>${gainHTML}</div>
<div class="fld src-box"><span class="lbl">来源${srcParts.length > 1 ? ' · ' + srcParts.length + ' 条' : ''}</span>${srcHTML}</div>
${e.note ? `<div class="fld note"><details${terms.length && terms.some(t => e.src.toLowerCase().includes(t)) && !terms.some(t => (e.title + e.human + e.cost + e.gain + e.note).toLowerCase().includes(t)) ? ' open' : ''}><summary>备注（适用条件、别踩的坑）</summary>${noteHTML}</details></div>` : ''}
${e.whoText ? `<div class="who-line">适用：${esc(e.whoText)}</div>` : ''}
<div class="card-ft"><span class="ref">第 ${e.sec} 节第 ${e.n} 条</span>
<label><input type="checkbox" name="add-todo" class="pick" data-pick="${e.id}"${TASK_IDS.has('e' + e.id) ? ' checked' : ''}>加入待办</label>
<span class="acts"><button class="fav${fav ? ' on' : ''}" data-fav="${e.id}">★ ${fav ? '已收藏' : '收藏'}</button>
<button data-copy="${e.id}">复制全文</button>
<button data-perma="${e.id}">定位</button></span></div>`;
}
const CARDS = [];
function buildBlocks() {
  const host = $('#blocks');
  host.innerHTML = '';
  for (const s of S) {
    const blk = document.createElement('section');
    blk.className = 'sec-block'; blk.id = 'sec-' + s.no; blk.dataset.sec = s.no;
    const intro = s.intro.map((l, i) => `<p class="sec-intro${/^(\*\*)?[^：]{1,12}(\*\*)?：/.test(l) && i > 1 ? ' guide' : ''}">${fmt(l, [], s.no)}</p>`).join('');
    blk.innerHTML = `<div class="sec-h" id="sech-${s.no}"><span class="no">${s.no}.</span><h2>${esc(s.title)}</h2><span class="k" data-k="${s.no}">${s.count} 条</span></div>${intro}`;
    for (const e of E.filter(x => x.sec === s.no)) {
      const card = document.createElement('article');
      card.className = 'card'; card.id = 'e-' + e.id; card.dataset.sec = e.sec; card.dataset.id = e.id;
      card.innerHTML = '<div class="skel"></div>';
      blk.appendChild(card);
      CARDS.push({ e, el: card, vis: false, key: null });
    }
    host.appendChild(blk);
  }
}
const CARD_OF = new Map();
const IO = new IntersectionObserver(list => {
  for (const en of list) {
    const card = CARD_OF.get(en.target);
    if (!card) continue;
    if (en.isIntersecting) { card.vis = true; if (card.key !== CUR_KEY) renderCard(card); IO.unobserve(en.target); }
  }
}, { rootMargin: '900px 0px' });
function renderCard(card, terms, key) {
  terms = terms || CUR_TERMS; key = key !== undefined ? key : CUR_KEY;
  card.el.innerHTML = cardHTML(card.e, terms);
  card.key = key;
}

/* ——— 筛选：同组「或」，跨组「且」，关键词按空白切词后全部命中 ——— */
function fitsMe(e) {
  if (!state.who.size || !e.who.length) return true;
  const has = v => state.who.has(v) || (v === '35岁' && state.who.has('60岁'));
  return e.who.some(g => g.every(has));
}
function matchExceptSec(e, terms) {
  if (state.ratio.size && !state.ratio.has(e.ratio)) return false;
  if (state.lens.size && !state.lens.has(e.lens)) return false;
  if (state.grade.size && !state.grade.has(e.grade)) return false;
  if (state.money.size && !state.money.has(e.money)) return false;
  if (state.time.size && !state.time.has(e.time)) return false;
  if (state.will.size && !state.will.has(e.will)) return false;
  if (!fitsMe(e)) return false;
  if (state.dispute && !e.dispute) return false;
  if (state.todo && !e.todo) return false;
  if (state.fav && !Fav.has(e.id)) return false;
  if (terms.length && !terms.every(t => e.hay.includes(t))) return false;
  return true;
}
function apply() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const key = terms.join(' ');
  CUR_TERMS = terms; CUR_KEY = key;
  let shown = 0, matched = 0; const perSec = {};
  for (const c of CARDS) {
    const base = matchExceptSec(c.e, terms);
    const ok = base && (!state.sec.size || state.sec.has(String(c.e.sec)));
    if (base) matched++;
    if (ok) { shown++; perSec[c.e.sec] = (perSec[c.e.sec] || 0) + 1; if (c.vis && c.key !== key) renderCard(c, terms, key); }
    if (c.el.hidden !== !ok) c.el.hidden = !ok;
  }
  for (const s of S) {
    const blk = document.getElementById('sec-' + s.no);
    const n = perSec[s.no] || 0;
    if (blk.hidden !== (n === 0)) blk.hidden = n === 0;
    const k = blk.querySelector('[data-k]'); if (k) k.textContent = n + ' / ' + s.count + ' 条';
    const cnt = $('[data-n="' + s.no + '"]'); if (cnt) cnt.textContent = n;
    const tocHost = $('[data-toc-for="' + s.no + '"]');
    if (tocHost) for (const li of tocHost.children) li.hidden = !matchExceptSec(ITEMS.get(li.dataset.toc), terms);
  }
  // 侧栏主题组的数字跟着当前筛选走，和组内章节行同一口径（否则选中一块后别组显示满额、子项全是 0，看着像坏了）
  if (TOPICS.length) {
    const live = TOPICS.map(t => t.secs.reduce((a, no) => a + (perSec[no] || 0), 0));
    $$('#sec-list .sec-g-n').forEach((el, i) => { el.textContent = live[i]; el.classList.toggle('zero', live[i] === 0); });
  }
  $('#cnt').textContent = shown;
  $('#cnt-total').textContent = E.length;
  $('#empty').hidden = shown !== 0;
  $('#blocks').hidden = shown === 0;
  renderBoard();
  syncControls();
}
function syncControls() {
  $('#q').value = state.q;
  $$('[data-dim] [data-v]').forEach(b => b.setAttribute('aria-pressed', String(state[b.parentElement.closest('[data-dim]').dataset.dim].has(b.dataset.v))));
  const all = $('#f-sec .all'); all.setAttribute('aria-pressed', String(state.sec.size === 0));
  all.querySelector('i').textContent = E.filter(e => matchExceptSec(e, CUR_TERMS)).length;
  $('#f-dispute').checked = state.dispute;
  $('#f-todo').checked = state.todo;
  $('#f-fav').checked = state.fav;
  $$('#sec-list .srow').forEach(r => r.setAttribute('aria-current', String(state.sec.has(r.querySelector('[data-v]').dataset.v))));
  const on = topicOn();
  $$('#sec-list [data-topic]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.topic === on)));
}
function resetFilters() {
  state.q = ''; for (const d of DIMS) state[d].clear();
  state.dispute = false; state.todo = false; state.fav = false;
  apply(); scrollTo({ top: 0 });
}

/* ——— 跳转与就地展开 ——— */
function ensureRendered(el) {
  const card = CARD_OF.get(el);
  if (card && el.querySelector('.skel')) renderCard(card);
}
function scrollToEl(el, align) {
  let tries = 0, lastY = NaN;
  const settle = () => {
    el.scrollIntoView({ block: align || 'center', behavior: 'auto' });   // 校正期间不能用平滑滚动，两次动画会互相打断
    const y = Math.round(el.getBoundingClientRect().top);
    if (++tries < 10 && y !== lastY) { lastY = y; setTimeout(settle, 50); return; }
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  };
  settle();
}
function gotoItem(key) {
  const isSec = key[0] === 's';
  const id = isSec ? 'sec-' + key.slice(1) : 'e-' + key;
  const el = document.getElementById(id);
  switchView('search'); closeDoc();
  if (!el) return;
  if (!el.offsetParent) resetFilters();          // 目标被筛选藏起来了，先清筛选再跳
  ensureRendered(el);
  if (!isSec) {                                  // 闪一下，让跳过去的卡片在长文档里看得见
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1700);
  }
  scrollToEl(el, isSec ? 'start' : 'center');
}
const POP = $('#xpop');
let POP_T0 = 0;
function showXref(span) {
  POP.querySelectorAll('.xp-b').forEach(n => n.remove());
  POP.querySelector('.xp-h b').textContent = span.textContent;
  const keys = span.dataset.keys.split(',');
  for (const k of keys) {
    const b = document.createElement('div'); b.className = 'xp-b';
    if (k[0] === 's') {
      const s = SECS.get(k.slice(1)); if (!s) continue;
      b.innerHTML = `<div class="xp-s">整节，共 ${s.count} 条</div><strong>${s.no}. ${esc(s.title)}</strong>`;
    } else {
      const e = ITEMS.get(k); if (!e) continue;
      b.innerHTML = `<div class="xp-s">第 ${e.sec} 节第 ${e.n} 条</div><strong>${fmt(e.title, [], e.sec)}</strong>`
        + (e.human ? `<p>${fmt(e.human, [], e.sec)}</p>` : '');
    }
    POP.appendChild(b);
  }
  POP.dataset.go = keys[0];
  POP.hidden = false; POP_T0 = Date.now();
  const r = span.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  POP.style.top = (window.scrollY + r.bottom + 6) + 'px';
  POP.style.left = Math.max(window.scrollX + 14, Math.min(window.scrollX + r.left, window.scrollX + vw - POP.offsetWidth - 16)) + 'px';
}
POP.querySelector('.xp-jump').onclick = () => { const k = POP.dataset.go; POP.hidden = true; if (k) gotoItem(k); };
POP.querySelector('.xp-x').onclick = () => { POP.hidden = true; };

/* ——— 单条复制：给别的模块和「复制本次检索到的条目」共用 ——— */
function entryText(e) {
  return [`第 ${e.sec} 节第 ${e.n} 条 · ${plain(e.title)}`,
    `性价比 ${e.ratio} ｜ 证据 ${e.grade} 级 ｜ 收益${e.level}（${e.lensLabel}）｜ ${e.moneyLabel} · ${e.timeLabel} · ${e.willLabel}`,
    e.human ? '说人话：' + plain(e.human) : '',
    '成本：' + plain(e.cost),
    '收益：' + plain(e.gain),
    '来源：' + plain(e.src),
    e.note ? '备注：' + plain(e.note) : '',
    e.dispute ? '（这条在原书里标了争议，先看备注的适用条件）' : ''].filter(Boolean).join('\n');
}
function copyText(txt, msg) {
  const done = () => toast(msg || '已复制');
  if (navigator.clipboard && window.isSecureContext !== false) {
    navigator.clipboard.writeText(txt).then(done, () => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
    ta.remove(); ok ? done() : toast('浏览器不让直接复制，已选中文本，按 Ctrl+C', 3000);
  }
}
let toastEl, toastT;
function toast(msg, ms) {
  clearTimeout(toastT);
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.style.display = 'block';
  toastT = setTimeout(() => { toastEl.style.display = 'none'; }, ms || 1600);
}

/* ——— 由条目生成待办（模块四读写同一份记录）——— */
function taskFromEntry(e) {
  const short = (plain(e.title).split(/[，,；;。]/)[0] || plain(e.title)).slice(0, 34);
  return { id: 'e' + e.id, kind: 'entry', ref: { entry: e.id, label: `第 ${e.sec} 节第 ${e.n} 条` }, title: short,
    detail: plain(e.human) || plain(e.gain), cost: { money: e.moneyLabel, time: e.timeLabel, will: e.willLabel },
    will: e.will, ratio: e.ratio, level: e.level, lens: e.lensLabel, grade: e.grade, dispute: e.dispute,
    urls: e.urls, due: '', note: '', status: 'open', doneAt: null, createdAt: Date.now(), source: 'search' };
}
function addTask(entryId, source) {
  const e = ITEMS.get(entryId); if (!e) return false;
  const t = taskFromEntry(e); t.source = source || t.source;
  const existed = Store.list('tasks').some(x => String(x.id) === t.id && x.status !== 'abandoned');
  if (!existed) Store.upsert('tasks', t);
  refreshTodoBadge();
  return !existed;
}
function refreshTodoBadge() {
  const all = Store.list('tasks');
  TASK_IDS = new Set(all.map(t => String(t.id)));
  const open = all.filter(t => t.status === 'open');
  $('#todo-n').textContent = open.length ? '(' + open.length + ')' : '';
}

/* ===================================================================
 * 模块二 · 现状自测：官方题 + 全书自动题按主题和基本情况出题，结果不给总分
 * =================================================================== */
const QB = D.questions || null;
const QALL = QB ? QB.official.concat(QB.auto) : [];
const qById = new Map(QALL.map(q => [q.id, q]));
const validAge = a => a !== undefined && a !== null && String(a).trim() !== '' && Number.isInteger(+a) && +a >= 0 && +a <= 120;
const QCFG = Store.get('quiz', null) || {};
const quiz = { phase: QCFG.phase || 'ask', themes: new Set(QCFG.themes || []), secs: new Set((QCFG.secs || []).map(String)) };
const saveQuiz = () => Store.set('quiz', { phase: quiz.phase, themes: [...quiz.themes], secs: [...quiz.secs] });
const SEG3 = [['y', '做到了'], ['n', '没做到'], ['s', '不适用']];

/** 六项都填到位才算填完：年龄看 validAge，其余看题库里那一项的合法取值（性别是 m/f，不是 y/n） */
function profValOk(f, v) { return f.type === 'number' ? validAge(v) : (f.opts || []).some(o => o[0] === v); }
function prof() { return Store.get('profile', null) || {}; }
function profDone() { const p = prof(); return !!QB && QB.profile.every(f => profValOk(f, p[f.id])); }
function ansMap() { const m = new Map(); for (const a of Store.list('answers')) m.set(String(a.id), a.v); return m; }
function setAns(qid, v) { const q = qById.get(qid); Store.upsert('answers', { id: qid, v, entry: q ? q.entry : null, at: Date.now() }); }
/** 自测联动：上一轮转成待办的「没做到」，新一轮没答过的题自动预填成「没做到」，改主意点一下就行 */
const PREFILL = new Set();
function prefillMiss() {
  PREFILL.clear();
  const miss = new Set(Store.list('tasks').filter(t => t.source === 'quiz' && t.status !== 'abandoned' && t.ref && t.ref.entry).map(t => String(t.ref.entry)));
  if (!miss.size) return 0;
  const A = ansMap();
  for (const q of activeQs()) {
    if (A.get(q.id) || !miss.has(String(q.entry))) continue;
    Store.upsert('answers', { id: q.id, v: 'n', entry: q.entry, at: Date.now(), prefill: 1 });
    PREFILL.add(q.id);
  }
  return PREFILL.size;
}
/** 基本情况 → 书里的「人群」标签集合（60 岁以上自动满足 35 岁以上，和模块一同一条规则） */
function whoTags() {
  const p = prof(), s = new Set();
  if (p.sex === 'f') s.add('女性');
  if (p.preg === 'y') s.add('怀孕');
  if (p.kid4 === 'y') s.add('婴幼儿');
  if (p.kid318 === 'y') s.add('孩子');
  if (p.elder === 'y') s.add('老人');
  if (validAge(p.ageYears)) { if (+p.ageYears >= 35) s.add('35岁'); if (+p.ageYears >= 60) s.add('60岁'); }
  return s;
}
function fitsProfile(e) {
  if (!e || !e.who || !e.who.length) return true;
  const t = whoTags(), has = v => t.has(v) || (v === '35岁' && t.has('60岁'));
  return e.who.some(g => g.every(has));
}
/** 官方题自带的出题条件（build/questions.mjs 把 when 编成了声明式字段，这里只做判断，不执行原书代码） */
function whenOk(q) {
  const w = q.when, p = prof();
  if (!w) return true;
  if (w.ageAtLeast && !(validAge(p.ageYears) && +p.ageYears >= w.ageAtLeast)) return false;
  if (w.sex && p.sex !== w.sex) return false;
  if (w.kid4 && p.kid4 !== 'y') return false;
  if (w.preg && p.preg !== 'y') return false;
  if (w.elder && p.elder !== 'y') return false;
  return true;
}
function inScope(q) {
  if (quiz.themes.size && !quiz.themes.has(q.theme)) return false;
  if (quiz.secs.size && !quiz.secs.has(String(q.sec))) return false;
  return true;
}
/** 出题：主题/节选中 ∧（官方题的 when 条件 ∧ 条目人群；自动题的条目人群）。官方题也过一遍人群，
 *  因为我们的基本情况比原自查页多几项，孕产、婴幼儿这类题不该问不相干的人。 */
function activeQs() {
  if (!QB || !profDone()) return [];
  return QALL.filter(q => inScope(q) && whenOk(q) && fitsProfile(ITEMS.get(q.entry)));
}
function groupBy(arr, key) { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }

function qRowHTML(q, cur, taskIds) {
  const off = q.source === 'official' ? '<span class="q-off">原书自查题</span>' : '';
  const hint = q.hint ? `<small>${esc(q.hint)}</small>` : '';
  const onTask = taskIds.has('e' + q.entry) ? '<span class="q-task">待办里有</span>' : '';
  const pf = PREFILL.has(q.id) ? '<span class="q-task q-pf">上次没做到，已预填</span>' : '';
  return `<div class="q-row${cur ? ' ans-' + cur : ''}" data-q="${esc(q.id)}">
  <div class="q-txt">${esc(q.text)}${off}${onTask}${pf}${hint}</div>
  <div class="q-act"><span class="seg3">${SEG3.map(([v, t]) => `<button type="button" data-a="${v}" aria-pressed="${cur === v}">${t}</button>`).join('')}</span>
  <a class="q-ref" href="#e-${q.entry}" data-go="${q.entry}">第 ${q.sec} 节第 ${q.n} 条</a></div></div>`;
}

function quizAskHTML(list, A) {
  const p = prof();
  let h = `<div class="quiz-h"><h2>现状自测</h2><p class="note-strip"><b>为什么不算「少活几年」：</b>每条的数字来自不同研究、不同人群，而且抽烟、不运动、睡得差这些习惯常常一起出现。把各条的风险乘到一起会重复计算，算出来的年数会偏大，偏多少也说不清。所以每条只给它自己那份证据，这里也不给总分。</p></div>`;
  h += `<section class="quiz-card"><h3>基本情况<small>决定问哪些题，答完就按这个筛</small></h3>`;
  for (const f of QB.profile) {
    if (f.type === 'number') {
      h += `<div class="pf"><span>${esc(f.text)}</span><input type="number" name="pf-${f.id}" inputmode="numeric" min="0" max="120" step="1" data-pf="${f.id}" value="${esc(String(p[f.id] == null ? '' : p[f.id]))}" aria-label="${esc(f.text)}"></div>`;
    } else {
      h += `<div class="pf"><span>${esc(f.text)}</span><span class="seg3">${f.opts.map(([v, t]) => `<button type="button" data-pf="${f.id}" data-v="${v}" aria-pressed="${p[f.id] === v}">${t}</button>`).join('')}</span></div>`;
    }
  }
  const n = list.filter(q => A.get(q.id)).length;
  h += `<p class="hint">已选主题：${quiz.themes.size ? [...quiz.themes].join('、') : '全部八组'}　·　本轮出 ${list.length} 题，已答 ${n} 题。
  <button class="ghost-btn" id="q-out"${profDone() && n ? '' : ' disabled'}>看本轮结果</button></p>${PREFILL.size ? `<p class="note-strip">待办清单里有 ${PREFILL.size} 条是从自测转过去的，这轮先按「没做到」给你预填上了（题目标了「上次没做到，已预填」）。做到了就点「做到了」覆盖，不改也行——这样自测和待办对得上账。</p>` : ''}</section>`;
  if (!profDone()) return h + `<section class="quiz-card"><p class="empty-line">基本情况还没填完（周岁、性别、是否怀孕备孕、4 岁以下、3–18 岁、家有老人，六项都要选）。填完就按你的情况出题。</p></section>`;
  if (!list.length) return h + `<section class="quiz-card"><p class="empty-line">这个主题组合下没有题。左侧「现状自测」里换一组主题，或者把按节细选清空。</p></section>`;
  const byTheme = groupBy(list, q => q.theme);
  for (const [th, qs] of byTheme) {
    qs.sort((a, b) => a.sec - b.sec || a.n - b.n);
    const done = qs.filter(q => A.get(q.id)).length;
    h += `<section class="q-block" data-theme="${esc(th)}"><h3>${esc(th)}<small>${done} / ${qs.length} 题已答</small></h3>` + qs.map(q => qRowHTML(q, A.get(q.id), TASK_IDS)).join('') + '</section>';
  }
  return h;
}

function quizOutHTML(list, A) {
  const yes = list.filter(q => A.get(q.id) === 'y'), no = list.filter(q => A.get(q.id) === 'n');
  const answered = yes.length + no.length;
  const blocks = [...groupBy(list, q => q.theme)].map(([th, qs]) => {
    const y = qs.filter(q => A.get(q.id) === 'y').length, n = qs.filter(q => A.get(q.id) === 'n').length;
    return { th, y, t: y + n, pct: y + n ? y / (y + n) : 1 };
  }).filter(r => r.t).sort((a, b) => a.pct - b.pct || b.t - a.t);
  const runs = Store.list('quizRuns');
  const last = runs[runs.length - 1];
  const missE = no.map(q => ITEMS.get(q.entry)).filter(Boolean).sort(M.byValue);
  const easy = missE.filter(e => e.will === '否'), free = easy.filter(e => e.money === '0'), disp = missE.filter(e => e.dispute);
  let v = `本轮答了 <b>${answered}</b> 题（还有 ${list.length - answered} 题没答），其中做到 <b>${yes.length}</b> 项、没做到 <b>${no.length}</b> 项。`;
  if (answered && !no.length) v += '书里这些你都已经做到了。';
  if (blocks.length) v += `漏得最多的是「${esc(blocks[0].th)}」：${blocks[0].t} 项里做到 ${blocks[0].y} 项。`;
  if (easy.length) v += `没做到的里有 <b>${easy.length}</b> 项一次办完就行，不用改习惯` + (free.length ? `，其中 ${free.length} 项不花钱。` : '。');
  if (disp.length) v += `有 ${disp.length} 项证据本身有争议，动手前先看原条目的备注。`;
  let h = `<div class="quiz-h"><h2>自测结果<small>不给总分：每块各算各的，每条各给各的证据</small></h2>
  <p class="row-btns"><button class="ghost-btn" id="q-back">← 返回改答案</button>
  <button class="ghost-btn" id="q-save">存为本轮结果</button>
  <button class="ghost-btn" id="q-miss2todo">把没做到的加入待办（${no.length}）</button></p>
  <p class="verdict">${v}</p></div>`;
  h += `<section class="quiz-card"><h3>哪一块漏得最多<small>只算答了「做到 / 没做到」的题，「不适用」不进分母</small></h3>`;
  for (const r of blocks) {
    const prev = last && last.blocks && last.blocks[r.th];
    const delta = prev && prev.t ? Math.round((r.pct - prev.y / prev.t) * 100) : null;
    h += `<div class="hbar" title="${esc(r.th)}：答了 ${r.t} 题，做到 ${r.y} 项"><span class="nm">${esc(r.th)}</span>
      <span class="tr"><span class="fl" style="width:${Math.round(r.pct * 100)}%"></span></span>
      <span class="v">${r.y} / ${r.t}${delta === null ? '' : (delta === 0 ? ' <i>持平</i>' : ' <i>' + (delta > 0 ? '↑' : '↓') + Math.abs(delta) + '%</i>')}</span></div>`;
  }
  if (last) h += `<p class="hint">对比的是 ${esc(last.at)} 那一轮（${last.sel}）。存本轮结果后再测，就能看增减。</p>`;
  h += '</section>';
  if (missE.length) {
    const top = missE.slice(0, 3);
    h += `<section class="quiz-card"><h3>先做这${top.length === 3 ? '三' : top.length === 2 ? '两' : '一'}件<small>没做到的里按官方口径排：性价比 → 收益量级 → 毅力 → 证据等级 → 成本合计</small></h3><ol class="top3">`;
    for (const e of top) {
      const pile = (M.PILES.find(x => x.will === e.will) || {}).name || '';
      h += `<li><a href="#e-${e.id}" data-go="${e.id}">${esc(plain(e.title))}</a>
        <span class="why">性价比${e.ratio}、证据 ${e.grade} 级、${pile}${e.money === '0' ? '、不花钱' : ''}</span></li>`;
    }
    h += '</ol><p class="row-btns"><button class="ghost-btn" id="q-copy3">复制这几件事</button></p></section>';
    for (const pile of M.PILES) {
      const items = missE.filter(e => e.will === pile.will);
      if (!items.length) continue;
      h += `<section class="quiz-card"><h3>${pile.name}（${items.length} 项）<small>${pile.sub}</small></h3>`
        + items.map(e => wrapCard(e)).join('') + '</section>';
    }
  } else {
    h += '<section class="quiz-card"><p class="empty-line">没勾「没做到」的题目——要么都做到了，要么还没答。</p></section>';
  }
  if (yes.length) h += `<section class="quiz-card"><h3>已经做到的（${yes.length} 项）<small>只列条号，别的地方不用再看</small></h3><div class="done-list">`
    + yes.map(q => `<a href="#e-${q.entry}" data-go="${q.entry}">第 ${q.sec} 节第 ${q.n} 条 ${esc(plain((ITEMS.get(q.entry) || {}).title || q.text))}</a>`).join('') + '</div></section>';
  return h;
}

function renderQuizSide() {
  const side = $('#quiz-side'); if (!side || !QB) return;
  const p = prof();
  if (!renderQuizSide._cnt) {
    const cnt = { theme: {}, sec: {} };
    for (const q of QALL) { cnt.theme[q.theme] = (cnt.theme[q.theme] || 0) + 1; cnt.sec[q.sec] = (cnt.sec[q.sec] || 0) + 1; }
    renderQuizSide._cnt = cnt;
  }
  const cnt = renderQuizSide._cnt;
  let h = `<section class="fgroup"><h4>想评估哪几块 <button class="all" data-th="">全部八组</button></h4><div class="chips">`;
  for (const th of QB.themes) h += `<button type="button" data-th="${esc(th)}" aria-pressed="${quiz.themes.has(th)}">${esc(th)}<i>${cnt.theme[th] || 0}</i></button>`;
  h += '</div><p class="hint">一项都没勾＝八组全出。题目按你的基本情况筛过：人群不符的（孕产、婴幼儿、老人等）不会问你。</p></section>';
  h += '<section class="fgroup"><h4>按节细选</h4><div class="sec-list">';
  for (const s of QB.sections) h += `<button type="button" data-sec="${s.no}" aria-pressed="${quiz.secs.has(String(s.no))}">${s.no}. ${esc(s.title)}<i>${cnt.sec[s.no] || 0}</i></button>`;
  h += '</div><p class="hint">勾了节就只出这些节的题（和上面的主题取交集）。</p></section>';
  h += `<section class="fgroup"><h4>本轮</h4><p class="hint">已答 ${Store.list('answers').filter(a => a.v).length} 题（历史累计）。基本情况：${validAge(p.ageYears) ? p.ageYears + ' 岁' : '未填'}${p.sex === 'f' ? ' · 女' : p.sex === 'm' ? ' · 男' : ''}。</p>
  <button class="ghost-btn wide" id="q-newrun">开始新一轮（清空本轮答题）</button></section>`;
  side.innerHTML = h;
}

function renderQuiz() {
  const root = $('#quiz-root'); if (!root) return;
  if (!QB) { root.innerHTML = '<p class="hint">题库没打进这份文件——重跑 <code>node build/questions.mjs && node build/bundle.mjs</code>。</p>'; return; }
  renderQuizSide();
  if (quiz.phase === 'ask') prefillMiss();
  const list = activeQs(), A = ansMap();
  root.innerHTML = quiz.phase === 'out' ? quizOutHTML(list, A) : quizAskHTML(list, A);
  root.dataset.n = String(list.length);
}

/** 存一轮结果：只留每块的做到/答了计数和没做到的条号，供下次对比 */
function saveRun() {
  const list = activeQs(), A = ansMap(), blocks = {};
  for (const [th, qs] of groupBy(list, q => q.theme)) {
    const t = qs.filter(q => A.get(q.id) === 'y' || A.get(q.id) === 'n').length;
    blocks[th] = { y: qs.filter(q => A.get(q.id) === 'y').length, t };
  }
  const rec = { id: 'r' + Date.now(), at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    sel: (quiz.themes.size ? [...quiz.themes].join('、') : '全部八组') + (quiz.secs.size ? ' · ' + quiz.secs.size + ' 节' : ''),
    blocks, miss: list.filter(q => A.get(q.id) === 'n').map(q => q.entry), answered: list.filter(q => A.get(q.id)).length };
  const arr = Store.list('quizRuns').slice(-9);
  arr.push(rec); Store.write('quizRuns', arr);
  return rec;
}

function quizClick(ev) {
  const t = ev.target;
  const seg = t.closest('[data-a]');
  if (seg) {
    const row = seg.closest('.q-row'); if (!row) return;
    const q = qById.get(row.dataset.q); if (!q) return;
    const cur = ansMap().get(q.id);
    const v = cur === seg.dataset.a ? '' : seg.dataset.a;
    if (v) setAns(q.id, v); else Store.drop('answers', q.id);
    row.classList.toggle('ans-y', v === 'y'); row.classList.toggle('ans-n', v === 'n'); row.classList.toggle('ans-s', v === 's');
    row.querySelectorAll('[data-a]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.a === v)));
    const blk = row.closest('.q-block');
    if (blk) { const th = blk.dataset.theme, qs = activeQs().filter(x => x.theme === th); blk.querySelector('h3 small').textContent = qs.filter(x => ansMap().get(x.id)).length + ' / ' + qs.length + ' 题已答'; }
    return true;
  }
  const pf = t.closest('[data-pf]');
  if (pf && pf.dataset.v !== undefined) {
    const p = prof(); p[pf.dataset.pf] = p[pf.dataset.pf] === pf.dataset.v ? '' : pf.dataset.v; Store.set('profile', p); renderQuiz(); return true;
  }
  const th = t.closest('[data-th]');
  if (th) { const v = th.dataset.th; if (!v) quiz.themes.clear(); else { quiz.themes.has(v) ? quiz.themes.delete(v) : quiz.themes.add(v); } saveQuiz(); renderQuiz(); return true; }
  const sc = t.closest('[data-sec]');
  if (sc) { const v = String(sc.dataset.sec); quiz.secs.has(v) ? quiz.secs.delete(v) : quiz.secs.add(v); saveQuiz(); renderQuiz(); return true; }
  if (t.closest('#q-back')) { quiz.phase = 'ask'; saveQuiz(); renderQuiz(); return true; }
  if (t.closest('#q-out')) { quiz.phase = 'out'; saveQuiz(); renderQuiz(); scrollTo({ top: 0 }); return true; }
  if (t.closest('#q-newrun')) {
    saveRun();
    Store.write('answers', []);
    quiz.phase = 'ask'; saveQuiz(); renderQuiz();
    toast('上一轮已存档，本轮答题记录已清空'); return true;
  }
  if (t.closest('#q-save')) { saveRun(); toast('已存为本轮结果，再测一次就能对比'); renderQuiz(); return true; }
  if (t.closest('#q-miss2todo')) {
    const list = activeQs().filter(q => ansMap().get(q.id) === 'n');
    let n = 0; for (const q of list) if (addTask(q.entry, 'quiz')) n++;
    refreshTodoBadge(); toast(n ? `已把 ${n} 项没做到的加入待办` : '这些条目都已经在待办里了'); return true;
  }
  if (t.closest('#q-copy3')) {
    const list = activeQs().filter(q => ansMap().get(q.id) === 'n').map(q => ITEMS.get(q.entry)).filter(Boolean).sort(M.byValue).slice(0, 3);
    const txt = '高性价比人生指南 · 先做这几件\n\n' + list.map(e => {
      const pile = (M.PILES.find(x => x.will === e.will) || {}).name || '';
      return `- [ ] ${plain(e.title)}\n  性价比${e.ratio}、证据 ${e.grade} 级、${pile}${e.dispute ? '、有争议（先看备注）' : ''}\n  要花的：${plain(e.cost)}\n  第 ${e.sec} 节第 ${e.n} 条`;
    }).join('\n\n');
    copyText(txt, '这几件事已复制'); return true;
  }
  return false;
}
function quizChange(ev) {
  const inp = ev.target.closest ? ev.target.closest('input[data-pf]') : null;
  if (!inp) return;
  const p = prof(); p[inp.dataset.pf] = inp.value; Store.set('profile', p);
  clearTimeout(quizChange._t); quizChange._t = setTimeout(renderQuiz, 400);
}

/* ===================================================================
 * 模块三 · 人生决策：意图路由 → 关键词打分 → 官方口径排序
 * 纯离线：不联网、不调模型、没有 key。所有答案都是书里的原条目 + 原标签，查不到就说查不到。
 * 打分口径：命中标题 > 命中说人话 > 命中其余字段（越长权重越高），命中该类问题的加权节再 +10；
 * 同分交给官方 byValue（性价比 → 收益量级 → 毅力 → 证据等级 → 成本合计），和自测「先做这几件」同一个比较器。
 * =================================================================== */
const SECS_URGENT = [13, 29, 14, 24, 15, 8, 25];
const SECS_MONEY = [7, 19, 18, 27, 25, 31, 33, 24];
const SECS_LEGAL = [9, 8, 11, 12, 26, 21, 34];
const SECS_SAVE = [5, 6, 24, 15, 22];
const INTENTS = [
  {
    key: 'urgent', name: '出事先做什么', secs: SECS_URGENT, eg: '刚被裁了先做什么',
    re: /(先做什么|先怎么办|先干啥|怎么办|咋办|出事了|急救|拨打|1[12][092]|被裁|裁员|被辞|辞退|劝退|优化掉|中暑|卡喉|噎|火灾|着火|地震|被盗|被偷|被骗|遭抢|车祸|咬伤|抓伤|触电|坠|昏迷|中毒|漏水|漏电|猝死|心梗|脑卒中|中风|烫伤|流鼻血|受伤|失联|走失|走火)/,
    note: '按「先做什么」排：第 13 节是现场急救，第 29 节是家里出事，第 14 节是账号和钱被盗，第 24 节是刚确诊慢性病，第 15 节是当天还能做的保命小事。'
  },
  {
    key: 'legal', name: '这么干犯不犯法', secs: SECS_LEGAL, eg: '替朋友担保签不签',
    re: /(犯法|犯不犯|违法|犯罪|坐牢|牢狱|判刑|拘留|拘役|案底|罪名|诈骗|洗钱|侵权|担责|连带|担保|保证人|代签|代转|走账|过账|刷单|代付|逃税|漏税|避税|虚开|抢票|外挂|翻墙|私装|违禁|合同有.*效力|算不算.*同谋|帮信)/,
    note: '第 9 节是别踩的法律红线，第 8 节是合同与担保，第 11、12 节是消费与维权，第 26 节是交通，第 21 节是工作和钱的纠纷，第 34 节是最后的兜底。'
  },
  {
    key: 'money', name: '能领哪笔钱', secs: SECS_MONEY, eg: '生育津贴怎么领',
    re: /(能领|领取|申领|补贴|津贴|补助金|赔偿|补偿|报销|能报|报哪些|报多少|报不报|理赔|赔付|救助|提取|公积金|医保|社保|养老险|新农合|失业金|养老金|低保|救济|退税|个税|生育|工伤|产假|护理假|年假|哪笔钱|多少钱)/,
    note: '第 7 节是社保与公积金，第 19 节是劳动纠纷里的钱，第 18 节是生娃这几笔，第 27 节是看病报销，第 25、31、33 节是税和转移支付。'
  },
  {
    key: 'choose', name: 'A 还是 B', secs: null, eg: '买房还是租房',
    re: /(还是|选哪|哪个好|哪种好|比一比|对比一下|取舍)/,
    note: '把两边各自的账摆开，同口径才比高低。'
  },
  {
    key: 'save', name: '怎么少花钱', secs: SECS_SAVE, eg: '家里开销怎么砍',
    re: /(省钱|少花|砍[^，。]{0,4}开销|开销|花销|预算|太贵|便宜|订阅|续费|房租|水电|物业费|流量|话费|宽带|保险|税费|退订|性价比|存钱)/,
    note: '第 5 节是消费与砍价，第 6 节是反面清单（别买），第 24 节是医疗开销，第 15 节是日常习惯，第 22 节是省时间的等价物。'
  },
  {
    key: 'value', name: '该不该做 / 值不值', secs: null, eg: '每天通勤两小时值不值',
    re: /(该不该|值不值|值得吗|值得不|要不要|划不划算|划算吗|有必要|亏不亏|用不用)/,
    note: '全库按关键词检索，再按性价比 → 收益量级 → 三项成本 → 证据等级排。'
  },
];
const INTENT_FALLBACK = {
  key: 'all', name: '全书检索', secs: null, eg: '',
  note: '没认出具体是哪类问题，按全书关键词排：标题命中最重，说人话其次，其余字段最轻。'
};
const WARN_LINE = '按中国大陆现行规定写的，各地执行不一样，真去办事、看病、打官司以当地部门、医生和律师的说法为准。';

/* 问句 → 候选词：先摘掉纯疑问词（它们不该参与匹配），再切 2~5 字子串。
   单字虚词（被/了/的）不摘，否则「被裁」「辞退」这类词会被拆散。 */
const STOP_RE = /(还是|请问|帮我|替我|我想问|我想知道|查一下|搜一下|这个|那个|这样|那样|什么时候|什么|怎么|怎样|咋|如何|为什么|为何|该不该|要不要|值不值|划不划算|能不能|可不可以|有没有|是不是|需不需要|哪个|哪种|哪样|多少|一下|或者|以及|如果|因为|所以|但是|然后|现在|最近|觉得|打算|应该|必须|可以|需要|一个|东西)/g;
const dRuns = text => String(text || '').toLowerCase().replace(STOP_RE, ' ').split(/[^0-9a-z一-龥]+/).filter(s => s.length >= 2);
function dGrams(text) {
  const set = new Set();
  for (const r of dRuns(text)) {
    const max = Math.min(5, r.length);
    for (let n = 2; n <= max; n++) for (let i = 0; i + n <= r.length; i++) set.add(r.slice(i, i + n));
  }
  return Array.from(set).slice(0, 160);
}
function lowOf(e) {
  if (e._tl == null) { e._tl = plain(e.title).toLowerCase(); e._hl = plain(e.human).toLowerCase(); }
  return e;
}
let _idfKey = '', _idfMap = null;
/** 每个候选词的全书稀有度：772 条里提到它的条目越少越值钱。
 *  「每天」「小时」「朋友」这种谁都有，权重压到很低；「通勤」「代通知金」才顶得起来。 */
function dIdf(g) {
  const key = g.join('|');
  if (key === _idfKey && _idfMap) return _idfMap;
  const df = g.map(() => 0);
  for (const e of E) {
    lowOf(e);
    for (let i = 0; i < g.length; i++) {
      const t = g[i];
      if (e._tl.indexOf(t) >= 0 || e._hl.indexOf(t) >= 0 || e.hay.indexOf(t) >= 0) df[i]++;
    }
  }
  const m = new Map();
  for (let i = 0; i < g.length; i++) m.set(g[i], Math.log(1 + E.length / (1 + df[i])));
  _idfKey = key; _idfMap = m;
  return m;
}
/** 参与打分的词：只扔掉全书 100 条以上都提到的（「的」「每天」这种没有区分度的），
 *  其余靠 idf 的平方拉开差距——「通勤」比「小时」值钱，但不是天壤之别。 */
function dUseGrams(text) {
  const all = dGrams(text);
  if (!all.length) return { g: [], idf: new Map() };
  const idf = dIdf(all);
  const strong = all.filter(t => idf.get(t) >= 2.2);
  return { g: strong.length ? strong : all, idf };
}
/** 一条问句在全书里命中哪些条目：primary＝标题或说人话里出现过的（正文其他字段罕见精确命中的也算），weak＝只是顺带提到 */
/** 虚词开头 / 结尾的词组降权：「帮朋友」「犯法吗」这种带壳的词，不该比「朋友」「犯法」本身值钱。
 *  「被」不放进名单——「被裁」「被偷」里的被是信息量，降权就查不准了。 */
const FUNC_EDGE = /^[帮替给让叫请我你他她谁这那什]+|[吗呢吧啊呀么的是不有也要在还都就了]+$/;
/** 数量词打头 / 结尾的词组（「两小时」「三次」）说的是量级不是主题，降权，别压过「通勤」这种名词 */
const QTY_EDGE = /^[0-9两一二三四五六七八九十半]+|[小时分钟天次块元年周月岁公里米升杯份趟顿倍成]+$/;
function dSearch(text, secs, limit) {
  const u = dUseGrams(text), g = u.g, idf = u.idf;
  if (!g.length) return { primary: [], weak: [] };
  const primary = [], weak = [];
  for (const e of E) {
    lowOf(e);
    let strong = 0, rare = 0, tier = 0, commonLen = 0;
    const hit = [];
    for (const t of g) {
      if (e._tl.indexOf(t) >= 0) hit.push([t, 3]);
      else if (e._hl.indexOf(t) >= 0) hit.push([t, 2]);
      else if (e.hay.indexOf(t) >= 0) hit.push([t, 1]);
    }
    for (const x of hit) {
      const t = x[0], tr = x[1];
      // 同一个命中被更长的词覆盖了（「两小」算在「两小时」里），不重复计分
      if (hit.some(y => y[1] >= tr && y[0].length > t.length && y[0].indexOf(t) >= 0)) continue;
      const iv = idf.get(t), pen = (FUNC_EDGE.test(t) ? 0.4 : 1) * (QTY_EDGE.test(t) ? 0.5 : 1);
      if (tr === 3) { strong += (12 + t.length * 4) * iv * iv * pen; if (tier < 3) tier = 3; }
      else if (tr === 2) { strong += (8 + t.length * 2) * iv * iv * pen; if (tier < 2) tier = 2; }
      else if (iv >= 3.4) rare += (4 + t.length) * iv * iv * pen;   // 正文字段里少见地精确命中
      else if (t.length > commonLen) commonLen = t.length;          // 谁都有或谁都不提，只算顺带
    }
    const boost = secs && secs.indexOf(e.sec) >= 0 ? 1.6 : 1;
    if (tier >= 2) primary.push({ e, s: (strong + rare * 0.5) * boost });
    else if (rare >= 95) primary.push({ e, s: rare * 0.5 * boost, rare: true });
    else if (rare > 0 || commonLen >= 4) weak.push({ e, s: (rare + commonLen * 6) * 0.35 * boost, weak: true });
  }
  const byS = (a, b) => b.s - a.s || M.byValue(a.e, b.e);
  primary.sort(byS); weak.sort(byS);
  return { primary: primary.slice(0, limit || 10), weak: weak.slice(0, 4) };
}
/** 延伸长文：只有标题和小序里出现才算命中，别拿正文里顺带提一句的长文糊弄人 */
function dDocs(text) {
  const u = dUseGrams(text), g = u.g; if (!g.length) return [];
  const out = [];
  for (const d of DOC) {
    if (d._tl == null) d._tl = (d.title + ' ' + (d.intro || '')).toLowerCase();
    let s = 0, best = 0;
    for (const t of g) {
      let v = 0;
      if (d._tl.indexOf(t) >= 0) v = 10 + t.length * 3;
      else if (d.hay.indexOf(t) >= 0) v = 2 + t.length;
      if (!v) continue;
      if (v > best) best = v;
      s += v * u.idf.get(t);
    }
    if (best >= 16) out.push({ d, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, 3);
}
/** 查不到时给个方向：哪几节沾边 */
function dNear(text) {
  const u = dUseGrams(text), g = u.g; if (!g.length) return [];
  const score = new Map();
  for (const e of E) {
    lowOf(e);
    let best = 0, dec = '';
    for (const t of g) {
      const v = e._tl.indexOf(t) >= 0 ? 12 + t.length * 4 : e._hl.indexOf(t) >= 0 ? 8 + t.length * 2 : e.hay.indexOf(t) >= 0 ? 4 + t.length : 0;
      if (v > best) { best = v; dec = t; }
    }
    if (best >= 6) score.set(e.sec, (score.get(e.sec) || 0) + best * (u.idf.get(dec) || 1));
  }
  return Array.from(score).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
}
const SYNS = {
  裁员: ['被裁', '辞退', 'N+1', '代通知金', '赔偿'], 解雇: ['辞退', '裁员', '经济补偿'],
  担保: ['保证人', '连带', '签字'], 借钱: ['借条', '利息', '担保'], 医保: ['社保', '异地就医', '报销'],
  失业金: ['失业保险金', '技能提升补贴'], 房贷: ['利率', '转按揭', '提前还款'], 疫苗: ['接种', 'HPV', '狂犬'],
  头盔: ['骑车', '电动车', '安全带'], 猫: ['宠物', '狂犬'], 狗: ['咬伤', '狂犬'],
  钱: ['补贴', '津贴', '报销', '赔偿'], 税: ['个税', '汇算', '退税', '专项附加'],
  合同: ['协议', '条款', '违约金'], 加班: ['调休', '工资', '劳动仲裁'], 装修: ['甲醛', '通风'],
  理财: ['基金', '存款', '保险'], 睡: ['失眠', '熬夜', '午睡'], 体检: ['筛查', '癌症', '口腔'],
  孩子: ['出生证明', '疫苗', '医保', '入学'], 父母: ['老人', '跌倒', '养老'],
};
function dSuggest(text) {
  const g = dGrams(text), hit = [];
  for (const k in SYNS) if (g.indexOf(k) >= 0) hit.push(`把「${k}」换成 ${SYNS[k].map(w => `〈${w}〉`).join('、')}`);
  hit.push('去掉「怎么 / 能不能 / 该不该」，只留名词和动词，比如「代通知金」「担保」「失业金」');
  hit.push('换个说法：书里用的是生活词（「医保」而不是「医疗保障基金」）');
  return hit.slice(0, 3);
}
const CONS = [
  ['刑事', /(刑事|判刑|坐牢|罪名|逮捕|拘役|有期徒刑|诈骗罪|非法经营|帮信|同谋)/],
  ['行政拘留', /(行政拘留|拘留|治安处罚|传唤)/],
  ['罚钱', /(罚款|滞纳金|没收|追缴)/],
  ['民事', /(民事|赔偿|违约金|起诉|仲裁|举证|合同无效|连带)/],
];
function dConsHTML(e) {
  const txt = [e.title, e.human, e.gain, e.note].map(plain).join(' ');
  return CONS.filter(c => c[1].test(txt)).map(c => `<span class="d-cons">${c[0]}</span>`).join('');
}

const decide = { q: '', asked: false, intent: INTENT_FALLBACK, res: { primary: [], weak: [] }, ab: null, docs: [], picked: new Set(), terms: [] };

function decideAsk(text) {
  const q = String(text || '').trim();
  if (q.length < 2) { toast('问题再具体一点，比如「替朋友担保签不签」'); return; }
  decide.q = q; decide.asked = true; decide.picked.clear();
  decide.terms = dRuns(q).filter(r => r.length >= 2).slice(0, 8);
  let it = INTENTS.find(x => x.re.test(q)) || INTENT_FALLBACK;
  decide.intent = it;
  const ab = String(q).split(/(?:还是|或者|和.+比|哪个)/).map(s => s.replace(STOP_RE, '').trim()).filter(s => s.length >= 2);
  if (it.key === 'choose' && ab.length >= 2) {
    decide.ab = [{ q: ab[0], res: dSearch(ab[0], null, 6) }, { q: ab[1], res: dSearch(ab[1], null, 6) }];
    decide.res = { primary: [], weak: [] };
  } else {
    decide.ab = null;
    decide.res = dSearch(q, it.secs, 10);
  }
  decide.docs = dDocs(q);
  Store.set('decide', { q: q });
  Store.upsert('decideHistory', { id: 'q:' + q, text: q, at: Date.now() });
  const hist = Store.list('decideHistory').sort((a, b) => b.at - a.at);
  hist.slice(8).forEach(h => Store.drop('decideHistory', h.id));
  renderDecide();
  scrollToEl($('#decide-ans'), 'start');
}

function dRowHTML(x) {
  const e = x.e, on = decide.picked.has(e.id);
  const human = plain(e.human || e.gain || '');
  const cut = human.length > 120 ? human.slice(0, 120) + '…' : human;
  return `<div class="d-row${on ? ' on' : ''}" data-row="${e.id}">
<label class="d-ck"><input type="checkbox" name="to-todo" data-dp="${e.id}"${on ? ' checked' : ''}><span>转待办</span></label>
<div class="d-main">
<div class="d-t"><a href="#e-${e.id}" data-go="${e.id}">${esc(plain(e.title))}</a>
<span class="d-ref">第 ${e.sec} 节第 ${e.n} 条</span>${decide.intent.key === 'legal' ? dConsHTML(e) : ''}${e.dispute ? '<span class="d-cons d-dp">原书标了争议</span>' : ''}</div>
${cut ? `<div class="d-h">${esc(cut)}</div>` : ''}
<div class="d-cols"><span>成本<b>${esc(e.moneyLabel)} · ${esc(e.timeLabel)} · ${esc(e.willLabel)}</b></span>
<span>收益量级<b>${esc(e.level)}（${esc(e.lensLabel)}）</b></span>
<span>证据等级<b>${esc(e.grade)}${e.gradeNote ? ' · ' + esc(plain(e.gradeNote)) : ''}</b></span></div>
${x.weak ? '<div class="d-weak">这条不是在讲这件事，是收益 / 备注 / 来源里出现了你的词，当线索看别当依据</div>' : ''}
${x.rare ? '<div class="d-weak">标题和「说人话」里没直接讲，是正文其他字段明确提到你的词</div>' : ''}
<details class="d-more"><summary>看完整条目（六字段、来源链接、备注）</summary>${wrapCard(e, decide.terms)}</details>
</div></div>`;
}
const dHead = `<div class="d-cols d-head"><span>成本<b>花钱 · 花时间 · 要毅力</b></span><span>收益量级<b>只看同口径</b></span><span>证据等级<b>A 强 / B 中 / C 弱</b></span></div>`;

function dGroupHTML(title, rows, tip) {
  if (!rows.length) return '';
  return `<h3 class="d-h3">${esc(title)}</h3>${tip ? `<p class="hint">${tip}</p>` : ''}${dHead}${rows.map(dRowHTML).join('')}`;
}
function dPickedBarHTML() {
  const n = decide.picked.size;
  return `<div class="row-btns d-acts">
<button class="primary" id="d-addtodo">加入待办清单（已勾 ${n}）</button>
<button class="ghost-btn" id="d-free">只选性价比极高且不花钱的</button>
<button class="ghost-btn" id="d-easy">只选一次办完就行的</button>
<button class="ghost-btn" id="d-copy">复制本次检索到的条目</button>
</div>`;
}
function dAnswerHTML() {
  const it = decide.intent, weak = decide.res.weak;
  let rows = decide.res.primary;
  const secs = [];
  for (const x of rows.concat(weak)) if (secs.indexOf(x.e.sec) < 0) secs.push(x.e.sec);
  let h = `<section class="quiz-card" id="decide-ans"><div class="quiz-h"><h2>「${esc(plain(decide.q))}」<small>${esc(it.name || '全书检索')}类问题</small></h2></div>`;
  if (it.key === 'choose' && decide.ab) {
    const [a, b] = decide.ab;
    h += `<p class="d-why">按〈怎么选〉来答：把问题拆成「${esc(a.q)}」和「${esc(b.q)}」两组关键词分别查，两边各自的账分开摆——<b>只有同口径的才比高低</b>（降死亡率、每年省 500 元、少熬一个小时，三笔账不排成一条线）。</p>`;
    h += `<div class="d-ab"><div class="d-col"><h4>${esc(a.q)}</h4>${a.res.primary.length ? a.res.primary.map(dRowHTML).join('') : '<p class="empty-line">这半句里没查到对应条目。</p>'}</div>
<div class="d-col"><h4>${esc(b.q)}</h4>${b.res.primary.length ? b.res.primary.map(dRowHTML).join('') : '<p class="empty-line">这半句里没查到对应条目。</p>'}</div></div>`;
    const both = a.res.primary.concat(b.res.primary);
    h += both.length ? `<p class="hint">两边条目可以一起勾选转成待办。</p>${dPickedBarHTML()}` : '';
    rows = both;
  } else if (rows.length) {
    h += `<p class="d-why">按〈${esc(it.name)}〉来答。${esc(it.note || INTENT_FALLBACK.note)} 主要依据第 ${secs.slice(0, 6).join('、')} 节，共 ${rows.length} 条命中${weak.length ? '（另有 ' + weak.length + ' 条只是顺带提到）' : ''}。</p>`;
    h += dGroupHTML('书里直接讲的', rows, '') + dGroupHTML('只是顺带提到的', weak, '这些条目不是在讲这件事，是收益或备注里出现了你的词；当线索看，别当依据。');
    h += dPickedBarHTML();
  } else {
    const found = dNear(decide.q), near = found.length ? found : (it.secs || []).slice(0, 3);
    h += `<p class="d-why"><b>书里查不到对应条目。</b>「${esc(plain(decide.q))}」在全书 ${META.entries} 条里没有命中的标题或说人话——我不替你编数字、编法条、编金额。</p>
<p class="hint">换词建议：${dSuggest(decide.q).map(esc).join('；')}。</p>
${near.length ? `<p class="d-near">最沾边的节：${near.map(no => `<a href="#sec-${no}" data-go="s${no}">第 ${no} 节 ${esc(SECS.get(String(no)).title)}</a>`).join('、')}</p>`
      : '<p class="d-near">全书 34 节的目录在「分类检索」页左侧，可以直接翻到最接近的一节。</p>'}`;
    rows = [];
  }
  const offLaw = ['urgent', 'legal', 'money'].indexOf(it.key) >= 0 || rows.some(x => SECS_LEGAL.indexOf(x.e.sec) >= 0 || SECS_MONEY.indexOf(x.e.sec) >= 0);
  if (rows.length && offLaw) h += `<p class="note-strip d-warn">${esc(WARN_LINE)}</p>`;
  if (decide.docs.length) h += `<p class="d-docs">长文里写得更细：${decide.docs.map(x => {
    const n = x.d.items.filter(it => it.h).length;
    return `<button class="ghost-btn" data-docx="${esc(x.d.name)}">《${esc(x.d.title)}》</button><button class="ghost-btn mini" data-docadd="${esc(x.d.name)}">把这 ${n} 个小节加入待办</button>`;
  }).join('')}</p>`;
  h += '</section>';
  return h;
}
function dIntroHTML() {
  return `<section class="quiz-card"><div class="quiz-h"><h2>问我一件具体的事<small>答案只来自书里的 ${META.entries} 条建议和 ${DOC.length} 篇长文，不联网、不调模型</small></h2></div>
<p class="d-why">我能按书里的算账方式回答六类问题：<b>该不该做 / 值不值</b>、<b>怎么选（A 还是 B）</b>、<b>出事先做什么</b>、<b>能领哪笔钱</b>、<b>这么干犯不犯法</b>、<b>怎么少花钱</b>。每条答案都带「第几节第几条」、三项成本、收益量级和证据等级，勾几条就能变成待办清单。</p>
<div class="chips d-intents">${INTENTS.map(x => `<button type="button" data-eg="${esc(x.eg)}">${esc(x.name)}：${esc(x.eg)}</button>`).join('')}
<button type="button" data-eg="我瞎编一个词问 紫水晶陀螺仪">试一个查不到的</button></div>
<p class="hint">检索是关键词打分，不是理解语义：说得出名词（代通知金、专项附加扣除、狂犬疫苗）比说一长串心情更容易命中。答不上的它会明说查不到。</p></section>`;
}
function decideFormHTML() {
  return `<div class="d-ask"><input id="d-q" type="search" placeholder="比如：刚被裁了先做什么 / 替朋友担保签不签 / 生育津贴怎么领" value="${esc(decide.q)}" autocomplete="off">
<button class="primary" id="d-go">查书</button></div>`;
}
function renderDecide() {
  const root = $('#decide-root'); if (!root) return;
  const hist = Store.list('decideHistory').sort((a, b) => b.at - a.at).slice(0, 8);
  $('#decide-side').innerHTML = `<section class="fgroup"><h4>六类问题</h4><div class="chips">
${INTENTS.map(x => `<button type="button" aria-pressed="${decide.asked && decide.intent.key === x.key}" data-eg="${esc(x.eg)}">${esc(x.name)}</button>`).join('')}</div></section>
<section class="fgroup"><h4>最近问过${hist.length ? '<button class="all" id="d-clear">清空</button>' : ''}</h4><div class="doc-list">
${hist.length ? hist.map(h => `<button data-eg="${esc(h.text)}">${esc(h.text)}</button>`).join('') : '<p class="hint">还没查过。</p>'}</div></section>
<section class="fgroup"><h4>它是怎么答的</h4><p class="hint">①认意图（哪类问题、该看哪几节）→ ②全书关键词打分（标题 &gt; 说人话 &gt; 其余字段）→ ③按官方 <code>byValue</code> 排（性价比 → 收益量级 → 毅力 → 证据等级 → 成本合计）→ ④逐条标出处。</p>
<p class="hint">低于阈值就回「书里查不到」，不给综合分、不换算成「少活几年」。${esc(WARN_LINE)}</p></section>`;
  root.innerHTML = decideFormHTML() + (decide.asked ? dAnswerHTML() : dIntroHTML());
}
function dSelectWhere(fn) {
  const all = decide.ab ? decide.ab.reduce((a, x) => a.concat(x.res.primary), []) : decide.res.primary.concat(decide.res.weak);
  const hit = all.filter(x => fn(x.e));
  decide.picked.clear();
  hit.forEach(x => decide.picked.add(x.e.id));
  renderDecide();
  toast(hit.length ? `已勾上 ${hit.length} 条，点「加入待办清单」` : '这一批里没有符合条件的');
}
function dAddPicked() {
  const ids = Array.from(decide.picked);
  if (!ids.length) { toast('先勾几条，或者用「只选性价比极高且不花钱的」'); return; }
  let added = 0, dup = 0;
  for (const id of ids) { addTask(id, 'decide') ? added++ : dup++; }
  refreshTodoBadge();
  decide.picked.clear();
  renderDecide();
  toast(`待办清单里新增 ${added} 条` + (dup ? `，${dup} 条本来就在` : '') + '，左侧「待办清单」可看');
}
function dCopyAll() {
  const all = (decide.ab ? decide.ab.reduce((a, x) => a.concat(x.res.primary), []) : decide.res.primary.concat(decide.res.weak));
  if (!all.length) { toast('这一轮没有可复制的条目'); return; }
  const head = `《高性价比人生指南》工作台 · 「${decide.q}」（${decide.intent.name}）\n以下 ${all.length} 条按性价比→收益量级→毅力→证据等级排序，出出处见每条。\n`;
  copyText(head + all.map(x => entryText(x.e)).join('\n\n'), `已复制 ${all.length} 条`);
}
function decideClick(ev) {
  const t = ev.target;
  const eg = t.closest('[data-eg]');
  if (eg) { decideAsk(eg.dataset.eg); return true; }
  if (t.closest('#d-go')) { decideAsk(($('#d-q') || {}).value || ''); return true; }
  if (t.closest('#d-addtodo')) { dAddPicked(); return true; }
  if (t.closest('#d-copy')) { dCopyAll(); return true; }
  if (t.closest('#d-free')) { dSelectWhere(e => e.ratio === '极高' && e.money === '0'); return true; }
  if (t.closest('#d-easy')) { dSelectWhere(e => e.will === '否'); return true; }
  if (t.closest('#d-clear')) { Store.write('decideHistory', []); renderDecide(); toast('已清空查询历史'); return true; }
  const dx = t.closest('[data-docx]');
  if (dx) { switchView('search'); openDoc(dx.dataset.docx); return true; }
  const da = t.closest('[data-docadd]');
  if (da) { const n = addDocTasks(da.dataset.docadd); toast(n ? `已把长文里的 ${n} 个小节加入待办` : '这些小节已经在待办里了'); return true; }
  const row = t.closest('.d-row');
  if (row && !t.closest('input,button,a,details,summary,label')) {
    const id = row.dataset.row, on = !decide.picked.has(id);
    on ? decide.picked.add(id) : decide.picked.delete(id);
    row.classList.toggle('on', on);
    const cb = row.querySelector('[data-dp]'); if (cb) cb.checked = on;
    const btn = $('#d-addtodo'); if (btn) btn.textContent = `加入待办清单（已勾 ${decide.picked.size}）`;
    return true;
  }
  return false;
}
function decideChange(ev) {
  const t = ev.target;
  const dp = t.closest ? t.closest('[data-dp]') : null;
  if (dp) {
    const id = dp.dataset.dp, on = dp.checked;
    on ? decide.picked.add(id) : decide.picked.delete(id);
    const row = dp.closest('.d-row'); if (row) row.classList.toggle('on', on);
    const btn = $('#d-addtodo'); if (btn) btn.textContent = `加入待办清单（已勾 ${decide.picked.size}）`;
    return;
  }
  const pick = t.closest ? t.closest('.pick') : null;
  if (pick) {
    const id = 'e' + pick.dataset.pick;
    if (pick.checked) { const added = addTask(pick.dataset.pick, 'decide'); toast(added ? '已加入待办清单' : '这条已经在待办里'); }
    else { Store.drop('tasks', id); refreshTodoBadge(); toast('已从待办清单移除'); }
    TASK_IDS = new Set(Store.list('tasks').map(x => String(x.id)));
  }
}

/* ===================================================================
 * 模块四 · 待办清单：任务只从书里的条目或长文小节生成，出处一路跟着走
 * =================================================================== */
const TC0 = Store.get('todoCfg', null) || {};
const todo = { groupBy: TC0.groupBy || 'pile', status: TC0.status || 'open', picked: new Set() };
const saveTodoCfg = () => Store.set('todoCfg', { groupBy: todo.groupBy, status: todo.status });
const SRC_NAME = { search: '检索页', quiz: '现状自测', decide: '人生决策', doc: '长文附录' };

function taskEntryOf(t) { return t.ref && t.ref.entry ? ITEMS.get(String(t.ref.entry)) : null; }
function tVal(t) {
  const e = taskEntryOf(t);
  if (e) return e;
  return { ratio: t.ratio || '一般', level: t.level || '中', will: t.will || '些', grade: t.grade || 'C', cs: t.cs == null ? 3 : t.cs };
}
/* 与自测「先做这几件」同一个比较器；长文小节排在条目后面 */
const tCmp = (a, b) => ((a.kind === 'doc' ? 1 : 0) - (b.kind === 'doc' ? 1 : 0)) || M.byValue(tVal(a), tVal(b));
const pileOf = t => (M.PILES.find(x => x.will === tVal(t).will) || M.PILES[1]).name;
const lensOf = t => (taskEntryOf(t) || {}).lensLabel || t.lens || '其他';
const pad2 = n => (n < 10 ? '0' : '') + n;
function todayKey() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function dueBucket(t) {
  if (!t.due) return '没填截止日';
  const d = String(t.due).slice(0, 10), today = todayKey();
  if (d < today) return '已经过期';
  if (d === today) return '今天到期';
  const days = (Date.parse(d + 'T00:00:00') - Date.parse(today + 'T00:00:00')) / 86400000;
  return days <= 7 ? '一周内' : '以后';
}
const DUE_ORDER = ['已经过期', '今天到期', '一周内', '以后', '没填截止日'];
const LENS_ORDER = ['换寿命', '换钱', '换时间精力', '换人身自由'];
function statusOf(t) { return t.status === 'done' ? 'done' : t.status === 'abandoned' ? 'ab' : 'open'; }
function visibleTasks() {
  const all = Store.list('tasks');
  return todo.status === 'all' ? all : all.filter(t => statusOf(t) === todo.status);
}
function todoGroups(list) {
  const g = [];
  if (todo.groupBy === 'pile') {
    for (const p of M.PILES) g.push({ key: p.name, sub: p.sub, rows: list.filter(t => pileOf(t) === p.name) });
  } else if (todo.groupBy === 'lens') {
    const order = LENS_ORDER.concat(['其他']);
    for (const k of order) {
      const rows = list.filter(t => lensOf(t) === k);
      if (rows.length || LENS_ORDER.indexOf(k) >= 0) g.push({ key: k, sub: k === '其他' ? '长文小节没标口径' : '同口径才比大小，跨口径不排成一条线', rows });
    }
  } else if (todo.groupBy === 'sec') {
    const m = new Map();
    for (const t of list) { const e = taskEntryOf(t); const k = e ? e.sec : (t.ref && t.ref.sec ? t.ref.sec : '长文'); if (!m.has(String(k))) m.set(String(k), []); m.get(String(k)).push(t); }
    Array.from(m.keys()).sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? +a - +b : /^\d+$/.test(a) ? -1 : 1)).forEach(k => {
      const s = /^\d+$/.test(k) ? SECS.get(k) : null;
      g.push({ key: s ? '第 ' + k + ' 节 ' + s.title : k === '长文' ? '长文附录里的小节' : '第 ' + k + ' 节', sub: s ? '本节 ' + s.count + ' 条' : '', rows: m.get(k) });
    });
  } else {
    for (const k of DUE_ORDER) g.push({ key: k, sub: k === '已经过期' ? '过期不等于失败，要么改日期要么放弃并写下理由' : '', rows: list.filter(t => dueBucket(t) === k) });
  }
  for (const x of g) x.rows.sort(tCmp);
  return g.filter(x => x.rows.length);
}
function taskFromDoc(name, idx) {
  const d = DOC.find(x => x.name === name); if (!d) return null;
  const it = d.items[idx]; if (!it || !it.h) return null;
  const head = plain(it.h).replace(/^#+\s*/, '');
  return { id: 'd:' + name + '#' + idx, kind: 'doc', ref: { doc: name, sec: null, label: '长文·《' + d.title + '》·' + head },
    title: head.slice(0, 34), detail: it.list.slice(0, 6).map(x => x.n + '. ' + plain(x.text)).join(' ') || it.paras.map(plain).join(' ').slice(0, 160),
    steps: it.list.map(x => plain(x.text)), cost: { money: '看内容', time: '花几小时', will: '要一点毅力' },
    will: '些', ratio: '一般', level: '中', lens: '其他', grade: 'C', dispute: false, urls: [], due: '', note: '',
    status: 'open', doneAt: null, createdAt: Date.now(), source: 'doc' };
}
function addDocTasks(name) {
  const d = DOC.find(x => x.name === name); if (!d) return 0;
  const have = new Set(Store.list('tasks').map(t => String(t.id)));
  let n = 0;
  d.items.forEach((it, i) => { if (!it.h) return; const t = taskFromDoc(name, i); if (t && !have.has(t.id)) { Store.upsert('tasks', t); n++; } });
  refreshTodoBadge();
  return n;
}

function tDueHTML(t) {
  if (!t.due) return '';
  const b = dueBucket(t), cls = b === '已经过期' ? 'over' : (b === '今天到期' ? 'today' : '');
  return `<span class="t-due${cls ? ' ' + cls : ''}">${esc(String(t.due).slice(0, 10))}${b === '已经过期' ? ' · 过期' : b === '今天到期' ? ' · 今天' : ''}</span>`;
}
function tRowHTML(t) {
  const e = taskEntryOf(t), st = statusOf(t), gone = !!t.ref && !!t.ref.entry && !e;
  const sel = todo.picked.has(String(t.id));
  const ref = t.ref || {};
  const refHTML = e ? `<a href="#e-${e.id}" data-go="${e.id}">${esc(ref.label || ('第 ' + e.sec + ' 节第 ' + e.n + ' 条'))}</a>`
    : gone ? `<span class="t-gone">${esc(ref.label || '')} · 该条目在新版正文里已删除</span>`
    : `<span>${esc(ref.label || '长文小节')}</span>`;
  const c = t.cost || {};
  const cost = e ? `${esc(e.moneyLabel)} · ${esc(e.timeLabel)} · ${esc(e.willLabel)}`
    : [c.money, c.time, c.will].map(x => x || '未标').join(' · ');
  const gain = e ? `${esc(e.level)}（${esc(e.lensLabel)}）` : `${esc(t.level || '—')}（${esc(t.lens || '未标')}）`;
  const grade = e ? esc(e.grade) + (e.gradeNote ? ' · ' + esc(plain(e.gradeNote)) : '') : esc(t.grade || '—');
  const ratio = e ? esc(e.ratio) : esc(t.ratio || '—');
  const detail = e ? plain(e.human || e.gain || '') : plain(t.detail || '');
  return `<div class="t-row s-${st}${sel ? ' sel' : ''}" data-task="${esc(String(t.id))}">
<label class="t-ck"><input type="checkbox" name="tsel" data-tsel="${esc(String(t.id))}"${sel ? ' checked' : ''}></label>
<div class="t-main">
<div class="t-hd"><span class="t-title">${esc(t.title || (e ? plain(e.title) : '（无标题）'))}</span>
<span class="t-ref">${refHTML}</span><span class="t-src">${esc(SRC_NAME[t.source] || '检索页')}</span>${t.dispute ? '<span class="t-dp">原书标了争议</span>' : ''}</div>
<div class="t-cols"><span>成本<b>${cost}</b></span><span>收益量级<b>${gain}</b></span><span>证据等级<b>${grade}</b></span><span>性价比<b>${ratio}</b></span></div>
${detail ? `<div class="t-h">${esc(detail.length > 150 ? detail.slice(0, 150) + '…' : detail)}</div>` : ''}
<div class="t-foot">${tDueHTML(t)}${st === 'done' ? `<span class="t-done-at">办完于 ${esc(String(t.doneAt || '').slice(0, 10))}</span>` : ''}${st === 'ab' ? `<span class="t-abn">已放弃${t.reason ? '：' + esc(t.reason) : ''}</span>` : ''}${t.note ? `<span class="t-note">备注：${esc(t.note)}</span>` : ''}
<label class="t-fin"><input type="checkbox" name="tdone" data-tdone="${esc(String(t.id))}"${st === 'done' ? ' checked' : ''}>${st === 'ab' ? '恢复并标记办完' : '办完了'}</label>
<button class="ghost-btn mini" data-tfold="${esc(String(t.id))}">改日期 · 备注 · 放弃</button></div>
<div class="t-edit" hidden data-edit="${esc(String(t.id))}">
<p class="hint">${e ? '出处：<a href="#e-' + e.id + '" data-go="' + e.id + '">看原条目全文（六字段、来源链接、备注）</a>' : '这条来自长文附录，没有对应条号。'}${e && e.urls && e.urls.length ? ' 来源链接在检索页原条目里。' : ''}</p>
<div class="t-edit-row"><label>截止日<input type="date" name="t-due" data-tdue="${esc(String(t.id))}" value="${esc(String(t.due || '').slice(0, 10))}"></label>
<label>备注（想记的细节写这里，任务本身还是书里那条）<textarea name="t-note" data-tnote="${esc(String(t.id))}" rows="2">${esc(t.note || '')}</textarea></label></div>
<div class="t-edit-row"><label>放弃的理由（留着，以后想恢复能看到）<input type="text" name="t-reason" data-treason="${esc(String(t.id))}" value="${esc(t.reason || '')}" placeholder="比如：这件事不归我管"></label>
<span class="t-edit-btns">${st === 'ab' ? `<button class="ghost-btn mini" data-trestore="${esc(String(t.id))}">恢复这条</button>` : `<button class="ghost-btn mini" data-tabandon="${esc(String(t.id))}">放弃这条</button>`}
<button class="ghost-btn mini" data-tdelete="${esc(String(t.id))}">彻底删除（不留记录）</button>
<button class="ghost-btn mini" data-tcopy="${esc(String(t.id))}">复制这条</button></span></div>
</div></div></div>`;
}
function todoStatsHTML(all) {
  const open = all.filter(t => statusOf(t) === 'open'), done = all.filter(t => statusOf(t) === 'done'), ab = all.filter(t => statusOf(t) === 'ab');
  const over = open.filter(t => dueBucket(t) === '已经过期').length;
  return `<section class="quiz-card t-sum"><div class="quiz-h"><h2>这一摊东西<small>只统计各组分了几件，不合成一个分数</small></h2></div>
<div class="t-sum-row"><span>在办 <b>${open.length}</b>${over ? ' · 其中 ' + over + ' 件过了截止日' : ''}</span>
<span>已办完 <b>${done.length}</b></span><span>已放弃 <b>${ab.length}</b></span><span>合计 <b>${all.length}</b></span></div>
<p class="hint">任务只能从书里的条目或长文小节生成，出处一路带着；想写自己的事，就写在任务的备注里。</p></section>`;
}
function todoHeadHTML() {
  return `<section class="quiz-card t-bar"><div class="row-btns">
<span class="t-glabel">分组看</span>${[['pile', '按要不要改习惯'], ['lens', '按换回什么'], ['sec', '按章节'], ['due', '按截止日']]
    .map(x => `<button class="ghost-btn mini${todo.groupBy === x[0] ? ' on' : ''}" data-tgroup="${x[0]}">${x[1]}</button>`).join('')}
<span class="t-glabel">看哪些</span>${[['open', '在办'], ['done', '已办完'], ['ab', '已放弃'], ['all', '全部']]
    .map(x => `<button class="ghost-btn mini${todo.status === x[0] ? ' on' : ''}" data-tstatus="${x[0]}">${x[1]}</button>`).join('')}
</div></section>`;
}
function todoBatchHTML(n) {
  if (!n) return '';
  return `<div class="row-btns d-acts t-batch">
<button class="primary" id="tb-done">勾选的 ${n} 件标记办完</button>
<button class="ghost-btn" id="tb-ab">放弃勾选的 ${n} 件</button>
<button class="ghost-btn" id="tb-none">取消选择</button></div>`;
}
function renderTodo() {
  const root = $('#todo-root'), side = $('#todo-side');
  if (!root) return;
  const all = Store.list('tasks'), list = visibleTasks(), groups = todoGroups(list);
  let h = todoStatsHTML(all) + todoHeadHTML();
  if (!all.length) {
    h += `<section class="quiz-card"><div class="quiz-h"><h2>待办还是空的<small>三处都能往里加</small></h2></div>
<p class="d-why">「人生决策」里查出建议后勾几条 → 加入待办清单；「现状自测」结果里点「把没做到的加入待办」；「分类检索」每张条目卡上也有「加入待办」。</p>
<p class="hint">每条任务都带「第几节第几条」，点出处能跳回检索页定位原条目。数据只存这台设备，记得在右上角「数据 · 备份」导出。</p></section>`;
  } else if (!groups.length) {
    h += `<section class="quiz-card"><p class="d-why">这一档里没有任务。换个状态看看（在办 / 已办完 / 已放弃 / 全部）。</p></section>`;
  } else {
    h += `<div class="d-cols d-head t-legend"><span>成本<b>花钱 · 花时间 · 要毅力</b></span><span>收益量级<b>只看同口径</b></span><span>证据等级<b>A 强 / B 中 / C 弱</b></span><span>性价比<b>极高 / 高 / 一般</b></span></div>`;
    for (const g of groups) {
      const done = g.rows.filter(t => statusOf(t) === 'done').length;
      h += `<h3 class="d-h3">${esc(g.key)}<small>${g.rows.length - done} 件在办 · 共 ${g.rows.length} 件</small></h3>`
        + (g.sub ? `<p class="hint">${esc(g.sub)}</p>` : '')
        + g.rows.map(tRowHTML).join('');
    }
    h += todoBatchHTML(todo.picked.size);
  }
  root.innerHTML = h;
  if (side) {
    const open = all.filter(t => statusOf(t) === 'open');
    let s = `<section class="fgroup"><h4>待办清单</h4><p class="hint">在办 ${open.length} 件${open.filter(t => dueBucket(t) === '已经过期').length ? '，其中 ' + open.filter(t => dueBucket(t) === '已经过期').length + ' 件过了截止日' : ''}。勾完打勾就记时间，放弃要写理由，随时能恢复。</p>`;
    s += '<div class="chips">' + [['pile', '按要不要改习惯'], ['lens', '按换回什么'], ['sec', '按章节'], ['due', '按截止日']]
      .map(x => `<button type="button" data-tgroup="${x[0]}" aria-pressed="${todo.groupBy === x[0]}">${x[1]}</button>`).join('') + '</div>';
    s += '<div class="chips">' + [['open', '在办'], ['done', '已办完'], ['ab', '已放弃'], ['all', '全部']]
      .map(x => `<button type="button" data-tstatus="${x[0]}" aria-pressed="${todo.status === x[0]}">${x[1]}</button>`).join('') + '</div></section>';
    s += '<section class="fgroup"><h4>整组操作</h4>';
    for (const p of M.PILES) {
      const rows = visibleTasks().filter(t => pileOf(t) === p.name && statusOf(t) === 'open');
      if (rows.length) s += `<button class="ghost-btn wide" id="tg-${p.will}">「${esc(p.name)}」这 ${rows.length} 件全勾上</button>`;
    }
    s += `<button class="ghost-btn wide" id="t-clear-ab">清空已放弃的 ${all.filter(t => statusOf(t) === 'ab').length} 条记录</button>
<button class="ghost-btn wide" id="t-ics">导出带截止日的 .ics（${all.filter(t => t.due && statusOf(t) !== 'ab').length} 件）</button>
<p class="hint">「要长期坚持」那堆一次别超过一两件；组内排序和自测「先做这几件」用的是同一个比较器：性价比 → 收益量级 → 毅力 → 证据等级 → 成本合计。</p></section>`;
    s += `<section class="fgroup"><h4>和自测的联动</h4><p class="hint">自测里标了「没做到」并转成待办的条目，下次开新一轮自测时会自动预填成「没做到」，改主意点一下就行——这样「自测 → 待办 → 再自测」能对上账。</p></section>`;
    side.innerHTML = s;
  }
}
window.renderTodo = renderTodo;

function todoFind(id) { return Store.list('tasks').find(t => String(t.id) === String(id)) || null; }
function todoMarkDone(id, done) {
  Store.upsert('tasks', { id: String(id), status: done ? 'done' : 'open', doneAt: done ? new Date().toISOString() : null });
  refreshTodoBadge(); renderTodo();
}
function todoText(t) {
  const e = taskEntryOf(t);
  return [`${t.title}${t.ref && t.ref.label ? '（' + t.ref.label + '）' : ''}`,
    e ? entryText(e) : `出处：${(t.ref || {}).label || ''}\n${t.detail || ''}`,
    t.due ? '截止：' + t.due : '', t.note ? '备注：' + t.note : ''].filter(Boolean).join('\n\n');
}
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
function icsEsc(s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n'); }
function todoIcs() {
  const rows = Store.list('tasks').filter(t => t.due && statusOf(t) !== 'ab');
  const d = todayKey().replace(/-/g, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//lifeplan-workbench//todo//CN', 'CALSCALE:GREGORIAN'];
  for (const t of rows) {
    const day = String(t.due).replace(/-/g, '').slice(0, 8);
    out.push('BEGIN:VEVENT', 'UID:' + encodeURIComponent(String(t.id)) + '@lifeplan', 'DTSTAMP:' + d + 'T000000Z',
      'DTSTART;VALUE=DATE:' + day, 'SUMMARY:' + icsEsc(t.title), 'DESCRIPTION:' + icsEsc((t.ref || {}).label || '') + (t.note ? ' / ' + icsEsc(t.note) : ''), 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return { text: out.join('\r\n'), n: rows.length };
}
function todoClick(ev) {
  const t = ev.target;
  const grp = t.closest('[data-tgroup]');
  if (grp) { todo.groupBy = grp.dataset.tgroup; saveTodoCfg(); todo.picked.clear(); renderTodo(); return true; }
  const st = t.closest('[data-tstatus]');
  if (st) { todo.status = st.dataset.tstatus; saveTodoCfg(); todo.picked.clear(); renderTodo(); return true; }
  const fold = t.closest('[data-tfold]');
  if (fold) { const box = $('[data-edit="' + fold.dataset.tfold + '"]'); if (box) { box.hidden = !box.hidden; fold.textContent = box.hidden ? '改日期 · 备注 · 放弃' : '收起'; } return true; }
  const ab = t.closest('[data-tabandon]');
  if (ab) {
    const id = ab.dataset.tabandon, box = $('[data-edit="' + id + '"]'), inp = box && box.querySelector('[data-treason]');
    Store.softDelete('tasks', id, inp ? inp.value : '');
    todo.picked.delete(String(id)); refreshTodoBadge(); renderTodo(); toast('已放弃，随时能恢复'); return true;
  }
  const rs = t.closest('[data-trestore]');
  if (rs) { Store.restore('tasks', rs.dataset.trestore); refreshTodoBadge(); renderTodo(); toast('已恢复为在办'); return true; }
  const del = t.closest('[data-tdelete]');
  if (del) { Store.drop('tasks', del.dataset.tdelete); todo.picked.delete(String(del.dataset.tdelete)); refreshTodoBadge(); renderTodo(); toast('已彻底删除这条记录'); return true; }
  const cp = t.closest('[data-tcopy]');
  if (cp) { const x = todoFind(cp.dataset.tcopy); if (x) copyText(todoText(x), '这条待办已复制'); return true; }
  if (t.closest('#tb-done')) {
    let n = 0; for (const id of todo.picked) { if (todoFind(id)) { Store.upsert('tasks', { id: String(id), status: 'done', doneAt: new Date().toISOString() }); n++; } }
    todo.picked.clear(); refreshTodoBadge(); renderTodo(); toast('已标记 ' + n + ' 件办完'); return true;
  }
  if (t.closest('#tb-ab')) {
    let n = 0; for (const id of todo.picked) if (todoFind(id)) { Store.softDelete('tasks', id, '批量放弃'); n++; }
    todo.picked.clear(); refreshTodoBadge(); renderTodo(); toast('已放弃 ' + n + ' 件（在「已放弃」里能看到，可恢复）'); return true;
  }
  if (t.closest('#tb-none')) { todo.picked.clear(); renderTodo(); return true; }
  if (t.closest('#t-clear-ab')) {
    const n = Store.list('tasks').filter(x => statusOf(x) === 'ab').length;
    Store.dropStatus('tasks', 'abandoned'); refreshTodoBadge(); renderTodo(); toast(n ? '已清空 ' + n + ' 条放弃记录' : '没有已放弃的记录'); return true;
  }
  if (t.closest('#t-ics')) {
    const r = todoIcs();
    if (!r.n) { toast('没有带截止日的任务'); return true; }
    download('高性价比人生指南-待办.ics', r.text, 'text/calendar;charset=utf-8'); toast('已导出 ' + r.n + ' 件（.ics 里是全天事件）'); return true;
  }
  const pileBtn = t.closest('[id^="tg-"]');
  if (pileBtn) {
    const w = pileBtn.id.slice(3), rows = visibleTasks().filter(x => String(tVal(x).will) === w && statusOf(x) === 'open');
    rows.forEach(x => todo.picked.add(String(x.id)));
    todo.status = 'open'; saveTodoCfg(); renderTodo(); toast('已勾上「' + (M.PILES.find(p => p.will === w) || {}).name + '」的 ' + rows.length + ' 件'); return true;
  }
  return false;
}
function todoChange(ev) {
  const t = ev.target;
  const done = t.closest('[data-tdone]');
  if (done) { todoMarkDone(done.dataset.tdone, done.checked); return; }
  const sel = t.closest('[data-tsel]');
  if (sel) {
    const id = String(sel.dataset.tsel);
    sel.checked ? todo.picked.add(id) : todo.picked.delete(id);
    const row = sel.closest('.t-row'); if (row) row.classList.toggle('sel', sel.checked);
    const bar = $('.t-batch'), root = $('#todo-root');
    if (bar) bar.remove();
    if (todo.picked.size) { root.insertAdjacentHTML('beforeend', todoBatchHTML(todo.picked.size)); }
    return;
  }
  const due = t.closest('[data-tdue]');
  if (due) { Store.upsert('tasks', { id: String(due.dataset.tdue), due: due.value }); renderTodo(); toast(due.value ? '已记截止日' : '已清空截止日'); return; }
  const note = t.closest('[data-tnote]');
  if (note) { Store.upsert('tasks', { id: String(note.dataset.tnote), note: note.value }); return; }
  const rs = t.closest('[data-treason]');
  if (rs) { const x = todoFind(rs.dataset.treason); if (x && x.status === 'abandoned') Store.upsert('tasks', { id: String(rs.dataset.treason), reason: rs.value }); }
}

/* ===================================================================
 * 长文附录：md-lite 渲染（表格 / 小节 / 编号列表）
 * =================================================================== */
function mdTable(lines) {
  const rows = lines.map(l => l.split('|').slice(1, -1).map(c => c.trim()));
  const head = rows[0];
  const body = rows.slice(2);
  return `<table><thead><tr>${head.map(h => `<th>${fmt(h, [], null)}</th>`).join('')}</tr></thead><tbody>`
    + body.map(r => `<tr>${r.map(c => `<td>${fmt(c, [], null)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
}
function docBodyHTML(d) {
  const out = [];
  for (const it of d.items) {
    if (it.h) out.push(`<h3>${fmt(it.h, [], null)}</h3>`);
    let tbl = [];
    for (const l of it.paras) {
      if (/^\|/.test(l.trim())) { tbl.push(l.trim()); continue; }
      if (tbl.length) { out.push(mdTable(tbl)); tbl = []; }
      if (l.trim()) out.push(`<p>${fmt(l, [], null)}</p>`);
    }
    if (tbl.length) out.push(mdTable(tbl));
    if (it.list.length) out.push('<ol>' + it.list.map(x => `<li value="${x.n}">${fmt(x.text, [], null)}</li>`).join('') + '</ol>');
  }
  return out.join('');
}
function openDoc(name) {
  const d = DOC.find(x => x.name === name); if (!d) return;
  $('#blocks').hidden = true; $('#empty').hidden = true;
  $('#doc-view').innerHTML = `<div class="doc-h"><button class="ghost-btn" id="doc-back">← 回检索</button><h2>${esc(d.title)}</h2></div>
<div class="doc-meta">长文附录 · ${d.items.filter(x => x.h).length} 个小节 · 共 ${d.items.reduce((a, x) => a + x.list.length, 0)} 个带条号的步骤${d.urls.length ? ' · 来源 ' + d.urls.length + ' 条' : ''}
<button class="ghost-btn mini" id="doc-todo">按小节加入待办清单</button></div>
<div class="doc-body">${docBodyHTML(d)}</div>`;
  $('#doc-view').hidden = false;
  renderBoard();
  $('#doc-todo').onclick = () => { const n = addDocTasks(name); toast(n ? `已把 ${n} 个小节加入待办，去「待办清单」看` : '这些小节已经在待办里了'); };
  $('#doc-back').onclick = () => { closeDoc(); apply(); };
  $('#doc-list').querySelectorAll('button').forEach(b => b.style.fontWeight = b.dataset.doc === name ? '700' : '');
  scrollTo({ top: 0 });
}
function closeDoc() {
  $('#doc-view').hidden = true; $('#doc-view').innerHTML = '';
  $('#doc-list').querySelectorAll('button').forEach(b => b.style.fontWeight = '');
  renderBoard();
}

/* ===================================================================
 * 视图切换 / 事件 / 备份 / 主题
 * =================================================================== */
function switchView(v) {
  state.view = v;
  $$('#modules button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(s => s.hidden = s.dataset.view !== v);
  $$('.side-pane').forEach(p => p.hidden = p.dataset.for !== v);
  $('.search-wrap').style.visibility = v === 'search' ? 'visible' : 'hidden';
  $('#cnt-line').style.visibility = v === 'search' ? 'visible' : 'hidden';
  if (v === 'todo' && window.renderTodo) window.renderTodo();
  if (v === 'quiz' && window.renderQuiz) window.renderQuiz();
  if (v === 'decide' && window.renderDecide) window.renderDecide();
}
function wireEvents() {
  $$('#modules button').forEach(b => b.onclick = () => switchView(b.dataset.view));
  let tm;
  $('#q').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { state.q = e.target.value.trim(); apply(); }, 120); });
  $$('[data-dim]').forEach(g => g.addEventListener('click', ev => {
    const fold = ev.target.closest('[data-fold]');
    if (fold) { const toc = $('[data-toc-for="' + fold.dataset.fold + '"]'); toc.hidden = !toc.hidden; fold.textContent = toc.hidden ? '▸' : '▾'; return; }
    const b = ev.target.closest('[data-v]'); if (!b) return;
    const dim = b.closest('[data-dim]').dataset.dim, v = b.dataset.v, set = state[dim];
    if (dim === 'sec') { set.clear(); if (v) set.add(v); if (v) { const toc = $('[data-toc-for="' + v + '"]'); if (toc) { toc.hidden = false; $('[data-fold="' + v + '"]').textContent = '▾'; } } }
    else if (dim === 'who') { const on = !set.has(v); if (v === '无') set.clear(); else set.delete('无'); if (on) set.add(v); }
    else { set.has(v) ? set.delete(v) : set.add(v); }
    apply(); closeDoc(); $('#blocks').hidden = false;
    if (dim === 'sec' && v) { const blk = document.getElementById('sec-' + v); ensureRendered(blk.querySelector('.card')); scrollToEl(blk, 'start'); }
    else scrollTo({ top: 0 });
  }));
  // 侧栏主题组名：点一下＝只看这一整块，和首屏卡片同一口径
  $('#sec-list').addEventListener('click', ev => { const g = ev.target.closest('[data-topic]'); if (g) selectTopic(+g.dataset.topic); });
  $('#f-dispute').onchange = e => { state.dispute = e.target.checked; apply(); };
  $('#f-todo').onchange = e => { state.todo = e.target.checked; apply(); };
  $('#f-fav').onchange = e => { state.fav = e.target.checked; apply(); };
  $('#reset').onclick = resetFilters; $('#reset2').onclick = resetFilters;
  $('#doc-list').addEventListener('click', ev => { const b = ev.target.closest('[data-doc]'); if (b) { switchView('search'); openDoc(b.dataset.doc); } });

  // 卡片内动作（委托）
  $('#main').addEventListener('click', ev => {
    const t = ev.target;
    const tc = t.closest('[data-topic]');
    if (tc) { selectTopic(+tc.dataset.topic); return; }
    if (t.closest('#topic-back')) { showBoard(); return; }
    if (t.closest('#board-all')) { clearTopic(); return; }
    const fav = t.closest('[data-fav]');
    if (fav) { const on = Fav.toggle(fav.dataset.fav); fav.classList.toggle('on', on); fav.textContent = on ? '★ 已收藏' : '★ 收藏'; if (state.fav) apply(); return; }
    const cp = t.closest('[data-copy]');
    if (cp) { const e = ITEMS.get(cp.dataset.copy); if (e) copyText(entryText(e), '这条已复制'); return; }
    const pm = t.closest('[data-perma]');
    if (pm) { const id = pm.dataset.perma; history.replaceState(history.state, '', location.pathname + location.search + '#e-' + id); copyText('第 ' + id.split('-')[0] + ' 节第 ' + id.split('-')[1] + ' 条', '条号已复制'); return; }
    const a = t.closest('.xref');
    if (a) { showXref(a); return; }
    if (!t.closest('#xpop')) POP.hidden = true;
    const go = t.closest('.xp-jump');
    if (go) { gotoItem(POP.dataset.go); POP.hidden = true; return; }
    const x = t.closest('.xp-x');
    if (x) POP.hidden = true;
  });
  $('#main').addEventListener('change', ev => {
    const pick = ev.target.closest('.pick');
    if (!pick) return;
    const id = 'e' + pick.dataset.pick;
    if (pick.checked) { const added = addTask(pick.dataset.pick, 'search'); toast(added ? '已加入待办清单' : '这条已经在待办里'); }
    else { Store.drop('tasks', id); refreshTodoBadge(); toast('已从待办清单移除'); }
    TASK_IDS = new Set(Store.list('tasks').map(t => String(t.id)));
  });
  $('#main').addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('xref')) { showXref(ev.target); }
  });
  $('#main').addEventListener('click', ev => { const a = ev.target.closest('a[data-go]'); if (!a) return; ev.preventDefault(); gotoItem(a.dataset.go); }, true);

  // 模块二：题干在 #quiz-root，选题在侧栏 #quiz-side，两处共用一套委托
  $('#quiz-root').addEventListener('click', ev => { if (quizClick(ev)) ev.preventDefault(); });
  $('#quiz-root').addEventListener('change', quizChange);
  $('#quiz-side').addEventListener('click', ev => { if (quizClick(ev)) ev.preventDefault(); });

  // 模块三：问题框、结果区和侧栏共用一套委托；回车即查
  $('#decide-root').addEventListener('click', ev => { if (decideClick(ev)) ev.preventDefault(); });
  $('#decide-root').addEventListener('change', decideChange);
  $('#decide-root').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.id === 'd-q') { ev.preventDefault(); decideAsk(ev.target.value); } });
  $('#decide-side').addEventListener('click', ev => { if (decideClick(ev)) ev.preventDefault(); });
  const todoRoot = $('#todo-root'), todoSide = $('#todo-side');
  if (todoRoot) {
    todoRoot.addEventListener('click', ev => { if (todoClick(ev)) ev.preventDefault(); });
    todoRoot.addEventListener('change', todoChange);
    todoRoot.addEventListener('input', ev => { const n = ev.target.closest('[data-tnote]'); if (n) Store.upsert('tasks', { id: String(n.dataset.tnote), note: n.value }); });
  }
  if (todoSide) todoSide.addEventListener('click', ev => { if (todoClick(ev)) ev.preventDefault(); });

  document.addEventListener('keydown', ev => {
    if (ev.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { ev.preventDefault(); switchView('search'); $('#q').focus(); }
    if (ev.key === 'Escape') { POP.hidden = true; }
  });
  addEventListener('scroll', () => { if (Date.now() - POP_T0 > 350) POP.hidden = true; }, { passive: true });

  // 侧栏抽屉（窄屏）
  const sb = $('#sidebar'), bd = $('#backdrop'), mb = $('#menu');
  const setMenu = on => { sb.classList.toggle('open', on); bd.classList.toggle('on', on); mb.setAttribute('aria-expanded', String(on)); };
  mb.onclick = () => setMenu(!sb.classList.contains('open'));
  bd.onclick = () => setMenu(false);

  // 主题
  $('#theme').onclick = () => {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem(NS + 'theme', dark ? 'dark' : 'light'); } catch (e) { }
  };

  // 备份
  const dlg = $('#ddata');
  $('#data-btn').onclick = () => {
    $('#snap-detail').innerHTML = `正文提交 <code>${esc(B.snapshot || '未知')}</code> · 内容指纹 <code>${esc(META.content_sha256)}</code><br>
共 ${META.entries} 条 / ${META.sections} 节 / ${META.docs} 篇长文 · 构建于 ${esc(B.builtAt || '')}<br>
本机记录：待办 ${Store.list('tasks').length} 条 · 收藏 ${Store.list('favs').length} 条 · 自测答题 ${Store.list('answers').length} 题<br>
数据是 ${esc(B.snapshot || '')} 那次的快照，政策与数字会过时，<b>以在线版为准</b>。`;
    $('#store-warn').textContent = Store.ok
      ? '记录存在这台设备的浏览器里。换设备、重装浏览器或清了站点数据就没了——定期导出 JSON。无痕模式下可能存不住。'
      : '这个浏览器现在存不了本机记录（无痕模式或被限制）。下面的导出仍然可用，但刷新后勾选会丢。';
    dlg.showModal();
  };
  $('#dcancel').onclick = () => dlg.close();
  $('#exp').onclick = () => {
    const obj = Store.exportAll();
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = '人生指南工作台备份-' + (B.snapshot || '') + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('备份已下载');
  };
  $('#imp').onclick = () => $('#imp-file').click();
  $('#imp-file').onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const r = Store.importAll(JSON.parse(await f.text()));
      toast(`已导入 ${r.keys} 组记录` + (r.lost ? '，其中 ' + r.lost + ' 条引用在新版正文里已不存在（任务仍保留）' : ''));
      Fav.reload(); for (const c of CARDS) { c.key = null; if (c.vis) renderCard(c); }
      apply(); refreshTodoBadge();
    } catch (e) { toast('这个文件读不出来：' + e.message, 4000); }
    ev.target.value = '';
  };
}

/* ===================================================================
 * 启动
 * =================================================================== */
function boot() {
  // 检索串与显示标签在运行时复原（公式与 build/parse.mjs、官方 index.html 逐字一致），
  // 构建产物里不带这些重复字段，单文件能小 1/3 左右。
  for (const e of E) {
    e.hay = [e.title, e.human, e.cost, e.gain, e.note, e.src, e.grade].join('\n').replace(/\*\*/g, '').replace(/\\([*_])/g, '$1').toLowerCase();
    e.moneyLabel = M.LABEL.money[e.money] ?? '';
    e.timeLabel = M.LABEL.time[e.time] ?? '';
    e.willLabel = M.LABEL.will[e.will] ?? '';
    e.lensLabel = M.LENS_LABEL[e.lens] || e.lens;
    e.whoText = e.who.length ? e.who.map(g => g.map(v => M.WHO_LABEL[v] || v).join('且')).join('、') : '';
  }
  for (const d of DOC) if (!d.hay) d.hay = [d.title, d.intro, d.items.map(i => [i.h, ...i.paras, ...i.list.map(x => x.text)].join(' ')).join(' ')].join(' ').replace(/\s+/g, ' ').toLowerCase();
  $('#snap-note').innerHTML = `数据快照：正文提交 <b>${esc(B.snapshot || '未知')}</b> · 内容指纹 <b>${esc(META.content_sha256)}</b> · 共 <b>${META.entries}</b> 条 / ${META.sections} 节 / ${META.docs} 篇长文 · 本地构建于 ${esc(B.builtAt || '')}。`
    + `内容以<a href="https://eternity4719.github.io/HowToLiveBetter/" target="_blank" rel="noopener">在线版</a>为准。`;
  buildChips(); buildSecList(); buildBlocks();
  for (const c of CARDS) { CARD_OF.set(c.el, c); IO.observe(c.el); }
  wireEvents(); refreshTodoBadge();
  // 手机竖屏下顶栏会换成两行：把它的实际高度交给 CSS，侧栏抽屉的起点跟着走，别写死 57px
  const topEl = $('.top');
  const setTopH = () => document.documentElement.style.setProperty('--top-h', Math.round(topEl.getBoundingClientRect().height) + 'px');
  if (topEl) { setTopH(); if ('ResizeObserver' in window) new ResizeObserver(setTopH).observe(topEl); else addEventListener('resize', setTopH); }
  const lastQ = Store.get('decide', null);
  if (lastQ && lastQ.q) decide.q = lastQ.q;                     // 只回填问题，不自动查，免得打开就一屏结果
  renderDecide();
  apply();
  // 首屏先渲染视口内的卡片，避免一片骨架
  for (const c of CARDS.slice(0, 12)) if (c.el.offsetParent) { c.vis = true; renderCard(c); }
  const h = decodeURIComponent(location.hash || '');
  if (/^#e-\d+-\d+$/.test(h)) setTimeout(() => gotoItem(h.slice(3)), 80);
  window.LIFE = { state, apply, gotoItem, ITEMS, SECS, Store, Fav, addTask, entryText, copyText, fmt, plain, switchView, toast, taskFromEntry, splitGain, splitSrc, cardHTML, refreshTodoBadge, openDoc, CARDS, CARD_OF, matchExceptSec, entryTextSafe: entryText,
    quiz: { QB, QALL, activeQs, prof, profDone, whoTags, fitsProfile, whenOk, saveRun, renderQuiz, quizOutHTML, quizAskHTML },
    decide: { state: decide, INTENTS, ASK: decideAsk, SEARCH: dSearch, DOCS: dDocs, GRAMS: dGrams, RUNS: dRuns, NEAR: dNear, RENDER: renderDecide },
    todo: { state: todo, RENDER: renderTodo, GROUPS: todoGroups, ROW: tRowHTML, ADDDOC: addDocTasks, ICS: todoIcs, CMP: tCmp, PILE: pileOf, DUE: dueBucket },
  };
  window.renderQuiz = () => renderQuiz();
  window.renderDecide = () => renderDecide();
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
})();
