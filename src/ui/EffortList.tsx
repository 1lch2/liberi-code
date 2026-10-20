import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useProviderSession } from '../hook/useProviderSession';
import { List } from './List';

/** 推理强度档位对应的中文说明。 */
const EFFORT_COMMENTS: Record<string, string> = {
  on: '开启推理',
  off: '关闭推理',
  none: '关闭推理',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  default: '服务商默认',
};

/** 推理强度选择页面的对话忙碌状态。 */
export interface EffortListProps {
  busy: boolean;
}

/** 选择并保存当前模型的推理强度，保存或取消后返回聊天。 */
export function EffortList({ busy }: EffortListProps) {
  const session = useProviderSession();
  const model = session.connection?.llm.model;
  const options = model?.effort ?? [];
  const saved = session.connection?.options.reasoningEffort;
  const current = session.connection?.llm.activeReasoningEffort;
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const index = current ? options.indexOf(current) : -1;
    return index >= 0 ? index : 0;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const blocked = busy || session.loadingConfig || saving;
  const activeIndex = Math.min(selectedIndex, Math.max(0, options.length - 1));
  const currentIndex = current ? options.indexOf(current) : -1;

  // 配置异步加载完成后，把当前档位定位到列表中的实际位置。
  useEffect(() => {
    if (currentIndex >= 0) setSelectedIndex(currentIndex);
  }, [currentIndex]);

  useInput((_input, key) => {
    if (key.escape && !saving) session.closeSelection();
  });

  async function select(effort: string) {
    if (blocked) return;
    setSaving(true);
    setError(undefined);
    try {
      await session.selectReasoningEffort(effort);
    } catch (err) {
      setError(err instanceof Error ? err.message : '推理强度保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>推理强度</Text>
      <Text dimColor>↑↓ 选择 · Enter 保存 · Esc 返回</Text>
      {!model ? (
        session.loadingConfig ? (
          <Text dimColor>正在加载配置与模型清单...</Text>
        ) : (
          <Text color="yellow">未连接任何模型，请先使用 /provider 连接服务商。</Text>
        )
      ) : (
        <>
          <Text dimColor>
            当前模型：{model.name} · 当前：{current ?? '未启用'}
          </Text>
          {saved && saved !== current && (
            <Text color="yellow">
              已保存的推理强度“{saved}”当前不可用，实际使用“{current ?? '未启用'}”。
            </Text>
          )}
          {options.length === 0 ? (
            model.reasoning ? (
              <Text color="yellow">当前模型无法调节推理强度，已默认开启推理。</Text>
            ) : (
              <Text color="yellow">当前模型不支持配置推理强度。</Text>
            )
          ) : (
            <>
              <List
                items={options.map(option => ({
                  id: option,
                  label: option,
                  comment: EFFORT_COMMENTS[option],
                }))}
                selectedIndex={activeIndex}
                onChange={setSelectedIndex}
                onSelect={item => {
                  void select(item.id);
                }}
                active={!blocked}
              />
              {saving && <Text dimColor>正在保存推理强度...</Text>}
              {busy && <Text color="yellow">请等待当前对话结束后修改推理强度。</Text>}
              {error && <Text color="red">{error}</Text>}
            </>
          )}
        </>
      )}
    </Box>
  );
}
