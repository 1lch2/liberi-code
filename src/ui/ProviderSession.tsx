import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MainAgent } from '../core/agent';
import { connectProvider, fetchModelCatalog, PROVIDERS } from '../core/provider';
import type { ProviderConnection, ProviderDefinition } from '../core/provider';
import {
  loadModelCatalog,
  loadSettings,
  STORAGE_PATHS,
  saveModelCatalog,
  saveProviderConnection,
  saveSettings,
} from '../core/settings';
import type { ModelCatalog, PermissionMode, Settings, StoragePaths } from '../core/settings';
import { OpenAILLM } from '../openai-llm';
import type { LLM } from '../types';

/** 连接、选项和页面状态的共享边界。 */
export interface ProviderSessionState {
  connection?: ProviderConnection;
  agent?: MainAgent;
  settings: Settings;
  view:
    | 'chat'
    | 'providers'
    | 'models'
    | 'config'
    | 'subagent-models'
    | 'review-models'
    | 'permissions';
  loadingConfig: boolean;
  error?: string;
  openProviders: () => void;
  openModels: () => void;
  openConfig: () => void;
  openSubagentModels: () => void;
  openReviewModels: () => void;
  openPermissions: () => void;
  closeSelection: () => void;
  loadModels: () => Promise<ModelCatalog>;
  createCompactLLM: () => Promise<LLM | undefined>;
  selectModel: (model: string) => Promise<void>;
  selectSubagentModel: (model: string) => Promise<void>;
  selectReviewModel: (model: string) => Promise<void>;
  selectPermission: (permission: PermissionMode) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;
  connect: (provider: ProviderDefinition, apiKey: string, baseURL?: string) => Promise<void>;
}

/** 服务商会话共享上下文，由独立 Hook 读取。 */
export const ProviderSessionContext = createContext<ProviderSessionState | undefined>(undefined);

/** 服务商会话容器的子组件与存储位置。 */
export interface ProviderSessionProps {
  children: ReactNode;
  paths?: StoragePaths;
}

