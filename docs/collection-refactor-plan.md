# ApiFix Bin「Collection 化」改造计划

> 目标:把现有的 Category → Module → Interface 层级重构为扁平的 Collection 模型,
> 每个集合独立环境、统一 REST/SSE/WS 管理、Postman 兼容脚本支持集合/文件夹级继承。
>
> 参考:Hoppscotch 源码(`~/Downloads/hoppscotch-main`)。调研结论见文末附录。
> ## 📍 进度快照(2026-08-29 会话结束时更新,新会话从这里接续)
>
> **🎉 全部完成(Phase 0–5)**:`vue-tsc` 全绿、Vitest 37/37 全绿、`npm run build:ext` 冒烟通过
> (含 pm 门面收敛校验)。改造计划五阶段全部落地。
>
> **📝 本轮(2026-08-29 第三/四轮)完成明细**:
> - **3.6** 历史记录流式字段(HistoryEntry += requestType/streamMerge/mergedText/rawPreview 前 64KB,
>   chunks 不入库)+ 历史条目「流式」徽章;重放沿用既有"重新发送"。
> - **3.7** PopupView 接 `onStreamingUpdate` 实时刷新预览(快速发送无合并配置,仅原始流)。
> - **4.3** pm 门面收敛:单一真源 `src/scripting/pm-facade.ts` → Vite lib IIFE 产物
>   `extension/pm-facade.js`(52KB);script-worker importScripts 与 sandbox.html `<script src>`
>   消费同一产物;build.js Step 0 构建 + 复制后强校验两消费端引用一致。传输边界(self/parent)
>   收敛为 FacadeTransport,文件底部按 importScripts 自动装配、Node(测试)环境跳过。
> - **4.4** Postman v2.1 树形导入(`importPostmanTree`):不再拍平,文件夹层级保留,集合/文件夹级
>   auth/变量/脚本落位(`app.importPostmanCollectionTree`);请求无 auth 时置 `inherit` 继承上级;
>   Postman environment JSON 导入为集合环境(`importPostmanEnvironment`)。Sidebar 导入弹窗与
>   MainView 拖拽双入口,旧拍平导入保留为兜底。
> - **4.5** 导出对齐:集合右键「导出 Postman v2.1」按树导出(`generatePostmanCollectionTree`,
>   集合环境另存文件,secret 值剥离);自有带版本备份格式成为主备份
>   (`generateCollectionBackup`/`parseCollectionBackup`,v=COLLECTION_EXPORT_VERSION,含 apis 表,
>   secret 值剥离),导出=原「导出工作区 JSON」入口,导入=粘贴/拖拽自动识别 →
>   `store.restoreCollectionBackup`(按 id 合并,并为集合补齐 modules 双写桥)。
>   另:send() 补上继承 Auth/Headers 的实际发送落地(此前只展示不生效,请求自身显式配置优先)。
> - **5.1** settings 单一真源:app store(db.settings)持全部 AppSettings,useSettings 变薄代理
>   (主题应用 + `apifix_theme_boot` 防闪烁缓存);旧 `apifix_settings` localStorage 键清除;
>   store 新增 `toggleTheme`。
> - **5.2** Vitest 落地(`npm test`,vitest.config.ts):4 个测试文件 37 用例,覆盖继承解析器、
>   流式合并引擎、模板解析、pm 门面(经 mock transport 直跑 EXECUTE_SCRIPT→SCRIPT_RESULT)。
>   **测试抓出并修复两个存量 bug**:①沙箱/worker/页内脚本沙箱都带 `'use strict'` + `eval` 参数名,
>   AsyncFunction 构造必抛 SyntaxError(脚本全挂)——pre-request.ts 与 pm-facade.ts 已去掉 strict
>   前缀(sloppy 模式允许遮蔽 eval/Function);②集合默认 none auth 导致继承条总显示 "Auth · xx(none)"
>   噪音 chip——chips 增加 none 过滤。
> - **5.3** GlobalSearch 覆盖集合树:路径=集合名+文件夹链;文件夹可检索(选中打开集合并展开祖先);
>   遗留模块变量检索替换为集合变量检索。快捷键已基于集合模型(activeSelection/moduleId 桥),无需改动。
> - **5.4** 死代码:删除 `src/utils/storage.ts`(localStorage 旧助手,MigrationDialog 内联键名);
>   删除 `saveGroupOrder` 与 Sidebar 的 legacy groups 双写(`addApiToLegacyGroup`/删除集合清 groups);
>   groups 状态保留仅供 init 兜底 derive 与 MigrationDialog 回滚路径。
>
> **⚠️ 遗留注意**(非阻塞):
> - SSE 类型隐藏方法选择器,LLM 流式 POST 场景受限(方法值保留,可一行 v-if 恢复)。
> - WS 连接同时只维护一条;切到其它 WS 请求会先断旧连。
> - worker/sandbox 沙箱为 best-effort 遮蔽(new Function),非安全隔离(与 Hoppscotch 同策略)。
> - `db.groups` 表与 groups 内存状态保留作迁移/回滚桥,新增写入已停止。
> - 环境变量仍是 EnvVariable(secret 可选),未迁 CollectionVariable(Phase 0 偏差,保持现状)。
>
> **关键落点**:`stream-merge.ts`(引擎+`STREAM_MERGE_PRESETS`)、`inheritance.ts`(1.2 解析器)、
> `collection-migration.ts`(迁移助手)、`CollectionSettingsModal.vue`(1.3)、pm scope 写回在
> `RequestBar.persistScriptEnvChanges`、pre-request.ts 的 `__scopedStores`/`scopedResultOf`。
> Phase 0 实现与原计划的偏差:workspace store 未改名 collections.ts(保留双写桥接,Phase 1 后再删);
> Environment.variables 仍用 EnvVariable(仅加 secret 字段),未迁到 CollectionVariable。



