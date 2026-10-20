import { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type { AgentUpdate } from '../core/agent';
import { Entry, Message } from './Message';
import { version } from '../../package.json';
import { CommandInput } from './CommandInput';
import { Toolbar } from './Toolbar';
import type { TokenUsage } from '../types';
import { useProviderSession } from '../hook/useProviderSession';
import { ProviderList } from './ProviderList';
import { ModelList } from './ModelList';
import { ConfigList } from './ConfigList';
import { PermissionList } from './PermissionList';
import { useCommands } from '../hook/useCommands';

/** 管理终端输入和消息列表，并展示 Agent 的输出事件。 */
export function App() {
  const session = useProviderSession();
  const commands = useCommands(handleCompact);
  const { agent, connection } = session;
  const { stdout } = useStdout();
  const [terminalRows, setTerminalRows] = useState(stdout.rows ?? 0);
  const [terminalColumns, setTerminalColumns] = useState(stdout.columns ?? 80);
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactStatus, setCompactStatus] = useState<string>();
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    totalTokens: 0,
    promptTokens: 0,
    cachedTokens: 0,
  });

  useEffect(() => {
    setTokenUsage(agent?.usage ?? { totalTokens: 0, promptTokens: 0, cachedTokens: 0 });
  }, [connection?.llm]);

  useEffect(() => {
    const handleResize = () => {
      setTerminalRows(stdout.rows ?? 0);
      setTerminalColumns(stdout.columns ?? 80);
    };
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  function handleUpdate(u: AgentUpdate) {
    if (u.kind === 'token_usage') {
      setTokenUsage(u.usage);
      return;
    }
    // 文件与网页工具的结果正文很长，终端只展示调用摘要，不重复渲染结果。
    if (u.kind === 'tool_result' && ['file_read', 'file_write', 'web_fetch'].includes(u.name))
      return;

    setEntries(prev => {
      switch (u.kind) {
        case 'assistant_text_thinking':
        case 'assistant_text_response':
          return [...prev, { type: u.kind, text: u.text }];
        case 'tool_call':
          return [...prev, { type: 'tool_call', name: u.name, args: u.args }];
        case 'tool_result':
          return [...prev, { type: 'tool_result', name: u.name, args: u.args, text: u.output }];
        case 'error':
          return [...prev, { type: 'error', text: u.message }];
      }
    });
  }

  async function handleSubmit(value: string) {
    const text = value.trim();
    if (!text || busy) return;
    if (!agent || !connection) {
      setEntries(previous => [
        ...previous,
        { type: 'error', text: '未连接任何模型，请使用 /provider 连接服务商。' },
      ]);
      return;
    }
    setInput('');
    setCompactStatus(undefined);
    setEntries(prev => [...prev, { type: 'user', text }]);
    setBusy(true);
    try {
      await agent.send(text, handleUpdate);
    } finally {
      setBusy(false);
    }
  }

  async function handleCompact() {
    if (busy) {
      setCompactStatus('请等待当前任务结束后压缩上下文。');
      return;
    }
    if (!agent || !connection) {
      setCompactStatus('未连接任何模型，请先使用 /provider。');
      return;
    }
    if (!agent.canCompact) {
      setCompactStatus('没有可压缩的早期历史，已保留最新一轮对话。');
      return;
    }
    setBusy(true);
    setCompacting(true);
    setCompactStatus(undefined);
    try {
      const summary = await agent.compact(handleUpdate, await session.createCompactLLM());
      if (summary !== undefined) {
        setEntries(previous => [
          { type: 'assistant_text_response', text: `### 上下文总结\n\n${summary}` },
          ...previous.slice(previous.map(entry => entry.type).lastIndexOf('user')),
        ]);
        setCompactStatus('上下文已压缩。');
      }
    } catch (error) {
      handleUpdate({
        kind: 'error',
        message: error instanceof Error ? error.message : '上下文压缩失败。',
      });
    } finally {
      setCompacting(false);
      setBusy(false);
    }
  }

  if (session.view === 'providers') return <ProviderList busy={busy} />;
  if (session.view === 'models') return <ModelList busy={busy} />;
  if (session.view === 'config') return <ConfigList />;
  if (session.view === 'subagent-models') return <ModelList busy={busy} target="subagent" />;
  if (session.view === 'review-models') return <ModelList busy={busy} target="review" />;
  if (session.view === 'permissions') return <PermissionList busy={busy} />;

  return (
    // 为 Ink 重绘后的换行保留一行；仅设置最小高度，让长消息自然延伸。
    <Box flexDirection="column" paddingX={1} minHeight={Math.max(0, terminalRows - 1)}>
      <Box flexDirection="column" flexShrink={0} paddingLeft={1}>
        <Text wrap="truncate-end">
          <Text bold>{'>_ Liberi Code'}</Text>
          <Text dimColor>{` (v${version})`}</Text>
        </Text>
        <Box paddingLeft={3}>
          <Text dimColor wrap="truncate-end">
            {process.cwd()}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={0} marginBottom={1}>
        {entries.map((entry, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Message entry={entry} width={Math.max(1, terminalColumns - 2)} />
          </Box>
        ))}
        {busy && (
          <Box>
            <Text color="magenta">
              <Spinner type="dots" />
            </Text>
            <Text>{compacting ? ' Compacting...' : ' Thinking...'}</Text>
          </Box>
        )}
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        <CommandInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          commands={commands}
        />
        {session.loadingConfig && <Text dimColor>正在读取本地配置...</Text>}
        {compactStatus && <Text dimColor>{compactStatus}</Text>}
        {session.error && <Text color="yellow">{session.error} 使用 /provider 重新连接。</Text>}
        <Toolbar
          model={connection?.llm.model.name}
          contextWindow={connection?.llm.model.contextWindow}
          permission={session.settings.permission}
          usage={tokenUsage}
        />
      </Box>
    </Box>
  );
}
