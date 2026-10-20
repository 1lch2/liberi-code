import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useProviderSession } from '../hook/useProviderSession';
import { PROVIDERS } from '../core/provider';
import type { ModelInfo } from '../types';
import { List } from './List';

/** 模型选择页面的忙碌状态与设置目标。 */
export interface ModelListProps {
  busy: boolean;
  target?: 'agent' | 'subagent' | 'review';
}

/** 展示当前服务商的模型，保存后返回聊天或设置界面。 */
export function ModelList({ busy, target = 'agent' }: ModelListProps) {
  const session = useProviderSession();
  const { connection, loadModels, loadingConfig } = session;
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const blocked = busy || loadingConfig || loading || saving;
  const provider = PROVIDERS.find(item => item.id === connection?.options.providerId);
  const targetLabel = target === 'subagent' ? ' subagent ' : target === 'review' ? ' review ' : '';
  const targetNote = target === 'review' ? '（暂未实现）' : '';
  const currentModel =
    target === 'subagent'
      ? session.settings.subagentModel
      : target === 'review'
        ? session.settings.reviewModel
        : connection?.options.model;

  useEffect(() => {
    if (loadingConfig) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loadModels()
      .then(catalog => {
        if (cancelled) return;
        setModels(catalog.models);
        setSelectedIndex(
          Math.max(
            0,
            catalog.models.findIndex(model => model.id === currentModel)
          )
        );
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadModels, currentModel, loadingConfig]);

  useInput((_input, key) => {
    if (key.escape && !saving) {
      if (target === 'agent') session.closeSelection();
      else session.openConfig();
    }
  });

  async function select(model: string) {
    if (blocked) return;
    setSaving(true);
    setError(undefined);
    try {
      if (target === 'subagent') await session.selectSubagentModel(model);
      else if (target === 'review') await session.selectReviewModel(model);
      else await session.selectModel(model);
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型切换失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>
        选择{targetLabel}模型{targetNote}
        {provider ? ` · ${provider.name}` : ''}
      </Text>
      <Text dimColor>↑↓ 选择 · Enter 确认 · Esc 返回</Text>
      <List
        items={models.map(model => ({
          id: model.id,
          label: model.name,
          comment: model.id,
          value: model.id === currentModel ? '当前' : '',
        }))}
        selectedIndex={selectedIndex}
        onChange={setSelectedIndex}
        onSelect={item => {
          void select(item.id);
        }}
        active={!blocked}
      />
      {loading && (
        <Text color="cyan">
          <Spinner type="dots" /> 正在读取模型列表...
        </Text>
      )}
      {saving && (
        <Text color="cyan">
          <Spinner type="dots" /> 正在保存模型选择...
        </Text>
      )}
      {busy && <Text color="yellow">请等待当前对话结束后切换模型。</Text>}
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
