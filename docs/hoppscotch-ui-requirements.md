# Postino · Hoppscotch 风格 UI/UX 重建需求文档

> 蓝本:Hoppscotch `hoppscotch-app v3.0.1`(源码快照 `~/Downloads/hoppscotch-main`)。
> UI 全部事实(布局结构、组件拆分、设计 token 取值、快捷键表)来自对该仓库 `packages/hoppscotch-common` 的实地调研,文中标注了参考文件路径。
> 本文只定「做什么、做成什么样」,实现方案见 §7,里程碑见 §8。

---

## 0. 结论(TL;DR)

**可以实现,且时机合适。** Collection 化改造(Phase 0–5)已把数据模型、继承体系、环境作用域、流式合并、pm 脚本、导入导出全部沉淀在 stores/utils 层;Hoppscotch 化重建的只是**视图层**(约 25–30 个组件)。两者同为 Vue 3,其 UI 模式(CSS 变量 token + 语义类、splitpanes 可持久化分栏、tippy popover 菜单、声明式快捷键表)均可脱离其技术栈自建复刻。

**不做整体照搬**:GraphQL、团队/工作区/云同步、Mock Server、文档发布、AI 实验、MQTT/Socket.IO、分享短链等一律排除(见 §1.2)。预计 5 个里程碑(M0–M5),M0+M1 完成后即可日常使用。

---

## 1. 背景与目标

### 1.1 现状与差距

| 维度 | 现状(Postino) | 目标(Hoppscotch 风格) |
|---|---|---|
| 外壳 | 单列布局:左侧集合树 Sidebar + 主区 + 右侧「上下文工具」抽屉(MainView.vue) | 顶部 Header(全局搜索/常用入口)+ 左侧 icon 导航栏 + 主区「上下文侧栏 + 可拖拽分栏编辑区」 |
| 导航 | Sidebar 内混合集合树/环境/历史,折叠按钮 | icon 导航栏(请求/设置)+ 侧栏三 tab:集合/环境/历史(`http/Sidebar.vue`) |
| 请求编辑 | RequestBar + TabPanel(自定义) | 请求行(method 彩色下拉 + 环境变量高亮输入框 + Send/Save)+ 6 个编辑 tab |
| 响应 | ResponsePanel(自研) | lens 体系:按内容类型渲染 + 固定 Headers/请求头/事件流等 tab |
| 主题 | 亮/暗/跟随系统 + 固定 indigo 主色 | **system/light/dark/black 四档** + **9 色 accent**(`settings.vue` + `newstore/settings.ts`) |
| 分栏 | CSS 固定宽度 | splitpanes 全可拖拽,尺寸按 layoutId 持久化(`app/PaneLayout.vue`) |
| 快捷键 | useKeyboardShortcuts(散落) | 声明式注册表 + action handler + `?` 呼出帮助面板(`helpers/keybindings.ts`) |
| 密度 | 行高 32px | body 12px / tiny 10px 高密度(`assets/themes/base-themes.scss`) |

### 1.2 非目标(有意不搬)

GraphQL 全家桶、团队/工作区/账号/云同步、Mock Server、文档发布(Published Docs)、AI 实验、MQTT/Socket.IO、分享短链(e/r)、Embed、34 语言 i18n(保留 zh-CN,英文可选)、Admin 后台。

### 1.3 与既有设计决策的对照(Collection 改造期间的「不照搬」清单)

| 当时的决策 | 本次是否重议 |
|---|---|
| 不分工作空间 | **保留**。Header 右侧放主题/导入导出/设置,不放 workspace/头像 |
| `{{var}}` 语法 | 保留 |
| 不用 EventSource,坚持后台 fetch 流 | 保留(扩展 SW + 桌面直连) |
| REST/SSE/WS 统一在一个请求模型 | **保留数据模型,重议导航呈现**(见 §3 决策 A) |
| worker/sandbox `new Function` 沙箱 | 保留 |

---

## 2. 可行性评估

### 2.1 技术栈对照

