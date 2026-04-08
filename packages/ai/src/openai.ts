import OpenAI from 'openai';
import type { AIProvider, ChatRequest, ChatResponse } from './types';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || 'gpt-4-turbo';

    const response = await this.client.chat.completions.create({
      model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    });

    const usage = response.usage!;
    const totalTokens = usage.total_tokens;

    return {
      content: response.choices[0].message.content || '',
      model: response.model,
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: totalTokens,
      },
      cost: this.estimateCost(totalTokens, model),
    };
  }

  estimateCost(tokens: number, model: string): number {
    // Pricing per 1M tokens (as of 2026)
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4-turbo': { input: 10.0, output: 30.0 },
      'gpt-4': { input: 30.0, output: 60.0 },
    };

    const price = pricing[model] || pricing['gpt-4-turbo'];
    // Rough estimate: 50/50 input/output split
    return ((tokens / 1_000_000) * (price.input + price.output)) / 2;
  }
}