## 设计理念(不可妥协项)

1. **不分工作空间**,通过 Collection 区分。
2. **每个 Collection 独立配置环境**(A: local/test;B: dev/test/prod)。
3. **REST / SSE / WebSocket 统一管理**(不做 Hoppscotch 那种大类分页);
   必须实现:**流式接收 + 自定义合并内容**(如提取 `data.content` 并拼接)。
4. **Pre Scripts 无缝兼容 Postman**,支持集合级、文件夹级(默认继承父级)。

---

## Phase 0 · 数据模型重构(一切的地基)

- [x] **0.1 定义新类型**(`src/types/index.ts`):

  ```ts
  // 集合:取代 Category + Module 的合并体
  interface Collection {
    id, name, order, description?, color?, icon?
    auth: AuthConfig            // 集合级 Auth(请求默认 inherit 到这里)
    headers: KvPair[]           // 集合级 Headers
    variables: EnvVariable[]    // 集合变量
    preRequestScript: string    // 集合级 Pre Script
    postRequestScript: string
    selectedEnvId: string | null
  }

  // 树节点:folder | request(基于现有 interfaces 表扩展)
  interface CollectionNode {
    id, collectionId, parentId: string | null, nodeType: 'folder' | 'request', order
    // folder 可选覆盖(全部缺省 = 继承父级)
    auth?, headers?, variables?, preRequestScript?, postRequestScript?, scriptsInherit?: boolean
    apiConfigId?                // request 指向现有 apis 表
  }

  // 环境变量升级为 Postman 语义
  interface EnvVariable { key, initialValue, currentValue, secret, enabled }
  // Environment 挂到集合:collectionId: string | 'global'
  ```

- [x] **0.2 Request 增加 `requestType: 'rest' | 'sse' | 'ws'`** + WS 字段(`protocols`)+
      `streamMerge?: StreamMergeConfig`(见 Phase 3);废弃 `ApiConfig.folder`。
- [x] **0.3 Dexie v10 schema 与迁移**(`src/db/index.ts`):新表 `collections`;
      `environments` 加 `collectionId`;`interfaces` 加 `collectionId`。
      迁移事务:每个 Module → 一个 Collection(Category color/icon 带过去,Category 层删除),
      全局 environments → `collectionId: 'global'`,旧表保留一个版本以便回滚。
