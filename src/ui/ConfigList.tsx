import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useProviderSession } from '../hook/useProviderSession';
import { List } from './List';
import { PERMISSION_LABELS } from '../core/settings';

/** 使用通用列表展示 Agent 设置，选择配置项后进入对应编辑页面。 */
export function ConfigList() {
  const session = useProviderSession();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) session.closeSelection();
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Agent 设置</Text>
      <Text dimColor>↑↓ 选择 · Enter 配置 · Esc 返回</Text>
      <List
        items={[
          {
            id: 'subagent-model',
            label: 'subagent model',
            comment: '用于上下文压缩的总结模型',
            value: session.settings.subagentModel ?? '未设置',
          },
          {
            id: 'review-model',
            label: 'review model',
            comment: '用于审查命令权限的模型（暂未实现）',
            value: session.settings.reviewModel ?? '未设置',
          },
          {
            id: 'permission',
            label: 'permission',
            comment: 'agent 权限审批模式',
            value: PERMISSION_LABELS[session.settings.permission],
          },
        ]}
        selectedIndex={selectedIndex}
        onChange={setSelectedIndex}
        onSelect={item => {
          if (item.id === 'permission') session.openPermissions();
          else if (item.id === 'review-model') session.openReviewModels();
          else session.openSubagentModels();
        }}
        active={!session.loadingConfig}
      />
      <Text dimColor>模型均从当前 Provider 的模型清单选择。</Text>
      {session.loadingConfig && <Text dimColor>正在加载配置与模型清单...</Text>}
      {session.error && <Text color="red">{session.error}</Text>}
    </Box>
  );
}
