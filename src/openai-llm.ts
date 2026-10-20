import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { AssistantMessage, CompletionRequest, LLM, Message, ModelInfo } from './types';
import { errorMessage } from './utils/error';

/** 描述 OpenAI 兼容端点的密钥、地址、模型配置和推理强度。 */
export interface OpenAILLMOptions {
  apiKey?: string;
  baseURL: string;
  model: ModelInfo;
  /** 当前模型显式选择的推理强度；未配置时按模型默认值生效。 */
  reasoningEffort?: string;
}

/** 判断模型是否使用 on/off 开关推理，而非可调节的强度档位。 */
function usesReasoningToggle(model: ModelInfo): boolean {
  return model.effort?.length === 2 && model.effort.includes('on') && model.effort.includes('off');
}

/** 返回模型未显式选择时的默认推理强度：开关型模型默认开启，其余取第一个档位。 */
function defaultReasoningEffort(model: ModelInfo): string | undefined {
  if (usesReasoningToggle(model)) return 'on';
  return model.effort?.[0] ?? (model.reasoning ? 'on' : undefined);
}

/** 返回实际生效的推理强度，显式选择不可用时回退到模型默认值。 */
function effectiveReasoningEffort(
  model: ModelInfo,
  effort: string | undefined
): string | undefined {
  return effort && model.effort?.includes(effort) ? effort : defaultReasoningEffort(model);
}

/** 将实际生效的推理强度转换为 Chat Completions 请求中的扩展字段。 */
function reasoningParams(model: ModelInfo, effort: string | undefined): Record<string, unknown> {
  const active = effectiveReasoningEffort(model, effort);
  if (!active) return {};
  if (usesReasoningToggle(model) && (active === 'on' || active === 'off')) {
    return { thinking: { type: active === 'on' ? 'enabled' : 'disabled' } };
  }
  // 无可用档位时推理由模型自身固定开启，不额外发送开关参数。
  if (!model.effort?.length) return {};
  return { reasoning_effort: active === 'off' ? 'none' : active };
}

function toOpenAIMessage(message: Message): ChatCompletionMessageParam {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.callId, content: message.content };
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map(call => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }
  return { role: message.role, content: message.content };
}

/** OpenAI 兼容端点的请求、配置和协议转换只放在这里。 */
export class OpenAILLM implements LLM {
  private client: OpenAI;
  private reasoningEffort?: string;
  /** 当前模型的调用 ID、展示名称、推理元信息与上下文限制。 */
  model: ModelInfo;

  /** 根据连接配置创建 OpenAI 兼容模型适配器。 */
  constructor(opts: OpenAILLMOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model;
    this.reasoningEffort = opts.reasoningEffort;
  }

  /** 实际生效的推理强度；未显式选择时返回模型默认值。 */
  get activeReasoningEffort(): string | undefined {
    return effectiveReasoningEffort(this.model, this.reasoningEffort);
  }

  /** 更新当前模型使用的推理强度，后续请求立即生效。 */
  setReasoningEffort(effort: string | undefined): void {
    this.reasoningEffort = effort;
  }

  /** 请求模型并将响应转换为 Agent 使用的消息格式。 */
  async complete(request: CompletionRequest): Promise<AssistantMessage> {
    const response = await this.client.chat.completions
      .create({
        model: this.model.id,
        messages: request.messages.map(toOpenAIMessage),
        ...(request.tools.length
          ? { tools: request.tools.map(tool => ({ type: 'function' as const, function: tool })) }
          : {}),
        ...reasoningParams(this.model, this.reasoningEffort),
        // SDK 类型尚未覆盖 models.dev 的扩展档位和厂商扩展的 thinking 字段。
      } as unknown as ChatCompletionCreateParamsNonStreaming)
      .catch((error: unknown) => {
        const message = errorMessage(error);
        // 服务端可能在错误正文中回显凭据，避免将密钥传入界面。
        throw new Error(message.replaceAll(this.client.apiKey, '[已隐藏]'));
      });
    if (response.usage) {
      request.onTokenUsage?.({
        totalTokens: response.usage.total_tokens,
        promptTokens: response.usage.prompt_tokens,
        cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? 0,
      });
    }
    const choice = response.choices[0];
    if (!choice) throw new Error('Model returned no choices.');

    const message = choice.message;
    return {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.tool_calls?.length
        ? {
            toolCalls: message.tool_calls.map(call => ({
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
            })),
          }
        : {}),
    };
  }
}
