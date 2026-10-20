# Shell 命令执行与 PowerShell、Bash 路径检查

[返回功能索引](../feature-map.yaml)

覆盖状态：已核对命令分派、Shell 选择、路径检查与只读命令检查主链路。最近核对：2026-10-20。

## 入口与关键实现

- [src/tools/terminal-run.ts](../../src/tools/terminal-run.ts)：`terminalRunTool` 注册 `terminal_run`，按实际 Shell 将命令用法写入工具描述；`terminalRun` 检查权限后在指定工作目录执行命令。PowerShell 和 Bash 使用 `execFile`，CMD 与 sh 保留 `exec`。
- [src/utils/command-permission/terminal-permission.ts](../../src/utils/command-permission/terminal-permission.ts)：独立入口 `checkTerminalCommandPermission`，为 PowerShell 和 Bash 分派路径与只读命令检查。
- [src/utils/command-permission/powershell-paths.ts](../../src/utils/command-permission/powershell-paths.ts)：用 PowerShell 原生 AST 与静态参数绑定识别路径并标记命令是否只读，按顺序跟踪静态目录切换，识别字符串 `Replace`；分析进程不执行传入命令。
- [src/utils/command-permission/bash-paths.ts](../../src/utils/command-permission/bash-paths.ts)：`getBashPaths` 用受限词法分析识别路径，并标记写入型命令与重定向；`getBashEnvironment` 清理会改变启动行为的环境变量与导出函数，供分析和实际执行共用。
- [src/utils/shell.ts](../../src/utils/shell.ts)：`getCurrentShellInfo` 在 Windows 优先选择 PowerShell 7，其次 Windows PowerShell，最后 CMD；非 Windows 优先已存在的 Bash，否则使用 `/bin/sh`。
- [src/core/prompt.ts](../../src/core/prompt.ts)：`buildToolsPrompt` 接收工具描述并生成提示词，不再维护 Shell 用法；提示词入口见[Agent 循环](agent-loop.md)。

## 权限边界

`executeTool` → `terminalRun` → `checkTerminalCommandPermission` → `getPowerShellPaths` / `getBashPaths` → `execFile` / `exec`。工具注册及异常转换由[公共分派器](agent-loop.md)负责。

路径检查用于默认的 `workspace-write` 模式：以工作目录真实路径为根逐项检查目标路径，不存在的路径向上查找最近存在的父目录，拒绝越界链接、断链和无法静态确认的动态形式。`auto-review` 暂未接入自动审查，沿用同一路径检查；`read-only` 在路径检查之外只允许可静态确认的只读命令，拒绝写入型命令、输出重定向和未知外部程序；`full-access` 跳过该检查，沿用同一执行入口和 Shell 启动选项。配置入口见[设置配置](settings.md)。

检查只覆盖静态可确认的路径。PowerShell 允许顶层独立语句中的 `cd` / `Set-Location`，目标须为工作区内可静态确认且已存在的单个目录；后续相对路径及重定向按切换后的目录检查。条件、循环、管道或子表达式中的目录切换，以及 `Push-Location` / `Pop-Location` 仍不支持。字符串 `Replace` 支持常量字符串、`Get-Content -Raw` 文本及连续替换，两个替换参数须为静态字符串；用于路径参数时只计算常量替换，不读取文件内容推导路径。

变量路径、其他动态表达式、赋值、嵌套 Shell、命令替换等仍会被拒绝。Bash 的目录切换、递归链接、`find -exec`、`xargs` 等间接访问暂不支持。`workspace-write` 和 `auto-review` 下未知外部程序只检查静态显式路径；sh 与 CMD 跳过路径检查。`read-only` 下 CMD 与 sh 直接拒绝，PowerShell 与 Bash 的外部程序默认不视为只读。

这是命令路径预检查，不是操作系统沙箱：外部程序与脚本内部的文件访问、程序自定义参数协议，以及检查与执行之间的文件系统变化都不受完整隔离。执行结果组合为 STDOUT / STDERR 文本，异常经工具分派器转换为错误文本。
