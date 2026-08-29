# 响应卡片布局优化需求（参考 ApiFox）

> 状态：已实施并通过验证（2026-08-29：vue-tsc 绿 / Vitest 37 过 / build:ext 成功 / dev 页 webbridge 自测通过）
> 参考对象：ApiFox 桌面版响应卡片（用户提供 6 张截图）
> 适用范围：`src/components/response/ResponsePanel.vue` 及其子组件；**WsPanel 不在本次范围**（保持现有 连接栏/通信/子协议/认证 结构，后续如需对齐另行立项）

## 一、背景

ApiFox 的响应卡片在垂直空间利用和信息分层上比本项目现状更紧凑：

- 状态三元组（200 · 13.26s · 282.7KB）与响应 tab 栏**同行**放置在右侧，头部只占一行；
- 流式响应用**时间线双栏**：左侧 chunk 列表（单行 raw 预览 + 时间戳），右侧选中 chunk 的格式化详情；
- 「实际请求」tab 展示脚本处理后**真正发出**的完整请求（headers + body），底部内嵌多语言请求代码。

本项目 lens 体系功能覆盖面已足够（JSON/XML/HTML/Image/Raw/Headers/事件流/合并结果/控制台/测试报告/Visualize/Diff），本次只做**布局与信息架构优化**，不新增视图种类。

## 二、现状与差距

| 维度 | ApiFox | 本项目现状 | 差距 |
|---|---|---|---|
| 头部 | tab 栏右侧内联状态 + 工具，单行 | meta-row 与 lens-tabs 上下两行 | 多占一行（约 32px） |
| 流式 | 时间线双栏（列表+详情） | 事件流单列滚动列表 | 无法对照查看单个 chunk |
| 实际请求 | 完整请求（URL/headers/body）+ 请求代码 | 「请求头」lens 仅 headers | 缺实际 URL/body 与代码入口 |
| Body 视图 | Pretty/Raw/Preview/Visualize/Text + charset | 树/格式化/原始/表格/预览/源码 | 基本对齐，缺 charset 选择（低优先级） |
| Header 表 | 名称/值 两列表格 | KV 表 | 对齐，样式统一即可 |

## 三、需求

### FR-1 响应头部单行化（P0，小）

- [x] 移除独立 meta-row，将其内容合并进 lens-tabs 同一行：
  - 左侧：lens tabs（现结构不变：body lenses + 分隔线 + 固定 lenses，含 badge 计数）；tabs 过多时该区域横向滚动，meta 区固定不滚。
  - 右侧（`margin-left: auto`，固定不参与 tabs 滚动）：`状态码pill · 耗时(保留现有 fast/medium 慢速配色) · 体积` + 图标按钮组（复制 Ctrl+.、下载 Ctrl+J、生成 Markdown、流式时的取消按钮）。图标沿用现有 meta-action 样式。
- [x] 高度约束：整行高度与现 lens-tabs 一致（约 36px），图标 13px、间距 8-12px，与 Hoppscotch token 体系对齐。
- [x] 流式进行中：状态码位置显示进行中指示（现有 loading 态迁移），耗时可实时跳动或显示已用时间，二选一（实现取简）。
- [x] 无响应空态（响应预览区）保持现状，不受影响。

### FR-2 「请求头」升级为「实际请求」tab（P1，中）

- [x] lens key `request` 语义升级，label 改为「实际请求」。
- [x] 内容分三段（自上而下）：
  1. **请求行**：`METHOD  URL`（实际发送的最终 URL：环境变量已替换、脚本已修改后），URL 超长省略、可点击复制。
  2. **请求 Headers**：沿用现有 KV 表（`store.response.requestHeaders`，已含继承合并与脚本增删后的实际值）。
  3. **请求 Body**：按实际发送类型展示——JSON 格式化（CodeMirror 只读）、form/urlencoded 用 KV 表、raw 用等宽 pre；GET 等无 body 时该段隐藏。
- [x] **数据扩展**：`ResponseData` 增加 `requestUrl: string` 与 `requestBodySnapshot: string`（发送管道在最终 fetch 前快照）；旧数据无此字段时降级为「该次记录缺少快照」提示，不报错。
- [x] **请求代码区块**（折叠区，默认收起，ApiFox 式置于 tab 底部）：
  - 语言 tabs：cURL / Python (requests) / JS (fetch) / JS (axios) / Java，复用 `utils/export.ts` 现有 5 个生成器；
  - 生成基于**实际请求快照**（而非当前编辑器配置）——`generateCurl` 等函数签名接收 ApiConfig，需新增轻量入口：由快照构造临时 ApiConfig 或新增按快照生成的重载；
  - 代码区 CodeMirror 只读 + 右上角复制按钮。
- [x] 与「…菜单 → 生成代码」的 CodeGenPanel 关系：保留不动（基于当前编辑器配置），实际请求 tab 内是「已发送事实」视角，两者并存。

### FR-3 流式时间线双栏（P1，中大）

