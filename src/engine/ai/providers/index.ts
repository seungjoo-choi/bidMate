import type { AiProvider } from '../../../core/types/ai';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { openaiAdapter } from './openai';
import type { AiProviderAdapter } from './types';

export const PROVIDERS: Record<AiProvider, AiProviderAdapter> = { claude: claudeAdapter, openai: openaiAdapter, gemini: geminiAdapter };

export function getAdapter(provider: AiProvider): AiProviderAdapter {
  return PROVIDERS[provider];
}
