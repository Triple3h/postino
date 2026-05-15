# API Fox Lite — 实现计划

> 基于 design-doc.md，去掉数据源同步，其余全部实现
> 从现有 vanilla JS 单文件架构迁移到 Vue 3 + TypeScript + Vite 工程化架构
> 创建日期：2026-05-15

---

## Phase 0：工程脚手架搭建（1 周）

**目标**：建立新项目骨架，Vue 3 + TS + Vite + CRXJS 跑通，三视场入口可访问空页面

| 任务 | 说明 |
|------|------|
| 初始化 Vite + Vue 3 + TS 项目 | `npm create vite` + CRXJS 插件配置 |
| Manifest V3 配置 | permissions: `storage, activeTab, sidePanel, cookies`；`host_permissions: <all_urls>`；声明 popup / side_panel / background / sandbox |
| 三视场入口 | `popup.html`、`sidepanel.html`、`index.html`（全屏页）三个独立入口 |
| Background Service Worker | 基础消息监听框架（`API_REQUEST`、`STREAMING_REQUEST`、`CANCEL_STREAM`） |
| 路由与布局骨架 | Vue Router 配置三视场共享路由，基础 Layout 组件（左侧栏 + 主内容区 + 右侧面板） |
| Dexie.js 初始化 | `ApiFoxDB` 建表：categories、modules、interfaces、history、settings |
| Pinia Store 骨架 | `categoryStore`、`moduleStore`、`interfaceStore`、`historyStore`、`settingsStore` |
| 主题系统 | CSS 变量体系（设计文档 2.1 色彩体系），Light/Dark/跟随系统 |
| 数据迁移工具 | 从旧版 `localStorage`（`apifix_bin_data` / `apifix_env_vars` / `apifix_history`）导入到 IndexedDB |

**交付物**：可加载的空壳插件，三视场可访问，数据库可读写

---

## Phase 1：核心数据模型 + 全屏页基础（2 周）

**目标**：全屏页可完成「大类/模块管理 → 接口编辑 → 发送请求 → 查看响应」完整闭环

| 任务 | 说明 |
|------|------|
| Category CRUD | 新建/重命名/修改颜色/删除大类，左侧导航渲染大类列表 |
| Module CRUD | 新建/删除/移动模块，模块类型切换（通用API / OpenAPI YAML / 只读） |
| InterfaceNode 树形管理 | 文件夹 + 请求节点，无限层级，拖拽排序，右键菜单 |
| 请求编辑器 — 请求行 | Method 选择器（带颜色）、URL 输入框（`{{` 触发变量提示）、发送按钮 |
| 请求编辑器 — Tab 面板 | Params / Body / Headers / Cookies / Auth / 设置 六个 Tab |
| Body 编辑器 | CodeMirror 6，支持 none / form-data / urlencoded / JSON / XML / text / binary |
| KV 编辑器组件 | 可复用的键值对编辑器（Params、Headers、form-data、urlencoded 共用） |
| Auth 配置 | none / bearer / basic / apikey 四种认证 |
| 请求发送 | 通过 Background Service Worker 发送，支持 CORS 绕过 |
| 响应展示 | 状态码/时间/大小、Body（Pretty/Raw/Preview）、Headers、Cookies |
| JSON 响应查看器 | 语法高亮 + 树形折叠 + 搜索 + 复制路径/值 |
| 环境变量基础 | 模块变量页（变量名 / 远程值 / 本地值 三列表格），`{{var}}` 模板解析 |
| 保存/加载 | 接口配置持久化到 IndexedDB，自动保存 |

**交付物**：全屏页可完整使用，替代现有 extension 功能

---

## Phase 2：环境变量体系 + 导入导出（1.5 周）

**目标**：完善变量系统，实现数据互通

