import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Profile, ProviderKind } from "./config.ts";

// ===== 与厂商无关的统一数据结构 =====
export interface UToolCall {
  id: string;
  name: string;
  args: string; // JSON 字符串
}
// 厂商原生 assistant 内容块（含 thinking 等）；回传给同厂商时优先使用，
// Anthropic 开启思考 + 工具调用时必须原样回传 thinking 块
export type AssistantRaw = { kind: ProviderKind; blocks: unknown };

export interface UMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: UToolCall[]; // assistant 请求的工具调用
  toolCallId?: string; // role=tool 时，对应的调用 id
  raw?: AssistantRaw; // role=assistant 时的厂商原生内容块
}
export interface UTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}
export interface ChatResult {
  content: string | null;
  toolCalls: UToolCall[];
  raw?: AssistantRaw;
}

// 思考档位：由路由器决定，Provider 各自翻译成厂商参数
export type Effort = "off" | "low" | "high";

// 流式文本回调：每收到一段正文增量就调用一次
export type OnToken = (delta: string) => void;

export interface ChatOptions {
  onToken?: OnToken;
  // none：仍传 tools（历史含工具块时 Anthropic 必需）但禁止模型再调用
  toolChoice?: "auto" | "none";
}

export interface Provider {
  readonly model: string;
  chat(
    messages: UMessage[],
    tools: UTool[],
    effort: Effort,
    opts?: ChatOptions,
  ): Promise<ChatResult>;
}

// ===== 工厂：按配置创建对应 Provider =====
export function createProvider(profile: Profile): Provider {
  return profile.provider === "anthropic"
    ? new AnthropicProvider(profile)
    : new OpenAIProvider(profile);
}

// ===== OpenAI 格式（DeepSeek / Kimi / 通义等兼容）=====
class OpenAIProvider implements Provider {
  private client: OpenAI;
  readonly model: string;

  constructor(profile: Profile) {
    this.client = new OpenAI({ apiKey: profile.apiKey, baseURL: profile.baseURL });
    this.model = profile.model;
  }

  async chat(
    messages: UMessage[],
    tools: UTool[],
    effort: Effort,
    opts?: ChatOptions,
  ): Promise<ChatResult> {
    const onToken = opts?.onToken;
    const msgs = messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
      if (m.role === "tool") {
        return { role: "tool", tool_call_id: m.toolCallId!, content: m.content ?? "" };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: m.content,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.args },
          })),
        };
      }
      return { role: m.role, content: m.content ?? "" } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
    });

    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: msgs,
      tools: openaiTools.length ? openaiTools : undefined,
      ...(openaiTools.length && opts?.toolChoice === "none"
        ? { tool_choice: "none" }
        : {}),
      // off 时不传该参数（等价关闭推理）；low/high 直接作为 reasoning_effort
      ...(effort !== "off" ? { reasoning_effort: effort } : {}),
      stream: true,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

    // 流式累积正文与工具调用（工具调用按 index 分片拼接）
    let content = "";
    const acc: Record<number, { id: string; name: string; args: string }> = {};
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onToken?.(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (acc[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }

    return {
      content: content || null,
      toolCalls: Object.keys(acc)
        .map(Number)
        .sort((a, b) => a - b)
        .map((i) => ({ id: acc[i].id, name: acc[i].name, args: acc[i].args })),
    };
  }
}

// ===== Anthropic 格式（system 独立、content 用 blocks、工具结构不同）=====
class AnthropicProvider implements Provider {
  private client: Anthropic;
  readonly model: string;
  private maxTokens: number;
  private budget: { low: number; high: number };

  constructor(profile: Profile) {
    this.client = new Anthropic({ apiKey: profile.apiKey, baseURL: profile.baseURL });
    this.model = profile.model;
    this.maxTokens = profile.maxTokens ?? 4096;
    // 思考深度 = thinking.budget_tokens，可在 config 覆盖
    this.budget = profile.thinkingBudget ?? { low: 2048, high: 8192 };
  }

  async chat(
    messages: UMessage[],
    tools: UTool[],
    effort: Effort,
    opts?: ChatOptions,
  ): Promise<ChatResult> {
    const onToken = opts?.onToken;
    // 1) system 消息抽出来单独传
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content ?? "")
      .join("\n");

    // 2) 其余消息转成 Anthropic messages，合并连续的 tool 结果到一条 user 消息
    const msgs: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "tool") {
        const block: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: m.toolCallId!,
          content: m.content ?? "",
        };
        const last = msgs[msgs.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content)) {
          last.content.push(block); // 合并到上一条 user 消息
        } else {
          msgs.push({ role: "user", content: [block] });
        }
        continue;
      }

      // 本厂商生成的消息：原样回传厂商内容块（保留 thinking 块，思考+工具时必需）
      if (m.role === "assistant" && m.raw?.kind === "anthropic") {
        msgs.push({
          role: "assistant",
          content: m.raw.blocks as Anthropic.MessageParam["content"],
        });
        continue;
      }

      if (m.role === "assistant" && m.toolCalls?.length) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const c of m.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: c.id,
            name: c.name,
            input: JSON.parse(c.args || "{}"),
          });
        }
        msgs.push({ role: "assistant", content: blocks });
        continue;
      }

      msgs.push({ role: m.role, content: m.content ?? "" });
    }

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    // 思考：off 不开；low/high 映射成 budget_tokens。
    // max_tokens 必须大于 budget，不够就临时抬高。
    let maxTokens = this.maxTokens;
    let thinking: Anthropic.ThinkingConfigParam | undefined;
    if (effort !== "off") {
      const budgetTokens = this.budget[effort];
      if (maxTokens <= budgetTokens) maxTokens = budgetTokens + 1024;
      thinking = { type: "enabled", budget_tokens: budgetTokens };
    }

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: msgs,
      tools: anthropicTools.length ? anthropicTools : undefined,
      ...(anthropicTools.length && opts?.toolChoice === "none"
        ? { tool_choice: { type: "none" as const } }
        : {}),
      ...(thinking ? { thinking } : {}),
    });
    // 只流式正文（thinking 增量不输出，由 spinner 表示）
    stream.on("text", (delta) => onToken?.(delta));
    const res = await stream.finalMessage(); // 自动聚合 tool_use 等所有 block

    let content: string | null = null;
    const toolCalls: UToolCall[] = [];
    for (const block of res.content) {
      if (block.type === "text") content = (content ?? "") + block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, args: JSON.stringify(block.input) });
      }
    }
    return {
      content,
      toolCalls,
      raw: { kind: "anthropic", blocks: res.content },
    };
  }
}
