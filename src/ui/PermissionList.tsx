import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PERMISSION_LABELS } from '../core/settings';
import type { PermissionMode } from '../core/settings';
import { useProviderSession } from '../hook/useProviderSession';
import { List } from './List';

/** 权限模式选择页面的展示顺序。 */
const PERMISSION_MODES: readonly PermissionMode[] = [
  'read-only',
  'workspace-write',
  'auto-review',
  'full-access',
];

/** 权限模式对应的界面说明。 */
const PERMISSION_COMMENTS: Record<PermissionMode, string> = {
  'read-only': '仅允许读取文件和网页',
  'workspace-write': '允许工作区内编辑和执行命令',
  'auto-review': '使用审查模型自动判断许可（暂未实现）',
  'full-access': '完全允许所有操作',
};

/** 权限模式选择页面的对话忙碌状态。 */
export interface PermissionListProps {
  busy: boolean;
}

/** 选择并保存权限审批模式，保存或取消后返回设置页。 */
export function PermissionList({ busy }: PermissionListProps) {
  const session = useProviderSession();
  const [selectedIndex, setSelectedIndex] = useState(
    Math.max(0, PERMISSION_MODES.indexOf(session.settings.permission))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const blocked = busy || session.loadingConfig || saving;

  useInput((_input, key) => {
    if (key.escape && !saving) session.openConfig();
  });

  async function select(permission: PermissionMode) {
    if (blocked) return;
    setSaving(true);
    setError(undefined);
    try {
      await session.selectPermission(permission);
    } catch (err) {
      setError(err instanceof Error ? err.message : '权限模式保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>权限审批模式</Text>
      <Text dimColor>↑↓ 选择 · Enter 保存 · Esc 返回</Text>
      <List
        items={PERMISSION_MODES.map(mode => ({
          id: mode,
          label: PERMISSION_LABELS[mode],
          comment: PERMISSION_COMMENTS[mode],
        }))}
        selectedIndex={selectedIndex}
        onChange={setSelectedIndex}
        onSelect={item => {
          void select(item.id as PermissionMode);
        }}
        active={!blocked}
      />
      {saving && <Text dimColor>正在保存权限模式...</Text>}
      {busy && <Text color="yellow">请等待当前对话结束后切换权限模式。</Text>}
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
