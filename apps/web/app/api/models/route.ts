import { NextRequest, NextResponse } from 'next/server';

import { getAgentApiKey } from '@/lib/api-keys';
import { resolveRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
}

interface OllamaTagModel {
  name: string;
  size?: number;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
  };
}

interface OllamaTagsResponse {
  models?: OllamaTagModel[];
}

interface CachedModels {
  models: TransformedModel[];
  fetchedAt: number;
}

interface TransformedModel {
  id: string;
  name: string;
  provider: string;
  description?: string;
  pricing: {
    input: number;
    output: number;
  };
  contextLength: number;
}

let openRouterCache: CachedModels | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;
const OPENROUTER_TIMEOUT_MS = 8000;

const ALLOWED_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'meta-llama',
  'mistralai',
  'cohere',
  'deepseek',
];

const PRIORITY_MODELS = [
  'anthropic/claude-opus-4',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.5-haiku',
  'openai/gpt-5.2',
  'openai/gpt-5.2-pro',
  'openai/gpt-5.2-chat',
  'openai/gpt-5.1',
  'openai/gpt-5',
  'openai/gpt-5-mini',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/o1',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash',
  'deepseek/deepseek-chat-v3',
  'deepseek/deepseek-r1',
];

function transformOpenRouterModel(model: OpenRouterModel): TransformedModel {
  const provider = model.id.split('/')[0];
  const inputPricePerToken = parseFloat(model.pricing.prompt) || 0;
  const outputPricePerToken = parseFloat(model.pricing.completion) || 0;

  return {
    id: model.id,
    name: model.name,
    provider,
    description: model.description,
    pricing: {
      input: inputPricePerToken * 1000,
      output: outputPricePerToken * 1000,
    },
    contextLength: model.context_length,
  };
}

function filterAndSortOpenRouterModels(models: TransformedModel[]): TransformedModel[] {
  let filtered = models.filter((model) => ALLOWED_PROVIDERS.includes(model.provider));

  filtered = filtered.filter((model) => {
    const id = model.id.toLowerCase();
    if (id.includes(':free') || id.includes('-free')) return false;
    if (id.includes('preview') && !id.includes('gemini')) return false;
    if (id.includes('instruct') && !id.includes('gpt')) return false;
    if (id.includes('gpt-3.5')) return false;
    if (id.includes('claude-2')) return false;
    if (id.includes('claude-instant')) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const aPriority = PRIORITY_MODELS.findIndex((priority) => a.id.startsWith(priority));
    const bPriority = PRIORITY_MODELS.findIndex((priority) => b.id.startsWith(priority));

    if (aPriority !== -1 && bPriority === -1) return -1;
    if (bPriority !== -1 && aPriority === -1) return 1;
    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;

    if (a.provider !== b.provider) {
      const providerOrder = ['anthropic', 'openai', 'google', 'deepseek', 'meta-llama', 'mistralai', 'cohere'];
      return providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider);
    }

    return a.name.localeCompare(b.name);
  });

  return filtered;
}

async function fetchModelsFromOpenRouter(): Promise<TransformedModel[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('openrouter-timeout'), OPENROUTER_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Accept': 'application/json',
      },
      next: { revalidate: 3600 }, // Next.js cache hint
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const models = Array.isArray(data?.data) ? (data.data as OpenRouterModel[]) : [];

    if (models.length === 0) {
      throw new Error('OpenRouter API returned no models');
    }

    return filterAndSortOpenRouterModels(models.map(transformOpenRouterModel));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`OpenRouter API timeout after ${OPENROUTER_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getOpenRouterModels(): Promise<TransformedModel[]> {
  const now = Date.now();
  if (openRouterCache && now - openRouterCache.fetchedAt < CACHE_TTL_MS) {
    return openRouterCache.models;
  }

  const models = await fetchModelsFromOpenRouter();
  openRouterCache = {
    models,
    fetchedAt: now,
  };
  return models;
}

function prettifyOllamaName(modelName: string): string {
  return modelName
    .replace(/:cloud$/i, ' Cloud')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function transformOllamaModel(model: OllamaTagModel): TransformedModel {
  const family = model.details?.family || model.details?.families?.[0];
  const sizeLabel = model.details?.parameter_size ? ` (${model.details.parameter_size})` : '';
  const descriptionParts = [
    family ? `Family: ${family}` : null,
    model.name.endsWith(':cloud') ? 'Cloud-hosted via Ollama' : 'Hosted via Ollama',
  ].filter(Boolean);

  return {
    id: model.name,
    name: prettifyOllamaName(model.name),
    provider: 'ollama',
    description: `${descriptionParts.join(' • ')}${sizeLabel}`,
    pricing: {
      input: 0,
      output: 0,
    },
    contextLength: 0,
  };
}

async function fetchModelsFromOllama(apiKey: string): Promise<TransformedModel[]> {
  const response = await fetch('https://ollama.com/api/tags', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data: OllamaTagsResponse = await response.json();
  const models = Array.isArray(data.models) ? data.models : [];

  return models
    .filter((model) => typeof model.name === 'string' && model.name.trim().length > 0)
    .map(transformOllamaModel)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(request: NextRequest) {
  let userId: string | null = null;

  try {
    const authResult = await resolveRequestAuth(request);
    userId = authResult?.kind === 'user' ? authResult.user.id : null;
  } catch {
    userId = null;
  }

  try {
    const [openRouterModels, ollamaApiKey] = await Promise.all([
      getOpenRouterModels(),
      userId ? getAgentApiKey(userId, 'ollama') : Promise.resolve(null),
    ]);

    let ollamaModels: TransformedModel[] = [];
    let ollamaError: string | null = null;

    if (ollamaApiKey) {
      try {
        ollamaModels = await fetchModelsFromOllama(ollamaApiKey);
      } catch (error) {
        console.error('[Models API] Ollama error:', error);
        ollamaError = error instanceof Error ? error.message : 'Unknown Ollama error';
      }
    }

    return NextResponse.json({
      models: [...openRouterModels, ...ollamaModels],
      cached: Boolean(openRouterCache),
      cachedAt: openRouterCache ? new Date(openRouterCache.fetchedAt).toISOString() : null,
      providers: {
        openrouter: {
          configured: true,
          modelCount: openRouterModels.length,
        },
        ollama: {
          configured: Boolean(ollamaApiKey),
          modelCount: ollamaModels.length,
          error: ollamaError,
        },
      },
    });
  } catch (error) {
    console.error('[Models API] Error:', error);

    if (openRouterCache) {
      return NextResponse.json({
        models: openRouterCache.models,
        cached: true,
        stale: true,
        error: error instanceof Error ? error.message : 'Impossible de récupérer la liste des modèles',
      });
    }

    return NextResponse.json(
      {
        error: 'Impossible de récupérer la liste des modèles',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
