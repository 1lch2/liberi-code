import { useApp } from 'ink';
import type { SlashCommand } from '../core/commands';
import { useProviderSession } from './useProviderSession';

/** 组装应用内置命令，各命令通过闭包持有自身所需的能力。 */
export function useCommands(compact: () => void): readonly SlashCommand[] {
  const { exit } = useApp();
  const { openProviders, openModels, openConfig, openEffort } = useProviderSession();

  return [
    { name: '/compact', description: '压缩上下文', execute: compact },
    { name: '/config', description: 'Agent 设置', execute: openConfig },
    { name: '/effort', description: '设置推理强度', execute: openEffort },
    { name: '/model', description: '切换模型', execute: openModels },
    { name: '/provider', description: '连接模型服务商', execute: openProviders },
    { name: '/quit', description: '退出TUI', execute: () => exit() },
  ];
}
