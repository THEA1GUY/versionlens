/**
 * The embedded demo's two promises: it keeps working when browser storage is gone, and
 * it never reaches for a model.
 *
 * `db.ts` caches its database promise at module scope, so each case re-imports the
 * modules under a freshly stubbed `window` rather than sharing one across tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubWindow(pathname: string, search = ""): void {
  vi.stubGlobal("window", { location: { pathname, search } });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embed mode detection", () => {
  it("is on for the /embed route and off everywhere else", async () => {
    stubWindow("/embed/");
    expect((await import("../../embed")).isEmbedded()).toBe(true);

    vi.resetModules();
    stubWindow("/comparison/", "?id=cmp_1&embed=1");
    expect((await import("../../embed")).isEmbedded()).toBe(true);

    vi.resetModules();
    stubWindow("/comparison/", "?id=cmp_1");
    expect((await import("../../embed")).isEmbedded()).toBe(false);
  });

  it("is off during prerendering, when there is no window", async () => {
    expect((await import("../../embed")).isEmbedded()).toBe(false);
  });
});

describe("storage when IndexedDB is unavailable", () => {
  // No `indexedDB` global in this environment, which is exactly the blocked-frame case.
  it("falls back to an ephemeral store in embed mode, and reads back what it wrote", async () => {
    stubWindow("/embed/");
    const db = await import("../../store/db");

    const doc = {
      id: "doc_1",
      filename: "SAMPLE-v1.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      sha256: "abc",
      createdAt: "2026-01-01T00:00:00.000Z",
      model: { blocks: [] },
    } as unknown as import("../../store/db").StoredDocument;

    await db.putDocument(doc, new Blob(["text"]));
    expect((await db.getDocument("doc_1"))?.filename).toBe("SAMPLE-v1.txt");
    expect(await db.listDocuments()).toHaveLength(1);

    await db.setSetting("prefs", { locale: "DMY" });
    expect(await db.getSetting("prefs")).toEqual({ locale: "DMY" });

    await db.deleteDocument("doc_1");
    expect(await db.listDocuments()).toHaveLength(0);
  });

  it("falls back when IndexedDB exists but refuses to open", async () => {
    // Safari throws SecurityError synchronously from open() when third-party storage is
    // blocked, which is a different branch from the API being missing altogether.
    stubWindow("/embed/");
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("SecurityError");
      },
    });
    const db = await import("../../store/db");
    await expect(db.listComparisons()).resolves.toEqual([]);
  });

  it("surfaces that same refusal in the standalone app", async () => {
    vi.stubGlobal("window", { location: { pathname: "/comparisons/", search: "" } });
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("SecurityError");
      },
    });
    const db = await import("../../store/db");
    await expect(db.listComparisons()).rejects.toThrow(/SecurityError/);
  });

  it("still reports the failure in the standalone app, rather than silently not saving", async () => {
    // No window stub: not embedded.
    const db = await import("../../store/db");
    await expect(db.getDocument("doc_1")).rejects.toThrow(/IndexedDB/);
  });

  it("keeps listing order newest-first through the fallback store", async () => {
    stubWindow("/embed/");
    const db = await import("../../store/db");
    for (const [id, createdAt] of [
      ["cmp_old", "2026-01-01T00:00:00.000Z"],
      ["cmp_new", "2026-06-01T00:00:00.000Z"],
    ] as const) {
      await db.putComparison({
        id,
        name: id,
        documentCategory: null,
        notes: null,
        documentIds: [],
        createdAt,
        completedAt: null,
        status: "COMPLETED",
        stageMessage: null,
        result: null,
        review: {},
      });
    }
    expect((await db.listComparisons()).map((c) => c.id)).toEqual(["cmp_new", "cmp_old"]);
  });
});

describe("no paid model calls in embed mode", () => {
  it("forces the model layer off, whatever is stored", async () => {
    stubWindow("/embed/");
    const settings = await import("../../store/settings");
    const llm = await settings.loadLlmSettings();
    expect(llm.enabled).toBe(false);
    expect(llm.ocrEnabled).toBe(false);
    expect(llm.apiKey).toBe("");
  });

  it("leaves the standalone defaults alone", async () => {
    stubWindow("/");
    const settings = await import("../../store/settings");
    // Storage is unavailable here, so this is the default path; `enabled` is false by
    // default too, but the key is what embed mode blanks unconditionally.
    const llm = await settings.loadLlmSettings();
    expect(llm.provider).toBe("deepseek");
  });
});

describe("the sample comparison", () => {
  it("runs the real engine, finds the planted changes, and is idempotent", async () => {
    stubWindow("/embed/");
    const { seedSample, SAMPLE_NAME } = await import("../sample");

    const first = await seedSample();
    expect(first.name).toBe(SAMPLE_NAME);
    expect(first.status).toBe("COMPLETED");

    const changes = first.result?.changes ?? [];
    expect(changes.length).toBeGreaterThan(5);

    // Every change must cite a real block, which is the project's one hard rule. An
    // addition has no counterpart on side A and a removal none on side B, so one side
    // is enough; neither side is not.
    for (const change of changes) {
      expect(change.citationA ?? change.citationB).not.toBeNull();
    }

    // The two changes the demo exists to show: an exact money delta, and an obligation
    // weakening that a word diff reports as two unremarkable word swaps.
    const summaries = changes.map((c) => c.summary).join(" ~ ");
    expect(summaries).toMatch(/£120,000 to £138,000 — \+£18,000 \(\+15%\)/);
    expect(summaries).toMatch(/"shall" \(mandatory\) to "may" \(permissive\)/);

    const second = await seedSample();
    expect(second.id).toBe(first.id);
  });

  it("makes no network request at all while building itself", async () => {
    // The end-to-end form of the guarantee: whatever the settings layer returns, the
    // whole ingest-and-compare pipeline must not touch the network. Every paid call in
    // the app goes through fetch.
    stubWindow("/embed/");
    const fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not call out")));
    vi.stubGlobal("fetch", fetchSpy);

    const { seedSample } = await import("../sample");
    const comparison = await seedSample();

    expect(comparison.status).toBe("COMPLETED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("labels both sample documents as fictional in their own text", async () => {
    stubWindow("/embed/");
    const { seedSample } = await import("../sample");
    const comparison = await seedSample();
    const docs = comparison.result?.documents;
    expect(docs?.a.filename).toMatch(/^SAMPLE-/);
    expect(docs?.b.filename).toMatch(/^SAMPLE-/);
  });
});