| Hoppscotch | 我们 | 结论 |
|---|---|---|
| Vue 3.5 + vite-plugin-pages | Vue 3 + vue-router(已有 3 路由) | ✅ 直接复刻组件模式 |
| 自研 DispatchingStore + dioc DI | Pinia | ✅ 不需要搬,服务层逻辑写进 stores/composables |
| Tailwind 3.4 + `@hoppscotch/ui` 预设 | 无(手写 CSS 变量 + scoped) | ⚠️ 建议引入 **Tailwind 4**(§3 决策 B) |
| `splitpanes` 3.1 | 无 | ➕ 引入(分栏核心) |
| `vue-tippy` 6(tooltip/popover 菜单) | 无 | ➕ 引入(树右键菜单/下拉的基础) |
| CodeMirror 6 | CodeMirror 6 | ✅ 已有,补 dark/black 主题 |
| lucide 图标 | lucide-vue | ✅ 已有 |
| Inter Variable / Roboto Mono Variable(fontsource 本地) | 系统字体 | ➕ fontsource 本地打包(**扩展 CSP 禁外链字体,必须本地化**) |
| `@hoppscotch/vue-toasted` | 无 | ➕ toast:引入 vue-sonner 或自写轻量版(决策 C) |

### 2.2 复用 vs 重建清单

**原样复用(不动)**:`stores/*`(app/workspace/ws)、`utils/*`(inheritance/stream-merge/template/http/ws-client/import/export/collection-migration)、`scripting/*` + `extension/pm-facade.js`、`db/*`、Vitest 测试、`background.js`。

**重建/大改(本需求范围)**:`views/MainView.vue`(→ 新外壳)、`components/sidebar/Sidebar.vue`(→ 集合树 tab 化)、`editor/RequestBar.vue` 模板部分(逻辑保留)、`editor/TabPanel.vue`(→ 6 tab 编辑区)、`response/ResponsePanel.vue`(→ lens 体系)、`response/WsPanel.vue`(→ Realtime 布局)、`common/EnvPanel.vue`(→ 环境面板+Selector)、`common/HistoryPanel.vue`(→ 分组历史)、`common/GlobalSearch.vue`(→ Spotlight)、`CollectionSettingsModal.vue`(→ Properties 弹窗)、新增 `views/SettingsView.vue`、新增外壳组件(Header/Sidenav/PaneLayout)。

**结论**:无不可逾越的技术障碍,全部是视图层工程量;主要风险在「重建期间功能回归」,靠里程碑逐段切换 + 手工验收清单控制(§8、§9)。

---

## 3. 关键决策(已定,2026-08-29)

**决策 A · 导航不分家(已定)。** Sidenav 只保留「请求」「设置」;集合树中 WS/SSE 请求用类型图标区分;打开 WS 请求时主区自动切换为 Realtime 式布局(连接栏 + 通信日志,§6.5),打开 REST/SSE 时为标准请求页。数据模型(`requestType` 统一请求)不回退。
~~备选(否决):Sidenav 分「REST」「Realtime」两项作类型过滤器~~ —— 视觉更贴原版但 M4 工作量 +30%,且集合树按类型分裂与继承/环境按集合组织的设计冲突。

**决策 B · 引入 Tailwind 4(已定)。** `@theme` 把语义类(`bg-primary`/`text-secondary`/`border-divider`)映射到 §4 的 CSS 变量,直接复用 Hoppscotch 的类名体系,还原度最高、翻译成本最低。现有 `theme.css`/`global.css` 在 M0 整体替换;**preflight 会重置全局样式,故 M0 即切换新外壳,重建期间不做新旧样式混用**。

**决策 C · Toast 用 vue-sonner(已定)。** 轻量、CSP 安全、动效完善,全局注册后 `toast.success/error/message` 直接可用。

---

## 4. 设计规范(Design Tokens)

来源:`packages/hoppscotch-common/assets/themes/{base-themes,accent-themes,themes}.scss`。落地方式:`:root` 默认 dark + green accent 兜底,`.light/.dark/.black` 切明暗,`[data-accent="…"]` 切强调色;`@theme` 内建立语义类映射。

### 4.1 主题模式与 Accent

