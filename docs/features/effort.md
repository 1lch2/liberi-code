# 推理强度配置与 /effort

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对命令入口、档位选择、默认档位回退、持久化、模型切换清理、启动失效清理和请求参数映射。最近核对：2026-10-20。

## 入口与关键实现

- [src/hook/useCommands.ts](../../src/hook/useCommands.ts)：注册 `/effort`，执行会话的 `openEffort`。
- [src/ui/EffortList.tsx](../../src/ui/EffortList.tsx)：展示当前模型的 `ModelInfo.effort` 档位和实际生效值；未显式选择时默认定位到第一个档位，回车保存，Esc 返回。没有档位但支持推理的模型提示默认开启推理；未连接或不支持推理时显示提示。档位附带中文说明，对话进行中禁止确认修改。
- [src/ui/ProviderSession.tsx](../../src/ui/ProviderSession.tsx)：`openEffort` 打开选择页；`selectReasoningEffort` 校验档位、保存 `SavedConnection.reasoningEffort`，并通过 `OpenAILLM.setReasoningEffort` 让后续请求立即使用新值。切换模型、删除当前供应商或启动刷新发现档位失效时会清空保存值。
- [src/core/settings.ts](../../src/core/settings.ts)：`SavedConnection.reasoningEffort` 持久化在 `~/.liberi/settings.json` 的连接配置中；读取时校验为可选的非空字符串。
- [src/openai-llm.ts](../../src/openai-llm.ts)：`OpenAILLMOptions.reasoningEffort` 保存显式选择；`activeReasoningEffort` 在未选择或选择失效时按模型默认值生效。普通档位写入 Chat Completions 顶层 `reasoning_effort`，仅支持开关的 `on/off` 写入顶层 `thinking: { type: enabled|disabled }`。
- [src/ui/Toolbar.tsx](../../src/ui/Toolbar.tsx)：模型名右侧显示实际生效的推理强度，包括未显式选择时回退的默认档位。

## 行为边界

- 档位来自 models.dev 的 `ModelInfo.effort`；未显式选择时普通模型取第一个档位。没有 effort 档位但支持 toggle 的模型使用 `on/off` 并默认开启，例如小米 MiMo、智谱 GLM、Kimi K2.6 和 MiniMax M3。
- 模型没有可用档位但 `reasoning` 为 true 时无法调节强度，实际状态按默认开启处理并显示 `on`；推理由模型自身固定提供，请求不额外附加开关参数。
- 普通档位直接使用 models.dev 提供的值，包括 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 等；`off` 在非开关型档位中按 `none` 发送。
- 默认值由适配器按模型动态计算，未显式选择时不写入设置文件；切换聊天模型会清空旧模型的显式选择，启动刷新后如果保存值不在新档位列表中也会清空并保存。
- 自定义 `openai-compatible` 端点不查询 models.dev，通常没有可配置档位，也不会自动开启推理。
- 保存失败时选择页保留并显示错误，当前连接和已有档位不变；保存成功后返回聊天，Toolbar 显示新值。
