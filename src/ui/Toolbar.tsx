import { Box, Text } from 'ink';
import type { TokenUsage } from '../types';
import { PERMISSION_LABELS } from '../core/settings';
import type { PermissionMode } from '../core/settings';

/** 统一 Token 计数显示，大数使用一位小数的万、亿单位。 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 100_000_000) return `${(tokens / 100_000_000).toFixed(1)} 亿`;
  if (tokens >= 10_000) return `${(tokens / 10_000).toFixed(1)} 万`;
  return tokens.toLocaleString('en-US');
}

/** 上下文长度按千进制 k/M 显示，截去小数；未收录时显示未知。 */
function formatContextWindow(tokens: number | undefined): string {
  if (tokens === undefined) return '未知';
  if (tokens >= 1_000_000) return `${Math.floor(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}k`;
  return String(tokens);
}

/** 工具栏所需的模型、当前推理强度、上下文长度、权限模式与当前用量。 */
export interface ToolbarProps {
  model?: string;
  effort?: string;
  contextWindow?: number;
  permission: PermissionMode;
  usage: TokenUsage;
}

/** 展示模型、当前推理强度、权限模式、当前上下文用量与长度，以及缓存用量和命中率。 */
export function Toolbar({ model, effort, contextWindow, permission, usage }: ToolbarProps) {
  if (!model) return <Text color="gray">未连接任何模型 · 使用 /provider 连接服务商</Text>;
  const cacheHitRate = usage.promptTokens > 0 ? usage.cachedTokens / usage.promptTokens : 0;

  return (
    <Box width="100%" justifyContent="space-between" flexWrap="wrap">
      <Text>
        <Text color="#fde68a">{model}</Text>
        {effort ? <Text color="gray"> · {effort}</Text> : null}
        {' · '}
        <Text color="#d8b4fe">{PERMISSION_LABELS[permission]}</Text>
      </Text>
      <Text color="gray">
        {`${formatTokenCount(usage.totalTokens)} tokens / ${formatContextWindow(contextWindow)} · 缓存 ${formatTokenCount(usage.cachedTokens)} tokens · 命中率 ${(cacheHitRate * 100).toFixed(1)}%`}
      </Text>
    </Box>
  );
}
