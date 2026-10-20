import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { normalizeBaseURL, PROVIDERS } from '../core/provider';
import { useProviderSession } from '../hook/useProviderSession';
import { List } from './List';

/** 服务商页面是否需要等待当前对话结束。 */
export interface ProviderListProps {
  busy: boolean;
}

/** 展示服务商列表、端点与密钥输入，并验证连接后返回聊天界面。 */
export function ProviderList({ busy }: ProviderListProps) {
  const session = useProviderSession();
  const initialIndex = PROVIDERS.findIndex(item => item.id === session.settings.selectedProviderId);
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, initialIndex));
  const [step, setStep] = useState<'list' | 'endpoint' | 'key'>('list');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [error, setError] = useState<string>();
  const provider = PROVIDERS[selectedIndex]!;
  const blocked = busy || session.loadingConfig || connecting || removing;

  function selectProvider() {
    setDeletePending(false);
    const saved = session.settings.connections.find(item => item.providerId === provider.id);
    setApiKey(saved?.apiKey ?? '');
    setBaseURL(provider.baseURL ?? saved?.baseURL ?? '');
    setError(undefined);
    setStep(provider.baseURL ? 'key' : 'endpoint');
  }

  useInput((input, key) => {
    const deleteKey = input.toLowerCase() === 'd' && !key.ctrl && !key.meta;
    if (!deleteKey) setDeletePending(false);
    if (key.escape && !connecting && !removing) {
      setError(undefined);
      setApiKey('');
      if (step === 'list') session.closeSelection();
      else setStep('list');
      return;
    }
    if (blocked || step !== 'list' || !deleteKey) return;
    if (!session.settings.connections.some(item => item.providerId === provider.id)) return;
    if (!deletePending) {
      setError(undefined);
      setDeletePending(true);
    } else {
      setDeletePending(false);
      void removeProvider();
    }
  });

  async function removeProvider() {
    setRemoving(true);
    setError(undefined);
    try {
      await session.removeProvider(provider.id);
      const nextIndex = PROVIDERS.findIndex(
        item =>
          item.id !== provider.id &&
          session.settings.connections.some(option => option.providerId === item.id)
      );
      setSelectedIndex(Math.max(0, nextIndex));
      setApiKey('');
      setBaseURL('');
    } catch (err) {
      setError(`移除失败：${err instanceof Error ? err.message : '未知错误。'}`);
    } finally {
      setRemoving(false);
    }
  }

  async function submitKey(value: string) {
    if (blocked) return;
    if (!value.trim()) {
      setError('请输入 API Key。');
      return;
    }
    setConnecting(true);
    setError(undefined);
    try {
      await session.connect(provider, value, baseURL);
      setApiKey('');
    } catch (err) {
      setError(`连接失败：${err instanceof Error ? err.message : '未知错误。'}`);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>选择 Provider</Text>
      <Text dimColor>↑↓ 选择 · Enter 确认 · D 移除配置 · Esc 返回</Text>
      <List
        items={PROVIDERS.map(item => ({
          id: item.id,
          label: item.name,
          comment: item.id,
          value:
            session.connection?.options.providerId === item.id
              ? '已连接'
              : session.settings.connections.some(option => option.providerId === item.id)
                ? '已配置'
                : '',
        }))}
        selectedIndex={selectedIndex}
        onChange={index => {
          setDeletePending(false);
          setSelectedIndex(index);
        }}
        onSelect={selectProvider}
        active={!blocked && step === 'list'}
      />
      {deletePending && (
        <Text color="yellow">再次按 D 移除 {provider.name} 的配置，按其他键取消。</Text>
      )}
      {step !== 'list' && <Text dimColor>{provider.baseURL ?? baseURL}</Text>}
      {step === 'endpoint' && (
        <Box flexDirection="column">
          <Text>输入 OpenAI Chat Completion 兼容 API 基础地址：</Text>
          <Box borderStyle="round" paddingX={1}>
            <TextInput
              value={baseURL}
              onChange={setBaseURL}
              focus={!blocked}
              onSubmit={value => {
                try {
                  setBaseURL(normalizeBaseURL(value));
                  setError(undefined);
                  setStep('key');
                } catch (err) {
                  setError(err instanceof Error ? err.message : '端点无效。');
                }
              }}
            />
          </Box>
        </Box>
      )}
      {step === 'key' && (
        <Box flexDirection="column">
          <Text>输入 API Key：</Text>
          <Box borderStyle="round" paddingX={1}>
            <TextInput
              key={`${provider.id}-key`}
              value={apiKey}
              onChange={setApiKey}
              onSubmit={submitKey}
              mask="*"
              focus={!blocked}
            />
          </Box>
          <Text dimColor>连接成功后保存到本机，下次启动自动连接。</Text>
        </Box>
      )}
      {connecting && (
        <Text color="cyan">
          <Spinner type="dots" /> 正在查询模型并验证连接...
        </Text>
      )}
      {removing && (
        <Text color="cyan">
          <Spinner type="dots" /> 正在移除配置并切换服务商...
        </Text>
      )}
      {busy && <Text color="yellow">请等待当前对话结束后连接或移除服务商。</Text>}
      {session.loadingConfig && <Text dimColor>正在加载配置与模型清单...</Text>}
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
