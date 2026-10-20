# Agent 设置与统一配置文件

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对命令入口、设置读写、权限模式、模型选择、推理强度、总结模型与审查模型设置链路。最近核对：2026-10-20。subagent model 用于上下文总结，未接入独立子任务 Agent；review model 仅保存设置，未接入命令权限审查，界面在 review model 设置、自动审查说明和 review 模型选择页标注“（暂未实现）”。

## 入口与关键实现

- [src/hook/useCommands.ts](../../src/hook/useCommands.ts)：注册 `/config`，执行会话的 `openConfig`。
- [src/ui/ConfigList.tsx](../../src/ui/ConfigList.tsx)：通过通用 List 展示 `subagent model`、`review model` 和 `permission`、灰色说明与当前值；回车打开对应选择页，Esc 返回聊天。
- [src/ui/PermissionList.tsx](../../src/ui/PermissionList.tsx)：展示“仅读取”“工作区写入”“自动审查”和“完全许可”及对应说明，默认选中当前模式；回车保存并返回设置页，Esc 取消，对话忙碌时禁止确认切换。显示名称由 `PERMISSION_LABELS` 提供，对应持久化值为 `workspace-write` / `auto-review` / `read-only` / `full-access`。
- [src/ui/List.tsx](../../src/ui/List.tsx)：通用列表组件，`ListItem` 提供 `label`、可选 `comment` 与 `value`。
- [src/ui/ModelList.tsx](../../src/ui/ModelList.tsx)：`target="subagent"` 与 `target="review"` 复用当前 Provider 的模型清单，并分别按已保存的总结模型、审查模型定位；回车保存后返回设置页，Esc 取消并返回设置页。没有连接时提示先使用 `/provider`。
- [src/ui/ProviderSession.tsx](../../src/ui/ProviderSession.tsx)：维护设置、页面和连接；`selectSubagentModel` 保存总结模型，`selectReviewModel` 保存审查模型，`createCompactLLM` 按当前 Provider 的端点和凭据创建独立总结适配器，不切换聊天模型；`selectPermission` 保存模式后更新 `MainAgent.permission`，启动时也向 MainAgent 传入保存的模式。
- [src/core/settings.ts](../../src/core/settings.ts)：全局配置管理入口，统一 Agent 设置、Provider 连接保存、模型缓存和临时产物位置。`Settings` 保存当前 Provider、连接、可选 `subagentModel`、可选 `reviewModel` 和 `permission`；连接条目通过可选 `reasoningEffort` 保存当前模型的显式推理强度。`loadSettings` 与 `saveSettings` 读写 `~/.liberi/settings.json`。`USER_DATA_DIRECTORY`、`SETTINGS_FILENAME`、`SETTINGS_FILE`、`TMP_DIRECTORY`、`STORAGE_PATHS` 与 `PERMISSION_LABELS` 提供存储位置和界面名称常量。

## 保存与行为边界

默认设置文件为用户主目录下的 `~/.liberi/settings.json`，也是用户目录中唯一保存 Agent 配置与凭据的文件；缺少 `permission` 时按 `workspace-write` 处理。设置文件在启动时只读取，不迁移写入；下一次保存设置、连接或模型时写入文件。启动时的模型清单刷新会更新独立缓存，见 [Provider](providers.md)。该文件同时是[文件读取](file-tools.md)唯一排除的凭据文件。

`loadSettings` 只接受当前内置 Provider ID，不再转换旧内置 Provider ID，也不读取旧的 `providers.json` 配置。连接中使用旧 Provider ID 时按格式无效处理；已选供应商标识不再映射，无法匹配已保存连接时保持未连接状态。模型名称、推理能力、强度选项与上下文限制保存在模型清单缓存中，不写入凭据配置；显式选择的推理强度作为连接选项保存在设置文件中，必须是可选的非空字符串；缺失时由适配器按模型默认档位回退，不写入设置文件。

模型清单缓存与网页正文临时文件统一放在 `~/.liberi/tmp` 下，运行时不在工作区以外新增其他写入位置。临时产物没有清理机制。

Provider 保存连接、切换聊天模型或删除连接时保留 `subagentModel` 与 `reviewModel`；切换聊天模型会清空旧模型的推理强度，设置总结模型或审查模型时保留已有 Provider 配置。`subagentModel` 保存当前 Provider 清单中的模型 ID，供 `/compact` 使用；没有独立 subagent Provider 配置或子任务执行能力。`reviewModel` 同样保存当前 Provider 清单中的模型 ID，目前仅完成设置持久化与选择入口，尚未接入命令权限审查。总结时的容量判断与回退见[上下文压缩](agent-loop.md)。

`permission` 的“工作区写入”保留文件真实路径与 Shell 命令路径检查；“自动审查”暂未接入审查逻辑，当前沿用工作区写入的路径检查；“仅读取”只允许读取当前工作区内的文件，禁止 `file_write`，`terminal_run` 只允许 PowerShell/Bash 中可静态确认的只读命令且路径须位于工作区内；“完全许可”跳过这些限制，但仍受操作系统权限约束。模式保存保留 Provider、subagent 和 review 设置，切换不重置 Agent 历史或 Token 用量。读取旧值 `workspace` 时转换为 `workspace-write`，后续保存使用新 key。工具执行边界见[文件读写](file-tools.md)与[命令执行](terminal-tool.md)。

模型清单来源和缓存边界见 [Provider](providers.md)。聊天回合进行中仍可打开设置页。
