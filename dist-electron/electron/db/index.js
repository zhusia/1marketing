"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WORKSPACE_ID = void 0;
exports.getDatabasePath = getDatabasePath;
exports.initDatabase = initDatabase;
exports.getDb = getDb;
exports.closeDatabase = closeDatabase;
const path_1 = __importDefault(require("path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const directories_1 = require("../data/directories");
const BackupRestore_1 = require("../services/BackupRestore");
const json_1 = require("../utils/json");
const userDataPath_1 = require("../utils/userDataPath");
let dbInstance = null;
let dbPathInstance = null;
// The permanent "Unnamed" workspace. Always exists, cannot be deleted, and is
// the fallback owner for projects whose workspace is deleted.
exports.DEFAULT_WORKSPACE_ID = 'workspace-default';
const DEFAULT_CONNECTORS = [
    'google_search_console',
    'github',
    'gitlab',
    'claude',
    'openai',
    'dataforseo',
    'pagespeed',
    'ghost',
    'wordpress',
    'devto',
    'hashnode',
    'twitter',
    'linkedin',
    'reddit',
    'telegram',
    'slack',
    'smtp',
    'discord',
    'bluesky',
    'mastodon',
    'pinterest',
    'youtube',
    'instagram',
    'facebook',
    'tiktok',
    'threads',
    'custom_api',
    'google_nlp',
];
const DEFAULT_SETTINGS = {
    activeProductId: null,
    activeWorkspaceId: exports.DEFAULT_WORKSPACE_ID,
    onboardingCompleted: false,
    trialStartedAt: Date.now(),
    subscriptionPlan: 'trial',
    pipeline1AutoMode: false,
    pipeline2Cron: '0 9 * * 1',
    pipeline3Cron: '0 9 * * *',
    notifyEmail: false,
    notifyTelegram: false,
    notifyInApp: true,
    autoPublishEnabled: false,
    telemetryConsentShown: false,
    telemetryOptIn: false,
};
function resolveDatabasePath() {
    return path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), '1marketingtool.db');
}
function getDatabasePath() {
    return dbPathInstance ?? resolveDatabasePath();
}
function createTables(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      tagline TEXT NOT NULL,
      short_description TEXT NOT NULL,
      medium_description TEXT NOT NULL,
      long_description TEXT NOT NULL,
      logo_url TEXT,
      screenshot_urls_json TEXT NOT NULL,
      demo_video_url TEXT,
      categories_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      pricing_model TEXT NOT NULL,
      platforms_json TEXT NOT NULL,
      target_user TEXT NOT NULL,
      pain_solved TEXT NOT NULL,
      competitors_json TEXT NOT NULL,
      seed_keywords_json TEXT NOT NULL DEFAULT '[]',
      repo_path TEXT,
      source_code TEXT NOT NULL DEFAULT '',
      brand_voice_json TEXT NOT NULL DEFAULT '{}',
      changelog_summary TEXT,
      workspace_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_configured',
      config_json TEXT NOT NULL,
      has_secret INTEGER NOT NULL DEFAULT 0,
      last_tested_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_provider_profiles (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      gateway_preset TEXT,
      base_url TEXT NOT NULL,
      default_model TEXT NOT NULL,
      memory_model TEXT,
      max_tokens INTEGER,
      headers_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 0,
      use_with_opencode INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      last_tested_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_provider_profiles_provider ON ai_provider_profiles (provider, sort_order);

    CREATE TABLE IF NOT EXISTS media_provider_profiles (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      credential_source TEXT NOT NULL DEFAULT 'own',
      ai_provider_profile_id TEXT,
      connector_name TEXT,
      environment_key TEXT,
      default_image_model TEXT,
      default_video_model TEXT,
      headers_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      last_tested_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(ai_provider_profile_id) REFERENCES ai_provider_profiles(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_provider_profiles_order
      ON media_provider_profiles (enabled DESC, sort_order ASC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS media_generation_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      product_id TEXT,
      source TEXT NOT NULL,
      profile_id TEXT,
      local_agent_id TEXT,
      provider_adapter_id TEXT,
      provider_job_id TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      submission_attempt INTEGER NOT NULL DEFAULT 0,
      parent_job_id TEXT,
      operation TEXT NOT NULL,
      model_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      request_json TEXT NOT NULL DEFAULT '{}',
      provider_response_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT,
      error_message TEXT,
      cancel_requested_at INTEGER,
      submitted_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL,
      FOREIGN KEY(parent_job_id) REFERENCES media_generation_jobs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_generation_jobs_product_kind
      ON media_generation_jobs (product_id, kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_generation_jobs_status
      ON media_generation_jobs (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      pipeline_type TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      error_message TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS repurpose_pipelines (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'social',
      source_platform TEXT NOT NULL,
      source_mode TEXT NOT NULL DEFAULT 'connected',
      source_url TEXT,
      source_account_id TEXT,
      source_account_name TEXT,
      milestone_source_id TEXT,
      watch_folders_json TEXT NOT NULL DEFAULT '[]',
      file_types_json TEXT NOT NULL DEFAULT '[]',
      group_mode TEXT NOT NULL DEFAULT 'file',
      context_note TEXT,
      channel_overrides_json TEXT NOT NULL DEFAULT '{}',
      poll_interval_hours INTEGER NOT NULL DEFAULT 6,
      destination_platforms_json TEXT NOT NULL DEFAULT '[]',
      language TEXT NOT NULL DEFAULT 'en',
      content_detail TEXT NOT NULL DEFAULT 'balanced',
      output_format TEXT NOT NULL DEFAULT 'plaintext',
      schedule_mode TEXT NOT NULL DEFAULT 'draft',
      schedule_delay_minutes INTEGER NOT NULL DEFAULT 60,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'paused',
      last_run_at INTEGER,
      next_run_at INTEGER,
      last_run_status TEXT,
      last_error TEXT,
      last_source_title TEXT,
      last_source_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repurpose_pipeline_sources (
      pipeline_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_url TEXT,
      processed_at INTEGER NOT NULL,
      PRIMARY KEY (pipeline_id, source_id),
      FOREIGN KEY(pipeline_id) REFERENCES repurpose_pipelines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repurpose_pipeline_runs (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      pipeline_name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'social',
      source_platform TEXT NOT NULL,
      source_account_id TEXT,
      source_account_name TEXT,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      fetched_posts INTEGER NOT NULL DEFAULT 0,
      processed_posts INTEGER NOT NULL DEFAULT 0,
      generated_content_items INTEGER NOT NULL DEFAULT 0,
      scheduled_posts INTEGER NOT NULL DEFAULT 0,
      source_title TEXT,
      source_url TEXT,
      content_run_ids_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS content_queue (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_at INTEGER,
      published_at INTEGER,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(run_id) REFERENCES pipeline_runs(id)
    );

    CREATE TABLE IF NOT EXISTS publish_history (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      published_url TEXT,
      published_at INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      FOREIGN KEY(content_id) REFERENCES content_queue(id)
    );

    CREATE TABLE IF NOT EXISTS rank_snapshots (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      position INTEGER NOT NULL,
      clicks INTEGER NOT NULL,
      impressions INTEGER NOT NULL,
      ctr REAL NOT NULL,
      source TEXT NOT NULL,
      date TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS rank_alerts (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      old_position INTEGER NOT NULL,
      new_position INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS seo_opportunities (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      type TEXT NOT NULL,
      score REAL NOT NULL,
      brief TEXT NOT NULL,
      status TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS directories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      da INTEGER NOT NULL,
      method TEXT NOT NULL,
      niche TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      domain_rating INTEGER,
      url_rating INTEGER,
      backlinks INTEGER,
      backlinks_dofollow_pct INTEGER,
      referring_domains INTEGER,
      referring_domains_dofollow_pct INTEGER,
      free INTEGER NOT NULL,
      active INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS directory_submissions (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      directory_id TEXT NOT NULL,
      directory_name TEXT NOT NULL,
      status TEXT NOT NULL,
      method TEXT NOT NULL,
      submitted_at INTEGER,
      listed_at INTEGER,
      listing_url TEXT,
      rejection_reason TEXT,
      backlink_score INTEGER NOT NULL,
      metadata_json TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(directory_id) REFERENCES directories(id)
    );

    CREATE TABLE IF NOT EXISTS domain_authority (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      domain_rating INTEGER NOT NULL,
      url_rating INTEGER NOT NULL,
      backlinks INTEGER NOT NULL,
      linking_websites INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'ahrefs',
      checked_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_accounts (
      provider TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      profile_url TEXT,
      session_partition TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      last_synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS browser_captures (
      id TEXT PRIMARY KEY,
      matched_product_id TEXT,
      source TEXT NOT NULL,
      hostname TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      page_text TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(matched_product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      content_id TEXT,
      body TEXT NOT NULL,
      media_json TEXT NOT NULL DEFAULT '[]',
      scheduled_at INTEGER,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS post_targets (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      connector_name TEXT NOT NULL,
      account_ref TEXT,
      body_override TEXT,
      first_comment TEXT,
      options_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      published_url TEXT,
      error TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_publish_history (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      connector_name TEXT NOT NULL,
      published_url TEXT,
      published_at INTEGER NOT NULL,
      response_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE
    );

    -- Follow-up comments on a published post. One row per planned comment, ordered by
    -- position within its target. Delays are measured from the PREVIOUS item (the post for
    -- position 0, the prior comment after that) via armed_at, so reordering keeps spacing.
    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      media_json TEXT NOT NULL DEFAULT '[]',
      trigger_json TEXT NOT NULL DEFAULT '{"kind":"immediate"}',
      status TEXT NOT NULL DEFAULT 'pending',
      origin TEXT NOT NULL DEFAULT 'composed',
      source_snippet_id TEXT,
      artifact_id TEXT,
      remote_comment_id TEXT,
      remote_parent_id TEXT,
      provider_metadata_json TEXT NOT NULL DEFAULT '{}',
      published_url TEXT,
      published_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_check_at INTEGER,
      armed_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(target_id) REFERENCES post_targets(id) ON DELETE CASCADE,
      FOREIGN KEY(post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE
    );

    -- Reusable comment blocks ("Contact info", "Book a demo"). auto_attach_json lists the
    -- channels this block is added to automatically on every new post for the product.
    CREATE TABLE IF NOT EXISTS comment_snippets (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      media_json TEXT NOT NULL DEFAULT '[]',
      trigger_json TEXT NOT NULL DEFAULT '{"kind":"delay","duration":90,"unit":"second"}',
      auto_attach_json TEXT NOT NULL DEFAULT '[]',
      auto_position INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS distribution_events (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      connector_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      post_id TEXT,
      target_id TEXT,
      message TEXT NOT NULL,
      published_url TEXT,
      error TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS distribution_post_artifacts (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      scheduled_post_id TEXT NOT NULL,
      content_id TEXT,
      product_id TEXT NOT NULL,
      connector_name TEXT NOT NULL,
      account_ref TEXT,
      remote_account_id TEXT NOT NULL DEFAULT '',
      remote_account_name TEXT,
      remote_post_id TEXT NOT NULL,
      remote_parent_id TEXT,
      remote_url TEXT,
      artifact_kind TEXT NOT NULL,
      artifact_index INTEGER NOT NULL DEFAULT 0,
      published_at INTEGER NOT NULL,
      identity_source TEXT NOT NULL,
      mapping_status TEXT NOT NULL DEFAULT 'resolved',
      provider_metadata_json TEXT NOT NULL DEFAULT '{}',
      last_checked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(target_id) REFERENCES post_targets(id) ON DELETE CASCADE,
      FOREIGN KEY(scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id),
      UNIQUE(connector_name, remote_account_id, remote_post_id)
    );

    CREATE TABLE IF NOT EXISTS distribution_metric_snapshots (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      provider_updated_at INTEGER,
      source TEXT NOT NULL,
      quality TEXT NOT NULL,
      impressions INTEGER,
      views INTEGER,
      reach INTEGER,
      engagements INTEGER,
      reactions INTEGER,
      likes INTEGER,
      comments INTEGER,
      shares INTEGER,
      reposts INTEGER,
      quotes INTEGER,
      saves INTEGER,
      clicks INTEGER,
      link_clicks INTEGER,
      video_starts INTEGER,
      watch_time_seconds REAL,
      average_watch_seconds REAL,
      average_watch_percentage REAL,
      extra_metrics_json TEXT NOT NULL DEFAULT '{}',
      definition_version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(artifact_id) REFERENCES distribution_post_artifacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS distribution_metric_daily (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      account_timezone TEXT NOT NULL DEFAULT 'UTC',
      source TEXT NOT NULL,
      impressions INTEGER,
      views INTEGER,
      reach INTEGER,
      engagements INTEGER,
      reactions INTEGER,
      likes INTEGER,
      comments INTEGER,
      shares INTEGER,
      reposts INTEGER,
      quotes INTEGER,
      saves INTEGER,
      clicks INTEGER,
      link_clicks INTEGER,
      video_starts INTEGER,
      watch_time_seconds REAL,
      average_watch_seconds REAL,
      average_watch_percentage REAL,
      extra_metrics_json TEXT NOT NULL DEFAULT '{}',
      definition_version INTEGER NOT NULL DEFAULT 1,
      observed_at INTEGER NOT NULL,
      FOREIGN KEY(artifact_id) REFERENCES distribution_post_artifacts(id) ON DELETE CASCADE,
      UNIQUE(artifact_id, metric_date, source)
    );

    CREATE TABLE IF NOT EXISTS distribution_conversation_snapshots (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      audience_top_level_count INTEGER,
      total_reply_count INTEGER,
      owned_reply_count INTEGER,
      answered_thread_count INTEGER,
      unanswered_thread_count INTEGER,
      oldest_unanswered_at INTEGER,
      median_first_response_seconds REAL,
      coverage_complete INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      FOREIGN KEY(artifact_id) REFERENCES distribution_post_artifacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS distribution_account_metric_daily (
      id TEXT PRIMARY KEY,
      connector_name TEXT NOT NULL,
      account_ref TEXT NOT NULL DEFAULT '',
      metric_date TEXT NOT NULL,
      account_timezone TEXT NOT NULL DEFAULT 'UTC',
      profile_views INTEGER,
      followers INTEGER,
      followers_gained INTEGER,
      followers_lost INTEGER,
      impressions INTEGER,
      reach INTEGER,
      engagements INTEGER,
      source TEXT NOT NULL,
      definition_version INTEGER NOT NULL DEFAULT 1,
      observed_at INTEGER NOT NULL,
      UNIQUE(connector_name, account_ref, metric_date, source)
    );

    CREATE TABLE IF NOT EXISTS distribution_performance_sync_runs (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      requested_connectors_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      artifacts_considered INTEGER NOT NULL DEFAULT 0,
      artifacts_succeeded INTEGER NOT NULL DEFAULT 0,
      artifacts_skipped INTEGER NOT NULL DEFAULT 0,
      artifacts_failed INTEGER NOT NULL DEFAULT 0,
      api_request_count INTEGER NOT NULL DEFAULT 0,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      next_retry_at INTEGER,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_product_status ON scheduled_posts (product_id, status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON scheduled_posts (status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_post_targets_post ON post_targets (post_id, status);
    CREATE INDEX IF NOT EXISTS idx_post_publish_history_post ON post_publish_history (post_id, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_post_comments_target ON post_comments (target_id, position);
    CREATE INDEX IF NOT EXISTS idx_post_comments_pending ON post_comments (status, next_check_at);
    CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, position);
    CREATE INDEX IF NOT EXISTS idx_comment_snippets_product ON comment_snippets (product_id, use_count DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_events_created ON distribution_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_events_product_created ON distribution_events (product_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_events_connector_created ON distribution_events (connector_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_events_type_status ON distribution_events (event_type, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_artifacts_target ON distribution_post_artifacts (target_id);
    CREATE INDEX IF NOT EXISTS idx_distribution_artifacts_product_published ON distribution_post_artifacts (product_id, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_artifacts_connector_published ON distribution_post_artifacts (connector_name, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_artifacts_mapping ON distribution_post_artifacts (mapping_status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_metric_snapshots_artifact ON distribution_metric_snapshots (artifact_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_metric_daily_artifact_date ON distribution_metric_daily (artifact_id, metric_date);
    CREATE INDEX IF NOT EXISTS idx_distribution_conversations_artifact ON distribution_conversation_snapshots (artifact_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_distribution_account_metrics_date ON distribution_account_metric_daily (connector_name, account_ref, metric_date);
    CREATE INDEX IF NOT EXISTS idx_distribution_sync_runs_started ON distribution_performance_sync_runs (started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_queue_product_status ON content_queue (product_id, status);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_product_type ON pipeline_runs (product_id, pipeline_type);
    CREATE INDEX IF NOT EXISTS idx_repurpose_pipelines_product ON repurpose_pipelines (product_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_repurpose_pipelines_due ON repurpose_pipelines (status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_repurpose_pipeline_runs_product ON repurpose_pipeline_runs (product_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_repurpose_pipeline_runs_pipeline ON repurpose_pipeline_runs (pipeline_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rank_snapshots_product_keyword_date ON rank_snapshots (product_id, keyword, date);
    CREATE INDEX IF NOT EXISTS idx_rank_alerts_product_ack ON rank_alerts (product_id, acknowledged);
    CREATE INDEX IF NOT EXISTS idx_directory_submissions_product_status ON directory_submissions (product_id, status);
    CREATE INDEX IF NOT EXISTS idx_seo_opportunities_product_status ON seo_opportunities (product_id, status);
    CREATE INDEX IF NOT EXISTS idx_domain_authority_product_date ON domain_authority (product_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_accounts_status ON automation_accounts (status);
    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      product_id TEXT,
      summary TEXT NOT NULL,
      items_succeeded INTEGER NOT NULL DEFAULT 0,
      items_failed INTEGER NOT NULL DEFAULT 0,
      details_json TEXT NOT NULL DEFAULT '{}',
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_spaces (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode = 'encrypted'),
      durable_transport TEXT CHECK (durable_transport IN ('folder', 's3') OR durable_transport IS NULL),
      nearby_enabled INTEGER NOT NULL DEFAULT 0,
      local_device_id TEXT NOT NULL,
      local_device_name TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      product_schema_version INTEGER NOT NULL,
      manifest_hash TEXT NOT NULL,
      blob_policy TEXT NOT NULL DEFAULT 'on-demand'
        CHECK (blob_policy IN ('metadata-only', 'on-demand', 'keep-all')),
      sync_mode TEXT NOT NULL DEFAULT 'auto' CHECK (sync_mode IN ('auto', 'review')),
      disabled_scopes_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_sync_at INTEGER,
      last_error_code TEXT,
      last_error_detail TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_transports (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('folder', 'lan', 's3')),
      config_json TEXT NOT NULL DEFAULT '{}',
      secret_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_health_status TEXT,
      last_health_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_clocks (
      space_id TEXT PRIMARY KEY REFERENCES sync_spaces(id) ON DELETE CASCADE,
      wall INTEGER NOT NULL DEFAULT 0,
      counter INTEGER NOT NULL DEFAULT 0,
      next_seq INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sync_record_state (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      content_hash TEXT,
      payload_json TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
      base_clock_json TEXT,
      revives_clock_json TEXT,
      clock_wall INTEGER NOT NULL,
      clock_counter INTEGER NOT NULL,
      origin_device_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, record_type, record_id)
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      device_seq INTEGER NOT NULL,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      record_schema_version INTEGER NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
      base_clock_json TEXT,
      revives_clock_json TEXT,
      payload_json TEXT,
      payload_hash TEXT NOT NULL,
      blob_refs_json TEXT NOT NULL DEFAULT '[]',
      clock_wall INTEGER NOT NULL,
      clock_counter INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      batch_id TEXT,
      written_at INTEGER,
      UNIQUE (space_id, device_seq)
    );

    CREATE TABLE IF NOT EXISTS sync_outbound_batches (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      origin_device_id TEXT NOT NULL,
      first_seq INTEGER NOT NULL,
      last_seq INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      encrypted_bytes BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      written_at INTEGER,
      PRIMARY KEY (space_id, batch_id)
    );

    CREATE TABLE IF NOT EXISTS sync_batches (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      origin_device_id TEXT NOT NULL,
      first_seq INTEGER NOT NULL,
      last_seq INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      ingested_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, batch_id)
    );

    CREATE TABLE IF NOT EXISTS sync_applied_operations (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, operation_id)
    );

    CREATE TABLE IF NOT EXISTS sync_devices (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      display_name TEXT,
      platform TEXT,
      app_version TEXT,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      last_transport TEXT CHECK (last_transport IN ('folder', 'lan', 's3') OR last_transport IS NULL),
      retired_at INTEGER,
      PRIMARY KEY (space_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS sync_acknowledgements (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      acknowledging_device_id TEXT NOT NULL,
      origin_device_id TEXT NOT NULL,
      last_contiguous_seq INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, acknowledging_device_id, origin_device_id)
    );

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      local_payload_json TEXT,
      remote_payload_json TEXT,
      local_clock_json TEXT NOT NULL,
      remote_clock_json TEXT NOT NULL,
      local_device_id TEXT NOT NULL,
      remote_device_id TEXT NOT NULL,
      winning_side TEXT NOT NULL CHECK (winning_side IN ('local', 'remote')),
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved', 'dismissed')),
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_blob_state (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      blob_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      plaintext_hash TEXT NOT NULL,
      chunk_size INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      local_state TEXT NOT NULL,
      remote_state TEXT NOT NULL,
      local_path TEXT,
      transferred_bytes INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      verified_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, blob_id)
    );

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL,
      transport TEXT CHECK (transport IN ('folder', 'lan', 's3') OR transport IS NULL),
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'cancelled', 'noop')),
      pulled_operations INTEGER NOT NULL DEFAULT 0,
      pushed_operations INTEGER NOT NULL DEFAULT 0,
      transferred_bytes INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_lan_peers (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT,
      endpoints_json TEXT NOT NULL DEFAULT '[]',
      secret_ref TEXT NOT NULL,
      confirmed_at INTEGER,
      revoked_at INTEGER,
      next_out_seq INTEGER NOT NULL DEFAULT 1,
      last_in_seq INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS sync_lan_inbox (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      origin_device_id TEXT NOT NULL,
      first_seq INTEGER NOT NULL,
      last_seq INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      encrypted_bytes BLOB NOT NULL,
      received_from_device_id TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      processed_at INTEGER,
      PRIMARY KEY (space_id, batch_id)
    );

    CREATE TABLE IF NOT EXISTS sync_lan_blob_inbox (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      blob_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      encrypted_bytes BLOB NOT NULL,
      file_hash TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, blob_id, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS sync_automation_assignments (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      device_id TEXT,
      clock_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS sync_device_roles (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS sync_staged_operations (
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      origin_device_id TEXT NOT NULL,
      device_seq INTEGER NOT NULL,
      operation_json TEXT NOT NULL,
      staged_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, operation_id)
    );

    CREATE TABLE IF NOT EXISTS sync_execution_claims (
      occurrence_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      completed_at INTEGER,
      outcome TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_transports_space ON sync_transports (space_id, enabled, kind);
    CREATE INDEX IF NOT EXISTS idx_sync_record_state_updated ON sync_record_state (space_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox (space_id, written_at, device_seq);
    CREATE INDEX IF NOT EXISTS idx_sync_outbound_pending ON sync_outbound_batches (space_id, written_at, first_seq);
    CREATE INDEX IF NOT EXISTS idx_sync_batches_origin ON sync_batches (space_id, origin_device_id, first_seq);
    CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts (space_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_jobs_history ON sync_jobs (space_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_blob_state_status ON sync_blob_state (space_id, local_state, remote_state);
    CREATE INDEX IF NOT EXISTS idx_sync_lan_inbox_pending ON sync_lan_inbox (space_id, processed_at, received_at);
    CREATE INDEX IF NOT EXISTS idx_sync_lan_blob_inbox ON sync_lan_blob_inbox (space_id, blob_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_sync_staged_origin ON sync_staged_operations (space_id, origin_device_id, device_seq);

    CREATE TABLE IF NOT EXISTS ai_logs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      agent TEXT NOT NULL,
      tool TEXT,
      transport TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      product_id TEXT,
      duration_ms INTEGER,
      exit_code INTEGER,
      tokens INTEGER,
      tokens_input INTEGER,
      tokens_output INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_logs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      summary TEXT NOT NULL,
      detail TEXT,
      request_body TEXT,
      response_body TEXT,
      cost REAL,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indexnow_submissions (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      product_id TEXT,
      host TEXT NOT NULL,
      url TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      submit_status TEXT NOT NULL,
      http_status INTEGER,
      submitted_at INTEGER NOT NULL,
      index_status TEXT NOT NULL DEFAULT 'unknown',
      indexed_at INTEGER,
      index_checked_at INTEGER,
      index_detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_indexnow_product_submitted ON indexnow_submissions (product_id, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS google_index_requests (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      product_id TEXT,
      property_url TEXT NOT NULL,
      url TEXT NOT NULL,
      request_type TEXT NOT NULL,
      submit_status TEXT NOT NULL,
      notify_time TEXT,
      submitted_at INTEGER NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_google_index_product_submitted ON google_index_requests (product_id, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS google_index_inspections (
      property_url TEXT NOT NULL,
      url TEXT NOT NULL,
      product_id TEXT,
      verdict TEXT NOT NULL,
      coverage_state TEXT NOT NULL,
      indexing_state TEXT NOT NULL,
      last_crawl_time TEXT,
      inspection_link TEXT NOT NULL,
      error TEXT,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (property_url, url)
    );
    CREATE INDEX IF NOT EXISTS idx_google_index_inspection_product ON google_index_inspections (product_id);

    CREATE TABLE IF NOT EXISTS keyword_planner_cache (
      cache_key TEXT PRIMARY KEY,
      location TEXT NOT NULL,
      currency TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_collections (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      parent_id TEXT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS storage_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      endpoint TEXT,
      region TEXT NOT NULL DEFAULT 'auto',
      bucket TEXT NOT NULL,
      prefix TEXT,
      public_base_url TEXT,
      force_path_style INTEGER NOT NULL DEFAULT 0,
      has_secret INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      collection_id TEXT,
      kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      title TEXT,
      description TEXT,
      storage TEXT NOT NULL DEFAULT 'local',
      managed INTEGER NOT NULL DEFAULT 0,
      local_path TEXT,
      profile_id TEXT,
      remote_bucket TEXT,
      remote_key TEXT,
      public_url TEXT,
      size_bytes INTEGER,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      checksum TEXT,
      sync_status TEXT NOT NULL DEFAULT 'local_only',
      sync_error TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(collection_id) REFERENCES asset_collections(id),
      FOREIGN KEY(profile_id) REFERENCES storage_profiles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_storage_profiles_default ON storage_profiles (is_default, enabled);
    CREATE INDEX IF NOT EXISTS idx_assets_product_kind ON assets (product_id, kind);
    CREATE INDEX IF NOT EXISTS idx_assets_collection ON assets (collection_id);
    CREATE INDEX IF NOT EXISTS idx_assets_sync ON assets (sync_status);
    CREATE INDEX IF NOT EXISTS idx_asset_collections_product ON asset_collections (product_id, parent_id);

    CREATE TABLE IF NOT EXISTS media_generation_outputs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      asset_id TEXT,
      ordinal INTEGER NOT NULL,
      provider_output_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(job_id) REFERENCES media_generation_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL,
      UNIQUE(job_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_media_generation_outputs_job
      ON media_generation_outputs (job_id, ordinal ASC);

    CREATE TABLE IF NOT EXISTS design_documents (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      title TEXT NOT NULL,
      format TEXT NOT NULL,
      template_id TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      inputs_json TEXT NOT NULL DEFAULT '{}',
      preview_asset_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(preview_asset_id) REFERENCES assets(id)
    );

    CREATE INDEX IF NOT EXISTS idx_design_docs_product ON design_documents (product_id, format);

    CREATE TABLE IF NOT EXISTS video_storyboards (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      pipeline_id TEXT NOT NULL,
      format TEXT NOT NULL,
      storyboard_json TEXT NOT NULL,
      review_json TEXT,
      asset_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(asset_id) REFERENCES assets(id)
    );

    CREATE TABLE IF NOT EXISTS video_runs (
      id TEXT PRIMARY KEY,
      storyboard_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      pending_gate TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      context_json TEXT NOT NULL DEFAULT '{}',
      provider_selection_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(storyboard_id) REFERENCES video_storyboards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS video_storyboard_revisions (
      storyboard_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      storyboard_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (storyboard_id, revision),
      FOREIGN KEY(storyboard_id) REFERENCES video_storyboards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_video_storyboards_product ON video_storyboards (product_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_runs_storyboard ON video_runs (storyboard_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_browser_captures_created ON browser_captures (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_browser_captures_product_created ON browser_captures (matched_product_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_created ON sync_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_source_created ON sync_logs (source, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_kind_created ON ai_logs (kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_logs_provider_created ON api_logs (provider, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_trackers (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brand_variants_json TEXT NOT NULL DEFAULT '[]',
      engines_json TEXT NOT NULL DEFAULT '["ai_overview"]',
      source TEXT NOT NULL DEFAULT 'dataforseo',
      location TEXT NOT NULL DEFAULT 'United States',
      language TEXT NOT NULL DEFAULT 'English',
      geo_target TEXT,
      schedule_days INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS ai_tracker_terms (
      id TEXT PRIMARY KEY,
      tracker_id TEXT NOT NULL,
      term TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(tracker_id) REFERENCES ai_trackers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_tracker_snapshots (
      id TEXT PRIMARY KEY,
      tracker_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      cost REAL,
      status TEXT NOT NULL DEFAULT 'complete',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(tracker_id) REFERENCES ai_trackers(id) ON DELETE CASCADE,
      UNIQUE(tracker_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS ai_tracker_results (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      term_id TEXT NOT NULL,
      term TEXT NOT NULL,
      engine TEXT NOT NULL,
      fetch_source TEXT NOT NULL,
      response_text TEXT,
      response_hash TEXT,
      found INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(snapshot_id) REFERENCES ai_tracker_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_tracker_mentions (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      is_self INTEGER NOT NULL DEFAULT 0,
      position INTEGER,
      snippet TEXT,
      sentiment REAL,
      FOREIGN KEY(result_id) REFERENCES ai_tracker_results(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_tracker_citations (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      title TEXT,
      brands_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY(result_id) REFERENCES ai_tracker_results(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_trackers_product ON ai_trackers (product_id);
    CREATE INDEX IF NOT EXISTS idx_ai_trackers_due ON ai_trackers (schedule_days, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_ai_tracker_terms_tracker ON ai_tracker_terms (tracker_id);
    CREATE INDEX IF NOT EXISTS idx_ai_tracker_snapshots_tracker_date ON ai_tracker_snapshots (tracker_id, snapshot_date DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_tracker_results_snapshot ON ai_tracker_results (snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_ai_tracker_mentions_result ON ai_tracker_mentions (result_id);
    CREATE INDEX IF NOT EXISTS idx_ai_tracker_citations_result ON ai_tracker_citations (result_id);

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      mentions_json TEXT NOT NULL DEFAULT '[]',
      actions_json TEXT NOT NULL DEFAULT '[]',
      tool_calls_json TEXT NOT NULL DEFAULT '[]',
      provider TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_conversations_project ON chat_conversations (project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS site_audit_runs (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      root_url TEXT NOT NULL,
      host TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      config_json TEXT NOT NULL DEFAULT '{}',
      pages_crawled INTEGER NOT NULL DEFAULT 0,
      pages_total INTEGER NOT NULL DEFAULT 0,
      issues_high INTEGER NOT NULL DEFAULT 0,
      issues_medium INTEGER NOT NULL DEFAULT 0,
      issues_low INTEGER NOT NULL DEFAULT 0,
      health_score INTEGER,
      error TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS site_audit_pages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      url TEXT NOT NULL,
      status_code INTEGER NOT NULL DEFAULT 0,
      redirect_url TEXT,
      title TEXT NOT NULL DEFAULT '',
      meta_description TEXT NOT NULL DEFAULT '',
      canonical TEXT,
      robots_meta TEXT,
      h1_count INTEGER NOT NULL DEFAULT 0,
      h2_count INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      images_total INTEGER NOT NULL DEFAULT 0,
      images_missing_alt INTEGER NOT NULL DEFAULT 0,
      internal_links INTEGER NOT NULL DEFAULT 0,
      external_links INTEGER NOT NULL DEFAULT 0,
      has_structured_data INTEGER NOT NULL DEFAULT 0,
      has_viewport INTEGER NOT NULL DEFAULT 0,
      is_indexable INTEGER NOT NULL DEFAULT 1,
      response_time_ms INTEGER NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(run_id) REFERENCES site_audit_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_audit_issues (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      code TEXT NOT NULL,
      severity TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      examples_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY(run_id) REFERENCES site_audit_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_site_audit_runs_product ON site_audit_runs (product_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_site_audit_pages_run ON site_audit_pages (run_id);
    CREATE INDEX IF NOT EXISTS idx_site_audit_issues_run ON site_audit_issues (run_id);

    CREATE TABLE IF NOT EXISTS prompt_explorer_runs (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      prompt TEXT NOT NULL,
      brand TEXT,
      competitors_json TEXT NOT NULL DEFAULT '[]',
      share_json TEXT NOT NULL DEFAULT '[]',
      model_count INTEGER NOT NULL DEFAULT 0,
      brand_mention_total INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_explorer_models (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      model_label TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      answer TEXT,
      error TEXT,
      brand_mentions INTEGER NOT NULL DEFAULT 0,
      competitor_mentions_json TEXT NOT NULL DEFAULT '{}',
      response_ms INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(run_id) REFERENCES prompt_explorer_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_explorer_runs_product ON prompt_explorer_runs (product_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prompt_explorer_models_run ON prompt_explorer_models (run_id);

    -- Alert inbox. product_id/workspace_id are deliberately unconstrained: an alert is a log entry
    -- that must survive its subject being deleted, and a FK would block project deletion.
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      product_id TEXT,
      workspace_id TEXT,
      route_json TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      dedupe_key TEXT,
      read_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (read_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications (dedupe_key, created_at DESC);
  `);
}
function hasColumn(db, table, column) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((row) => row.name === column);
}
function migrateSchema(db) {
    if (!hasColumn(db, 'sync_blob_state', 'record_type')) {
        db.exec(`ALTER TABLE sync_blob_state ADD COLUMN record_type TEXT NOT NULL DEFAULT 'asset'`);
    }
    if (!hasColumn(db, 'sync_blob_state', 'record_id')) {
        db.exec(`ALTER TABLE sync_blob_state ADD COLUMN record_id TEXT NOT NULL DEFAULT ''`);
    }
    if (!hasColumn(db, 'sync_spaces', 'sync_mode')) {
        db.exec(`ALTER TABLE sync_spaces ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'auto' CHECK (sync_mode IN ('auto', 'review'))`);
    }
    if (!hasColumn(db, 'sync_spaces', 'disabled_scopes_json')) {
        db.exec(`ALTER TABLE sync_spaces ADD COLUMN disabled_scopes_json TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'source_account_id')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN source_account_id TEXT`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'source_account_name')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN source_account_name TEXT`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'source_mode')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'connected'`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'source_url')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN source_url TEXT`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'milestone_source_id')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN milestone_source_id TEXT`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'kind')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN kind TEXT NOT NULL DEFAULT 'social'`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'watch_folders_json')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN watch_folders_json TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'file_types_json')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN file_types_json TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'context_note')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN context_note TEXT`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'channel_overrides_json')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN channel_overrides_json TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!hasColumn(db, 'repurpose_pipelines', 'group_mode')) {
        db.exec(`ALTER TABLE repurpose_pipelines ADD COLUMN group_mode TEXT NOT NULL DEFAULT 'file'`);
    }
    if (!hasColumn(db, 'repurpose_pipeline_runs', 'source_account_id')) {
        db.exec(`ALTER TABLE repurpose_pipeline_runs ADD COLUMN source_account_id TEXT`);
    }
    if (!hasColumn(db, 'repurpose_pipeline_runs', 'source_account_name')) {
        db.exec(`ALTER TABLE repurpose_pipeline_runs ADD COLUMN source_account_name TEXT`);
    }
    if (!hasColumn(db, 'repurpose_pipeline_runs', 'kind')) {
        db.exec(`ALTER TABLE repurpose_pipeline_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'social'`);
    }
    if (!hasColumn(db, 'repurpose_pipeline_runs', 'content_run_ids_json')) {
        db.exec(`ALTER TABLE repurpose_pipeline_runs ADD COLUMN content_run_ids_json TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!hasColumn(db, 'media_generation_jobs', 'submission_attempt')) {
        db.exec(`ALTER TABLE media_generation_jobs ADD COLUMN submission_attempt INTEGER NOT NULL DEFAULT 0`);
    }
    if (!hasColumn(db, 'media_generation_jobs', 'parent_job_id')) {
        db.exec(`ALTER TABLE media_generation_jobs ADD COLUMN parent_job_id TEXT`);
    }
    if (!hasColumn(db, 'products', 'source_code')) {
        db.exec(`ALTER TABLE products ADD COLUMN source_code TEXT NOT NULL DEFAULT ''`);
    }
    if (!hasColumn(db, 'products', 'brand_voice_json')) {
        db.exec(`ALTER TABLE products ADD COLUMN brand_voice_json TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!hasColumn(db, 'products', 'seed_keywords_json')) {
        db.exec(`ALTER TABLE products ADD COLUMN seed_keywords_json TEXT NOT NULL DEFAULT '[]'`);
    }
    const directoryColumns = [
        { name: 'category', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'description', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'domain_rating', definition: 'INTEGER' },
        { name: 'url_rating', definition: 'INTEGER' },
        { name: 'backlinks', definition: 'INTEGER' },
        { name: 'backlinks_dofollow_pct', definition: 'INTEGER' },
        { name: 'referring_domains', definition: 'INTEGER' },
        { name: 'referring_domains_dofollow_pct', definition: 'INTEGER' },
    ];
    for (const column of directoryColumns) {
        if (!hasColumn(db, 'directories', column.name)) {
            db.exec(`ALTER TABLE directories ADD COLUMN ${column.name} ${column.definition}`);
        }
    }
    if (!hasColumn(db, 'api_logs', 'request_body')) {
        db.exec(`ALTER TABLE api_logs ADD COLUMN request_body TEXT`);
    }
    if (!hasColumn(db, 'api_logs', 'response_body')) {
        db.exec(`ALTER TABLE api_logs ADD COLUMN response_body TEXT`);
    }
    if (!hasColumn(db, 'chat_messages', 'tool_calls_json')) {
        db.exec(`ALTER TABLE chat_messages ADD COLUMN tool_calls_json TEXT NOT NULL DEFAULT '[]'`);
    }
    // Per-target publish options (e.g. YouTube { short: true }). Generic JSON bag so future
    // per-post platform settings (TikTok postMode, per-post Page override, …) reuse the column.
    if (!hasColumn(db, 'post_targets', 'options_json')) {
        db.exec(`ALTER TABLE post_targets ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}'`);
    }
    // AI logs gained an input/output token breakdown; existing rows keep the
    // single `tokens` total and leave the split columns null.
    if (!hasColumn(db, 'ai_logs', 'tokens_input')) {
        db.exec(`ALTER TABLE ai_logs ADD COLUMN tokens_input INTEGER`);
    }
    if (!hasColumn(db, 'ai_logs', 'tokens_output')) {
        db.exec(`ALTER TABLE ai_logs ADD COLUMN tokens_output INTEGER`);
    }
    // Workspaces: every project belongs to one workspace; deleting a workspace
    // reassigns its projects to the permanent "Unnamed" default rather than
    // destroying them. Guard each step so re-running is a no-op.
    if (!hasColumn(db, 'products', 'workspace_id')) {
        db.exec(`ALTER TABLE products ADD COLUMN workspace_id TEXT`);
    }
    const timestamp = Date.now();
    db.prepare(`
    INSERT INTO workspaces (id, name, color, is_default, sort_order, created_at, updated_at)
    VALUES (@id, 'Unnamed', NULL, 1, 0, @timestamp, @timestamp)
    ON CONFLICT(id) DO NOTHING
  `).run({ id: exports.DEFAULT_WORKSPACE_ID, timestamp });
    db.prepare(`UPDATE products SET workspace_id = @id WHERE workspace_id IS NULL OR workspace_id = ''`).run({ id: exports.DEFAULT_WORKSPACE_ID });
    // Created here rather than in createTables() because the workspace_id column
    // only exists after the ALTER TABLE above runs on pre-existing databases.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_workspace ON products (workspace_id)`);
}
function seedDirectories(db) {
    const stmt = db.prepare(`
    INSERT INTO directories (
      id,
      name,
      url,
      da,
      method,
      niche,
      category,
      description,
      domain_rating,
      url_rating,
      backlinks,
      backlinks_dofollow_pct,
      referring_domains,
      referring_domains_dofollow_pct,
      free,
      active
    )
    VALUES (
      @id,
      @name,
      @url,
      @da,
      @method,
      @niche,
      @category,
      @description,
      @domainRating,
      @urlRating,
      @backlinks,
      @backlinksDofollowPct,
      @referringDomains,
      @referringDomainsDofollowPct,
      @free,
      @active
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      da = excluded.da,
      method = excluded.method,
      niche = excluded.niche,
      category = excluded.category,
      description = excluded.description,
      domain_rating = excluded.domain_rating,
      url_rating = excluded.url_rating,
      backlinks = excluded.backlinks,
      backlinks_dofollow_pct = excluded.backlinks_dofollow_pct,
      referring_domains = excluded.referring_domains,
      referring_domains_dofollow_pct = excluded.referring_domains_dofollow_pct,
      free = excluded.free,
      active = excluded.active
  `);
    const tx = db.transaction(() => {
        for (const entry of directories_1.DIRECTORY_SEED) {
            stmt.run({
                ...entry,
                free: entry.free ? 1 : 0,
                active: entry.active ? 1 : 0,
            });
        }
        const seedIds = directories_1.DIRECTORY_SEED.map((entry) => entry.id);
        const placeholders = seedIds.map(() => '?').join(', ');
        db.prepare(`UPDATE directories SET active = 0 WHERE id NOT IN (${placeholders})`).run(...seedIds);
    });
    tx();
}
function seedConnectors(db) {
    const now = Date.now();
    const stmt = db.prepare(`
    INSERT INTO connectors (id, name, enabled, status, config_json, has_secret, created_at, updated_at)
    VALUES (@id, @name, 0, 'not_configured', '{}', 0, @createdAt, @updatedAt)
    ON CONFLICT(name) DO NOTHING
  `);
    const tx = db.transaction(() => {
        for (const name of DEFAULT_CONNECTORS) {
            stmt.run({
                id: name,
                name,
                createdAt: now,
                updatedAt: now,
            });
        }
    });
    tx();
}
function seedSettings(db) {
    const stmt = db.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (@key, @valueJson, @updatedAt)
    ON CONFLICT(key) DO NOTHING
  `);
    const tx = db.transaction(() => {
        const updatedAt = Date.now();
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            stmt.run({ key, valueJson: (0, json_1.safeStringify)(value), updatedAt });
        }
    });
    tx();
}
function initDatabase() {
    if (dbInstance)
        return dbInstance;
    const dbPath = resolveDatabasePath();
    (0, BackupRestore_1.processPendingRestore)(path_1.default.dirname(dbPath), dbPath);
    dbPathInstance = dbPath;
    dbInstance = new better_sqlite3_1.default(dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    createTables(dbInstance);
    migrateSchema(dbInstance);
    seedDirectories(dbInstance);
    seedConnectors(dbInstance);
    seedSettings(dbInstance);
    return dbInstance;
}
function getDb() {
    if (!dbInstance) {
        return initDatabase();
    }
    return dbInstance;
}
function closeDatabase() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
        dbPathInstance = null;
    }
}
//# sourceMappingURL=index.js.map