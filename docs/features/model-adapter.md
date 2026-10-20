# OpenAI 兼容模型接口与 Token 用量

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对 SDK 请求、消息转换及用量上报主链路。最近核对：2026-10-20。

## 入口与关键实现

- [src/openai-llm.ts](../../src/openai-llm.ts)：`OpenAILLM` 实现 `LLM`；`toOpenAIMessage` 转换内部消息，`complete` 调用 `client.chat.completions.create`，转换首个响应 choice 的正文和工具调用。
- [src/types.ts](../../src/types.ts)：`ModelInfo` 保存模型 ID、名称与可选上下文、最大输入和最大输出限制；`LLM.model` 向 Agent 暴露元信息。`CompletionRequest`、`AssistantMessage` 和 `ToolCall` 定义补全协议，不依赖 SDK 类型。
- [src/core/provider.ts](../../src/core/provider.ts)：按内置服务商或自定义端点查询模型列表、校验连接后创建适配器，配置入口见[Provider](providers.md)。启动不再读取模型环境变量。
- [src/ui/ProviderSession.tsx](../../src/ui/ProviderSession.tsx)：启动时读取本地已选连接，使用保存的端点、模型和 Key 创建适配器；会刷新模型清单但不执行聊天连接校验；当前模型不在新清单时切换到首个模型，刷新失败回退本地缓存。

## 调用链与状态边界

[Agent 循环](agent-loop.md) → `OpenAILLM.complete` → 非流式 Chat Completions 请求 → 内部助手消息。工具参数保留为原始 JSON 字符串，由 Agent 解析；工具消息通过 `tool_call_id` 对齐。

`OpenAILLM` 接收 `ModelInfo`，请求使用 `model.id`，展示与上下文信息使用同一对象。`BaseAgent.model` 读取当前适配器的元信息，`setLLM` 切换后立即反映新模型；元信息来源与缓存见[Provider](providers.md)。上下文与输入限制用于[压缩时选择总结模型](agent-loop.md)，不自动触发压缩或修改请求的输出预算。工具列表为空时，请求中省略 `tools` 字段。

适配器将本次响应的 `usage.total_tokens`、`usage.prompt_tokens` 和 `usage.prompt_tokens_details.cached_tokens` 映射到 `TokenUsage`，不跨请求累加。`BaseAgent.usage` 保存当前计数，经 `AgentUpdate` 传到[终端工具栏](terminal-ui.md)；总结请求不更新主对话的缓存统计。压缩后或切换模型时，当前上下文数先本地估算，下次主响应返回后以服务端用量校正；本地估算并非各供应商分词器的精确计数。缓存量已包含在输入和总量中，不重复相加。没有 choice 时抛出错误，由 Agent 请求错误分支处理。
