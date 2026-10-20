# Provider 连接、模型选择与本地配置

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对注册、选择、校验、保存、删除、启动模型清单刷新及本地启动初始化主链路，并通过本地 HTTP 服务与 Ink 模拟终端的 E2E 检查。最近核对：2026-10-20。未使用各厂商真实 API Key 验收全部端点。

## 入口与关键实现

- [src/core/provider.ts](../../src/core/provider.ts)：统一供应商清单与连接实现。`PROVIDERS` 使用 models.dev 的内置供应商 ID，保留中文标签与现有 Chat Completions 地址；自定义兼容端点使用本地 ID `openai-compatible`。`fetchModelCatalog` 获取服务商可用模型，再从 models.dev 补充名称与上下文限制；`connectProvider` 验证首个模型并返回连接供会话层保存和激活，本文件不读写本地配置。
- [src/hook/useCommands.ts](../../src/hook/useCommands.ts)：应用命令列表注册 `/provider` 和 `/model`，将会话的 `openProviders`、`openModels` 绑定为执行回调；`App` 将列表传给输入组件，由 [src/core/commands.ts](../../src/core/commands.ts) 通用分发器匹配执行。
- [src/ui/ProviderSession.tsx](../../src/ui/ProviderSession.tsx)：`ProviderSession` 管理连接、选项和页面状态；主动连接时调用 `connectProvider` 校验，依次保存模型缓存与连接后再激活。启动读取用户目录配置后，对已选连接主动调用 `fetchModelCatalog` 刷新服务商模型清单并同步 models.dev 名称与上下文限制，成功后覆盖本地缓存；如果刷新后的清单不包含当前模型，自动切换到清单中的第一个模型并保存连接。刷新失败时回退本地缓存并在界面提示错误，缓存也未命中时以模型 ID 作为展示名，上下文限制保持未知。缺少已选连接时保持未连接状态。
- [src/hook/useProviderSession.ts](../../src/hook/useProviderSession.ts)：`useProviderSession` 提供共享状态读取入口，Hook 与 UI 组件分别归属 `src/hook` 和 `src/ui`。
- [src/ui/ProviderList.tsx](../../src/ui/ProviderList.tsx)：中文标签作为 `label`、Provider ID 作为灰色 `comment`，右侧 `value` 显示“已连接”或“已配置”，未配置项留空。上下键选择、回车展开输入、列表状态双按 D 删除配置；内置项输入 API Key，自定义项先输入地址。Key 使用掩码显示，连接失败保留页面供重试，Esc 返回列表或聊天。
- [src/ui/List.tsx](../../src/ui/List.tsx)：Provider、模型和设置页面共用的受控列表，支持标签、可选说明和当前值，负责上下键循环导航与回车确认；布局见[设置配置](settings.md)。
- [src/ui/ModelList.tsx](../../src/ui/ModelList.tsx)：读取当前 Provider 的模型清单，以模型名称作为 `label`、ID 作为灰色 `comment`，右侧 `value` 仅为已选模型显示“当前”。默认编辑聊天模型，`target="subagent"` 编辑 subagent 模型设置，始终保存 ID。加载或保存时禁用选择，当前对话结束前禁止确认；卸载后忽略未完成的读取结果。
- [src/core/settings.ts](../../src/core/settings.ts)：全局配置管理入口，统一设置、连接保存和临时模型缓存；`loadSettings`、`saveSettings` 读写配置，`saveProviderConnection` 保留其他 Agent 设置。内部 `writeJSON` 通过临时文件重命名原子写入，以 `0600` 模式创建文件；Windows 文件访问受当前用户目录的 ACL 控制。Agent 设置见[设置配置](settings.md)。
- [src/ui/App.tsx](../../src/ui/App.tsx)：根据会话展示聊天、Provider、模型或设置相关选择页；未连接时禁止发送模型请求，当前回合结束后才能切换连接或模型。会话创建 `MainAgent`，切换使用继承的 `BaseAgent.setLLM` 保留历史，重置用量统计。

## 删除供应商配置

在 `/provider` 列表中选中已配置项，连续按两次 D（大小写均可）删除。第一次显示确认提示，移动选项或按其他键取消；API Key 和端点输入阶段不处理删除，对话忙碌、配置加载、连接和删除期间禁用删除。删除配置不移除内置供应商选项，之后仍可重新连接；不包含凭据的临时模型缓存保留。

`ProviderList` → `ProviderSession.removeProvider`：读取已保存配置并排除选中项，按 `PROVIDERS` 的界面顺序找到剩余已配置供应商的第一项，优先读取其内存或磁盘模型清单，缺失时查询并缓存；使用清单的第一个模型。将删除结果、当前供应商和新模型一次保存成功后更新会话，列表定位到新供应商并保留当前聊天历史。即使删除的不是当前供应商，也按这一规则重新选择。

没有剩余配置时清空当前连接与 Agent 引用，返回 chat TUI，工具栏恢复“未连接任何模型”提示；界面已有消息保留，后续重新连接会创建新的 Agent 对话。清单查询或保存失败时不提交删除、不替换当前连接，停留列表显示错误，可重新双按 D 重试。

## 模型选择

`/model` → `ModelList` → `ProviderSession.loadModels`：优先使用当前连接的内存清单，再读取磁盘缓存；缓存缺失或为空时调用 `fetchModelCatalog` 查询并保存。读取后同步当前适配器的模型元信息，保持原适配器与当前用量。启动仍只读本地文件；未连接时提示先使用 `/provider`，查询失败可 Esc 返回后重新进入。

上下键选择，回车调用 `ProviderSession.selectModel`：先保存选中模型，再替换当前适配器和连接状态，返回聊天；持久化失败时保留原连接与页面，可再次回车重试。确认当前模型只返回聊天，不重置连接或用量。Esc 取消不改变所选模型。App 和 Agent 保持挂载，消息与对话历史继续保留。

