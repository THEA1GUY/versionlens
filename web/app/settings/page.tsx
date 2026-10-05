"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROVIDERS, type LlmSettings, type ProviderId, providerById } from "@/lib/engine/providers";
import { eraseAll, storageUsage, type StorageUsage } from "@/lib/store/db";
import {
  type ConnectionCheck,
  type Preferences,
  defaultsForProvider,
  loadLlmSettings,
  loadPreferences,
  saveLlmSettings,
  savePreferences,
  testConnection,
} from "@/lib/store/settings";
import { formatBytes } from "@/lib/format";
import { ErrorNote, Spinner, WarningNote } from "@/components/ui";

export default function SettingsPage() {
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadLlmSettings(), loadPreferences(), storageUsage()])
      .then(([l, p, u]) => {
        setLlm(l);
        setPrefs(p);
        setUsage(u);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function persist(next: LlmSettings): Promise<void> {
    setLlm(next);
    setSaved(false);
    try {
      await saveLlmSettings(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function persistPrefs(next: Preferences): Promise<void> {
    setPrefs(next);
    try {
      await savePreferences(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function changeProvider(id: ProviderId): void {
    if (!llm) return;
    void persist({ ...llm, provider: id, ...defaultsForProvider(id) });
    setCheck(null);
  }

  async function runTest(): Promise<void> {
    if (!llm) return;
    setTesting(true);
    setCheck(null);
    try {
      setCheck(await testConnection(llm));
    } finally {
      setTesting(false);
    }
  }

  if (error && !llm) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }
  if (!llm || !prefs) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6">
        <Spinner label="Loading settings…" />
      </div>
    );
  }

  const preset = providerById(llm.provider);

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
      <nav className="mb-5 text-[12.5px] text-ink-faint">
        <Link href="/" className="hover:text-ink hover:underline">
          Dashboard
        </Link>
        <span aria-hidden="true"> / </span>
        <span>Settings</span>
      </nav>

      <h1 className="serif-title text-[26px] font-semibold">Settings</h1>
      <p className="mt-2 max-w-prose text-[13.5px] text-ink-soft">
        Everything here is stored in this browser on this device. There is no account and
        no server holding your data.
      </p>

      {/* --------------------------------------------------------- model */}
      <section className="card mt-7 p-5">
        <h2 className="text-[15px] font-semibold">Semantic analysis</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
          Optional. Deterministic comparison finds amounts, dates, durations and
          obligations on its own. A model adds meaning-change detection on passages that
          were already aligned, and settles section pairings that scoring cannot separate.
        </p>

        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={llm.enabled}
            onChange={(e) => void persist({ ...llm, enabled: e.target.checked })}
            className="mt-0.5 h-3.5 w-3.5 accent-[#1a4fd6]"
          />
          <span className="text-[13px]">
            <span className="font-medium">Use a model</span>
            <span className="block text-[11.5px] text-ink-faint">
              Aligned passages are sent to the provider you choose, using your key.
            </span>
          </span>
        </label>

        {llm.enabled ? (
          <div className="mt-4 space-y-4 border-t border-rule-soft pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
                  Provider
                </span>
                <select
                  value={llm.provider}
                  onChange={(e) => changeProvider(e.target.value as ProviderId)}
                  className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">Model</span>
                <input
                  value={llm.model}
                  onChange={(e) => void persist({ ...llm, model: e.target.value })}
                  list="model-suggestions"
                  placeholder={preset.defaultModel || "model id"}
                  className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent"
                />
                <datalist id="model-suggestions">
                  {(check?.models ?? preset.models).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
                  API base URL
                </span>
                <input
                  value={llm.baseUrl || preset.baseUrl}
                  onChange={(e) => void persist({ ...llm, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
                  API key
                </span>
                <div className="flex gap-2">
                  <input
                    value={llm.apiKey}
                    onChange={(e) => void persist({ ...llm, apiKey: e.target.value })}
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={preset.keyHint}
                    className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="shrink-0 rounded-md border border-rule px-2.5 text-[12px] text-ink-soft hover:bg-canvas"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
                {preset.consoleUrl ? (
                  <span className="mt-1 block text-[11.5px] text-ink-faint">
                    Get a key from{" "}
                    <a
                      href={preset.consoleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      {preset.label}
                    </a>
                    .
                  </span>
                ) : null}
              </label>
            </div>

            <WarningNote>
              Your key is kept in this browser&rsquo;s local database and sent only to the
              provider above. It is not encrypted at rest — anything able to run script on
              this site, or anyone using this device profile, could read it. Use a key
              scoped to this purpose and revoke it when you are done.
            </WarningNote>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testing || !llm.apiKey}
                className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-medium hover:bg-canvas disabled:opacity-50"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              {saved ? <span className="text-[12px] text-add">Saved</span> : null}
            </div>

            {check ? (
              check.ok ? (
                <p className="text-[12.5px] text-add">{check.message}</p>
              ) : (
                <ErrorNote>{check.message}</ErrorNote>
              )
            ) : null}

            <details className="text-[12.5px]">
              <summary className="cursor-pointer text-ink-soft hover:text-ink">
                Advanced
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
                    Passages per request
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={llm.batchSize}
                    onChange={(e) =>
                      void persist({ ...llm, batchSize: clampInt(e.target.value, 1, 25, 8) })
                    }
                    className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
                    Maximum passages per comparison
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={500}
                    value={llm.maxPassages}
                    onChange={(e) =>
                      void persist({ ...llm, maxPassages: clampInt(e.target.value, 10, 500, 80) })
                    }
                    className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                  />
                  <span className="mt-1 block text-[11.5px] text-ink-faint">
                    Caps the cost of one comparison.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={llm.arbitrateAlignment}
                    onChange={(e) =>
                      void persist({ ...llm, arbitrateAlignment: e.target.checked })
                    }
                    className="mt-0.5 h-3.5 w-3.5 accent-[#1a4fd6]"
                  />
                  <span className="text-[12.5px]">
                    <span className="font-medium">Let the model settle ambiguous section pairings</span>
                    <span className="block text-[11.5px] text-ink-faint">
                      Only where the top candidates score within a few points of each other —
                      typically a handful of cases per document, not one call per pair.
                    </span>
                  </span>
                </label>
              </div>
            </details>
          </div>
        ) : null}
      </section>

      {/* ---------------------------------------------------- preferences */}
      <section className="card mt-5 p-5">
        <h2 className="text-[15px] font-semibold">Review preferences</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
              Numeric date order
            </span>
            <select
              value={prefs.locale}
              onChange={(e) =>
                void persistPrefs({ ...prefs, locale: e.target.value as "DMY" | "MDY" })
              }
              className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            >
              <option value="DMY">Day/Month/Year — 15/10/2026</option>
              <option value="MDY">Month/Day/Year — 10/15/2026</option>
            </select>
            <span className="mt-1 block text-[11.5px] text-ink-faint">
              Dates like 04/05/2026 are flagged low confidence either way.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
              Your name on review notes
            </span>
            <input
              value={prefs.reviewerName}
              onChange={(e) => void persistPrefs({ ...prefs, reviewerName: e.target.value })}
              placeholder="Optional"
              className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[11.5px] text-ink-faint">
              Stored on this device only.
            </span>
          </label>
          <label className="flex items-start gap-2.5 sm:col-span-2">
            <input
              type="checkbox"
              checked={prefs.showMinorByDefault}
              onChange={(e) =>
                void persistPrefs({ ...prefs, showMinorByDefault: e.target.checked })
              }
              className="mt-0.5 h-3.5 w-3.5 accent-[#1a4fd6]"
            />
            <span className="text-[12.5px]">
              Show minor formatting and wording changes by default
            </span>
          </label>
        </div>
      </section>

      {/* -------------------------------------------------------- storage */}
      <section className="card mt-5 p-5">
        <h2 className="text-[15px] font-semibold">Local data</h2>
        {usage ? (
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
            <Row label="Documents stored" value={String(usage.documents)} />
            <Row label="Comparisons stored" value={String(usage.comparisons)} />
            <Row label="Space used" value={formatBytes(usage.bytesUsed)} />
            <Row label="Space available" value={formatBytes(usage.bytesQuota)} />
          </dl>
        ) : null}

        <p className="mt-3 text-[12px] leading-relaxed text-ink-soft">
          Clearing this browser&rsquo;s site data also erases everything here. There is no
          copy anywhere else, so export any report you need to keep.
        </p>

        <div className="mt-4">
          {confirmErase ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-remove">
                Erase all documents and comparisons? This cannot be undone.
              </span>
              <button
                type="button"
                onClick={() => {
                  void eraseAll().then(() => {
                    setConfirmErase(false);
                    return storageUsage().then(setUsage);
                  });
                }}
                className="rounded-md border border-remove bg-remove px-3 py-1.5 text-[12.5px] font-medium text-white"
              >
                Erase everything
              </button>
              <button
                type="button"
                onClick={() => setConfirmErase(false)}
                className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] hover:bg-canvas"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmErase(true)}
              className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] text-remove hover:bg-remove-soft"
            >
              Erase all local data
            </button>
          )}
        </div>
      </section>

      {error ? (
        <div className="mt-5">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule-soft pb-0.5">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
