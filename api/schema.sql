-- VersionLens schema.
--
-- Pages, sections and blocks are stored as one JSON document per version rather than as
-- separate tables. They are only ever read as a whole (to render a version and resolve
-- citations), never queried field by field, so four joined tables would buy nothing.
-- Changes do get a table: they are filtered, searched and individually reviewed.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id                 TEXT PRIMARY KEY,
    organization_id    TEXT NOT NULL REFERENCES organizations(id),
    filename           TEXT NOT NULL,
    mime_type          TEXT NOT NULL,
    size_bytes         INTEGER NOT NULL,
    sha256             TEXT NOT NULL,
    storage_key        TEXT NOT NULL,
    uploaded_by        TEXT,
    created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_versions (
    id                 TEXT PRIMARY KEY,
    document_id        TEXT NOT NULL REFERENCES documents(id),
    label              TEXT,
    parser_version     TEXT NOT NULL,
    page_count         INTEGER NOT NULL DEFAULT 0,
    extraction_status  TEXT NOT NULL,
    content_json       TEXT,          -- pages + sections + blocks, with provenance
    created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id);

CREATE TABLE IF NOT EXISTS comparisons (
    id                     TEXT PRIMARY KEY,
    organization_id        TEXT NOT NULL REFERENCES organizations(id),
    name                   TEXT,
    document_category      TEXT,
    notes                  TEXT,
    version_a_document_id  TEXT NOT NULL REFERENCES documents(id),
    version_b_document_id  TEXT NOT NULL REFERENCES documents(id),
    status                 TEXT NOT NULL,
    stage_message          TEXT,
    locale                 TEXT NOT NULL DEFAULT 'DMY',
    use_semantic           INTEGER NOT NULL DEFAULT 1,
    summary_json           TEXT,
    section_map_json       TEXT,
    documents_json         TEXT,
    warnings_json          TEXT,
    audit_json             TEXT,
    error                  TEXT,
    engine_version         TEXT,
    extraction_version     TEXT,
    analysis_model_version TEXT,
    created_by             TEXT,
    created_at             TEXT NOT NULL,
    completed_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_comparisons_org ON comparisons(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS changes (
    id                TEXT PRIMARY KEY,
    comparison_id     TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
    change_key        TEXT NOT NULL,          -- engine-local id, e.g. chg_00007
    ordinal           INTEGER NOT NULL,
    type              TEXT NOT NULL,
    category          TEXT NOT NULL,
    categories        TEXT NOT NULL,          -- JSON array
    importance        TEXT NOT NULL,
    importance_score  REAL NOT NULL,
    confidence        REAL NOT NULL,
    summary           TEXT NOT NULL,
    search_text       TEXT NOT NULL,          -- summary + both passages + section labels
    payload_json      TEXT NOT NULL,          -- the full canonical change object
    review_status     TEXT NOT NULL DEFAULT 'unreviewed',
    reviewed_by       TEXT,
    reviewed_at       TEXT,
    UNIQUE (comparison_id, change_key)
);
CREATE INDEX IF NOT EXISTS idx_changes_lookup
    ON changes(comparison_id, importance, category, review_status);

CREATE TABLE IF NOT EXISTS change_notes (
    id             TEXT PRIMARY KEY,
    change_id      TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    author         TEXT,
    body           TEXT NOT NULL,
    created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_change ON change_notes(change_id, created_at);

-- Append-only. Every upload, comparison and reviewer decision lands here (TRD §22).
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at   TEXT NOT NULL,
    actor         TEXT,
    action        TEXT NOT NULL,
    subject_type  TEXT NOT NULL,
    subject_id    TEXT NOT NULL,
    detail_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_log(subject_type, subject_id, occurred_at);
