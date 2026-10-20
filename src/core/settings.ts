import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PROVIDERS } from './provider';
import type { ModelInfo } from '../types';

/** Agent 工具的工作区限制模式。 */
export type PermissionMode = 'workspace-write' | 'auto-review' | 'read-only' | 'full-access';

/** 权限审批模式对应的界面名称。 */
export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  'read-only': '仅读取',
  'workspace-write': '工作区写入',
  'auto-review': '自动审查',
  'full-access': '完全许可',
};

/** 一个服务商保存的连接选项、当前模型及凭据。 */
export interface SavedConnection {
  providerId: string;
  baseURL: string;
  model: string;
  apiKey: string;
}

/** 用户目录中统一保存的 Agent 设置和服务商连接。 */
export interface Settings {
  selectedProviderId?: string;
  connections: SavedConnection[];
  subagentModel?: string;
  reviewModel?: string;
  permission: PermissionMode;
}

/** 用户目录中保存 Agent 数据与临时产物的根目录。 */
export const USER_DATA_DIRECTORY = join(homedir(), '.liberi');

/** 用户目录中的统一设置文件，也是其中唯一保存明文凭据的文件。 */
export const SETTINGS_FILENAME = 'settings.json';

/** 用户目录中的统一设置文件路径。 */
export const SETTINGS_FILE = join(USER_DATA_DIRECTORY, SETTINGS_FILENAME);

/** 通过临时文件重命名原子保存 JSON，以 0600 模式创建文件。 */
async function writeJSON(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, file);
}

/** 读取统一设置；文件缺失时返回空清单。 */
export async function loadSettings(file = SETTINGS_FILE): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取本地设置。');
    return { connections: [], permission: 'workspace-write' };
  }
  try {
    const data = JSON.parse(text) as Omit<Settings, 'permission'> & {
      permission?: PermissionMode | 'workspace';
    };
    if (data.permission === 'workspace') data.permission = 'workspace-write';
    if (
      !Array.isArray(data.connections) ||
      (data.selectedProviderId !== undefined && typeof data.selectedProviderId !== 'string') ||
      (data.subagentModel !== undefined && typeof data.subagentModel !== 'string') ||
      (data.reviewModel !== undefined && typeof data.reviewModel !== 'string') ||
      (data.permission !== undefined && !Object.hasOwn(PERMISSION_LABELS, data.permission))
    )
      throw new Error();
    if (
      !data.connections.every(
        item =>
          PROVIDERS.some(provider => provider.id === item.providerId) &&
          typeof item.baseURL === 'string' &&
          typeof item.model === 'string' &&
          typeof item.apiKey === 'string'
      )
    )
      throw new Error();
    return { ...data, permission: data.permission ?? 'workspace-write' };
  } catch {
    throw new Error('本地设置格式无效。');
  }
}

/** 原子保存完整设置，统一写入 settings.json。 */
export async function saveSettings(settings: Settings, file = SETTINGS_FILE): Promise<void> {
  await writeJSON(file, settings);
}

/** 持久配置与模型清单缓存文件的位置。 */
export interface StoragePaths {
  configFile: string;
  modelsFile: string;
}

/** 模型清单缓存，保留厂商顺序、清单来源及模型名称和上下文限制。 */
export interface ModelCatalog {
  models: ModelInfo[];
  source: 'api' | 'documentation';
}

/** 单个连接的模型清单缓存条目，连同识别连接所需的身份信息。 */
interface ModelCacheEntry {
  providerId: string;
  baseURL: string;
  catalog: ModelCatalog;
}

/** 容纳所有连接模型清单的缓存文件内容。 */
interface ModelCatalogFile {
  entries: Record<string, ModelCacheEntry>;
}

/** 用户目录中放置临时产物的统一位置。 */
export const TMP_DIRECTORY = join(USER_DATA_DIRECTORY, 'tmp');

/** 默认配置位于用户目录，模型清单缓存与网页临时文件位于用户目录下的临时目录。 */
export const STORAGE_PATHS: StoragePaths = {
  configFile: SETTINGS_FILE,
  modelsFile: join(TMP_DIRECTORY, 'model-catalog.json'),
};

/** 保存连接选项并选中该服务商，不覆盖其他服务商的选项。 */
export async function saveProviderConnection(
  connection: SavedConnection,
  paths = STORAGE_PATHS
): Promise<void> {
  const settings = await loadSettings(paths.configFile);
  await saveSettings(
    {
      ...settings,
      selectedProviderId: connection.providerId,
      connections: [
        ...settings.connections.filter(item => item.providerId !== connection.providerId),
        connection,
      ],
    },
    paths.configFile
  );
}

/** 生成连接在缓存文件中的条目键；与凭据无关，换 Key 后仍复用同一条清单。 */
function modelCacheKey(connection: Pick<SavedConnection, 'providerId' | 'baseURL'>): string {
  const endpoint = createHash('sha256').update(connection.baseURL).digest('hex').slice(0, 16);
  return `${connection.providerId}-${endpoint}`;
}

/** 读取全部缓存条目；文件缺失或损坏时返回空集合。 */
async function readModelCatalogFile(paths: StoragePaths): Promise<ModelCatalogFile> {
  try {
    const parsed = JSON.parse(await readFile(paths.modelsFile, 'utf8')) as ModelCatalogFile;
    if (parsed && typeof parsed.entries === 'object' && parsed.entries !== null) return parsed;
  } catch {
    // 首次运行、缓存损坏或没有读取权限时都按空缓存处理。
  }
  return { entries: {} };
}

/** 校验一个缓存条目，字段缺失或不合法时返回 undefined。 */
function readCacheEntry(entry: unknown): ModelCacheEntry | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const candidate = entry as ModelCacheEntry;
  const catalog = candidate.catalog;
  if (
    typeof candidate.providerId !== 'string' ||
    typeof candidate.baseURL !== 'string' ||
    typeof catalog !== 'object' ||
    catalog === null ||
    !Array.isArray(catalog.models) ||
    !catalog.models.every(
      model =>
        model !== null &&
        typeof model === 'object' &&
        typeof model.id === 'string' &&
        typeof model.name === 'string' &&
        [model.contextWindow, model.maxInputTokens, model.maxOutputTokens].every(
          limit =>
            limit === undefined ||
            (typeof limit === 'number' && Number.isFinite(limit) && limit > 0)
        )
    ) ||
    !['api', 'documentation'].includes(catalog.source)
  ) {
    return undefined;
  }
  return candidate;
}

/** 更新当前连接的模型清单缓存；只改动对应条目，保留其他连接的清单。 */
export async function saveModelCatalog(
  connection: SavedConnection,
  catalog: ModelCatalog,
  paths = STORAGE_PATHS
): Promise<void> {
  const key = modelCacheKey(connection);
  const file = await readModelCatalogFile(paths);
  const entries = {
    ...file.entries,
    [key]: { providerId: connection.providerId, baseURL: connection.baseURL, catalog },
  };
  await writeJSON(paths.modelsFile, { entries } satisfies ModelCatalogFile);
}

/** 读取当前连接的模型清单缓存；文件缺失、条目不存在或格式无效时视为无缓存。 */
export async function loadModelCatalog(
  connection: SavedConnection,
  paths = STORAGE_PATHS
): Promise<ModelCatalog | undefined> {
  const entry = readCacheEntry(
    (await readModelCatalogFile(paths)).entries[modelCacheKey(connection)]
  );
  return entry?.catalog;
}
