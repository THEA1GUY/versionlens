/**
 * Model-agnostic provider configuration.
 *
 * The key is the user's and stays on their machine; requests go from the browser
 * straight to the provider. Nothing about a document reaches our servers, because there
 * are no servers in this path.
 */

export type ProviderId = "openai" | "anthropic" | "deepseek" | "groq" | "openrouter" | "custom";

export type ApiFlavour = "openai" | "anthropic";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** Chat-completions base, without a trailing slash. */
  baseUrl: string;
  flavour: ApiFlavour;
  /** Suggestions only — the user may type any model id. */
  models: string[];
  defaultModel: string;
  keyHint: string;
  /** Where the user gets a key. */
  consoleUrl: string;
  /**
   * Whether the provider's browser endpoint accepts requests from a web page.
   * Anthropic requires an explicit opt-in header for direct browser calls.
   */
  browserHeaders?: Record<string, string>;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    flavour: "openai",
    models: ["deepseek-chat", "deepseek-flash", "deepseek-v4-pro"],
    defaultModel: "deepseek-chat",
    keyHint: "sk-…",
    consoleUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    flavour: "openai",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    defaultModel: "gpt-4o-mini",
    keyHint: "sk-…",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    flavour: "anthropic",
    models: ["claude-sonnet-5-5", "claude-haiku-4-5-20251001", "claude-opus-5-5"],
    defaultModel: "claude-sonnet-5-5",
    keyHint: "sk-ant-…",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    browserHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    flavour: "openai",
    // Reasoning models consume the JSON budget and return an empty completion, so the
    // defaults here are non-reasoning.
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    defaultModel: "llama-3.3-70b-versatile",
    keyHint: "gsk_…",
    consoleUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    flavour: "openai",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku", "deepseek/deepseek-chat"],
    defaultModel: "openai/gpt-4o-mini",
    keyHint: "sk-or-…",
    consoleUrl: "https://openrouter.ai/keys",
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible)",
    baseUrl: "",
    flavour: "openai",
    models: [],
    defaultModel: "",
    keyHint: "your key",
    consoleUrl: "",
  },
];

export function providerById(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? (PROVIDERS[0] as ProviderPreset);
}

export interface LlmSettings {
  enabled: boolean;
  provider: ProviderId;
  /** Overrides the preset when set — required for `custom`. */
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Passages per request. */
  batchSize: number;
  /** Cap on passages sent per comparison, so a long contract cannot run away. */
  maxPassages: number;
  /** Let the model arbitrate ambiguous section pairings. */
  arbitrateAlignment: boolean;
  /**
   * Send scanned pages to the provider as images to recover their text.
   *
   * Separate from `enabled` on purpose: semantic analysis sends aligned passages, OCR
   * sends a picture of a whole page. That is a bigger disclosure and deserves its own
   * decision.
   */
  ocrEnabled: boolean;
  /** Vision-capable model for OCR; may differ from the analysis model. */
  ocrModel: string;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  enabled: false,
  provider: "deepseek",
  baseUrl: "",
  model: "deepseek-chat",
  apiKey: "",
  batchSize: 8,
  maxPassages: 80,
  arbitrateAlignment: true,
  ocrEnabled: false,
  ocrModel: "deepseek-flash",
};

export function resolveEndpoint(settings: LlmSettings): {
  url: string;
  flavour: ApiFlavour;
  headers: Record<string, string>;
} | null {
  const preset = providerById(settings.provider);
  const base = (settings.baseUrl || preset.baseUrl).replace(/\/+$/, "");
  if (!base || !settings.apiKey || !settings.model) return null;

  if (preset.flavour === "anthropic") {
    return {
      url: `${base}/messages`,
      flavour: "anthropic",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        ...(preset.browserHeaders ?? {}),
      },
    };
  }
  return {
    url: `${base}/chat/completions`,
    flavour: "openai",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    },
  };
}