- [x] **0.4 导出格式加 `v` 版本号字段**(字段级版本标记即可,不引入 Zod)。
- [x] **0.5 收敛 stores**:已删 3 个冗余 store;workspace.ts 保留文件名,内部新增 collections 真源状态
      + 双写镜像(旧 UI 零回归),Phase 1 后再物理改名;`app.ts` 新增 getEnvVariablesForApi 等。
- [x] **0.6 顺手清理**:移除未使用的 axios;合并 `InterfaceNode` 的
      `preRequestScript/preScript`、`postRequestScript/postScript` 重复字段。

## Phase 1 · 集合树与继承体系

- [x] **1.1 Sidebar 改造**(`Sidebar.vue`):去掉 Category 层,顶层直接是 Collection 列表;
      节点图标区分 rest/sse/ws;复用现有拖拽与右键菜单。
- [x] **1.2 继承解析器**(`src/utils/inheritance.ts`,已实现,未接入 UI):
      `resolveInherited(collectionId, nodeId)` 沿祖先根→叶返回
      `{ auth, headers, variables, preScripts[], postScripts[] }`。规则:

  | 项 | 规则 |
  |---|---|
  | Auth | 请求 `authType='inherit'`(默认)→ 最近一个非 inherit 祖先;无则 none |
  | Headers | 祖先激活项合并,同 key 近层覆盖远层;请求自身最高优先 |
  | 变量 | 同 key 近层覆盖远层 |
  | Pre Scripts | Collection → 文件夹(根→叶,跳过关闭继承者)→ 请求(Postman 同序) |
  | Post Scripts | 请求 → 文件夹(叶→根)→ Collection(Postman 同序) |

- [x] **1.3 Collection 设置面板**:Auth / Headers / 变量 / Pre+Post 脚本 / 描述。
- [x] **1.4 Folder 设置对话框**:同上 + "脚本继承父级"开关(默认开)。
- [x] **1.5 请求编辑器继承提示**:继承标记条已渲染(继承自 XX + Auth/Headers/变量/Pre/Post chips,
      悬停显示明细;`RequestBar.inheritedChips`)。
- [x] **1.6 Module 遗留能力安置**:dataSource/OpenAPI 同步、exportConfig 移入
      `collection.meta`(功能冻结,后续按需删)。

## Phase 2 · 每集合独立环境

- [x] **2.1 EnvPanel 重写**:环境选择器只显示**当前集合**的环境,
      切换写 `collection.selectedEnvId`;全局环境独立入口。
- [x] **2.2 解析优先级(Postman 对齐)**:
      请求变量 > 脚本临时变量 > 当前集合所选环境 > 集合变量(父→子就近覆盖)> 全局变量。
      改 `template.ts` scope 链与 `app.ts getEnvVariables()`。
- [x] **2.3 Script 写回修正**:`persistScriptEnvChanges()` 写回当前集合所选环境;
      `pm.collectionVariables` 真正落到 `collection.variables`;
      `pm.environment` / `pm.globals` 分别对应集合环境与全局环境。
- [x] **2.4 Secret 变量**:UI 掩码已完成(EnvPanel 眼睛切换);⚠️ 导出剥离在 4.5 未做。
- [x] **2.5 兼容**:`{{ModuleB.var}}` 跨模块引用废弃(迁移时转为集合变量);
      移除 `ModuleVariableValue.environmentValues[envId]` hack。

## Phase 3 · REST/SSE/WS 统一管理 + 流式合并(核心必须项)

- [x] **3.1 统一请求模型**:类型选择器(REST/SSE/WS)已加在请求栏,非 rest 隐藏方法选择器;
      子面板已统一(EditorView 按 requestType 切换 WsPanel / ResponsePanel)。
      注意:SSE 隐藏方法选择器后 POST 场景受限(见顶部快照)。
