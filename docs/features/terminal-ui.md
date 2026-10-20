# 终端输入、消息展示与布局

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对输入提交、命令页面、事件展示和尺寸变化主链路。最近核对：2026-10-20。

## 入口与关键实现

- [package.json](../../package.json)：使用 Ink 6.8 与 React 19；满屏页面返回较短页面时，由 Ink 跟踪上一帧高度并同步重绘状态，清理旧画面。
- [src/ui/App.tsx](../../src/ui/App.tsx)：`App` 管理输入、展示条目、忙碌状态、Token 用量和终端行列数；提交时调用 Agent，订阅并清理 stdout 的 `resize` 监听；向消息传递扣除左右 padding 后的可用列宽。
- [src/ui/ProviderList.tsx](../../src/ui/ProviderList.tsx)：独立服务商选择和凭据输入界面，由 `/provider` 切换进入；状态和连接归属见[Provider](providers.md)。聊天组件保持挂载，切回时保留消息和历史。
- [src/ui/Toolbar.tsx](../../src/ui/Toolbar.tsx)：`Toolbar` 接收当前 `OpenAILLM.model.name`、`OpenAILLM.activeReasoningEffort`、`contextWindow`、权限模式和 `TokenUsage`；在模型名右侧展示实际生效的推理强度，再展示权限模式；右侧展示当前上下文用量与容量，以及缓存用量和命中率。未显式选择时显示按模型计算的默认档位，不支持推理时不追加。`formatContextWindow` 使用千进制 k/M 整数显示上下文长度，未知时显示“未知”；不依赖 App 或 Agent，窄终端可换行。名称、推理能力和上下文来自 models.dev 元信息，未匹配时名称使用 ID。
- [src/ui/CommandInput.tsx](../../src/ui/CommandInput.tsx)：`CommandInput` 通过 `CommandInputProps.commands` 接收命令列表，菜单与执行共用该列表，不依赖 Provider 会话或内置命令。管理输入框下方的斜杠菜单、前缀筛选、循环上下键导航、Tab／回车补全，并在补全后将光标移至末尾。
- [src/core/commands.ts](../../src/core/commands.ts)：`SlashCommand` 定义名称、说明和可选无参执行回调；`executeCommand` 接收列表和输入，按首词匹配并执行，返回是否消费输入。不注册具体功能，也不定义功能能力集合。
- [src/hook/useCommands.ts](../../src/hook/useCommands.ts)：应用内置命令的组装入口，接收 App 的压缩回调，并在顶层接入 Ink 退出和会话页面能力，注册 `/compact`、`/config`、`/effort`、`/model`、`/provider`、`/quit`。`CommandInput` 继续使用通用命令协议分发。
- [src/ui/ConfigList.tsx](../../src/ui/ConfigList.tsx)：`/config` 的设置列表，复用支持标签、灰色说明和右侧值的 [List](../../src/ui/List.tsx)；设置存储及总结模型见[设置配置](settings.md)。
- [src/ui/EffortList.tsx](../../src/ui/EffortList.tsx)：`/effort` 的推理强度选择页，展示当前模型可用档位和实际生效值；未显式选择时默认定位到第一个档位，无档位但支持推理时提示默认开启，回车保存并返回聊天，Esc 取消，对话忙碌时禁止确认。档位来源和请求映射见[推理强度](effort.md)。
- [src/ui/Message.tsx](../../src/ui/Message.tsx)：`Entry` 定义展示类型，`Message` 渲染用户、思考、回复、工具摘要和错误。
- [src/ui/Markdown.tsx](../../src/ui/Markdown.tsx)：`Markdown` 将 marked 内置 token 映射为 Ink 的 Box/Text，只接入 assistant 正式回复，并按可用列宽处理表格换行。
- [src/utils/assistant-text.ts](../../src/utils/assistant-text.ts)：`splitAssistantText` 按完整 `<think>...</think>` 标签拆分正文与思考块，由 Agent 调用后推送 UI 事件。
- [src/utils/format-text.ts](../../src/utils/format-text.ts)：消息与文本格式化工具。`truncate` 截断长工具输出，`formatArgs` 格式化通用工具参数，`truncateBytes` 按 UTF-8 字节截断供[网页抓取](web-fetch.md)使用，`sanitizeTerminalText` 清除文本自带的 ANSI 控制序列并把残留控制字符显示为转义文本。

## 调用链与状态边界

输入首字符为 `/` 且尚无空白字符时，按前缀筛选已注册命令；上下键循环导航，Tab／回车补全所选命令，不提交消息。补全后再次回车时，`CommandInput` 把列表与输入交给 `executeCommand` 分发：已注册命令被消费，不发送给模型；未命中命令的输入交给 `App` 处理。`/quit` 退出 TUI，`/compact` 压缩早期上下文并保留最新一轮，`/effort` 打开推理强度选择页，`/model` 打开模型选择页。压缩与普通对话共用忙碌状态，防止同时改动历史；其他命令仍可打开页面或退出。退出流程见[启动与退出](cli-startup.md)。

新增命令时在应用组装入口提供名称、说明和执行闭包即可，无需修改通用协议、分发器或输入组件。

启动配置与模型清单加载期间仅显示加载提示，暂不展示 `Toolbar`，普通消息提交被忽略；加载完成且未连接时，`Toolbar` 才显示“未连接任何模型”及 `/provider` 提示，普通消息不会请求模型。`/provider` 与 `/model` 打开列表页，当前回合结束前禁止确认切换；成功后返回聊天，失败保留原连接。连接与模型选择详见[Provider](providers.md)。

`TextInput.onSubmit` → `handleSubmit` → [BaseAgent.send](agent-loop.md)（由 MainAgent 继承）→ `handleUpdate` → 展示条目或用量状态 → `Message`。空白输入和忙碌时的提交被忽略，执行结束时在 `finally` 中恢复忙碌状态。

文件工具调用只展示文件名，`App` 不追加其结果事件。网页抓取工具同样只展示单行青色摘要 `→ Fetch: {主机名}`，`App` 也不追加其结果事件。命令调用展示命令文本，命令结果先清理终端控制字符再截断显示。模型用量的计算归属见[模型适配](model-adapter.md)。

`assistant_text_response` → `Message` → `Markdown`：`Markdown` 把 marked 的 token 映射为 Ink 组件，支持标题、段落、强调、列表、引用、代码块、链接和表格等常见标记，不做语法高亮与数学、图表渲染。

聊天界面始终显示标题与工作目录；布局保留消息区、输入框和独立 `Toolbar`，展示模型名、当前推理强度、当前上下文用量与缓存命中率。压缩期间显示 `Compacting...`，成功后早期展示条目替换为总结，最新回合保留；没有早期历史或任务进行中时显示原因，不发起总结请求。启动清屏入口见[启动与构建](cli-startup.md)。

模型及 Provider 选择列表使用通用 `List` 的 `label/comment/value`：名称在左、灰色 ID 紧随其后，当前模型或 Provider 配置状态显示在右侧，其他项留空。切换适配器时重新估算保留历史的上下文用量并清空缓存统计，补充模型元信息不改变用量。压缩后仅更新上下文计数，缓存用量与命中率保留到下次主请求返回。