| 任务 | 说明 |
|------|------|
| 四级变量作用域 | 全局变量 → 模块远程值 → 模块本地值 → 请求级变量，优先级解析 |
| 跨模块变量引用 | `{{moduleB.token}}` 语法，按模块 ID 解析，显示层映射模块名 |
| 内置动态函数 | `{{$timestamp}}`、`{{$guid}}`、`{{$randomInt}}` 等 |
| 变量浮层提示 | URL/Body/Header 输入框中 `{{` 触发变量列表浮层 |
| cURL 导入 | 解析 cURL 命令，创建接口节点 |
| Postman Collection 导入 | v2.1 格式解析，映射到 Category/Module/InterfaceNode |
| OpenAPI/Swagger 导入 | 3.0 YAML/JSON 解析，自动创建模块和接口树 |
| HAR 文件导入 | 浏览器导出的 HAR 文件解析 |
| 导出功能 | 导出为 cURL / Postman Collection / OpenAPI 3.0 / Markdown |
| 代码生成 | 生成 Python requests / JavaScript fetch/axios / Java HttpClient 等语言代码 |
| 旧版数据迁移 | 从 `apifix_bin_data` 迁移现有 APIs/Groups 到新数据模型 |

**交付物**：变量系统完整可用，可从旧版和其他工具导入导出

---

## Phase 3：脚本引擎（2 周）

**目标**：实现完整的 `pm` API + 沙箱执行 + 断言系统

| 任务 | 说明 |
|------|------|
| 沙箱 iframe 执行环境 | `sandbox.html` + `postMessage` 通信，禁用 `window/document/eval/Function` |
| 脚本调度器 | 注入上下文对象、捕获日志、30 秒超时熔断 |
| `pm.request` API | method / url / body / addHeader / setHeader / removeHeader / addQueryParam / removeQueryParam / setPathParam |
| `pm.response` API | code / status / responseTime / responseSize / headers / text / json / xml / jsonPath / match |
| `pm.globals/environment/variables/collection` | 四级 VariableScope：get / set / unset / replaceIn / toObject / import / clear |
| `pm.sendRequest` | 异步辅助请求，通过主进程代理执行 |
| `pm.sendRequest.sendInterface` | 调用当前模块内其他接口 |
| `pm.test` + `pm.expect` | Chai 风格断言，支持异步测试用例 |
| `pm.visualizer` | template / table 可视化渲染 |
| `pm.info` | moduleName / categoryName / interfaceName / eventName |
| 前置脚本编辑器 | CodeMirror 6 + 代码片段插入下拉 |
| 后置脚本编辑器 | 同上 |
| 脚本日志控制台 | console.log/info/warn/error/table 输出，带时间戳和类型标签 |
| 文件夹级前置脚本 | 文件夹可设置前置脚本，自动给子请求加 Header |
| 执行生命周期 | 变量解析 → 前置脚本 → 发送请求 → 接收响应 → 后置脚本 → 断言 → 更新历史 |

**交付物**：脚本引擎完整可用，兼容 Postman 脚本生态

---

## Phase 4：Side Panel + Popup（1.5 周）

**目标**：三视场全部可用

| 任务 | 说明 |
|------|------|
| Side Panel 入口 | `side_panel` manifest 配置，右键/快捷键打开 |
| Side Panel 布局 | 紧凑版左侧导航 + 请求/响应上下堆叠 |
| Side Panel 响应式 | 300-400px 图标栏 / 400-600px 折叠导航 / 600-800px 完整导航 |
| Popup 浮窗 | 800×600，最近模块卡片 + 快捷发送 + 最近 5 条历史 |
| Popup 快速发送 | 极简表单：Method + URL + JSON Body + 发送 |
| 三视场状态同步 | `chrome.storage` + `chrome.runtime.onChanged` 监听，一处修改变量另一处刷新 |
| 视场切换 | Popup → Side Panel / Popup → 全屏页，携带当前编辑上下文 |
| 快捷键 | `Ctrl+Shift+A` Popup / `Ctrl+Shift+S` Side Panel / `Ctrl+Shift+F` 全屏页 |

**交付物**：三视场完整运行，状态同步

---

## Phase 5：高级功能（2 周）

