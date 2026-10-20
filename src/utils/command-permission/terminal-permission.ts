import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ShellInfo } from '../shell';
import { getPowerShellPaths } from './powershell-paths';
import { getBashPaths } from './bash-paths';

/** 独立检查 PowerShell 和 Bash 命令路径，CMD 与 sh 暂不检查；只读模式额外要求命令可静态确认。 */
export async function checkTerminalCommandPermission(
  command: string,
  cwd: string,
  shell: ShellInfo,
  readOnly = false
): Promise<boolean> {
  if (shell.type !== 'powershell' && shell.type !== 'bash') return !readOnly;
  const root = await fs.realpath(cwd);
  const analysis =
    shell.type === 'powershell'
      ? { ...(await getPowerShellPaths(command, cwd, shell.path)), recursivePaths: [] }
      : await getBashPaths(command, cwd, shell.path);
  if (!analysis.valid || (readOnly && !analysis.readOnly)) return false;
  const resolveTarget = (target: string) =>
    path.isAbsolute(target) ? target : `${cwd}${path.sep}${target}`;
  for (const target of analysis.paths) {
    const relative = path.relative(path.resolve(cwd), path.resolve(cwd, target));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return false;
    // 保留路径中的 ..，由 realpath 按真实链接顺序解析，不能先折叠链接后的父目录。
    if (!(await isPathWithinRoot(root, resolveTarget(target)))) return false;
  }
  const visited = new Set<string>();
  for (const target of analysis.recursivePaths) {
    if (!(await checkTree(root, resolveTarget(target), visited))) return false;
  }
  return true;
}

async function checkTree(root: string, target: string, visited: Set<string>): Promise<boolean> {
  if (!(await isPathWithinRoot(root, target))) return false;
  try {
    const resolved = await fs.realpath(target);
    if (visited.has(resolved)) return true;
    visited.add(resolved);
    if ((await fs.stat(resolved)).isDirectory()) {
      for (const name of await fs.readdir(resolved)) {
        if (!(await checkTree(root, path.join(resolved, name), visited))) return false;
      }
    }
    return true;
  } catch (error) {
    return isMissingPath(error);
  }
}

async function isPathWithinRoot(root: string, target: string): Promise<boolean> {
  let current = target;
  while (true) {
    try {
      const resolved = await fs.realpath(current);
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return false;
      return true;
    } catch (error) {
      if (!isMissingPath(error)) return false;
      // 断开的链接不能退回父目录后作为合法的新路径。
      try {
        await fs.lstat(current);
        return false;
      } catch (statError) {
        if (!isMissingPath(statError)) return false;
      }
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