- 背景四档:`system / light / dark / black`(跟随系统用 `usePreferredDark` 解析)。
- Accent 九色:`green teal blue indigo purple yellow orange red pink`,默认 `indigo`。
- 每个 accent 四个变量:`--accent-color`(500)、`--accent-light-color`(400)、`--accent-dark-color`(600)、`--accent-contrast-color`。

### 4.2 Base token 取值(暗色为准,亮色对应 gray-50/100)

| Token | Dark | Black | 用途 |
|---|---|---|---|
| `--primary-color` | `#181818` | `#0f0f0f` | 页面/主区背景 |
| `--primary-light-color` | `#1c1c1e` | 同规则略亮 | 输入框/卡片底 |
| `--primary-dark-color` | neutral-800 | — | hover 面 |
| `--primary-contrast-color` | neutral-900 | — | 侧栏 footer 等 |
| `--secondary-color` | neutral-400 | — | 次级文字 |
| `--secondary-light-color` | neutral-500 | — | 三级文字 |
| `--secondary-dark-color` | zinc-50 | — | 暗色下的强调文字 |
| `--divider-color` / `-light` | `#1f1f1f` | 对应更深 | 边框(暗色两者同值) |
| `--divider-dark-color` | zinc-800 | — | 强边框 |

### 4.3 Method / 状态色(dark 下的 method 文本色)

GET=emerald-500、POST=yellow-500、PUT=sky-500、PATCH=violet-500、DELETE=rose-500、HEAD/OPTIONS=灰;状态色 6 档(2xx 绿 / 3xx 蓝 / 4xx 橙 / 5xx 红 等)。现有 `theme.css` 的 `--method-*` 值需重映射到该体系。

### 4.4 字体与度量

- 正文 **Inter Variable**、代码 **Roboto Mono Variable**,fontsource 本地打包(unplugin-fonts 或直接 import css)。
- `--font-size-body: 0.75rem`(12px)、tiny 10px、行高 1rem —— 全局高密度。
- 圆角:默认 4px;按钮/输入框走「方角拼接」风(URL 输入 `rounded-l-none` 与 method 下拉贴合);弹窗内 6px。
- 标准留白:行内控件 `px-4 py-2`;区块标题条 `px-4 py-2 + 底部分隔线`;大区块 `p-4`。

---

## 5. 全局布局规格

### 5.1 外壳(参考 `layouts/default.vue` + `app/Header.vue` + `app/Sidenav.vue`)

```
┌──────────────────────────────────────────────────────────────────┐
│ AppHeader  [⚡Postino] [   ⌘K 搜索请求/环境/历史/设置…   ]  [导入▾][Theme][⚙] │  h-12, border-b
├───┬──────────────────────┬──────────────────────────────────────┤
│ S │ Sidebar tabs         │  主区(AppPaneLayout,splitpanes)        │
│ i │ ┌──────────────────┐ │  ┌──────────────────────────────────┐ │
│ d │ │集合│环境│历史      │ │  │ 请求行: [GET▾][https://…][ ▶ ][💾] │ │
│ e │ ├──────────────────┤ │  ├──────────────────────────────────┤ │
│ n │ │ 集合树 / 环境列表 │ │  │ Tabs: 参数|Body|Headers|Auth|     │ │
│ v │ │ / 历史            │ │  │       脚本|变量                   │ │
│   │ │ (过滤框置顶)      │ │  ├──────────────────────────────────┤ │
│ 设│ │                  │ │  │ 响应区: ●200 128ms 3.2KB │Raw|JSON│ │
│ 置│ │                  │ │  │        |Headers|事件流|合并结果    │ │
│   │ └──────────────────┘ │  └──────────────────────────────────┘ │
└───┴──────────────────────┴──────────────────────────────────────┘
```

- **Sidenav**(宽 ~56px,可展开至 ~200px,设置项 `EXPAND_NAVIGATION`):仅「请求」(`/`)与「设置」(`/settings`)两项;激活态 = 左侧 2px accent 竖条 + `bg-primaryLight` 文字提亮;收起时 icon + tippy tooltip。
- **Header** 三栏 grid:左 = logo/应用名;中 = Spotlight 搜索条(点击或 `Ctrl/⌘+K`);右 = 导入导出菜单(cURL/Postman/备份,含拖拽提示)、主题循环切换按钮、设置入口。Hoppscotch 的 workspace 切换器/邀请/头像位全部省略。
- **PaneLayout**:splitpanes 双层 —— 外层「侧栏 | 主区」,内层「编辑区 | 响应区」(默认上下,设置可切左右);每层 `layout-id`(如 `http`、`rest-primary`),尺寸经 localStorage 持久化,均有 min-size。

