// 官方成本模型与排序口径：权重、显示措辞、性价比判定式、三堆分类、byValue 排序
// 逐字对齐在线版 index.html（第 605-620、1034-1039 行）与 selfcheck.html（第 374-381 行）。
// 改这里等于改全书口径，build/verify.mjs 会检查有没有抄歪 —— 别动。
export const COST_W = { money: { '0': 0, '少': 1, '多': 2 }, time: { '少': 0, '中': 1, '多': 2 }, will: { '否': 0, '些': 1, '是': 2 } };
export const LABEL = {
  money: { '0': '不花钱', '少': '花少量钱', '多': '花不少钱' },
  time: { '少': '顺手', '中': '花几小时', '多': '每天占时间' },
  will: { '否': '不用毅力', '些': '要一点毅力', '是': '要很多毅力' },
};
export const LENS_LABEL = { '死亡率': '换寿命', '金钱': '换钱', '时间': '换时间精力', '自由': '换人身自由' };
export const WHO_LABEL = { '怀孕': '怀孕或备孕', '婴幼儿': '家有 3 岁以下孩子', '孩子': '家有 3 到 18 岁孩子', '老人': '家有老人', '35岁': '35 岁以上', '60岁': '60 岁以上', '女性': '女性' };

// 官方 selfcheck.html：没做到的事按「要不要改习惯」分三堆，判据是成本标签里的毅力
export const PILES = [
  { will: '否', name: '一次办完就行', sub: '做一次或者记住就够，不用改习惯' },
  { will: '些', name: '要改一个习惯', sub: '要忍一点不适，坚持几周就成了习惯' },
  { will: '是', name: '要长期坚持', sub: '和惯性长期对着干，最难，挑一件慢慢来' },
];

export const csOf = e => (COST_W.money[e.money] ?? 0) + (COST_W.time[e.time] ?? 0) + (COST_W.will[e.will] ?? 0);
export const ratioOf = e => (e.level === '大' ? (e.cs === 0 ? '极高' : (e.cs <= 2 ? '高' : '一般'))
  : e.level === '中' ? (e.cs === 0 ? '高' : '一般') : '一般');

// 官方 byValue：性价比 → 收益量级 → 毅力 → 证据等级 → 成本合计（作用在条目本身）
const RANK = { '极高': 0, '高': 1, '一般': 2 };
const LV = { '大': 0, '中': 1, '小': 2 };
const WILL = { '否': 0, '些': 1, '是': 2 };
const GR = { A: 0, B: 1, C: 2 };
export const byValue = (a, b) => (RANK[a.ratio] - RANK[b.ratio]) || (LV[a.level] - LV[b.level])
  || (WILL[a.will] - WILL[b.will]) || (GR[a.grade] - GR[b.grade]) || (a.cs - b.cs);
