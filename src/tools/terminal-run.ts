import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkTerminalCommandPermission } from '../utils/command-permission/terminal-permission';
import { getBashEnvironment } from '../utils/command-permission/bash-paths';
import type { ToolDefinition } from '../types';
import { getCurrentShellInfo, type ShellType } from '../utils/shell';
import type { PermissionMode } from '../core/settings';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const SHELL_USAGE: Record<ShellType, string> = {
  powershell:
    "Run PowerShell commands directly, such as `Get-ChildItem -Force` or `Get-Content -LiteralPath 'file.txt'`. Quote paths with single quotes and separate multiple commands with `;`.",
  cmd: 'Run CMD commands directly, such as `dir /a` or `type "file.txt"`. Quote paths with double quotes and chain commands with `&&`.',
  bash: "Run Bash commands directly, such as `pwd`, `ls -la`, or `cat 'file.txt'`. Quote paths with single quotes and chain commands with `&&`.",
  sh: "Run POSIX shell commands directly, such as `pwd`, `ls -la`, or `cat 'file.txt'`. Quote paths with single quotes and chain commands with `&&`.",
};

/** 在指定工作目录执行命令；工作区模式下执行现有 Shell 路径检查。 */
export async function terminalRun(
  args: Record<string, unknown>,
  cwd: string,
  permission: PermissionMode = 'workspace-write'
): Promise<string> {
  const command = String(args.command);
  const shell = getCurrentShellInfo();
  // TODO: auto-review 暂未实现，当前与 workspace-write 共用命令路径检查。
  if (permission !== 'full-access') {
    const readOnly = permission === 'read-only';
    if (readOnly && shell.type !== 'powershell' && shell.type !== 'bash') {
      throw new Error('仅读取模式不支持 CMD 和 sh，请使用 PowerShell 或 Bash。');
    }
    if (!(await checkTerminalCommandPermission(command, cwd, shell, readOnly))) {
      throw new Error(
        readOnly
          ? '仅读取模式命令未通过检查：只允许可静态确认的只读命令，不能创建、修改、复制、删除或移动文件，不能使用输出重定向，也不能执行未知外部程序；读取路径仍须位于工作目录内。'
          : '命令路径检查未通过：包含工作目录外的路径，或无法静态分析的 Shell 语法。请使用可静态确认的路径；PowerShell 切换目录需使用顶层独立语句。'
      );
    }
  }

  const options = { cwd, maxBuffer: 10 * 1024 * 1024, windowsHide: true };
  const { stdout, stderr } =
    shell.type === 'powershell'
      ? await execFileAsync(
          shell.path,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();\n${command}`,
          ],
          options
        )
      : shell.type === 'bash'
        ? await execFileAsync(shell.path, ['--noprofile', '--norc', '-p', '-c', command], {
            ...options,
            env: getBashEnvironment(),
          })
        : await execAsync(command, { ...options, shell: shell.path });
  const out = (stdout ?? '').trim();
  const err = (stderr ?? '').trim();
  return (
    [out && `STDOUT:\n${out}`, err && `STDERR:\n${err}`].filter(Boolean).join('\n\n') ||
    '(no output)'
  );
}

/** 注册终端执行工具及其模型参数定义。 */
export const terminalRunTool = {
  definition: {
    name: 'terminal_run',
    description:
      'Run a shell command from the working directory. In workspace-write mode, PowerShell and Bash validate paths and reject dynamic paths, assignments and nested shells. PowerShell allows standalone top-level cd/Set-Location with a static workspace path, and string Replace on literals or Get-Content -Raw text; Bash rejects directory changes. CMD and sh skip this check. Full-access mode skips path validation. Returns combined stdout and stderr. ' +
      SHELL_USAGE[getCurrentShellInfo().type],
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  } satisfies ToolDefinition,
  execute: terminalRun,
};