### 5.2 响应式与多形态

- 主窗口 < 768px(参考 Hoppscotch 移动端):Sidenav 转为底部固定栏,侧栏转抽屉。
- **PopupView / SidePanelView**(扩展小窗):隐藏 Header 与 Sidenav,单列紧凑(请求行 → 响应),侧栏内容并入顶部下拉;复用同一套组件的 `compact` 形态而非另写页面。

---

## 6. 功能需求

### 6.1 请求页(REST / SSE 统一;参考 `http/Request.vue`、`http/RequestOptions.vue`、`lenses/ResponseBodyRenderer.vue`)

- **FR-1.1 请求行**:method 下拉(GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS + CUSTOM,彩色文本,alt+↑↓ 循环切换)| URL 输入框 = 环境变量感知(`{{var}}` 高亮 + 自动补全 + 历史补全,现有 VariableAutocomplete 增强)| 发送按钮(发送中变「取消」,`Ctrl+Enter`)| 按钮旁下拉菜单(导入 cURL、生成代码)| 保存按钮 → Save 弹窗(FR-2.5)。
- **FR-1.2 编辑区 tabs**:`参数 / Body / Headers / Auth / 前置脚本 / 后置脚本 / 变量` 七个(变量 tab = 请求级变量,Hoppscotch 亦有 RequestVariables)。Auth tab 内含「继承父级」选项(现有能力保留,只换皮)。
- **FR-1.3 响应区 meta 行**:状态码色点 + 耗时 + 大小;流式请求显示实时字节/事件计数。
- **FR-1.4 响应 lens**:按 Content-Type 动态选渲染器 —— `Raw / JSON(可折叠树,复用 JsonTreeViewer)/ XML / HTML / Image`;固定追加 tab:`Headers(角标数量)`、`请求头`、`事件流`(SSE 原始事件,现有)、`合并结果`(我们的流式合并,视觉并入 lens 体系)、`控制台`(脚本 console 输出)。
- **FR-1.5 发送通道提示**:发送失败占位图内嵌「发送通道」选择(直连/代理/扩展后台),替代 Hoppscotch 的 Kernel Interceptor 占位。

### 6.2 Collections 侧栏(参考 `collections/index.vue`、`Collection.vue`、`Request.vue`)

- **FR-2.1 结构**:tab 化侧栏三页签「集合 / 环境 / 历史」;集合页顶部 = 过滤输入框(本地过滤,输入即过滤树)。
- **FR-2.2 树节点**:集合/文件夹节点(chevron + 文件夹图标 + 名称 + 节点内新建快捷按钮)、请求节点(**method 彩色文本**替代图标 + rest/sse/ws 类型小图标 + 打开中绿色 ping 圆点)。保留我们独有的**继承标记**(「继承自 XX」徽章)—— Hoppscotch 无节点级标记,属增强项。
- **FR-2.3 右键菜单**(tippy popover,`@contextmenu.prevent` 触发,带单键快捷字母):
  - 集合/文件夹:`新建请求 R`、`新建文件夹 N`、`编辑 E`、`排序 S`、`复制 D`、`导出 X`、`属性 P`、`删除 ⌫`;
  - 请求:`编辑 E`、`复制 D`、`复制为 cURL C`、`导出 X`、`删除 ⌫`;
  - 去掉 Hoppscotch 的 Run Collection/Mock Server/Documentation/Share/Add Example。
- **FR-2.4 拖拽**:HTML5 原生 draggable,dragover 高亮(`bg-accent/25`),落点校验(不可移入自身子孙),移动后持久化 order/parentId。
- **FR-2.5 Save 弹窗**(参考 `collections/SaveRequest.vue`):请求名输入 + **复用整棵集合树作单选 picker**(选中文件夹/集合作为落点),Save/Cancel。
- **FR-2.6 Properties 弹窗**(参考 `collections/Properties.vue`):`Headers / Auth / 变量 / 脚本(前置+后置子 tab) / 详情` 五 tab,对应重做 CollectionSettingsModal;文件夹多一个「脚本继承父级」开关(现有能力)。