**目标**：生产级功能补全

| 任务 | 说明 |
|------|------|
| 请求历史 | 自动保存最近 100 条，星标收藏，按模块/时间筛选 |
| 响应差异对比 | 两次响应 JSON Diff，类似 Git Diff 并排展示 |
| 批量测试 | 选中文件夹串行/并行执行，生成测试报告 |
| 接口对比 | 选中两个接口并排显示参数/响应差异 |
| Cookie 自动携带 | 读取当前浏览器域名 Cookie，可开关 |
| Network 捕获 | DevTools 面板一键导入浏览器 Network 请求（需 `webRequest` 权限） |
| 右键菜单 | 网页中选中 JSON → 「发送到 API Fox Lite 格式化」（content_script） |
| 全局搜索 | `Ctrl+K` 命令面板，搜索跨模块的接口/变量/历史 |
| 导出/备份 | 导出 OpenAPI / Markdown / HTML 文档，备份到 GitHub Gist |
| 模块概览页 | 统计卡片（接口数/文档数/数据模型/用例覆盖率） |
| 只读模式 | 禁止手动修改接口，仅通过导入更新 |
| OpenAPI YAML 编辑模式 | 直接编辑 YAML 文本，实时预览接口结构 |
| 回收站 | 删除的模块/接口进入回收站，30 天自动清理 |

**交付物**：功能完整的浏览器插件

---

## Phase 6：打磨与优化（1 周）

**目标**：体验优化、性能调优、发布准备

| 任务 | 说明 |
|------|------|
| 性能优化 | 虚拟滚动（大量接口）、懒加载模块数据、CodeMirror 按需加载 |
| 键盘快捷键完善 | 全局快捷键、编辑器内快捷键、Tab 导航 |
| 无障碍 | ARIA 标签、键盘焦点管理 |
| 国际化 | 中文为主，预留 i18n 接口 |
| 插件图标与品牌 | 16/32/48/128 图标，加载页动画 |
| Chrome Web Store 发布素材 | 截图、描述、隐私政策 |
| 错误监控 | 全局错误捕获、异常上报框架 |
| Electron 适配 | 全屏页复用到 Electron 桌面端（`webSecurity: false` 绕过 CORS） |

**交付物**：可发布的 Chrome 扩展 + Electron 桌面端

---

## 总排期

| 阶段 | 周期 | 累计 |
|------|------|------|
| Phase 0：工程脚手架 | 1 周 | 1 周 |
| Phase 1：核心闭环 | 2 周 | 3 周 |
| Phase 2：变量 + 导入导出 | 1.5 周 | 4.5 周 |
| Phase 3：脚本引擎 | 2 周 | 6.5 周 |
| Phase 4：Side Panel + Popup | 1.5 周 | 8 周 |
| Phase 5：高级功能 | 2 周 | 10 周 |
| Phase 6：打磨优化 | 1 周 | 11 周 |

**总计约 11 周**，每个 Phase 结束后有一个可交付的里程碑版本。

---

## 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 框架 | Vue 3 + TypeScript | 响应式、组件化 |
| 构建 | Vite + CRXJS | 浏览器插件开发工具链 |
| UI 库 | 自研组件 + Headless UI | 保持 Apifox 风格一致性 |
| 编辑器 | CodeMirror 6 | 全视场统一，轻量高性能 |
| HTTP 客户端 | 原生 `fetch` + `chrome.webRequest` API | 捕获 Cookie |
| 存储 | Dexie.js | IndexedDB 封装 |
| 状态管理 | Pinia | 跨视场状态同步 |

---

## 与现有代码的关系

- 现有 `index.html`（Electron 版）和 `extension/`（Chrome 扩展版）保持不动，新项目独立开发
- Phase 2 中提供旧版数据迁移工具，从 `localStorage` 导入到新 IndexedDB
- Phase 6 中将全屏页复用到 Electron 桌面端，替代现有 `index.html`
- 迁移完成后，旧代码归档到 `legacy/` 目录
