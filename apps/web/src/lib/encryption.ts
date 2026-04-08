/**
 * AES-256-GCM Encryption utilities for API keys
 * 
 * Security features:
 * - AES-256-GCM (authenticated encryption)
 * - Random IV for each encryption
 * - ENCRYPTION_KEY from environment (never in code/DB)
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const API_KEY_VALIDATION_TIMEOUT_MS = 8000;

export type ApiKeyValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'network' | 'timeout' | 'unknown'; status?: number };

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  // Hash the key to ensure it's exactly 32 bytes (256 bits)
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a string using AES-256-GCM
 * @param plaintext - The string to encrypt (e.g., API key)
 * @returns Base64 encoded string: IV + AuthTag + Ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Combine: IV (16) + AuthTag (16) + Ciphertext
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'base64')
  ]);
  
  return combined.toString('base64');
}

/**
 * Decrypt a string encrypted with encrypt()
 * @param encryptedData - Base64 encoded string from encrypt()
 * @returns Original plaintext
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Extract: IV (16) + AuthTag (16) + Ciphertext
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext.toString('base64'), 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Get a hint for display (last 4 characters)
 * @param apiKey - The full API key
 * @returns Masked hint like "...XYZ4"
 */
export function getKeyHint(apiKey: string): string {
  if (apiKey.length < 4) return '****';
  return '...' + apiKey.slice(-4);
}

/**
 * Detect provider from API key format
 * @param apiKey - The API key to analyze
 * @returns Provider name or null if unknown
 */
export function detectProvider(apiKey: string): 'openai' | 'anthropic' | 'google' | 'ollama' | null {
  // Check Anthropic FIRST (sk-ant-* starts with sk- so order matters!)
  if (apiKey.startsWith('sk-ant-')) {
    return 'anthropic';
  }
  // Then OpenAI
  if (apiKey.startsWith('sk-') || apiKey.startsWith('sk-proj-')) {
    return 'openai';
  }
  // Then Google
  if (apiKey.startsWith('AIza')) {
    return 'google';
  }
  // Ollama Cloud keys currently do not have a stable public prefix in our codebase,
  // so only recognize explicit/provider-specific patterns when present.
  if (apiKey.startsWith('ollama_')) {
    return 'ollama';
  }
  return null;
}

/**
 * Validate API key by making a test request
 * @param apiKey - The API key to validate
 * @param provider - The provider (openai, anthropic, google)
 * @returns true if valid, false otherwise
 */
async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = API_KEY_VALIDATION_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function validateApiKeyDetailed(
  apiKey: string,
  provider: string
): Promise<ApiKeyValidationResult> {
  try {
    switch (provider) {
      case 'openai': {
        const response = await fetchWithTimeout('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        return response.ok ? { ok: true } : { ok: false, reason: 'invalid', status: response.status };
      }
      case 'anthropic': {
        // Anthropic doesn't have a simple models endpoint, so we try a minimal request
        const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }]
          })
        });
        if (response.status === 401) {
          return { ok: false, reason: 'invalid', status: response.status };
        }
        return { ok: true };
      }
      case 'google': {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );
        return response.ok ? { ok: true } : { ok: false, reason: 'invalid', status: response.status };
      }
      case 'ollama': {
        const response = await fetchWithTimeout('https://ollama.com/api/tags', {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });
        if (response.status === 401 || response.status === 403) {
          return { ok: false, reason: 'invalid', status: response.status };
        }
        return response.ok
          ? { ok: true }
          : { ok: false, reason: 'network', status: response.status };
      }
      default:
        return { ok: false, reason: 'unknown' };
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    console.error('API key validation error:', error);
    return { ok: false, reason: 'network' };
  }
}

export async function validateApiKey(apiKey: string, provider: string): Promise<boolean> {
  const result = await validateApiKeyDetailed(apiKey, provider);
  return result.ok;
}

// Provider configurations with available models
export const PROVIDER_MODELS: Record<string, { name: string; models: { id: string; name: string; description: string }[] }> = {
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable, multimodal' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous generation' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Legacy, very fast' },
    ]
  },
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Best balance' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Previous Sonnet' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fast and cheap' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Most capable' },
    ]
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and efficient' },
      { id: 'gemini-pro', name: 'Gemini Pro', description: 'Previous generation' },
    ]
  },
  ollama: {
    name: 'Ollama Cloud',
    models: [
      { id: 'kimi-k2.5:cloud', name: 'Kimi K2.5 Cloud', description: 'Recommended OpenClaw cloud model' },
      { id: 'minimax-m2.5:cloud', name: 'MiniMax M2.5 Cloud', description: 'Fast coding and productivity' },
      { id: 'glm-5:cloud', name: 'GLM-5 Cloud', description: 'Reasoning and code generation' },
    ]
  }
};