### 6.3 Environments(参考 `environments/index.vue`、`Selector.vue`、`my/Details.vue`)

- **FR-3.1 侧栏环境 tab**:顶部固定「Global 全局环境」条目(点击编辑),下方列出**当前集合**的环境(Hoppscotch 为用户级扁平列表;我们保持每集合独立模型,仅借鉴视觉);当前选中项 accent 高亮;支持新建/删除/复制环境。
- **FR-3.2 编辑弹窗**:三列变量表 `KEY | 初始值 | 当前值`,行内「初始↔当前」单行/全部互转按钮,secret 开关(掩码,导出剥离 —— 现有能力),底部增删行。
- **FR-3.3 常驻 Selector**:tab 栏右侧 layers 图标 + 当前环境名,popover 含搜索、`Global`/`无环境` 选项(切换写 `collection.selectedEnvId`,现有逻辑)。

### 6.4 History(参考 `history/index.vue`、`Personal.vue`、`rest/Card.vue`)

- **FR-4.1**:分组切换 `时间(默认)/ 域名`;状态筛选 `全部/成功/失败`;自由文本过滤;分组标题 hover 出分组删除;顶部「清空全部」(确认弹窗)。
- **FR-4.2 卡片**:左侧 method 色块(点击恢复请求,tooltip 显示耗时)、URL、相对时间;右键菜单(恢复/复制 URL/删除)。保留我们独有的**「流式」徽章**(悬停显示合并文本)。

### 6.5 Realtime / WS(参考 `pages/realtime/websocket.vue`、`realtime/Communication.vue`、`Log.vue`)

- **FR-5.1**:打开 `requestType==='ws'` 的请求 → 主区切换:顶部**连接栏**(URL(走请求栏)+ 连接中置灰 + Connect/Disconnect 按钮,连接中变「断开」)+ tabs:`通信`(双向消息日志 + 发送框,协议帧区分收发色)、`子协议`(可拖拽排序列表)、`认证`。
- **FR-5.2**:保留断线自动重连(2s×10)开关与连接状态机展示;`Sec-WebSocket-Protocol` 配置沿用现有模型。
- **FR-5.3** SSE 不设独立页面,在请求页内以事件流/合并结果 lens 呈现(现状保留)。

### 6.6 Settings 页(参考 `pages/settings.vue`,路由 `/settings`,Sidenav 第二项)

- **FR-6.1** 分区布局:每区左 1/3 标题+描述、右 2/3 控件,区间 divide-y:
  1. **外观**:主题四档(system/light/dark/black)+ accent 九色色板;
  2. **通用**:语言(zh-CN,EN 预留)、展开导航、侧栏在左、上下分栏/左右分栏;
  3. **网络**:发送通道(直连 CORS/公共代理/扩展后台/桌面 shell,即现 corsMode)+ 代理 URL;
  4. **快捷键**:全表展示 + 点击重绑(现有 shortcuts 体系迁入);
  5. **数据**:迁移向导入口(旧数据/MigrationDialog)、备份/恢复(自有带版本格式)、导入导出、清空数据(确认)。
- **FR-6.2** 主题应用即时生效(写 db.settings,经 useSettings 代理 —— 现有 5.1 机制)。

### 6.7 Spotlight(参考 `app/spotlight/index.vue`、`services/spotlight/`)

- **FR-7.1** `Ctrl/⌘+K` 呼出模态:大输入框 + 分组结果(导航/集合与请求/环境变量/历史/设置项)+ ↑↓ 选择、↩ 确认、ESC 关闭;选中请求 = 打开并展开祖先(现有 GlobalSearch 逻辑迁移)。

### 6.8 快捷键体系(参考 `helpers/keybindings.ts`、`app/ShortcutsPrompt.vue`)

