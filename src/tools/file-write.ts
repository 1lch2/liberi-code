import * as fs from 'node:fs/promises';
import { usePathValidation } from '../hook/usePathValidation';
import type { ToolDefinition } from '../types';
import { isInsideDirectory, resolvePath } from '../utils/path';
import { TMP_DIRECTORY } from '../core/settings';
import type { PermissionMode } from '../core/settings';

/** 按权限模式检查路径并写入文件内容。 */
export async function fileWrite(
  args: Record<string, unknown>,
  cwd: string,
  permission: PermissionMode = 'workspace-write'
): Promise<string> {
  const target = resolvePath(String(args.path), cwd);
  // TODO: auto-review 暂未实现，当前与 workspace-write 共用写入路径检查。
  if (permission === 'read-only') {
    throw new Error(`权限不足：仅读取模式禁止写入文件（${target}）。`);
  }
  if (
    permission !== 'full-access' &&
    !isInsideDirectory(target, TMP_DIRECTORY) &&
    !(await usePathValidation(target))
  ) {
    throw new Error(
      `权限不足：禁止写入工作目录以外的路径（${target}），仅额外允许临时目录 ~/.liberi/tmp。`
    );
  }
  await fs.writeFile(target, String(args.content), 'utf-8');
  return `Wrote ${target}`;
}

/** 注册文件写入工具及其模型参数定义。 */
export const fileWriteTool = {
  definition: {
    name: 'file_write',
    description:
      'Create or overwrite a file according to the configured permission mode. In workspace-write mode only the working directory and the ~/.liberi/tmp directory are writable. Always read the file first when modifying an existing file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to a file.' },
        content: { type: 'string', description: 'Full content to write to the file.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  } satisfies ToolDefinition,
  execute: fileWrite,
};