- [x] **3.2 SSE 强化**(`http.ts drainSseEvents`):多行 `data:` 拼接、`id`/`retry`、
      `data: [DONE]` 识别、BOM/CRLF 容错;事件补全 `{ event, data, id, timestamp }`。
- [x] **3.3 流式合并引擎**(`src/utils/stream-merge.ts`):

  ```ts
  interface StreamMergeConfig {
    mode: 'off' | 'auto' | 'custom'
    eventFilter?: string        // 只合并指定 event 类型,空 = 全部
    dataPath: string            // 取值路径:data.content / choices[0].delta.content
    separator: string           // 片段拼接符,默认 ''
    stopMarker?: string         // 终止标记(默认 [DONE]),不并入结果
  }
  ```

  - `dataPath` 支持 `a.b.c` 与 `a[0].b`;
  - `auto` 内置预设:OpenAI(`choices[0].delta.content`)、Anthropic(`delta.text`)、
    Gemini(`candidates[0].content.parts[0].text`)、`content` / `text` 兜底;
  - 基于现有 `ResponseStreamChunk.json` 逐 chunk 增量 append,不做全量重算。
- [x] **3.4 ResponsePanel 流式 UI**:流式响应下增加 **合并结果**(只读 CodeMirror,
      实时追加、自动滚动、复制按钮)与 **事件流**(序号/时间/event/负载列表)两个子视图。
- [x] **3.5 WS 客户端**:`background.js` ws-control 端口协议(WS_OPEN/SEND/CLOSE/PING ⇄
      WS_STATE/MESSAGE/LOG);保活用 UI 20s WS_PING 重置 SW 计时器(不注入协议心跳帧);
      `ws-client.ts` 门面兼容桌面/浏览器直连;`WsPanel.vue` 连接配置(URL 走请求栏 + 子协议)、
      双向消息日志、发送框、断线自动重连开关(2s×10 次)。
- [x] **3.6 历史与恢复**:HistoryEntry 记录 requestType/streamMerge/mergedText/原始前 64KB
      (chunks 不入库);历史条目「流式」徽章悬停看合并文本;重放走既有"重新发送"。
- [x] **3.7 Popup 补流式**:PopupView 快速发送接 `onStreamingUpdate` 实时刷新预览。

## Phase 4 · Postman 兼容脚本与继承执行

- [x] **4.1 执行链接通继承**:`send()` 按 Phase 1.2 完整链执行 pre(Collection → folders → request),
      post 反向;尊重 `scriptsInherit=false`;脚本日志标注来源层级。
- [x] **4.2 pm.* 门面按 scope 重接线**(`pre-request.ts createPmRuntime`):
      `pm.environment` → 集合所选环境;`pm.collectionVariables` → `collection.variables`;
      `pm.globals` → 全局环境;`pm.variables` → 合并只读视图。门面本身不动。
- [x] **4.3 沙箱双副本收敛**:门面单一真源 `src/scripting/pm-facade.ts` → IIFE
      `extension/pm-facade.js`,worker(importScripts)与 sandbox(`<script src>`)消费同一产物;
      build.js Step 0 构建 + 收敛校验。实施偏差:未做"注入两处再比对",而是单产物双消费(更强收敛)。
- [x] **4.4 Postman 导入升级**:`importPostmanTree` 保留 v2.1 树(文件夹层级 + 集合/文件夹级
      auth/变量/脚本落位,请求无 auth 置 inherit);`importPostmanEnvironment` 导入集合环境;
      Sidebar 弹窗与 MainView 拖拽双入口,旧拍平保留兜底。脚本原文照抄未转换。
- [x] **4.5 导出对齐(含 2.4 secret 剥离)**:集合右键导出 Postman v2.1 树
      (`generatePostmanCollectionTree` + 环境文件);自有带版本备份为备份主格式
      (`generateCollectionBackup`/`parseCollectionBackup`,secret 值剥离,导入按 id 合并并补齐双写桥);
      send() 补齐继承 Auth/Headers 实际落地。

## Phase 5 · 收尾与质量