- **FR-8.1** 迁移为声明式注册表 + action handler;必收清单:
  `Ctrl+Enter` 发送/取消 · `Ctrl+S` 保存 · `Ctrl+K` Spotlight · `?` 快捷键帮助 · `Ctrl+I` 重置请求 · `Alt+↑/↓` 切 method · `Ctrl+J` 下载响应 · `Ctrl+.` 复制响应 · `Alt+R/E/H/S` 请求/环境/历史/设置跳转 · `Ctrl+Shift+L` 格式化 Body。
- **FR-8.2** `?` 呼出快捷键总览弹窗(数据即注册表)。

### 6.9 反馈与空状态

- **FR-9.1** 全局 toast(右上,成功/失败/带动作按钮);**FR-9.2** 危险操作统一确认弹窗;**FR-9.3** 空状态占位(无请求/无响应/无历史/发送失败各一张,发送失败占位内嵌通道选择,见 FR-1.5)。

---

## 7. 技术落地方案

### 7.1 新增依赖

`tailwindcss@4` + `@tailwindcss/vite`、`splitpanes`、`vue-tippy`、`@fontsource-variable/inter`、`@fontsource-variable/roboto-mono`、`vue-sonner`(决策 C)。

### 7.2 Token 落地

```css
/* assets/styles/tokens.css(替代 theme.css) */
:root { --primary-color:#181818; ... --accent-color:…indigo-500; }
:root.light { ... }  :root.black { ... }
:root[data-accent="teal"] { --accent-color:…; }
@theme { /* tailwind4: --color-primary→var(--primary-color) 等,
            使 bg-primary/text-secondary/border-divider/accent 直接可用 */ }
```

主题切换:`documentElement.classList` + `data-accent` 属性(参考 `modules/theming.ts`),经现有 useSettings/toggleTheme。

### 7.3 组件映射表(Hoppscotch → 我们)

| Hoppscotch(`packages/hoppscotch-common/src/...`) | 动作 | 我们的组件 |
|---|---|---|
| `layouts/default.vue` + `app/Header.vue` + `app/Sidenav.vue` | 新建 | `components/shell/{AppHeader,AppSidenav}.vue` |
| `app/PaneLayout.vue` | 新建 | `components/shell/PaneLayout.vue`(splitpanes + 持久化) |
| `pages/index.vue` + `http/RequestTab.vue` | 重建 | `views/MainView.vue` + `editor/EditorView.vue` |
| `http/Request.vue` | 改造 | `editor/RequestBar.vue`(逻辑保留,模板重写) |
| `http/RequestOptions.vue`(6 tab) | 改造 | `editor/TabPanel.vue`(增「变量」tab) |
| `lenses/ResponseBodyRenderer.vue` | 重建 | `response/ResponsePanel.vue`(lens 注册表) |
| `collections/index.vue` + `Collection.vue` + `Request.vue` | 改造 | `sidebar/Sidebar.vue`(树逻辑保留) |
| `collections/Properties.vue` / `SaveRequest.vue` | 重做 | `sidebar/CollectionSettingsModal.vue` + 新 `SaveRequestModal.vue` |
| `environments/{index,Selector,my/Details}.vue` | 改造 | `common/EnvPanel.vue` + 新 `EnvSelector.vue` |
| `history/{index,Personal,rest/Card}.vue` | 改造 | `common/HistoryPanel.vue` |
| `app/spotlight/index.vue` | 改造 | `common/GlobalSearch.vue` → Spotlight |
| `pages/settings.vue` | 新建 | `views/SettingsView.vue` |
| `helpers/keybindings.ts` + actions | 重建 | `utils/shortcuts.ts` 改声明式 + `composables/useActionHandler.ts` |

### 7.4 约束

- **扩展 CSP**:字体/图标全部本地打包;禁外链脚本;`splitpanes`/`vue-tippy`/`vue-sonner` 均无 eval,安全。
- 分栏尺寸、导航展开态、过滤词等 UI 偏好 → localStorage;业务数据仍走 db.settings/IndexedDB(不混)。
- 分支策略:新分支 `feature/hoppscotch-ui`,按里程碑提交;旧样式在 M5 一次性删除。

---

