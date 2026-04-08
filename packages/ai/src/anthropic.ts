import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, ChatRequest, ChatResponse } from './types';

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || 'claude-sonnet-4-5';

    const response = await this.client.messages.create({
      model,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature,
      messages: request.messages.map((msg) => ({
        role: msg.role === 'system' ? 'assistant' : msg.role,
        content: msg.content,
      })),
    });

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const totalTokens = inputTokens + outputTokens;

    return {
      content: response.content[0].type === 'text' ? response.content[0].text : '',
      model: response.model,
      tokens: {
        prompt: inputTokens,
        completion: outputTokens,
        total: totalTokens,
      },
      cost: this.estimateCost(totalTokens, model),
    };
  }

  estimateCost(tokens: number, model: string): number {
    // Pricing per 1M tokens (as of 2026)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
      'claude-opus-4': { input: 15.0, output: 75.0 },
    };

    const price = pricing[model] || pricing['claude-sonnet-4-5'];
    // Rough estimate: 50/50 input/output split
    return ((tokens / 1_000_000) * (price.input + price.output)) / 2;
  }
}
