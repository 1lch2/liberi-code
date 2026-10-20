/** 描述可注册给模型调用的工具及其参数格式。 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 描述模型发起的单个工具调用。 */
export interface ToolCall {
  id: string;
  name: string;
  /** 保留原始 JSON 字符串，由 agent 在执行工具时解析。 */
  arguments: string;
}

/** 描述模型返回的助手消息及其可选工具调用。 */
export interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

/** 描述发送给模型的对话消息。 */
export type Message =
  | { role: 'system' | 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; callId: string; content: string };

/** 当前上下文用量；压缩后总量先本地估算，缓存数据保留到下次模型响应。 */
export interface TokenUsage {
  totalTokens: number;
  promptTokens: number;
  cachedTokens: number;
}

/** 描述一次模型补全请求所需的消息和工具定义。 */
export interface CompletionRequest {
  messages: Message[];
  tools: ToolDefinition[];
  /** 接收本次请求的总用量、输入用量和缓存命中量。 */
  onTokenUsage?: (usage: TokenUsage) => void;
}

/** 模型调用标识、展示名称、推理能力及已知的上下文和输入输出限制。 */
export interface ModelInfo {
  id: string;
  name: string;
  /** 是否支持推理模式；未获取到 models.dev 元信息时保持未知。 */
  reasoning?: boolean;
  /** 推理强度选项；仅有开关能力时使用 on/off，未获取到元信息时保持未知。 */
  effort?: string[];
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** 定义与具体 SDK 无关的模型信息和补全能力。 */
export interface LLM {
  /** 当前模型的名称与上下文限制，未收录的限制保持未知。 */
  readonly model: ModelInfo;
  /** 根据对话消息和工具定义生成助手回复。 */
  complete(request: CompletionRequest): Promise<AssistantMessage>;
}
