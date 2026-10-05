import type {
  Change,
  ChangesResponse,
  Comparison,
  ComparisonListItem,
  DocumentContent,
  Health,
  ReviewStatus,
  SearchResponse,
  UploadedDocument,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface ChangeFilters {
  category?: string[];
  importance?: string[];
  change_type?: string[];
  review_status?: string[];
  min_confidence?: number;
  include_minor?: boolean;
  q?: string;
  limit?: number;
}

function toQuery(filters: ChangeFilters): string {
  const params = new URLSearchParams();
  for (const value of filters.category ?? []) params.append("category", value);
  for (const value of filters.importance ?? []) params.append("importance", value);
  for (const value of filters.change_type ?? []) params.append("change_type", value);
  for (const value of filters.review_status ?? []) params.append("review_status", value);
  if (filters.min_confidence !== undefined) {
    params.set("min_confidence", String(filters.min_confidence));
  }
  if (filters.include_minor !== undefined) {
    params.set("include_minor", String(filters.include_minor));
  }
  if (filters.q) params.set("q", filters.q);
  params.set("limit", String(filters.limit ?? 800));
  return params.toString();
}

export const api = {
  health: () => request<Health>("/api/health"),

  listComparisons: () =>
    request<{ comparisons: ComparisonListItem[] }>("/api/comparisons").then(
      (r) => r.comparisons,
    ),

  getComparison: (id: string) => request<Comparison>(`/api/comparisons/${id}`),

  deleteComparison: (id: string) =>
    request<void>(`/api/comparisons/${id}`, { method: "DELETE" }),

  uploadDocument: async (file: File): Promise<UploadedDocument> => {
    const form = new FormData();
    form.append("file", file);
    return request<UploadedDocument>("/api/documents", { method: "POST", body: form });
  },

  createComparison: (payload: {
    version_a_document_id: string;
    version_b_document_id: string;
    name?: string;
    document_category?: string;
    notes?: string;
    locale?: "DMY" | "MDY";
    use_semantic?: boolean;
  }) =>
    request<{ id: string; status: string }>("/api/comparisons", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getChanges: (id: string, filters: ChangeFilters = {}) =>
    request<ChangesResponse>(`/api/comparisons/${id}/changes?${toQuery(filters)}`),

  getDocumentContent: (documentId: string) =>
    request<DocumentContent>(`/api/documents/${documentId}/content`),

  reviewChange: (recordId: string, status: ReviewStatus, comment?: string) =>
    request<Change>(`/api/changes/${recordId}/review`, {
      method: "PATCH",
      body: JSON.stringify({ status, comment: comment || null }),
    }),

  search: (id: string, q: string) =>
    request<SearchResponse>(
      `/api/comparisons/${id}/search?q=${encodeURIComponent(q)}`,
    ),

  exportUrl: (id: string, format: "pdf" | "docx" | "csv" | "xlsx", includeMinor = false) =>
    `/api/comparisons/${id}/export?format=${format}&include_minor=${includeMinor}`,

  originalUrl: (documentId: string) => `/api/documents/${documentId}/file`,
};
