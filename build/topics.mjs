// 八大主题分组：34 节 → 八块的唯一权威定义。
// 检索页的首屏卡片网格、侧栏章节分组、自测页的主题选择都读这里，改这里等于同时改三处，不会出现口径分叉。
// 色值取自参考图实测（见 documents/designs/ref-board_design_system.md 第 1 节），图标是 24×24 stroke 路径。
// 顺序按各主题在书里第一次出现的章节号排，不是按条数排。

export const TOPICS = [
  {
    name: '身体', tint: '#E4F7F1', icon: 'heart',
    secs: [1, 2, 16, 24, 28, 33, 34],
    desc: '别早死、别慢慢死，病了怎么少花钱少走弯路',
    tags: ['不要早死 · 不要慢慢死', '慢性病、看病、外形、残障'],
  },
  {
    name: '精力', tint: '#E9ECFD', icon: 'battery',
    secs: [3, 4, 22],
    desc: '睡眠、注意力、时间和放松，别白白耗掉',
    tags: ['不要浪费精力 · 不要浪费时间', '注意力和放松怎么花'],
  },
  {
    name: '钱', tint: '#FBF3DC', icon: 'wallet',
    secs: [5, 6, 7, 15],
    desc: '少花冤枉钱、防骗防亏，没钱时也有路可走',
    tags: ['不要浪费钱 · 反面清单', '没钱的时候怎么活、租房买房'],
  },
  {
    name: '法律与安全', tint: '#ECE9FA', icon: 'shield',
    secs: [8, 9, 14, 21],
    desc: '别因一条红线把自己搭进去，守住人身自由',
    tags: ['别把自己搭进去 · 法律红线', '账号信息安全、出国旅行'],
  },
  {
    name: '家庭', tint: '#FCE9EF', icon: 'house',
    secs: [10, 17, 25, 29],
    desc: '恋爱结婚算清账，老人的钱与身后事先安排',
    tags: ['恋爱结婚划不划算 · 家有老人', '人走了以后、重大打击之后'],
  },
  {
    name: '工作', tint: '#FDEDE0', icon: 'briefcase',
    secs: [11, 12, 19, 23, 26, 31],
    desc: '在职维权、离职补偿、工伤，学与创业划不划算',
    tags: ['在职离职工伤 · 学什么划算', '创业、做网站、十八岁后的路'],
  },
  {
    name: '急救', tint: '#FBE4E2', icon: 'cross',
    secs: [13],
    desc: '危急时刻先做什么，按场景排的处置顺序',
    tags: ['紧急情况：先做什么', '按场景排的处置顺序'],
  },
  {
    name: '孩子', tint: '#E5F4F9', icon: 'child',
    secs: [18, 20, 27, 30, 32],
    desc: '从备孕怀孕到孩子上学，每个节点算笔账',
    tags: ['养孩子划不划算 · 刚出生怎么带', '怀孕生产、上学、留学'],
  },
];

export const THEMES = TOPICS.map(t => t.name);

/* 节号 → 主题名（questions.mjs 出题时按这个分块，检索页按这个分卡） */
export const THEME = {};
for (const t of TOPICS) for (const no of t.secs) THEME[no] = t.name;

export const ICONS = {
  heart: '<path d="M12 20.2C7.4 17.1 4.4 14 4.4 11.1a3.8 3.8 0 0 1 7.6-1.1 3.8 3.8 0 0 1 7.6 1.1c0 2.9-3 6-7.6 9.1z"/><path d="M6.3 12.6h2.4l1.3-2.3 1.9 4.1 1.2-1.8h2.6"/>',
  battery: '<rect x="2.6" y="8" width="16.4" height="8.4" rx="2.2"/><path d="M21.4 11.2v2"/><path d="M6 11.2v2M9.2 11.2v2M12.4 11.2v2"/>',
  wallet: '<path d="M3 7.6h16.4a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9.6a2 2 0 0 1 2-2z"/><path d="M1 11.4h18.4"/><circle cx="16.6" cy="15.4" r="1.3"/>',
  shield: '<path d="M12 3.1l7.2 2.6v5.4c0 4.4-2.9 7.6-7.2 9.6-4.3-2-7.2-5.2-7.2-9.6V5.7z"/><path d="M9.2 12.1l2 2 3.6-3.9"/>',
  house: '<path d="M3.6 11.1L12 4.6l8.4 6.5v7.3a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"/><path d="M9.8 20.4v-5.6h4.4v5.6"/>',
  briefcase: '<rect x="2.4" y="7.8" width="19.2" height="11.4" rx="2"/><path d="M9 7.8V6a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 6v1.8"/><path d="M2.4 12.6h19.2"/>',
  cross: '<path d="M9.6 3.4h4.8v6.2h6.2v4.8h-6.2v6.2H9.6v-6.2H3.4V9.6h6.2z"/>',
  child: '<circle cx="12" cy="6.4" r="3.2"/><path d="M12 9.8v5.8"/><path d="M8.6 12.4h6.8"/><path d="M9.4 19.8 12 15.6l2.6 4.2"/>',
};
