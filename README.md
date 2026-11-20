# life-code · 高性价比人生指南工作台

把《高性价比人生指南》里的 772 条建议做成一个**单文件本地工作台**：按主题检索、逐条现状自测、按你的处境排序人生决策、把要做的建议变成待办清单。全程离线可用，数据只留在你自己机器上。

- 交付物：`高性价比人生指南工作台.html`（约 3.1 MB，双击即开，无需服务器、无需安装、无外部请求）
- 在线版：<https://better-life-guide-ve2qskzepjc.qoder.zone>（Qoder Sites 私有访问，需用你的 Qoder 账号打开）
- 数据源：<https://eternity4719.github.io/HowToLiveBetter/>，正文快照 `49fceab`

## 四块能力

**分类检索** —— 34 节内容归成 8 大主题（身体 170 / 精力 58 / 钱 127 / 法律与安全 100 / 家庭 62 / 工作 129 / 急救 49 / 孩子 77 = 772 条），卡片上带条数、节号列表和性价比构成条。搜索与筛选是同一套官方语义：同组内「或」、跨组「且」，关键词做子串命中。

**现状自测** —— 772 题（官方题库 79 题 + 其余 25 节按条目自动出题 693 题）。不给总分：每答一题单独给出证据与出处，答错也能看到那条建议为什么成立。

**人生决策** —— 输入你的处境（花钱多少、耗时多少、意愿强弱、身份角色、关注维度），纯离线检索 + 官方性价比口径排序，**不调用任何模型、不需要任何 API key**。选中的建议可以一键生成待办。

**待办清单** —— 从检索结果或决策结果里把要采取的行动收进来，勾完即归档；和收藏、自测记录一起走本机 `localStorage`，可随时导出 JSON / 导入 JSON。

## 怎么构建

需要 Node 20.11+（开发时用的是 v24）。仓库里不含原书正文和派生数据，先跑一遍流水线：

```bash
node build/fetch.mjs        # 抓官方正文源文件 → build/raw/
node build/parse.mjs        # 解析正文 → build/data/{entries,sections,docs,meta}.json
node build/questions.mjs    # 生成自测题库 → build/data/questions.json
node build/bundle.mjs       # 打包单文件 → 高性价比人生指南工作台.html
node build/verify.mjs       # 29 项校验：官方口径对账 + 与你 PDF 全文逐条比对
node build/serve.mjs        # 可选：本地 http 预览（默认 8765），交付物本身不需要
```

`verify` 的最后一行是硬指标：`29/29 通过 · 数据指纹 <sha> · 772 条 / 34 节 / 9 篇长文`。其中 11 项需要原书全文——`build/raw/` 由 `fetch` 抓，`book_raw.txt` 是作者本机从 PDF 抽取的文本、**不入库**；缺哪份就把对应检查项标成 `SKIP` 并写明原因，不会假通过（干净克隆下为 `18/18 通过 · 跳过 11 项`）。

## 目录结构

```
build/
  template.html   页面骨架（四个视图 + 侧栏 + 顶栏）
  ui.css          全部样式：pastel 主题卡、明暗两套、520/560/900/1120 断点
  app.js          状态机与四个模块的全部逻辑（约 1.7k 行，无依赖）
  cost-model.mjs  官方性价比口径唯一源：COST_W / csOf / ratioOf / 各显示表
  topics.mjs      八大主题唯一源：34 节 → 主题，检索卡、侧栏分组、出题三处共用
  fetch.mjs parse.mjs questions.mjs qreview.mjs   数据流水线
  bundle.mjs verify.mjs serve.mjs                 打包、校验、本地预览
  raw/ data/       抓来的原文与派生数据（gitignore）
documents/designs/   设计取舍记录（参考图采纳了什么、没采纳什么、为什么）
自测题抽查200.md      分层抽样的 200 题复核清单，改题干写进 questions.mjs 的 overrides
```

## 隐私与边界

没有后端、没有埋点、没有云同步，也不发任何网络请求（`file://` 打开时控制台零消息、零外部资源）。记录只写在本机 `localStorage`，换设备靠导出/导入 JSON。在线版和本地是两套独立存储，要延续就在本地导出、去在线页导入。

## 已知取舍

主题划分按 `topics.mjs` 的 8 组，不按参考图里的 9 组——8 组是检索卡、侧栏、出题共用的唯一源，改分组要三处同时对齐。卡片交互目前是「点卡片筛到这一块 + 跳到该块第一节」，「点卡片在卡内就地展开」是已确认的下一步改动。`自测题抽查200.md` 里的题干措辞仍在人工复核中。

## 声明

本项目是个人使用的检索与自测工具，建议正文的版权归原书作者与出版社，数据接口和排版口径归官方站点维护方；仓库不收录、不镜像原书全文，只保留抓取与解析脚本。官方站点：<https://eternity4719.github.io/HowToLiveBetter/>。