- [x] **5.1 设置去重**:app store(db.settings)为 AppSettings 唯一真源;useSettings 薄代理
      (主题应用 + boot cache);store 新增 toggleTheme;旧 `apifix_settings` localStorage 键清除。
- [x] **5.2 引入 Vitest**(`npm test`):37 用例覆盖继承解析器、流式合并引擎、模板解析、pm 门面
      (mock transport 直跑 EXECUTE_SCRIPT→SCRIPT_RESULT);抓出并修复沙箱 strict-mode 存量 bug。
- [x] **5.3 GlobalSearch 覆盖集合树**:路径=集合名+文件夹链;文件夹可检索并展开祖先;
      集合变量检索替代遗留模块变量;快捷键已基于集合模型,无需改动。
- [x] **5.4 删除死代码**:删除 `src/utils/storage.ts`;删除 `saveGroupOrder` 与 Sidebar legacy
      groups 双写;groups 状态保留仅供 init 兜底 derive 与 MigrationDialog 回滚;重复脚本字段已于 0.6 合并。

## 不照搬 Hoppscotch 的点(有意为之)

1. **工作空间/团队**——数据模型里彻底不出现。
2. **`<<var>>` 语法**——保留 `{{var}}`(Postman 兼容的一部分)。
3. **EventSource 方案**——只支持 GET、不能带 header,调不了 LLM 流式接口;
   坚持 background SW + fetch 流。
4. **REST / Realtime 分家**——统一在一个请求模型里,`requestType` 只是一个字段。
5. **QuickJS WASM 沙箱**——现有 worker + sandbox iframe + `new Function` 三级降级够用,
   且支持 AsyncFunction(await);远期再考虑。

## 实施顺序

Phase 0 → 1 → 2 → 3 → 4 → 5 串行。3.3/3.4(流式合并)是硬需求,
可在 Phase 1 完成后插队(不依赖环境系统)。预估 Phase 0+1 最大(数据迁移 + Sidebar/设置面板)。

---

## 附录 · Hoppscotch 调研结论(2026-08)

**数据模型**(`packages/hoppscotch-data/src/`):
- 核心技巧:**文件夹即集合** —— `HoppCollection.folders: HoppCollection[]` 递归,
  每层节点都带 auth / headers / variables / preRequestScript / testScript,
  继承只需沿路径上溯(`cascadeParentCollectionForProperties`,根→叶)。
- `authType: "inherit"` + `authActive` 是唯一的继承标记;请求自身优先于继承。
- 变量四元组 `{ key, initialValue, currentValue, secret }`,解析时 current → initial 回退;
  导出时剥离 currentValue 与 secret。
- 环境是**用户级扁平列表**(非按集合),与我们"每集合环境"的设计不同,仅借鉴变量结构。
- 持久化 JSON 带 `v` 版本字段(verzod)逐版本迁移。

**网络/流式**(`hoppscotch-common/src/helpers/realtime/SSEConnection.ts` 等):
- SSE = 原生 `EventSource` 薄封装(只支持 GET),输出纯日志行,**无任何解析/合并能力**。
- WS = 原生 `WebSocket` 封装 + 扁平消息日志。
- REST 执行链:RequestRunner(合并继承 props + 跑脚本)→ EffectiveURL(模板解析/auth 生成)
  → kernel(axios / Tauri+libcurl)。
- **不存在** `choices[0].delta.content` 之类的流式内容合并——需自研。

**脚本沙箱**(`packages/hoppscotch-js-sandbox`):
- 实验模式用 QuickJS WASM(faraday-cage);默认模式是 web worker 里 `new Function`(无隔离)。
- `pm.*` 是运行时兼容层(bootstrap JS 里定义),`pm.collectionVariables` / `pm.vault` /
  `pm.iterationData` 直接抛异常;Postman 导入时脚本原文照抄不转换。
- 脚本环境变更以 `{ updatedEnvs }` 载荷返回宿主;**未配置超时/内存上限**(我们可以做得更好)。
- 环境变量合并优先级:request → collection → temp → selected env → global。