列表沿用 Provider 返回或文档记录的模型清单，不逐个探测模型权限；切换模型不发送额外校验消息，实际调用权限和兼容性由下一次聊天请求确认。

## 模型元信息

内置供应商按 Provider ID 与模型 ID 精确匹配 [models.dev API](https://models.dev/api.json)，同步 `name` 与 `limit.context/input/output`，映射到 [ModelInfo](../../src/types.ts) 的展示名及上下文、最大输入、最大输出限制。未匹配的模型保留 ID 作为名称，缺失或非正数限制保持未知；自定义兼容端点不查询 models.dev，也不推测模型归属。同步请求失败会报告错误，不把失败当成成功缓存。

对应 ID：MiniMax 使用 `minimax-cn` / `minimax-cn-coding-plan`，智谱使用 `zhipuai` / `zhipuai-coding-plan`，小米使用 `xiaomi` / `xiaomi-token-plan-cn`，Kimi 使用 `moonshotai-cn` / `kimi-code-plan-cn`；DeepSeek 与 OpenAI 仍为 `deepseek`、`openai`。models.dev 只提供元信息，不替换现有 API 地址或可用模型清单。

当前模型元信息通过 `OpenAILLM.model` 传给 `BaseAgent.model`，切换模型时随适配器一起更新；Toolbar 显示同一份模型名称。

## 内置清单与官方来源

| Provider | Chat Completions 基础地址 | 模型清单 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `GET /models` |
| MiniMax API | `https://api.minimax.cn/v1` | `GET /models` |
| MiniMax Token Plan | `https://api.minimax.cn/v1` | `GET /models` |
| GLM API | `https://open.bigmodel.cn/api/paas/v4` | 优先 `GET /models`，明确不支持时读取官方文档 |
| GLM Token Plan | `https://open.bigmodel.cn/api/coding/paas/v4` | 优先 `GET /models`，明确不支持时读取官方文档 |
| 小米 MiMo API | `https://api.xiaomimimo.com/v1` | `GET /models` |
| 小米 MiMo Token Plan | `https://token-plan-cn.xiaomimimo.com/v1` | 沿用兼容接口 `GET /models`，待真实套餐凭据验收 |
| Kimi API | `https://api.moonshot.cn/v1` | `GET /models` |
| Kimi Coding Plan | `https://api.kimi.com/coding/v1` | 沿用兼容接口 `GET /models`，待真实套餐凭据验收 |
| OpenAI 官方 | `https://api.openai.com/v1` | `GET /models` |
| OpenAI Chat Completion | 用户输入 | `GET /models` |

来源：[DeepSeek 接入](https://api-docs.deepseek.com/)、[DeepSeek 模型清单](https://api-docs.deepseek.com/api/list-models/)、[MiniMax OpenAI SDK](https://platform.minimax.cn/docs/api-reference/text-openai-api)、[MiniMax 模型清单](https://platform.minimax.cn/docs/api-reference/models/openai/list-models)、[MiniMax 套餐接入](https://platform.minimax.cn/docs/m-plan/other-tools)、[GLM OpenAI 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[GLM 套餐端点](https://docs.bigmodel.cn/cn/coding-plan/latest-model)、[OpenAI 模型列表协议](https://developers.openai.com/api/reference/resources/models/methods/list)。MiniMax 使用中国区端点，API 与套餐通过不同 Key 区分。GLM 的 Token Plan 选项对应厂商命名的 Coding Plan。

GLM 官方 OpenAPI 没有公开模型列表定义。仅在标准接口返回 404、405 或 501 时，读取官方 Markdown 清单作为备用来源，并在缓存中把 `source` 记为 `documentation`；其他错误不触发文档备用。来源：[模型概览](https://docs.bigmodel.cn/cn/guide/start/model-overview)、[套餐模型说明](https://docs.bigmodel.cn/cn/coding-plan/latest-model)。

新增端点来源：[MiMo 首次调用 API](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call)、[MiMo 模型列表](https://mimo.mi.com/docs/zh-CN/api/model/list-models)、[Kimi 官方接入与平台对比](https://www.kimi.com/code/docs/en/)、[OpenAI 模型列表](https://developers.openai.com/api/reference/resources/models/methods/list)。套餐须使用对应套餐凭据；不保证接口返回的所有模型均支持当前聊天与工具调用协议。

## 保存与缓存边界

- `~/.liberi/settings.json` 统一保存服务商 ID、端点、选中模型、API Key、当前选中的服务商和 Agent 设置；删除只移除目标配置并更新自动选中的供应商与模型。存储位置见[设置配置](settings.md)。
- `~/.liberi/tmp/model-catalog.json` 是全部连接共用的单一缓存，按连接保存模型 ID、名称、上下文限制与清单来源，不保存 API Key。条目键由 `providerId` 与端点摘要组成，与凭据无关；写入只改动对应条目。旧字符串清单及其他无效缓存按未命中处理，下次获取清单时重新同步。位置见[设置配置](settings.md)。
- 首个模型必须通过 Chat Completions 校验；接口失败、列表为空、模型无权限或保存失败均显示连接失败，不改变当前已连接的模型。
- 本地已保存的连接在启动时直接激活，不表示凭据仍有效；模型清单刷新失败会回退缓存并在界面提示，后续请求失败由正常对话错误分支处理，适配器会过滤错误正文中回显的 API Key。
- `/compact` 使用已配置的总结模型，策略见[上下文压缩](agent-loop.md)。退出 CLI 会在 Ink 卸载后清理终端并结束进程，详见[终端交互](terminal-ui.md)。
