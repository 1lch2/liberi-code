# 文件读写与工作目录路径权限

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对工具注册、读写入口、共享路径检查与权限例外。最近核对：2026-10-20。

## 入口与关键实现

- [src/tools/file-read.ts](../../src/tools/file-read.ts)：`fileReadTool` 注册 `file_read`；`fileRead` 解析目标路径、检查权限并读取 UTF-8 文本。
- [src/tools/file-write.ts](../../src/tools/file-write.ts)：`fileWriteTool` 注册 `file_write`；`fileWrite` 检查路径后以 UTF-8 创建或覆盖文件，不创建父目录。
- [src/utils/path.ts](../../src/utils/path.ts)：`resolvePath` 将相对路径关联到调用方传入的 `cwd`；`isInsideDirectory` 判断目标是否位于指定目录内，供两个工具的例外共用。
- [src/hook/usePathValidation.ts](../../src/hook/usePathValidation.ts)：`usePathValidation` 是异步路径权限函数，不是 React Hook；以 `process.cwd()` 的真实路径为根，检查一个或多个路径。
- [src/core/settings.ts](../../src/core/settings.ts)：`USER_DATA_DIRECTORY` 给出用户目录 `~/.liberi`，`SETTINGS_FILENAME` 给出读取时唯一排除的凭据文件名，`TMP_DIRECTORY` 给出写入例外目录；目录职责见[设置配置](settings.md)。

工具注册与错误文本转换见[Agent 循环](agent-loop.md)。

## 权限边界

`permission` 默认 `workspace-write`，此时只能访问工作目录内的路径；`auto-review` 当前同样执行工作区路径检查；`read-only` 只允许读取当前工作区内的文件，并拒绝 `file_write`；`full-access` 跳过路径检查，实际访问仍受操作系统权限限制。配置入口见[设置配置](settings.md)。

`workspace-write` 和 `auto-review` 下保留以下读取与写入例外；`read-only` 不适用这些例外：

- Agent 初始化阶段注册的 SKILL.md 绝对路径可以只读访问，仅限注册的文件本身，注册与同名覆盖规则见[Agent 循环](agent-loop.md)。
- `file_read` 可读取用户目录 `~/.liberi` 及其子目录下的文件，唯一排除根部的 `SETTINGS_FILENAME`。
- `file_write` 在 `workspace-write` 和 `auto-review` 下只能额外写 `TMP_DIRECTORY` 及其子目录，用于回写网页抓取等临时产物；`read-only` 不允许任何写入，用户目录其余位置仍不可写。

例外只放宽对应的那一项工具，不改变其他工具的边界。权限失败通过异常交给分派器转换为模型可见文本。

## 补充边界

路径解析使用 Agent 传入的 `cwd`，权限根使用进程工作目录；当前[启动入口](cli-startup.md)将两者设为同一目录。文件写入前先读取是工具描述中的模型指令，执行函数没有强制这一顺序。[命令执行](terminal-tool.md)使用独立的终端命令校验，不复用此函数。
