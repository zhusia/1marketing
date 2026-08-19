"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKETING_RECORD_CATALOG = exports.SYNC_SCOPE_DEFINITIONS = void 0;
exports.getRecordAdapter = getRecordAdapter;
exports.scanMarketingRecords = scanMarketingRecords;
exports.applyMarketingRecord = applyMarketingRecord;
const canonical_1 = require("./canonical");
const types_1 = require("./types");
exports.SYNC_SCOPE_DEFINITIONS = [
    { id: 'core', label: 'Workspaces & products', detail: 'Workspace list, product profiles, device roles, and the automation owner.', locked: true },
    { id: 'content', label: 'Content library', detail: 'Generated posts, articles, and their statuses.', locked: false },
    { id: 'assets', label: 'Assets & designs', detail: 'Asset library metadata, collections, and Design Studio documents.', locked: false },
    { id: 'video', label: 'Video storyboards', detail: 'AI Video Maker storyboards and their revisions.', locked: false },
    { id: 'scheduling', label: 'Scheduling', detail: 'Scheduled posts, channel targets, and comment snippets.', locked: false },
    { id: 'automations', label: 'Automations', detail: 'Repurpose pipelines and AI visibility trackers.', locked: false },
    { id: 'preferences', label: 'App preferences', detail: 'Portable settings such as layout customizations.', locked: false },
];
const workspace = {
    recordType: 'workspace',
    table: 'workspaces',
    idColumns: ['id'],
    columns: ['id', 'name', 'color', 'is_default', 'sort_order', 'created_at', 'updated_at'],
    order: 10,
    scope: 'core',
};
const product = {
    recordType: 'product',
    table: 'products',
    idColumns: ['id'],
    columns: [
        'id', 'name', 'url', 'tagline', 'short_description', 'medium_description', 'long_description', 'logo_url',
        'screenshot_urls_json', 'demo_video_url', 'categories_json', 'tags_json', 'pricing_model', 'platforms_json',
        'target_user', 'pain_solved', 'competitors_json', 'seed_keywords_json', 'source_code', 'brand_voice_json',
        'changelog_summary', 'workspace_id', 'archived', 'created_at', 'updated_at',
    ],
    order: 20,
    scope: 'core',
};
const contentPiece = {
    recordType: 'content_piece',
    table: 'content_queue',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'type', 'title', 'content', 'status', 'scheduled_at', 'published_at', 'metadata_json',
        'created_at', 'updated_at',
    ],
    order: 30,
    scope: 'content',
    normalize: (row) => ({ ...row, published_at: null }),
    prepareApply: (db, payload) => {
        const productId = String(payload.product_id);
        const runId = `sync-import-${productId}`;
        db.prepare(`INSERT INTO pipeline_runs (
        id, product_id, pipeline_type, trigger, status, input_json, output_json, started_at, completed_at, error_message
      ) VALUES (?, ?, 'SYNC', 'sync', 'completed', '{}', '{}', ?, ?, NULL)
      ON CONFLICT(id) DO NOTHING`).run(runId, productId, Date.now(), Date.now());
        return { ...payload, run_id: runId };
    },
};
const collection = {
    recordType: 'asset_collection',
    table: 'asset_collections',
    idColumns: ['id'],
    columns: ['id', 'product_id', 'parent_id', 'name', 'created_at', 'updated_at'],
    order: 40,
    scope: 'assets',
};
const asset = {
    recordType: 'asset',
    table: 'assets',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'collection_id', 'kind', 'mime_type', 'original_name', 'title', 'description', 'storage',
        'managed', 'size_bytes', 'width', 'height', 'duration_ms', 'checksum', 'tags_json', 'metadata_json', 'created_at',
        'updated_at',
    ],
    order: 50,
    scope: 'assets',
    normalize: (row) => ({ ...row, storage: 'local' }),
    prepareApply: (_db, payload) => ({
        ...payload,
        storage: 'local',
        local_path: null,
        profile_id: null,
        remote_bucket: null,
        remote_key: null,
        public_url: null,
        sync_status: 'local_only',
        sync_error: null,
    }),
};
const designDocument = {
    recordType: 'design_document',
    table: 'design_documents',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'title', 'format', 'template_id', 'width', 'height', 'inputs_json', 'preview_asset_id',
        'created_at', 'updated_at',
    ],
    order: 60,
    scope: 'assets',
};
const storyboard = {
    recordType: 'video_storyboard',
    table: 'video_storyboards',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'pipeline_id', 'format', 'storyboard_json', 'review_json', 'asset_id', 'created_at', 'updated_at',
    ],
    order: 70,
    scope: 'video',
};
const storyboardRevision = {
    recordType: 'video_storyboard_revision',
    table: 'video_storyboard_revisions',
    idColumns: ['storyboard_id', 'revision'],
    columns: ['storyboard_id', 'revision', 'storyboard_json', 'created_at'],
    order: 80,
    scope: 'video',
};
const scheduledPost = {
    recordType: 'schedule_definition',
    table: 'scheduled_posts',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'content_id', 'body', 'media_json', 'scheduled_at', 'timezone', 'status', 'created_at',
        'updated_at',
    ],
    order: 90,
    scope: 'scheduling',
    // Activation is intentionally device-local until an automation owner is assigned.
    normalize: (row) => ({ ...row, status: row.status === 'published' ? 'published' : 'draft' }),
};
const postTarget = {
    recordType: 'post_target',
    table: 'post_targets',
    idColumns: ['id'],
    columns: [
        'id', 'post_id', 'connector_name', 'account_ref', 'body_override', 'first_comment', 'options_json', 'updated_at',
    ],
    order: 100,
    scope: 'scheduling',
    prepareApply: (_db, payload) => ({
        ...payload,
        status: 'pending',
        attempts: 0,
        next_attempt_at: null,
        published_url: null,
        error: null,
    }),
};
const snippet = {
    recordType: 'comment_snippet',
    table: 'comment_snippets',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'name', 'body', 'media_json', 'trigger_json', 'auto_attach_json', 'auto_position',
        'created_at', 'updated_at',
    ],
    order: 110,
    scope: 'scheduling',
    prepareApply: (_db, payload) => ({ ...payload, use_count: 0 }),
};
const pipeline = {
    recordType: 'pipeline_definition',
    table: 'repurpose_pipelines',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'name', 'kind', 'source_platform', 'source_mode', 'source_url', 'file_types_json', 'group_mode',
        'context_note', 'channel_overrides_json', 'poll_interval_hours', 'destination_platforms_json', 'language',
        'content_detail', 'output_format', 'schedule_mode', 'schedule_delay_minutes', 'timezone', 'created_at', 'updated_at',
    ],
    order: 120,
    scope: 'automations',
    prepareApply: (_db, payload) => ({
        ...payload,
        source_account_id: null,
        source_account_name: null,
        milestone_source_id: null,
        watch_folders_json: '[]',
        status: 'paused',
        last_run_at: null,
        next_run_at: null,
        last_run_status: null,
        last_error: null,
        last_source_title: null,
        last_source_url: null,
    }),
};
const tracker = {
    recordType: 'ai_tracker_definition',
    table: 'ai_trackers',
    idColumns: ['id'],
    columns: [
        'id', 'product_id', 'name', 'brand_variants_json', 'engines_json', 'source', 'location', 'language', 'geo_target',
        'schedule_days', 'created_at', 'updated_at',
    ],
    order: 130,
    scope: 'automations',
    prepareApply: (_db, payload) => ({ ...payload, last_run_at: null, next_run_at: null }),
};
const trackerTerm = {
    recordType: 'ai_tracker_term',
    table: 'ai_tracker_terms',
    idColumns: ['id'],
    columns: ['id', 'tracker_id', 'term', 'tags_json', 'created_at'],
    order: 140,
    scope: 'automations',
};
const portableSetting = {
    recordType: 'portable_setting',
    table: 'settings',
    idColumns: ['key'],
    columns: ['key', 'value_json', 'updated_at'],
    order: 150,
    scope: 'preferences',
    selectWhere: `key IN ('layout.customizations')`,
};
const automationAssignment = {
    recordType: 'automation_assignment',
    table: 'sync_automation_assignments',
    idColumns: ['space_id', 'workspace_id'],
    columns: ['space_id', 'workspace_id', 'device_id', 'clock_json', 'updated_at'],
    order: 160,
    scope: 'core',
    control: true,
};
const deviceRole = {
    recordType: 'device_role',
    table: 'sync_device_roles',
    idColumns: ['space_id', 'device_id'],
    columns: ['space_id', 'device_id', 'role', 'updated_at'],
    order: 170,
    scope: 'core',
    control: true,
};
exports.MARKETING_RECORD_CATALOG = [
    workspace,
    product,
    contentPiece,
    collection,
    asset,
    designDocument,
    storyboard,
    storyboardRevision,
    scheduledPost,
    postTarget,
    snippet,
    pipeline,
    tracker,
    trackerTerm,
    portableSetting,
    automationAssignment,
    deviceRole,
];
const catalogByType = new Map(exports.MARKETING_RECORD_CATALOG.map((entry) => [entry.recordType, entry]));
function getRecordAdapter(recordType) {
    const adapter = catalogByType.get(recordType);
    if (!adapter)
        throw new types_1.SyncError('unsupported-record-schema', `Unsupported sync record type: ${recordType}`);
    return adapter;
}
function recordId(adapter, row) {
    return adapter.idColumns.map((column) => String(row[column])).join(':');
}
function safePayload(adapter, value) {
    const allowed = new Set(adapter.columns);
    const keys = Object.keys(value);
    if (keys.some((key) => !allowed.has(key)) || adapter.idColumns.some((column) => !(column in value))) {
        throw new types_1.SyncError('tampered', `The ${adapter.recordType} payload contains unsupported fields.`);
    }
    const payload = {};
    for (const column of adapter.columns) {
        const candidate = value[column];
        if (candidate !== undefined && candidate !== null && typeof candidate !== 'string' && typeof candidate !== 'number') {
            throw new types_1.SyncError('tampered', `The ${adapter.recordType} payload has an invalid ${column} value.`);
        }
        if (candidate !== undefined)
            payload[column] = candidate;
    }
    return payload;
}
function scanMarketingRecords(db) {
    const records = [];
    for (const adapter of exports.MARKETING_RECORD_CATALOG) {
        const sql = `SELECT ${adapter.columns.join(', ')} FROM ${adapter.table}${adapter.selectWhere ? ` WHERE ${adapter.selectWhere}` : ''}`;
        const rows = db.prepare(sql).all();
        for (const source of rows) {
            const payload = adapter.normalize ? adapter.normalize(source) : source;
            records.push({
                recordType: adapter.recordType,
                recordId: recordId(adapter, payload),
                schemaVersion: 1,
                payload,
                payloadHash: (0, canonical_1.canonicalHash)(payload),
                modifiedAt: typeof payload.updated_at === 'number' ? payload.updated_at : Number(payload.created_at ?? 0),
                blobRefs: [],
            });
        }
    }
    return records;
}
function applyMarketingRecord(db, recordType, operation, payload, recordIdValue) {
    const adapter = getRecordAdapter(recordType);
    if (operation === 'delete') {
        const parts = recordIdValue.split(':');
        if (parts.length !== adapter.idColumns.length)
            throw new types_1.SyncError('tampered', 'The record identifier is malformed.');
        const where = adapter.idColumns.map((column) => `${column} = ?`).join(' AND ');
        db.prepare(`DELETE FROM ${adapter.table} WHERE ${where}`).run(...parts);
        return;
    }
    if (!payload)
        throw new types_1.SyncError('tampered', 'An upsert operation is missing its payload.');
    const safe = safePayload(adapter, payload);
    const prepared = adapter.prepareApply ? adapter.prepareApply(db, safe) : safe;
    const columns = Object.keys(prepared);
    const values = columns.map((column) => prepared[column]);
    const conflict = adapter.idColumns.join(', ');
    const mutable = columns.filter((column) => !adapter.idColumns.includes(column));
    const updates = mutable.map((column) => `${column} = excluded.${column}`).join(', ');
    db.prepare(`INSERT INTO ${adapter.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(${conflict}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`).run(...values);
}
//# sourceMappingURL=MarketingRecordCatalog.js.map