## 8. 里程碑与验收标准

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M0 外壳与主题** | 依赖引入、tokens.css、AppHeader/AppSidenav/PaneLayout、四档主题+九 accent、字体本地化 | 主区可拖拽分栏且刷新后保持;三主题×任意 accent 全局无残留旧色;`vue-tsc` 绿 |
| **M1 请求页** | 请求行(method 彩色/环境高亮输入/Send-Cancel/Save)、七 tab 编辑区、响应 lens + meta 行 | 用真实接口完整走通:发请求、看 JSON 树、看 Headers;`Ctrl+Enter` 发送;SSE 流式+合并结果功能等价现状 |
| **M2 集合侧栏** | 树 tab 化、过滤、右键菜单(含快捷字母)、拖拽移动、Properties、Save 弹窗 | 集合/文件夹/请求增删改移、继承标记与继承发送链不回归;拖拽非法落点被拒 |
| **M3 环境+历史** | 环境 tab+编辑弹窗+Selector、历史分组/筛选/卡片 | 变量解析优先级不变(请求>脚本>集合环境>集合变量>全局);历史可按时间/域名分组并恢复请求 |
| **M4 Realtime+Spotlight+快捷键** | WS 连接栏布局、Spotlight、声明式快捷键+帮助面板 | WS 收发/重连/子协议等价现状;`⌘K` 可搜请求/环境/历史/设置;`?` 弹总览 |
| **M5 设置页+多形态+收尾** | SettingsView 五分区、popup/sidepanel 紧凑形态、删除旧样式与旧文档 | 设置全部即时生效;popup 单列可用;全量手工回归清单通过;`npm run build:ext` 冒烟 |

每个 M 结束跑:`npx vue-tsc -b` + `npm test`(37 用例,UI 改动不应触及)+ 手工验收清单。

---

## 9. 风险与开放问题

1. **Tailwind preflight 全局重置**:与旧 CSS 共存期会互相污染 → 在新分支直接以新外壳替换旧外壳(M0 即切换),不做渐进混用。
2. **功能回归**:UI 全重写的最大风险 → 每 M 的手工清单 + 流式/继承/迁移三条主链路在 M1/M2/M3 各回归一次。
3. **CodeMirror 主题**:需为 dark/black 两档补编辑器主题,否则代码区刺眼。
4. **vue-tippy 在 popup/sidepanel 小窗内的定位边界**(弹出层可能被窗缘裁剪)→ 小窗形态下用原生 title 或内联展开降级。
5. **高密度(12px)可读性**:如不适应,`--font-size-body` 提到 13px 一处变量即可全局调整。
6. **开放问题**:① 是否加英文语言包;② 是否要「集合级批量运行(Run Collection)」—— 脚本引擎已支持,可作 M6 增强;③ 示例响应(Example Responses)是否需要(建议不做)。

---

## 10. 附录 · Hoppscotch 参考文件索引

路径前缀:`~/Downloads/hoppscotch-main/packages/hoppscotch-common/src/`

- 外壳:`layouts/default.vue`、`components/app/{Header,Sidenav,PaneLayout,Footer,SpotlightSearch,ShortcutsPrompt}.vue`、`app/spotlight/index.vue`
- 请求页:`pages/index.vue`、`components/http/{Request,RequestOptions,TabHead,Sidebar}.vue`、`lenses/ResponseBodyRenderer.vue` + `lenses/renderers/*`
- 集合:`components/collections/{index,Collection,Request,SaveRequest,Properties,MyCollections}.vue`
- 环境/历史:`components/environments/{index,Selector,my/Details}.vue`、`components/history/{index,Personal}.vue`、`history/rest/Card.vue`
- Realtime:`pages/realtime/websocket.vue`、`pages/realtime/sse.vue`、`components/realtime/{Communication,Log,LogEntry}.vue`
- 设置/主题:`pages/settings.vue`、`assets/themes/{base-themes,accent-themes,themes}.scss`、`modules/theming.ts`、`newstore/settings.ts`
- 交互基建:`helpers/keybindings.ts`、`helpers/shortcuts.ts`、`helpers/actions.ts`、`helpers/rest/labelColoring.ts`、`helpers/dragDropValidation.ts`、`composables/toast.ts`