- [x] 「事件流」lens 重构为双栏（容器内 `grid-template-columns: minmax(280px, 42%) 1fr`，可拖拽分隔可选，不强制）：
  - **左：chunk 列表**
    - 每行：流方向图标（↓ 数据 / ↑ 发送）+ 单行 raw 预览（等宽字体、ellipsis、不换行）+ 右侧时间戳 `HH:mm:ss`；
    - 选中态高亮（accent 左边条或背景），点击切换右侧详情；
    - 顶部搜索框：按 chunk 内容过滤（实时，显示命中计数，复用现有 bodySearch 模式）；
    - 流式进行中自动滚动跟随最新 chunk；用户向上滚动后**暂停跟随**，出现「回到底部」悬浮按钮，点击恢复跟随。
  - **右：选中 chunk 详情**
    - 子工具栏：`格式化 | 原始`（默认格式化：JSON 可解析时用 JsonTreeViewer/CodeMirror，否则等宽 pre）；
    - 右上角复制该 chunk 原文按钮；
    - 未选中任何 chunk 时自动选中最新一条；空态沿用 lens-empty 样式。
- [x] 「已连接到 {url}」chip：仅 WS 有明确连接地址时显示（SSE/chunked 为普通请求可省略）——首版仅在数据可得时展示，不为此扩数据结构。
- [x] 「合并结果」lens 保留现状不动。
- [x] chunk 多时的性能：列表行虚拟化暂不做（个人用量），但 raw 预览截断到单行 ≤500 字符再进 DOM。

### FR-4 请求类型自动识别，移除 REST/SSE/WS 手动切换（P1，中）

- [x] **移除请求栏的 REST | SSE | WS 三档 type-picker**，请求类型不再由用户声明，改为自动识别：
  - `ws://` / `wss://` 开头 → **WS 模式**（发送按钮变「连接/断开」，右侧面板为 WsPanel）——浏览器只允许 `new WebSocket()` 以 ws/wss scheme 发起握手，scheme 即可靠判据；
  - `http(s)://`（含无 scheme 自动补全的 URL）→ **统一流式 HTTP**：发送一律走流式读取管道（后台 STREAMING_REQUEST），按响应头 `Content-Type: text/event-stream` 自动进入 时间线/事件流/合并结果 视图；普通响应整体到达，走现有 lens 体系，行为不变。
- [x] 发送按钮语义随模式自动切换：WS=连接/断开，HTTP=发送/取消（流式进行中）。
- [x] **数据兼容**：`ApiConfig.requestType` 字段保留、不再作为 UI 分支依据（避免破坏既有备份/导入）；存量 `requestType: 'ws'` 但 URL 为 http(s) 的记录按 HTTP 处理（可后续再加 scheme 纠错提示，不在本期）。
- [x] **管道统一的影响面核查**（实施时逐项确认行为不回退）：发送并下载响应（流式累积后 blob）、重试、取消（AbortController）、二进制/图片响应（累积为 arraybuffer 走 Image lens）、历史记录徽章（流式标记改为「实际发生了流式」而非「类型为 SSE」）。
- [x] 无 scheme 输入沿用现有自动补全逻辑（默认 https://）后再判定。

### FR-5 流式合并配置迁入响应卡片（P1，小，2026-08-29 追加）

- [x] 移除请求栏的「流式合并」按钮与弹层（原 RequestBar 右侧），配置入口迁入响应卡片——与 ApiFox 的时间线工具栏对齐：
  - 「事件流」lens 工具栏左侧新增「合并」按钮（带 active 绿点），点击弹出配置面板；
  - 「合并结果」lens 的 merged-bar 同步一份入口（弹层右对齐），两处共用同一面板组件与状态。
- [x] 配置面板抽为独立组件 `src/components/response/StreamMergeConfig.vue`（模式三选/取值路径/预设/event 过滤/拼接符/终止标记，逻辑与原请求栏版本一致）。
- [x] **合并结果即时重算**：配置在响应卡片中改动后，`ResponsePanel` 用 `mergeChunks()`（StreamMerger 引擎,与发送管道同一实现）对已有 chunks 回放,「合并结果」与复制按钮立即反映新配置——配置不再只在发送时生效;`ResponseData.mergedText` 保留作回退（无 chunks 或重算异常时）。
- [x] 弹层点外部自动收起（capture 阶段 document click,`.merge-picker` 内点击不关）;切换响应时重置弹层状态。
- [x] 只读集合隐藏入口;WS 模式本就不显示（无事件流 lens）。

### FR-6 环境选择器迁至顶栏右上角（P2，小，2026-08-29 追加）

- [x] `EnvSelector`（FR-3.3 组件,自带集合/全局环境分组、搜索、勾选态）从编辑器 TabPanel tab 栏迁至 `AppHeader` 右上角按钮组首位——Hoppscotch 式全局入口,任意视图常驻;
- [x] 触发按钮补 ChevronDown 下降箭头,对齐 Hoppscotch 顶栏样式;
- [x] 尺寸对齐 Hoppscotch(用户反馈"环境框太小"):触发框 30px 高/13px 字号/220px 宽上限,弹层 280px 宽、搜索改为盒式输入(圆角边框 + 图标内嵌、focus 描边)、选项行加大到 7px 8px 内边距;
- [x] 切换语义不变:集合环境写 `collection.selectedEnvId`,全局环境写 `currentEnvId`,发送时仍按 请求变量 > 集合所选环境 > 集合变量 > 全局环境 解析。

