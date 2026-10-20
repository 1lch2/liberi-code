# CLI 启动、本地构建与开发检查

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对入口及启动、构建、退出主链路。最近核对：2026-10-20。

## 入口与关键实现

- [src/index.tsx](../../src/index.tsx)：使用 Ink 渲染 `ProviderSession` 包裹的 `App`；不加载 `.env`，也不检查模型、端点或密钥环境变量。
- [src/ui/ProviderSession.tsx](../../src/ui/ProviderSession.tsx)：首次启动允许未连接；有本地已选连接时使用保存的端点、模型和凭据初始化，并在启动时刷新一次模型清单；当前模型不在新清单时切换到第一个模型，刷新失败回退本地缓存，详细保存和连接边界见[Provider](providers.md)。
- [package.json](../../package.json)：定义 Node.js 最低版本、开发脚本和 `liberi-code` CLI 入口。
- [scripts/build.mjs](../../scripts/build.mjs)：使用 esbuild 将入口打包为 Node.js ESM 文件 `dist/liberi-code.js`，保留外部包依赖并添加 CLI shebang。

## 调用链与边界

`npm start` → `tsx src/index.tsx` → `render(<ProviderSession><App /></ProviderSession>)` → 读取本地已选连接并初始化适配器与 Agent，或进入未连接状态。启动不执行聊天连接校验，但会刷新模型清单；当前模型不在新清单时回退首个模型，刷新失败回退本地缓存。

启动时使用 `process.cwd()` 作为 Agent 工作目录；输出为 TTY 时清除可见内容和历史缓冲区。Ink 退出后入口等待卸载完成，暂停 stdin、恢复非 raw 输入模式，清除 TUI 可见内容和历史缓冲区并恢复光标；等待 stdout 写入完成后结束 CLI 进程，不等待残留请求或活动句柄。该流程共用于 `/quit` 和 Ctrl+C，非 TTY 输出不写入清屏序列。进程退出不保证已启动的外部子进程或远端任务被取消。模型连接见[模型适配](model-adapter.md)，终端渲染见[终端交互](terminal-ui.md)。

## 开发检查与任务完成 hook

- [commitlint.config.js](../../commitlint.config.js)：使用 Conventional Commits 解析预设，仅启用 `type-empty`、`subject-empty`、`header-trim`，要求类型和描述非空、标题首尾无空白，不限制类型枚举、大小写或消息长度；保留 commitlint 默认的 merge、revert 等忽略行为。
- [.husky/commit-msg](../../.husky/commit-msg)：Git 提交时运行 `npm run commitlint -- --edit "$1"`；`npm install` 的 `prepare` 脚本通过 Husky 注册 hook。
- [.prettierrc](../../.prettierrc)、[.prettierignore](../../.prettierignore)：项目格式化规则和排除范围；`npm run format` 执行 `prettier --write .`，`npm run format:check` 只检查格式。
- [.codex/config.toml](../../.codex/config.toml)、[.codex/hooks.json](../../.codex/hooks.json)：启用 Codex hooks，在 `Stop` 事件调用仓库根目录下的格式化脚本。首次加载及定义变更后需在 Codex 中审阅、信任 hook。
- [.codex/hooks/format.mjs](../../.codex/hooks/format.mjs)：从脚本位置确定仓库根目录，调用本地 Prettier；日志输出到 stderr，成功时 stdout 返回 JSON，失败时以非零状态结束。

这些检查属于开发工作流，不在本项目 Agent 的对话循环中执行。发布流程及安装包分发见[GitHub Actions 发布](release.md)，编辑器调试配置未纳入本专题。
