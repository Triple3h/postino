# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-05-16
- Primary product surfaces: Chrome extension full page (`/`, `main.html`), popup (`/popup`), side panel (`/sidepanel`), Electron/Vite shell.
- Evidence reviewed: `design-doc.md`, `src/views/MainView.vue`, `src/views/PopupView.vue`, `src/views/SidePanelView.vue`, `src/components/sidebar/Sidebar.vue`, `src/components/editor/*`, `src/components/response/ResponsePanel.vue`, `src/assets/styles/theme.css`, `src/assets/styles/global.css`.

## Brand
- Personality: 专业、轻量、可信，接近 Apifox 的紫蓝工程工具气质，但更强调“随开随调”的效率感。
- Trust signals: 清晰的信息层级、稳定的状态反馈、方法/状态颜色一致、少量玻璃感和阴影提升精致度。
- Avoid: 过重的营销风、低对比度文本、花哨动效、破坏调试效率的大面积装饰。

## Product goals
- Goals: 让 API 调试主流程更像现代生产力工具；降低空状态/加载状态的迷茫感；让分组、模块、请求、响应的层级一眼可辨。
- Non-goals: 不引入新 UI 框架，不改变数据模型，不重做全部交互为复杂工作台。
- Success signals: 首屏有品牌和状态锚点；侧栏层级更清楚；请求编辑和响应面板更突出；关键按钮、输入、空/加载/错误状态有明确反馈。

## Personas and jobs
- Primary personas: 前端/后端开发者、测试人员、需要快速复现接口问题的产品/技术支持。
- User jobs: 导入或新建请求、维护分组/模块、配置变量与鉴权、发送请求、阅读响应、复用历史。
- Key contexts of use: 浏览器插件全屏页、Chrome side panel 分屏调试、Popup 快速请求。

## Information architecture
- Primary navigation: 左侧 Category → Module → Interface 树；顶部全局工具；中间请求配置；底部响应；可选右侧历史。
- Core routes/screens: MainView、PopupView、SidePanelView、WorkspaceSettingsView、EditorView。
- Content hierarchy: 全局上下文 > 工作区树 > 当前请求 URL/method/send > request tabs > response status/body > history/env/search overlays.

## Design principles
- Principle 1: 工具感优先。装饰必须服务于识别、聚焦或状态反馈。
- Principle 2: 渐进精致。通过 tokens、阴影、hover/focus、空状态和 microcopy 统一升级，而非堆叠新组件。
- Tradeoffs: 保持原生 CSS/Vue 结构，牺牲少量极致视觉自由以换取小 diff、低风险和 extension/desktop 兼容。

## Visual language
- Color: 紫蓝主色，辅以 cyan/emerald 状态渐变；浅色模式使用暖灰背景和白色卡片，深色模式使用 navy slate。
- Typography: UI 字体为 Inter/system，代码为 JetBrains Mono/Consolas；请求 URL 和响应内容保持等宽。
- Spacing/layout rhythm: 8px 基准，工具栏 12px 横向间距，卡片 12–16px 内边距。
- Shape/radius/elevation: 8–16px 圆角；面板用 1px 边框 + 柔和阴影区分层级。
- Motion: 150–220ms hover/focus/transform；尊重 reduced motion。
- Imagery/iconography: 轻量 emoji/SVG 作为状态锚点，不依赖外部图标库。

## Components
- Existing components to reuse: `.btn`, `.method-badge`, Sidebar、RequestBar、TabPanel、ResponsePanel、HistoryPanel、EnvPanel、WorkspaceSettingsView。
- New/changed components: 主顶部品牌栏、侧栏品牌/搜索/层级样式、请求栏 hint 与 loading 状态、响应 loading/empty hero、统一 overlay/card/button tokens。
- Variants and states: hover、active、focus-visible、disabled、loading、empty、success/error/slow duration。
- Token/component ownership: 全局 tokens 在 `src/assets/styles/theme.css`；基础控件在 `src/assets/styles/global.css`；组件局部布局留在各 SFC scoped style。

## Accessibility
- Target standard: WCAG 2.1 AA 方向，至少保证键盘可见焦点和颜色语义不唯一。
- Keyboard/focus behavior: 所有按钮、输入、select 增加 focus-visible ring；保留 Enter 发送和 Cmd/Ctrl+K 搜索。
- Contrast/readability: 文本 token 保持高对比；方法标签使用淡底 + 强色文本。
- Screen-reader semantics: 当前实现主要依赖原生控件；后续可补 aria-label/aria-live。
- Reduced motion and sensory considerations: 全局 reduced-motion 禁用过渡/动画。

## Responsive behavior
- Supported breakpoints/devices: 全屏桌面优先；side panel 在 400–600px 收窄；popup 360–500px。
- Layout adaptations: 主内容 min-width 保持 600px；side panel 自动压缩侧栏；历史面板固定宽度。
- Touch/hover differences: 触摸端依赖显式按钮，不把关键操作仅放在 hover。

## Interaction states
- Loading: 请求发送时按钮显示进行中，响应区展示加载卡片/进度文案。
- Empty: 无响应、无请求、无历史、无搜索结果提供下一步提示。
- Error: HTTP/脚本错误继续使用 status/error 色；响应状态栏突出。
- Success: 2xx、快速响应、保存 toast 使用 success 色。
- Disabled: 禁用按钮降低透明度且取消 hover 抬升。
- Offline/slow network, if applicable: 慢响应 duration 标红；后续可补超时说明。

## Content voice
- Tone: 简洁、工程化、行动导向。
- Terminology: 使用“分组 / 模块 / 请求 / 响应 / 环境 / 历史”，避免混用旧“工作空间”概念。
- Microcopy rules: 空状态说明“现在可以做什么”；危险操作保留确认；按钮动词短而明确。

## Implementation constraints
- Framework/styling system: Vue 3 + Pinia + Vite，vanilla CSS scoped styles，无 Tailwind/UI 库。
- Design-token constraints: 不新增依赖；尽量扩展现有 CSS variables。
- Performance constraints: 不引入重动画或大图资源；DOM 结构轻量。
- Compatibility constraints: Chrome extension MV3、side panel、popup、desktop build 均需保持可运行。
- Test/screenshot expectations: 至少运行 `npm run build`；如本地可启动，使用浏览器 smoke 检查主界面。

## Open questions
- [ ] 是否需要完整品牌命名从 “API Fox Lite” 统一为 “ApiFix Bin Pro”？影响 logo/title 文案。
- [ ] 是否需要正式 dark mode 视觉验收截图？影响深色 token 细化。
- [ ] 是否要引入可折叠侧栏？当前设计保留变量但未新增交互，以避免扩大范围。
