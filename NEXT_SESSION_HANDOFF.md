# Next Session Handoff

## 可直接复制给下个会话的提示词

你在 `/Users/triple3h/GithubProjects/apifix-bin-pro` 继续实现 `implementation-plan.md`。上一轮已经完成一批基础修复和脚手架，请不要重做或回滚这些改动。

当前目标：把 UI 和业务调用从旧的 `apis/groups/currentApiId` 兼容层，逐步切换到计划里的 `Category -> Module -> InterfaceNode` 模型。优先完成 Sidebar 导航树和 Editor/Search/History 调用适配，保持现有功能可用，并继续保证 `npm run typecheck`、`npm run build`、`npm run build:ext` 通过。

已完成：
- `npm run typecheck` 已修通。
- `npm run build` 已通过。
- `npm run build:ext` 已通过。
- 新增 `env.d.ts`。
- 新增 planned model 类型：`Category`、`Module`、`InterfaceNode`、`PlannedWorkspaceModel`。
- Dexie 新增 v2 表：`categories`、`modules`、`interfaces`。
- 新增 Pinia stores：`src/stores/category.ts`、`src/stores/module.ts`、`src/stores/interface.ts`、`src/stores/workspace.ts`。
- `src/stores/app.ts` 已在初始化时从旧 `apis/groups` 自动派生 planned model 三表索引。
- 修复前置脚本结果未进入实际发送请求的问题。
- `src/utils/http.ts` 已统一用 `resolveTemplateVars` 解析模板变量。
- 导出/代码生成已补 OpenAPI 3.0、HTML 文档、Java HttpClient。
- `extension/manifest.json` 已补 `activeTab`、`cookies`、commands 快捷键。
- `extension/background.js` 已支持 `CANCEL_STREAM` alias 和快捷键打开 popup/side panel/full page。

下一步建议顺序：
1. 先读 `src/stores/workspace.ts`、`src/types/index.ts`、`src/db/index.ts`、`src/stores/app.ts`，确认 planned model 兼容层。
2. 改 `src/components/sidebar/Sidebar.vue`：从一层 `groups -> apiIds` 渲染切到 `categories -> modules -> interfaces`，但选择接口时仍可设置兼容的 `store.currentApiId = interfaceNode.apiId`。
3. 改 `src/components/common/GlobalSearch.vue` 和 `src/components/common/HistoryPanel.vue`：优先使用 interface/module/category 元信息展示，必要时仍 fallback 到 `store.apis`。
4. 改 `src/utils/migration.ts` 和 `src/components/common/MigrationDialog.vue`：迁移旧数据时同时写入 planned model 三表，而不是只依赖 `app.init()` 的延迟派生。
5. 改 `src/utils/import.ts`、`src/utils/openapi-import.ts` 及 Sidebar 导入流程：导入请求时除了写 `apis`，也写入对应 module/interface 索引。
6. 每个小阶段后运行 `npm run typecheck`；最后运行 `npm run build` 和 `npm run build:ext`。

注意事项：
- 现有 UI 还主要依赖旧模型，不能直接删除 `ApiConfig`、`Group`、`store.apis`、`store.groups`。
- 不要推倒重写；使用兼容层渐进迁移。
- 不要新增依赖，除非用户明确同意。
- 不要回滚用户或其他 agent 的并行改动。

## 当前剩余核心差距

- Sidebar 还没有真正展示 `Category -> Module -> InterfaceNode` 树。
- Editor 仍通过 `getCurrentApi()` / `updateApi()` 工作。
- MigrationDialog 仍主要写旧 `apis/groups` 表。
- Importers 仍返回 flat `ApiConfig[]`，没有直接生成 planned model 节点。
- `historyStore`、`settingsStore` 还没有从 `appStore` 中拆出。
- CRXJS 仍未接入，当前 Vite 多入口是手写 Rollup input。

## 上轮验证

```bash
npm run typecheck
npm run build
npm run build:ext
```

三者均通过。`npm run build` / `build:ext` 只有 Vite 大 chunk 警告。
