/**
 * User settings, including their own model API key.
 *
 * The key is stored in this browser's IndexedDB and sent only to the provider endpoint
 * the user chose. It is never transmitted to any VersionLens server, because there is no
 * VersionLens server — the app is static files.
 *
 * That still means the key sits in browser storage, which is readable by anything that
 * can run script on this origin. The settings screen says so plainly rather than
 * implying it is encrypted.
 */

import {
  DEFAULT_LLM_SETTINGS,
  type LlmSettings,
  type ProviderId,
  providerById,
} from "../engine/providers";
import { getSetting, setSetting } from "./db";

const KEY_LLM = "llm";
const KEY_PREFS = "prefs";

export interface Preferences {
  /** Numeric date order, for inputs like 04/05/2026. */
  locale: "DMY" | "MDY";
  /** Minor formatting and wording changes are collapsed by default. */
  showMinorByDefault: boolean;
  /** Reviewer name recorded alongside decisions; local only. */
  reviewerName: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  locale: "DMY",
  showMinorByDefault: false,
  reviewerName: "",
};

export async function loadLlmSettings(): Promise<LlmSettings> {
  const stored = await getSetting<Partial<LlmSettings>>(KEY_LLM).catch(() => undefined);
  const merged = { ...DEFAULT_LLM_SETTINGS, ...(stored ?? {}) };
  // A stale provider id from an older build must not break the screen.
  if (!providerById(merged.provider)) merged.provider = DEFAULT_LLM_SETTINGS.provider;
  return merged;
}

export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  await setSetting(KEY_LLM, settings);
}

export async function loadPreferences(): Promise<Preferences> {
  const stored = await getSetting<Partial<Preferences>>(KEY_PREFS).catch(() => undefined);
  return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await setSetting(KEY_PREFS, prefs);
}

/** Vision-capable defaults per provider, for OCR. */
const OCR_DEFAULT: Partial<Record<ProviderId, string>> = {
  deepseek: "deepseek-flash",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-5-5",
  openrouter: "openai/gpt-4o",
};

export function defaultsForProvider(
  id: ProviderId,
): Pick<LlmSettings, "baseUrl" | "model" | "ocrModel"> {
  const preset = providerById(id);
  return {
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    ocrModel: OCR_DEFAULT[id] ?? preset.defaultModel,
  };
}

export interface ConnectionCheck {
  ok: boolean;
  message: string;
  /** Models the endpoint reports, when it offers a listing. */
  models?: string[];
}

/**
 * Verify a key against the provider before a comparison depends on it.
 *
 * Deliberately a real request: a key that looks well-formed but is revoked, out of
 * credit, or scoped wrongly only reveals itself when used.
 */
export async function testConnection(settings: LlmSettings): Promise<ConnectionCheck> {
  const preset = providerById(settings.provider);
  const base = (settings.baseUrl || preset.baseUrl).replace(/\/+$/, "");
  if (!base) return { ok: false, message: "Set an API base URL first." };
  if (!settings.apiKey) return { ok: false, message: "Enter an API key first." };

  // Anthropic has no public models listing on the browser path; send a 1-token message.
  if (preset.flavour === "anthropic") {
    try {
      const response = await fetch(`${base}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          ...(preset.browserHeaders ?? {}),
        },
        body: JSON.stringify({
          model: settings.model || preset.defaultModel,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      if (!response.ok) {
        return { ok: false, message: await describeFailure(response) };
      }
      return { ok: true, message: `Connected to ${preset.label}.` };
    } catch (err) {
      return { ok: false, message: networkHint(err) };
    }
  }

  try {
    const response = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${settings.apiKey}` },
    });
    if (!response.ok) {
      return { ok: false, message: await describeFailure(response) };
    }
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      .sort();
    return {
      ok: true,
      message: models.length > 0
        ? `Connected. ${models.length} model${models.length === 1 ? "" : "s"} available.`
        : "Connected.",
      models,
    };
  } catch (err) {
    return { ok: false, message: networkHint(err) };
  }
}

async function describeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) {
    return "The provider rejected this key (401/403). Check it was copied in full and is still active.";
  }
  if (response.status === 402) {
    return "The provider says this account has no credit (402).";
  }
  if (response.status === 429) {
    return "Rate limited by the provider (429). Wait a moment and try again.";
  }
  return `${response.status} ${response.statusText}. ${text.slice(0, 200)}`.trim();
}

/**
 * A failed browser request to a third-party API is almost always CORS rather than a bad
 * key, and the browser deliberately hides the detail. Say so instead of guessing.
 */
function networkHint(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return (
    `Could not reach the provider: ${message}. ` +
    "A browser request can fail this way when the provider does not allow calls " +
    "directly from a web page. Try another provider, or run the self-hosted build."
  );
}