/** 管理连接和页面状态，启动时读取本地设置并刷新当前 Provider 的模型清单。 */
export function ProviderSession({ children, paths = STORAGE_PATHS }: ProviderSessionProps) {
  const [connection, setConnection] = useState<ProviderConnection>();
  const [settings, setSettings] = useState<Settings>({
    connections: [],
    permission: 'workspace-write',
  });
  const [view, setView] = useState<ProviderSessionState['view']>('chat');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState<string>();
  const agentRef = useRef<MainAgent>();

  function activate(next: ProviderConnection, permission = settings.permission) {
    if (agentRef.current) agentRef.current.setLLM(next.llm);
    else agentRef.current = new MainAgent({ llm: next.llm, cwd: process.cwd(), permission });
    setConnection(next);
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const saved = await loadSettings(paths.configFile);
        if (cancelled) return;
        setSettings(saved);
        const selected = saved.connections.find(
          item => item.providerId === saved.selectedProviderId
        );
        if (selected) {
          // 启动时主动刷新模型清单；失败时回退本地缓存，避免离线无法启动。
          let catalog: ModelCatalog | undefined;
          let refreshed = false;
          const provider = PROVIDERS.find(item => item.id === selected.providerId);
          if (provider) {
            try {
              catalog = await fetchModelCatalog(provider, selected.apiKey, selected.baseURL);
              refreshed = true;
            } catch (err) {
              if (!cancelled) {
                setError(`模型清单刷新失败：${err instanceof Error ? err.message : '未知错误。'}`);
              }
            }
            if (catalog) {
              try {
                await saveModelCatalog(selected, catalog, paths);
              } catch {
                if (!cancelled) setError('模型清单已刷新，但本地缓存保存失败。');
              }
            }
          }
          catalog ??= await loadModelCatalog(selected, paths);
          if (cancelled) return;
          let options = selected;
          if (
            refreshed &&
            catalog?.models.length &&
            !catalog.models.some(model => model.id === options.model)
          ) {
            // 当前模型可能已从服务商清单移除（例如预览版下线），回退到第一个可用模型并保存选择。
            options = { ...options, model: catalog.models[0]!.id };
            try {
              await saveProviderConnection(options, paths);
            } catch {
              if (!cancelled) setError('当前模型已不在模型清单中，回退后的模型选择保存失败。');
            }
            if (cancelled) return;
            setSettings(previous => ({
              ...previous,
              connections: previous.connections.map(item =>
                item.providerId === options.providerId ? options : item
              ),
            }));
          }
          activate(
            {
              options,
              catalog,
              llm: new OpenAILLM({
                apiKey: options.apiKey,
                baseURL: options.baseURL,
                model: catalog?.models.find(model => model.id === options.model) ?? {
                  id: options.model,
                  name: options.model,
                },
              }),
            },
            saved.permission
          );
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '本地配置读取失败。');
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [paths]);

  async function connect(provider: ProviderDefinition, apiKey: string, baseURL?: string) {
    const next = await connectProvider(provider, apiKey, baseURL);
    try {
      await saveModelCatalog(next.options, next.catalog!, paths);
      await saveProviderConnection(next.options, paths);
    } catch {
      throw new Error('连接验证成功，但本地配置或模型缓存保存失败。');
    }
    activate(next);
    setSettings(previous => ({
      ...previous,
      selectedProviderId: provider.id,
      connections: [
        ...previous.connections.filter(item => item.providerId !== provider.id),
        next.options,
      ],
    }));
    setError(undefined);
    setView('chat');
  }

  const loadModels = useCallback(async (): Promise<ModelCatalog> => {
    if (!connection) throw new Error('未连接任何模型，请先使用 /provider 连接服务商。');
    if (connection.catalog) return connection.catalog;
    let catalog = await loadModelCatalog(connection.options, paths);
    if (!catalog?.models.length) {
      const provider = PROVIDERS.find(item => item.id === connection.options.providerId)!;
      catalog = await fetchModelCatalog(
        provider,
        connection.options.apiKey,
        connection.options.baseURL
      );
      try {
        await saveModelCatalog(connection.options, catalog, paths);
      } catch {
        throw new Error('模型列表已获取，但本地模型缓存保存失败。');
      }
    }
    const currentModel = catalog.models.find(model => model.id === connection.options.model);
    if (currentModel) connection.llm.model = currentModel;
    const loaded = catalog;
    setConnection(current =>
      current?.llm === connection.llm ? { ...current, catalog: loaded } : current
    );
    return catalog;
  }, [connection, paths]);

  async function selectModel(model: string) {
    if (!connection) throw new Error('请先连接服务商。');
    if (model !== connection.options.model) {
      const catalog = await loadModels();
      const selected = catalog.models.find(item => item.id === model)!;
      const options = { ...connection.options, model };
      try {
        await saveProviderConnection(options, paths);
      } catch {
        throw new Error('模型选择保存失败，请检查本地配置文件。');
      }
      activate({
        ...connection,
        options,
        catalog,
        llm: new OpenAILLM({ ...options, model: selected }),
      });
      setSettings(previous => ({
        ...previous,
        connections: previous.connections.map(item =>
          item.providerId === options.providerId ? options : item
        ),
      }));
    }
    setView('chat');
  }

  async function createCompactLLM(): Promise<LLM | undefined> {
    if (
      !connection ||
      !settings.subagentModel ||
      settings.subagentModel === connection.options.model
    ) {
      return undefined;
    }
    const catalog = await loadModels();
    const model = catalog.models.find(item => item.id === settings.subagentModel);
    return model ? new OpenAILLM({ ...connection.options, model }) : undefined;
  }

  async function removeProvider(providerId: string) {
    const saved = await loadSettings(paths.configFile);
    if (!saved.connections.some(item => item.providerId === providerId)) return;
    const remaining = saved.connections.filter(item => item.providerId !== providerId);
    const provider = PROVIDERS.find(item =>
      remaining.some(option => option.providerId === item.id)
    );
    let next: ProviderConnection | undefined;
    if (provider) {
      const options = remaining.find(item => item.providerId === provider.id)!;
      let catalog = connection?.options.providerId === provider.id ? connection.catalog : undefined;
      catalog ??= await loadModelCatalog(options, paths);
      if (!catalog?.models.length) {
        catalog = await fetchModelCatalog(provider, options.apiKey, options.baseURL);
        await saveModelCatalog(options, catalog, paths);
      }
      const model = catalog.models[0]!;
      const selected = { ...options, model: model.id };
      next = { options: selected, catalog, llm: new OpenAILLM({ ...selected, model }) };
    }
    const updated: Settings = {
      ...saved,
      selectedProviderId: next?.options.providerId,
      connections: remaining.map(item =>
        item.providerId === next?.options.providerId ? next.options : item
      ),
    };
    try {
      await saveSettings(updated, paths.configFile);
    } catch {
      throw new Error('供应商配置删除失败，请检查本地配置文件。');
    }
    setSettings(updated);
    setError(undefined);
    if (next) activate(next);
    else {
      agentRef.current = undefined;
      setConnection(undefined);
      setView('chat');
    }
  }

  async function selectSubagentModel(model: string) {
    const saved = await loadSettings(paths.configFile);
    const updated = { ...saved, subagentModel: model };
    await saveSettings(updated, paths.configFile);
    setSettings(updated);
    setView('config');
  }

  async function selectReviewModel(model: string) {
    const saved = await loadSettings(paths.configFile);
    const updated = { ...saved, reviewModel: model };
    await saveSettings(updated, paths.configFile);
    setSettings(updated);
    setView('config');
  }

  async function selectPermission(permission: PermissionMode) {
    const saved = await loadSettings(paths.configFile);
    const updated = { ...saved, permission };
    await saveSettings(updated, paths.configFile);
    if (agentRef.current) agentRef.current.permission = permission;
    setSettings(updated);
    setView('config');
  }

  return (
    <ProviderSessionContext.Provider
      value={{
        connection,
        agent: agentRef.current,
        settings,
        view,
        loadingConfig,
        error,
        connect,
        loadModels,
        createCompactLLM,
        selectModel,
        selectSubagentModel,
        selectReviewModel,
        selectPermission,
        removeProvider,
        openProviders: () => setView('providers'),
        openModels: () => setView('models'),
        openConfig: () => setView('config'),
        openSubagentModels: () => setView('subagent-models'),
        openReviewModels: () => setView('review-models'),
        openPermissions: () => setView('permissions'),
        closeSelection: () => setView('chat'),
      }}
    >
      {children}
    </ProviderSessionContext.Provider>
  );
}