## 四、明确不做

- 成功响应/响应示例 切换、文档模式/调试模式、Mock（无接口文档体系，个人用无消费场景）；
- 响应 Cookie 独立 tab（罕见场景，需要时走 Headers）;
- Body charset 选择器（utf8 假设成立，遇到乱码再说）;
- 时间线虚拟滚动（量大再说）;
- WsPanel 结构对齐（另行立项）。

## 五、保持不变

- lens 种类与顺序（body lenses 按 Content-Type 动态 + 固定 lenses 追加）；
- 测试报告 / Visualize / Diff 三个本项目特有 lens；
- 键盘快捷键（Ctrl+. 复制、Ctrl+J 下载等）；
- 主题与 token 体系（全部样式走现有 CSS 变量，四档主题 × 9 accent 自动跟随）。

## 六、验收标准

1. 响应区头部在任何 lens/主题下仅占一行，状态三元组与工具按钮完整可见，tabs 溢出可滚动；
2. 发送任意请求后，「实际请求」tab 展示的 URL/headers/body 与网络面板实际发出的内容一致（含前置脚本修改的场景）；
3. 流式请求中：chunk 实时入列并跟随滚动、上滚暂停跟随、点击任一 chunk 右侧正确显示其格式化内容、搜索过滤计数正确；
4. 请求栏无类型切换控件：`wss://` URL 自动进入 WS 模式（连接/断开 + WsPanel），`https://` 的 event-stream 接口发送后自动出现 时间线/事件流 视图，普通 JSON 接口行为与改造前一致；
5. 四档主题 × 9 accent 下无样式错乱；暗色下对比度不回退；
6. `vue-tsc` 绿，现有 Vitest 用例全过；发送管道扩展（requestUrl/requestBodySnapshot、统一流式）不破坏历史记录兼容（旧记录打开不报错）。

## 七、实施顺序建议

1. **R1 头部单行化**（半天级，纯布局）——立刻可感知；
2. **R2 实际请求 tab**（1 天级，含发送管道快照扩展）；
3. **R4 类型自动识别**（1 天级，发送管道统一 + type-picker 移除）——建议在 R3 之前：管道统一后时间线的触发条件（真实流式 chunk）一次到位，避免先做一版基于手动类型的再重构；
4. **R3 时间线双栏**（1-2 天级，含跟随/暂停交互）。

每步独立可交付、可单独验证。

## 八、实施记录（2026-08-29）

- 改动面：`src/utils/http.ts`（`isWebSocketUrl` 导出 + 全链路 requestUrl/requestBodySnapshot 快照）、`src/utils/request-snapshot.ts`（新建：快照解析 + 临时 ApiConfig 构造）、`src/components/response/ResponsePanel.vue`（FR-1/2/3）、`src/components/editor/RequestBar.vue` 与 `EditorView.vue`、`src/components/sidebar/CollectionsTree.vue`（FR-4）、`src/types/index.ts`（ResponseData 扩展）。
- 实现取舍：
  - `ResponseData.url` 本就是 buildUrl 后的最终 URL,`requestUrl` 按文档仍落字段（显式语义 + 与旧记录区分）,读取侧 `requestUrl ?? url` 回退;Body 快照旧记录回退 `requestBody`（剔除 `[object FormData]` 占位串）,仅两者皆缺时显示「缺少快照」提示——比文档的"一律降级提示"更可用且不违背原意。
  - form Body 无单一字符串形态,快照序列化为逐行 `key=value`（文件字段标 `(file) 名`）;urlencoded 快照即实际发送的编码串,展示/代码生成时按 `&`/`=` 拆回解码。
  - 代码生成入参 envVars 一律传 `{}`:快照值已是发送时最终解析结果,再做模板替换只会二重点换。
  - 侧栏类型图标只认 ws/wss scheme,SSE 图标移除（URL 无法声明 SSE,响应到达后由 事件流/合并结果 lens 呈现）;「流式合并」按钮在 HTTP 模式常驻（配置型,响应流式时才生效）。
- 验证：`vue-tsc -b` 绿；Vitest 37/37 过；`build:ext` 成功；dev 页 webbridge 实测——单行头部（状态/耗时/体积/操作右置、tabs 左置）、GET/POST 实际请求 tab（最终 URL、Content-Type、JSON Body 美化、cURL 等五语言代码折叠区）、事件流双栏（自动选中最新、JSON 树详情、搜索 1/3 匹配、33 chunk 自动跟随、上滚出「回到底部」、点击恢复）、`wss://` 自动切 WS（连接按钮 + WsPanel + method 隐藏）、无新字段旧记录回退不报错。SSE 端到端受页面 CORS 限制未直连（扩展后台不受限）,流式 UI 用注入 chunks 验证,管道自动探测逻辑（getStreamingContentType）为既有代码未改动。
