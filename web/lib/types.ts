export type Side = "A" | "B";

export type Importance = "HIGH" | "MEDIUM" | "LOW";

export type ChangeTypeName =
  | "ADDED"
  | "REMOVED"
  | "MODIFIED"
  | "MEANING_CHANGED"
  | "MOVED"
  | "SECTION_ADDED"
  | "SECTION_REMOVED"
  | "SECTION_RENAMED";

export type ReviewStatus =
  | "unreviewed"
  | "confirmed"
  | "false_alert"
  | "needs_discussion"
  | "resolved";

export type ComparisonStatus =
  | "UPLOADED"
  | "EXTRACTING"
  | "SEGMENTING"
  | "ALIGNING"
  | "DIFFING"
  | "ANALYZING"
  | "GENERATING_RESULTS"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";

export interface Citation {
  document_version: Side;
  block_id: string;
  page: number;
  section: string;
  char_start: number;
  char_end: number;
  text: string;
  bbox: [number, number, number, number] | null;
}

export interface ChangeValue {
  value: string | number | null;
  unit?: string | null;
  currency?: string | null;
  source_text?: string | null;
  kind?: string | null;
  context?: string | null;
  actor?: string | null;
  strength?: number | null;
  frequency?: string | null;
  days_equivalent?: number | null;
}

export interface ChangeDelta {
  absolute?: number | null;
  percentage?: number | null;
  percentage_points?: number | null;
  days?: number | null;
  strength_change?: number | null;
  unit?: string | null;
}

export interface DiffOp {
  op: "equal" | "insert" | "delete" | "replace";
  a: string;
  b: string;
}

export interface ReviewerNote {
  author: string | null;
  body: string;
  created_at: string;
}

export interface Change {
  id: string;
  record_id: string;
  type: ChangeTypeName;
  category: string;
  categories: string[];
  summary: string;
  importance: Importance;
  importance_score: number;
  confidence: number;
  confidence_label: string;
  confidence_signals: Record<string, number>;
  old_value: ChangeValue | null;
  new_value: ChangeValue | null;
  delta: ChangeDelta | null;
  direction: string | null;
  citation_a: Citation | null;
  citation_b: Citation | null;
  text_a: string;
  text_b: string;
  word_diff: DiffOp[];
  detectors: string[];
  section_a: string | null;
  section_b: string | null;
  notes: string[];
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: ReviewerNote[];
}

export interface KeyChange {
  change_id: string;
  category: string;
  summary: string;
  importance: Importance;
  citation_a: Citation | null;
  citation_b: Citation | null;
}

export interface ReviewProgress {
  total: number;
  reviewed: number;
  confirmed: number;
  false_alerts: number;
  needs_discussion: number;
  resolved?: number;
  unreviewed: number;
}

export interface ComparisonSummary {
  headline: string;
  total_changes: number;
  material_changes: number;
  minor_changes: number;
  high_attention: number;
  medium_attention: number;
  low_attention: number;
  by_category: Record<string, number>;
  by_type: Record<string, number>;
  key_changes: KeyChange[];
  review_progress: ReviewProgress;
  identical: boolean;
}

export interface SectionMapRow {
  status: "MATCHED" | "ADDED" | "REMOVED";
  section_a: string | null;
  section_b: string | null;
  page_a: number | null;
  page_b: number | null;
  alignment_confidence: number;
  alignment_signals: Record<string, number>;
  change_count: number;
}

export interface PageMeta {
  page_number: number;
  status: string;
  extraction_confidence: number;
  note: string | null;
}

export interface DocumentMeta {
  label: string;
  filename: string;
  sha256: string;
  page_count: number;
  section_count: number;
  block_count: number;
  extraction_version: string;
  pages: PageMeta[];
}

export interface Comparison {
  id: string;
  name: string | null;
  document_category: string | null;
  notes: string | null;
  status: ComparisonStatus;
  stage_message: string | null;
  error: string | null;
  locale: "DMY" | "MDY";
  use_semantic: boolean;
  created_at: string;
  completed_at: string | null;
  created_by: string | null;
  version_a_document_id: string;
  version_b_document_id: string;
  summary: ComparisonSummary;
  section_map: SectionMapRow[];
  documents: { a?: DocumentMeta; b?: DocumentMeta };
  warnings: string[];
  audit: Record<string, string | number | null>;
  disclaimer: string;
}

export interface ComparisonListItem {
  id: string;
  name: string | null;
  status: ComparisonStatus;
  stage_message: string | null;
  created_at: string;
  completed_at: string | null;
  document_category: string | null;
  version_a_filename: string;
  version_b_filename: string;
  change_count: number;
  reviewed_count: number;
}

export interface UploadedDocument {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  version_id: string;
  page_count: number;
  section_count: number;
  block_count: number;
  extraction_status: string;
  warnings: string[];
}

export interface DocumentBlock {
  id: string;
  page: number;
  block_index: number;
  block_type: string;
  section_id: string | null;
  text: string;
  cells: string[] | null;
  bbox: [number, number, number, number] | null;
}

export interface DocumentSection {
  id: string;
  label: string;
  heading: string;
  section_number: string | null;
  level: number;
  parent_id: string | null;
  start_page: number;
  end_page: number;
  order_index: number;
}

export interface DocumentContent {
  document_id: string;
  page_count: number;
  extraction_status: string;
  pages: PageMeta[];
  sections: DocumentSection[];
  blocks: DocumentBlock[];
}

export interface Facets {
  category: Record<string, number>;
  importance: Record<string, number>;
  type: Record<string, number>;
  review_status: Record<string, number>;
  total: number;
}

export interface ChangesResponse {
  changes: Change[];
  total: number;
  facets: Facets;
}

export interface SearchResponse {
  query: string;
  changes: {
    record_id: string;
    change_key: string;
    summary: string;
    category: string;
    importance: Importance;
  }[];
  document_matches: {
    side: Side;
    document_id: string;
    block_id: string;
    page: number;
    section: string;
    text: string;
  }[];
}

export interface Health {
  status: string;
  engine_version: string;
  extraction_version: string;
  semantic_available: boolean;
  semantic_model: string;
  supported_formats: string[];
  max_upload_bytes: number;
  disclaimer: string;
}
