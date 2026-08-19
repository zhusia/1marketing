"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// dist-electron/electron/ipc/channels.js
var require_channels = __commonJS({
  "dist-electron/electron/ipc/channels.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CHANNELS = void 0;
    exports2.CHANNELS = {
      SYSTEM_SELECT_FOLDER: "system:select-folder",
      SYSTEM_SELECT_FILES: "system:select-files",
      SYSTEM_OPEN_EXTERNAL: "system:open-external",
      SYSTEM_REVEAL_PATH: "system:reveal-path",
      SYSTEM_GET_ZOOM: "system:get-zoom",
      SYSTEM_SET_ZOOM: "system:set-zoom",
      SYSTEM_STEP_ZOOM: "system:step-zoom",
      SYSTEM_ZOOM_CHANGED: "system:zoom-changed",
      TASKS_START: "tasks:start",
      TASKS_WAIT: "tasks:wait",
      TASKS_LIST: "tasks:list",
      TASKS_GET: "tasks:get",
      TASKS_CANCEL: "tasks:cancel",
      TASKS_PROGRESS: "tasks:progress",
      DASHBOARD_OVERVIEW: "dashboard:overview",
      DASHBOARD_UNIFIED: "dashboard:unified",
      DASHBOARD_UNIFIED_SYNC: "dashboard:unified-sync",
      DASHBOARD_UNIFIED_SYNC_PROGRESS: "dashboard:unified-sync-progress",
      DASHBOARD_REFRESH_RANKS: "dashboard:refresh-ranks",
      DASHBOARD_ASK: "dashboard:ask",
      DASHBOARD_ASK_PROGRESS: "dashboard:ask-progress",
      PRODUCTS_LIST: "products:list",
      PRODUCTS_GET: "products:get",
      PRODUCTS_FETCH_INFO: "products:fetch-info",
      PRODUCTS_LOOKUP_SITES: "products:lookup-sites",
      AI_FIRST_RUN_RECOMMEND: "ai:first-run-recommend",
      PRODUCTS_CREATE: "products:create",
      PRODUCTS_UPDATE: "products:update",
      PRODUCTS_ARCHIVE: "products:archive",
      PRODUCTS_MOVE: "products:move",
      PRODUCTS_IMPORT_GSC: "products:import-gsc",
      PRODUCTS_IMPORT_GSC_PROGRESS: "products:import-gsc-progress",
      WORKSPACES_LIST: "workspaces:list",
      WORKSPACES_CREATE: "workspaces:create",
      WORKSPACES_UPDATE: "workspaces:update",
      WORKSPACES_DELETE: "workspaces:delete",
      CONNECTORS_LIST: "connectors:list",
      CONNECTORS_UPSERT: "connectors:upsert",
      CONNECTORS_ENABLE: "connectors:enable",
      CONNECTORS_TEST: "connectors:test",
      CONNECTORS_TEST_POST: "connectors:test-post",
      CONNECTORS_DATAFORSEO_ACCOUNT: "connectors:dataforseo-account",
      CONNECTORS_OAUTH_START: "connectors:oauth-start",
      CONNECTORS_OAUTH_COMPLETE: "connectors:oauth-complete",
      CONNECTORS_OAUTH_CANCEL: "connectors:oauth-cancel",
      CONNECTORS_OAUTH_OPEN: "connectors:oauth-open",
      CONNECTORS_OAUTH_URL: "connectors:oauth-url",
      CONNECTORS_BROWSERS: "connectors:browsers",
      CONNECTORS_OAUTH_STATUS: "connectors:oauth-status",
      CONNECTORS_OAUTH_REVOKE: "connectors:oauth-revoke",
      CONNECTORS_GOOGLE_SA_DELETE: "connectors:google-sa-delete",
      CONNECTORS_ANALYZE_PAGE_INDEX: "connectors:analyze-page-index",
      CONNECTORS_PAGE_INDEX_PROGRESS: "connectors:page-index-progress",
      CONNECTORS_SECRET_STATUS: "connectors:secret-status",
      CONNECTORS_SECRET_VALUES: "connectors:secret-values",
      CONNECTORS_PAGES: "connectors:pages",
      CONNECTORS_RESTORE_PROFILE: "connectors:restore-profile",
      CONNECTORS_SET_PROJECT_MAPPING: "connectors:set-project-mapping",
      CONNECTORS_SET_PROJECT_MUTED: "connectors:set-project-muted",
      CONNECTORS_SET_FACEBOOK_MAPPING: "connectors:set-facebook-mapping",
      SYNC_LOGS_LIST: "sync-logs:list",
      SYNC_LOGS_CLEAR: "sync-logs:clear",
      AI_LOGS_LIST: "ai-logs:list",
      AI_LOGS_CLEAR: "ai-logs:clear",
      API_LOGS_LIST: "api-logs:list",
      API_LOGS_COUNT: "api-logs:count",
      API_LOGS_CLEAR: "api-logs:clear",
      CONTENT_LIST: "content:list",
      CONTENT_CREATE: "content:create",
      CONTENT_UPDATE: "content:update",
      CONTENT_APPROVE: "content:approve",
      CONTENT_ARCHIVE: "content:archive",
      CONTENT_DELETE: "content:delete",
      CONTENT_BULK_DELETE: "content:bulk-delete",
      CONTENT_BULK_UPDATE: "content:bulk-update",
      CONTENT_DUPLICATE: "content:duplicate",
      CONTENT_REGENERATE: "content:regenerate",
      CONTENT_SCHEDULE: "content:schedule",
      CONTENT_PUBLISH: "content:publish",
      CONTENT_PUBLISH_HISTORY: "content:publish-history",
      CONTENT_GENERATION_PROGRESS: "content:generation-progress",
      CONTENT_WRITE_FROM_CLUSTER: "content:write-from-cluster",
      ASSETS_LIST: "assets:list",
      ASSETS_GET: "assets:get",
      ASSETS_IMPORT: "assets:import",
      ASSETS_IMPORT_URL: "assets:import-url",
      ASSETS_UPDATE: "assets:update",
      ASSETS_DELETE: "assets:delete",
      ASSETS_DOWNLOAD: "assets:download",
      ASSETS_DOWNLOAD_PATH: "assets:download-path",
      ASSETS_DOWNLOAD_PATHS_ZIP: "assets:download-paths-zip",
      ASSETS_VALIDATE_MEDIA: "assets:validate-media",
      ASSETS_DATA_URL: "assets:data-url",
      ASSETS_PREVIEW_URL: "assets:preview-url",
      ASSET_COLLECTIONS_LIST: "asset-collections:list",
      ASSET_COLLECTIONS_UPSERT: "asset-collections:upsert",
      ASSET_COLLECTIONS_DELETE: "asset-collections:delete",
      VIDEO_SOURCE_FETCH: "video-source:fetch",
      VIDEO_PIPELINES_LIST: "video:pipelines-list",
      VIDEO_RUNS_LIST: "video:runs-list",
      VIDEO_RUN_GET: "video:run-get",
      VIDEO_STORYBOARD_WRITE: "video:storyboard-write",
      VIDEO_STORYBOARD_UPDATE: "video:storyboard-update",
      VIDEO_STORYBOARD_COMMAND: "video:storyboard-command",
      VIDEO_GATE_RESOLVE: "video:gate-resolve",
      VIDEO_COMPOSE_START: "video:compose-start",
      VIDEO_REVIEW_GET: "video:review-get",
      VIDEO_RUN_CANCEL: "video:run-cancel",
      VIDEO_RUN_DISCARD: "video:run-discard",
      VIDEO_REVISION_RESTORE: "video:revision-restore",
      VIDEO_PROGRESS: "video:progress",
      DESIGN_FORMATS: "design:formats",
      DESIGN_TEMPLATES_LIST: "design:templates-list",
      DESIGN_SYSTEMS_LIST: "design:systems-list",
      DESIGN_DOCS_LIST: "design:docs-list",
      DESIGN_DOC_GET: "design:doc-get",
      DESIGN_DOC_DELETE: "design:doc-delete",
      DESIGN_RENDER_PREVIEW: "design:render-preview",
      DESIGN_RENDER_HTML: "design:render-html",
      DESIGN_RENDER_VIDEO: "design:render-video",
      DESIGN_SAVE: "design:save",
      DESIGN_GENERATE: "design:generate",
      DESIGN_FROM_PROMPT: "design:from-prompt",
      DESIGN_REFINE: "design:refine",
      DESIGN_ARTICLE_IMAGES: "design:article-images",
      DESIGN_PROMPT_PROGRESS: "design:prompt-progress",
      DESIGN_IMAGE_GENERATE: "design:image-generate",
      DESIGN_IMAGE_GEN_STATUS: "design:image-gen-status",
      MEDIA_GENERATION_CATALOG: "media-generation:catalog",
      MEDIA_PROVIDERS_LIST: "media-generation:providers-list",
      MEDIA_PROVIDER_SAVE: "media-generation:provider-save",
      MEDIA_PROVIDER_DELETE: "media-generation:provider-delete",
      MEDIA_PROVIDER_SECRET_SAVE: "media-generation:provider-secret-save",
      MEDIA_PROVIDER_SECRET_REMOVE: "media-generation:provider-secret-remove",
      MEDIA_PROVIDER_TEST: "media-generation:provider-test",
      MEDIA_GENERATION_DEFAULTS_GET: "media-generation:defaults-get",
      MEDIA_GENERATION_DEFAULTS_SET: "media-generation:defaults-set",
      MEDIA_GENERATION_JOBS_LIST: "media-generation:jobs-list",
      MEDIA_GENERATION_JOB_GET: "media-generation:job-get",
      MEDIA_GENERATION_CREATE: "media-generation:create",
      MEDIA_GENERATION_CANCEL: "media-generation:cancel",
      MEDIA_GENERATION_DELETE: "media-generation:delete",
      MEDIA_GENERATION_PROGRESS: "media-generation:progress",
      SCHEDULE_LIST: "schedule:list",
      SCHEDULE_GET: "schedule:get",
      SCHEDULE_UPSERT: "schedule:upsert",
      SCHEDULE_RESCHEDULE: "schedule:reschedule",
      SCHEDULE_CANCEL: "schedule:cancel",
      SCHEDULE_DELETE: "schedule:delete",
      SCHEDULE_PUBLISH_NOW: "schedule:publish-now",
      SCHEDULE_PLATFORMS: "schedule:platforms",
      COMMENTS_LIST_FOR_POST: "comments:list-for-post",
      COMMENTS_LIST_FOR_PRODUCT: "comments:list-for-product",
      COMMENTS_DETAIL: "comments:detail",
      COMMENTS_REPLACE_FOR_TARGET: "comments:replace-for-target",
      COMMENTS_CANCEL: "comments:cancel",
      COMMENTS_PUBLISH_NOW: "comments:publish-now",
      COMMENTS_CAPABILITY: "comments:capability",
      COMMENTS_PERMISSION_DECLINE: "comments:permission-decline",
      COMMENT_SNIPPETS_LIST: "comment-snippets:list",
      COMMENT_SNIPPETS_UPSERT: "comment-snippets:upsert",
      COMMENT_SNIPPETS_DELETE: "comment-snippets:delete",
      DISTRIBUTION_HISTORY_LIST: "distribution-history:list",
      DISTRIBUTION_PERFORMANCE_DASHBOARD: "distribution-performance:dashboard",
      DISTRIBUTION_PERFORMANCE_CAPABILITIES: "distribution-performance:capabilities",
      DISTRIBUTION_PERFORMANCE_PERMISSION_DECISION: "distribution-performance:permission-decision",
      DISTRIBUTION_PERFORMANCE_SYNC: "distribution-performance:sync",
      DISTRIBUTION_PERFORMANCE_SYNC_PROGRESS: "distribution-performance:sync-progress",
      AI_LOCAL_STATUS: "ai:local-status",
      AI_TEST_CONNECTION: "ai:test-connection",
      AI_GENERATE_SYSTEM_PROMPT: "ai:generate-system-prompt",
      AI_SEO_AUDIT: "ai:seo-audit",
      AI_SEO_AUDIT_PROGRESS: "ai:seo-audit-progress",
      AI_PROVIDERS_LIST: "ai-providers:list",
      AI_PROVIDERS_SAVE_PROFILE: "ai-providers:save-profile",
      AI_PROVIDERS_DELETE_PROFILE: "ai-providers:delete-profile",
      AI_PROVIDERS_SAVE_SECRET: "ai-providers:save-secret",
      AI_PROVIDERS_REMOVE_SECRET: "ai-providers:remove-secret",
      AI_PROVIDERS_TEST: "ai-providers:test",
      AI_PROVIDERS_GET_ACTIVE_ROUTE: "ai-providers:get-active-route",
      AI_PROVIDERS_SET_ACTIVE_ROUTE: "ai-providers:set-active-route",
      SEO_LIST: "seo:list",
      SEO_CREATE: "seo:create",
      SEO_UPDATE_STATUS: "seo:update-status",
      RANK_SNAPSHOTS: "rank:snapshots",
      RANK_ALERTS: "rank:alerts",
      RANK_ALERT_ACK: "rank:alert-ack",
      DIRECTORIES_LIST: "directories:list",
      DIRECTORIES_SUBMISSIONS: "directories:submissions",
      DIRECTORIES_EXPORT_MANUAL: "directories:export-manual",
      DIRECTORIES_UPDATE_STATUS: "directories:update-status",
      DIRECTORIES_RUN_ASSISTED: "directories:run-assisted",
      DIRECTORIES_CONFIRM_SUBMIT: "directories:confirm-submit",
      DIRECTORIES_STOP_ASSISTED: "directories:stop-assisted",
      DIRECTORIES_AUTOMATION_PROGRESS: "directories:automation-progress",
      PIPELINES_RUN: "pipelines:run",
      PIPELINES_LIST_RUNS: "pipelines:list-runs",
      RANK_DOMAIN_AUTHORITY: "rank:domain-authority",
      RANK_BULK_DOMAIN_AUTHORITY: "rank:bulk-domain-authority",
      RANK_BACKLINK_PROFILE: "rank:backlink-profile",
      RANK_CAPTURE_GSC_LINKS: "rank:capture-gsc-links",
      RANK_RUN_AUTOMATION: "rank:run-automation",
      RANK_RUN_BATCH: "rank:run-batch",
      RANK_AUTOMATION_PROGRESS: "rank:automation-progress",
      KEYWORDS_OVERVIEW: "keywords:overview",
      KEYWORDS_IDEAS: "keywords:ideas",
      KEYWORDS_PLANNER: "keywords:planner",
      KEYWORDS_RANKED: "keywords:ranked",
      KEYWORDS_SERP_POSITION: "keywords:serp-position",
      KEYWORDS_CLUSTER: "keywords:cluster",
      KEYWORDS_CLUSTER_PROGRESS: "keywords:cluster-progress",
      SERP_BRIEF: "serp:brief",
      SERP_ANALYSIS: "serp:analysis",
      AI_VISIBILITY_LIST: "ai-visibility:list",
      AI_VISIBILITY_GET: "ai-visibility:get",
      AI_VISIBILITY_UPSERT: "ai-visibility:upsert",
      AI_VISIBILITY_DELETE: "ai-visibility:delete",
      AI_VISIBILITY_RUN: "ai-visibility:run",
      AI_VISIBILITY_SNAPSHOTS: "ai-visibility:snapshots",
      AI_VISIBILITY_DELETE_SNAPSHOT: "ai-visibility:delete-snapshot",
      AI_VISIBILITY_RESPONSES: "ai-visibility:responses",
      AI_VISIBILITY_PROGRESS: "ai-visibility:progress",
      PERFORMANCE_PAGESPEED: "performance:pagespeed",
      PERFORMANCE_SEARCH_INSIGHTS: "performance:search-insights",
      INDEXNOW_VERIFY_KEY: "indexnow:verify-key",
      INDEXNOW_SUBMIT: "indexnow:submit",
      INDEXNOW_SITEMAP_URLS: "indexnow:sitemap-urls",
      INDEXNOW_HISTORY: "indexnow:history",
      INDEXNOW_CHECK_INDEX: "indexnow:check-index",
      INDEXNOW_CHECK_INDEX_PROGRESS: "indexnow:check-index-progress",
      INDEXNOW_CLEAR_HISTORY: "indexnow:clear-history",
      INDEXNOW_BING_KEY_STATUS: "indexnow:bing-key-status",
      INDEXNOW_BING_KEY_GET: "indexnow:bing-key-get",
      INDEXNOW_BING_KEY_SET: "indexnow:bing-key-set",
      INDEXNOW_BING_KEY_CHECK: "indexnow:bing-key-check",
      INDEXNOW_GET_KEY: "indexnow:get-key",
      INDEXNOW_SET_KEY: "indexnow:set-key",
      INDEXNOW_GET_KEY_LOCATION: "indexnow:get-key-location",
      INDEXNOW_SET_KEY_LOCATION: "indexnow:set-key-location",
      GOOGLE_INDEX_HISTORY: "google-index:history",
      GOOGLE_INDEX_CLEAR_HISTORY: "google-index:clear-history",
      GOOGLE_INDEX_INSPECT: "google-index:inspect",
      GOOGLE_INDEX_INSPECT_CACHE: "google-index:inspect-cache",
      AUDIT_START: "audit:start",
      AUDIT_CANCEL: "audit:cancel",
      AUDIT_GET: "audit:get",
      AUDIT_LIST: "audit:list",
      AUDIT_DELETE: "audit:delete",
      AUDIT_EXPORT: "audit:export",
      AUDIT_PROGRESS: "audit:progress",
      PROMPT_EXPLORER_EXPLORE: "prompt-explorer:explore",
      PROMPT_EXPLORER_PROGRESS: "prompt-explorer:progress",
      PROMPT_EXPLORER_LIST: "prompt-explorer:list",
      PROMPT_EXPLORER_GET: "prompt-explorer:get",
      PROMPT_EXPLORER_DELETE: "prompt-explorer:delete",
      SKILLS_LIST: "skills:list",
      SKILLS_STATUS: "skills:status",
      SKILLS_INSTALL: "skills:install",
      SKILLS_REVEAL: "skills:reveal",
      WRITING_STYLE_GENERATE: "writing-style:generate",
      WRITING_STYLE_SAVE: "writing-style:save",
      WRITING_STYLE_LIST: "writing-style:list",
      WRITING_STYLE_DELETE: "writing-style:delete",
      REPURPOSE_LIST_ACCOUNTS: "repurpose:list-accounts",
      REPURPOSE_LIST_POSTS: "repurpose:list-posts",
      REPURPOSE_PROBE_WATCH_URL: "repurpose:probe-watch-url",
      REPURPOSE_FETCH_URL: "repurpose:fetch-url",
      REPURPOSE_IMPORT_MEDIA: "repurpose:import-media",
      REPURPOSE_PIPELINES_LIST: "repurpose:pipelines-list",
      REPURPOSE_PIPELINES_LOGS: "repurpose:pipelines-logs",
      REPURPOSE_PIPELINES_SAVE: "repurpose:pipelines-save",
      REPURPOSE_PIPELINES_PAUSE: "repurpose:pipelines-pause",
      REPURPOSE_PIPELINES_RUN: "repurpose:pipelines-run",
      REPURPOSE_PIPELINES_DELETE: "repurpose:pipelines-delete",
      FOLDER_PIPELINES_LIST: "folder-pipelines:list",
      FOLDER_PIPELINES_SCAN: "folder-pipelines:scan",
      FOLDER_PIPELINES_SAVE: "folder-pipelines:save",
      FOLDER_PIPELINES_RUN: "folder-pipelines:run",
      FOLDER_PIPELINES_DELETE: "folder-pipelines:delete",
      MCP_CONFIG: "mcp:config",
      MCP_CONFIGURE: "mcp:configure",
      AUTOMATION_GOOGLE_ACCOUNT: "automation:google-account",
      AUTOMATION_GOOGLE_LOGIN: "automation:google-login",
      AUTOMATION_GOOGLE_OPEN: "automation:google-open",
      AUTOMATION_GOOGLE_SYNC: "automation:google-sync",
      AUTOMATION_GOOGLE_RESET: "automation:google-reset",
      AUTOMATION_GOOGLE_WEBMASTER_RUN: "automation:google-webmaster-run",
      AUTOMATION_GOOGLE_WEBMASTER_PROGRESS: "automation:google-webmaster-progress",
      AUTOMATION_BROWSER_EXTENSION_INFO: "automation:browser-extension-info",
      AUTOMATION_BROWSER_EXTENSION_INSTALL: "automation:browser-extension-install",
      AUTOMATION_BROWSER_CAPTURES: "automation:browser-captures",
      AUTOMATION_BROWSER_OPEN_EXTENSIONS: "automation:browser-open-extensions",
      SETTINGS_LIST: "settings:list",
      SETTINGS_GET: "settings:get",
      SETTINGS_SET: "settings:set",
      SYNC_GET_STATUS: "sync:get-status",
      SYNC_SUGGEST_FOLDERS: "sync:suggest-folders",
      SYNC_PICK_FOLDER: "sync:pick-folder",
      SYNC_INSPECT_TARGET: "sync:inspect-target",
      SYNC_CREATE_FOLDER: "sync:create-folder",
      SYNC_JOIN_FOLDER: "sync:join-folder",
      SYNC_TEST_S3: "sync:test-s3",
      SYNC_CREATE_S3: "sync:create-s3",
      SYNC_JOIN_S3: "sync:join-s3",
      SYNC_RUN_NOW: "sync:run-now",
      SYNC_CANCEL: "sync:cancel",
      SYNC_SET_PAUSED: "sync:set-paused",
      SYNC_DISCONNECT: "sync:disconnect",
      SYNC_LIST_TRANSPORTS: "sync:list-transports",
      SYNC_LIST_DEVICES: "sync:list-devices",
      SYNC_RETIRE_DEVICE: "sync:retire-device",
      SYNC_LIST_CONFLICTS: "sync:list-conflicts",
      SYNC_RESOLVE_CONFLICT: "sync:resolve-conflict",
      SYNC_LIST_JOBS: "sync:list-jobs",
      SYNC_SET_BLOB_POLICY: "sync:set-blob-policy",
      SYNC_LIST_BLOBS: "sync:list-blobs",
      SYNC_DOWNLOAD_BLOB: "sync:download-blob",
      SYNC_GET_DIAGNOSTICS: "sync:get-diagnostics",
      SYNC_SET_AUTOMATION_OWNER: "sync:set-automation-owner",
      SYNC_LIST_SCOPES: "sync:list-scopes",
      SYNC_SET_SCOPE: "sync:set-scope",
      SYNC_SET_MODE: "sync:set-mode",
      SYNC_PREVIEW_CHANGES: "sync:preview-changes",
      SYNC_PUSH_CHANGES: "sync:push-changes",
      SYNC_FETCH_CHANGES: "sync:fetch-changes",
      SYNC_LIST_STAGED: "sync:list-staged",
      SYNC_APPLY_STAGED: "sync:apply-staged",
      SYNC_SKIP_STAGED: "sync:skip-staged",
      SYNC_SET_DEVICE_ROLE: "sync:set-device-role",
      SYNC_START_NEARBY_HOST: "sync:start-nearby-host",
      SYNC_JOIN_NEARBY: "sync:join-nearby",
      SYNC_GET_NEARBY_PAIRING: "sync:get-nearby-pairing",
      SYNC_CONFIRM_NEARBY: "sync:confirm-nearby",
      SYNC_CANCEL_NEARBY: "sync:cancel-nearby",
      SYNC_PROGRESS: "sync:progress",
      SYNC_STATUS: "sync:status",
      SYNC_DATA_CHANGED: "sync:data-changed",
      UPDATES_CHECK: "updates:check",
      UPDATES_DOWNLOAD: "updates:download",
      UPDATES_INSTALL: "updates:install",
      UPDATES_GET_VERSION: "updates:get-version",
      UPDATES_GET_STATUS: "updates:get-status",
      UPDATES_STATUS: "updates:status",
      MENU_OPEN_SETTINGS: "menu:open-settings",
      MENU_OPEN_UPDATES: "menu:open-updates",
      LICENSE_GET_INFO: "license:get-info",
      LICENSE_GET_LIMITS: "license:get-limits",
      LICENSE_ACTIVATE: "license:activate",
      LICENSE_VALIDATE: "license:validate",
      LICENSE_DEACTIVATE: "license:deactivate",
      LICENSE_CAN_ADD_WORKSPACE: "license:can-add-workspace",
      LICENSE_CAN_ADD_PROJECT: "license:can-add-project",
      LICENSE_CAN_USE_IMPORT_EXPORT: "license:can-use-import-export",
      LICENSE_CHANGED: "license:changed",
      BACKUP_PREVIEW_EXPORT: "backup:preview-export",
      BACKUP_EXPORT: "backup:export",
      BACKUP_INSPECT_IMPORT: "backup:inspect-import",
      BACKUP_IMPORT: "backup:import",
      STORAGE_ANALYZE: "storage:analyze",
      STORAGE_CLEAN: "storage:clean",
      STORAGE_SAVE_POLICY: "storage:save-policy",
      STORAGE_PROFILES_LIST: "storage:profiles-list",
      STORAGE_PROFILES_UPSERT: "storage:profiles-upsert",
      STORAGE_PROFILES_SECRET: "storage:profiles-secret",
      STORAGE_PROFILES_TEST: "storage:profiles-test",
      STORAGE_PROFILES_DELETE: "storage:profiles-delete",
      NOTIFICATIONS_LIST: "notifications:list",
      NOTIFICATIONS_MARK_READ: "notifications:mark-read",
      NOTIFICATIONS_MARK_ALL_READ: "notifications:mark-all-read",
      NOTIFICATIONS_REMOVE: "notifications:remove",
      NOTIFICATIONS_CLEAR: "notifications:clear",
      NOTIFICATIONS_SET_PREFERENCES: "notifications:set-preferences",
      NOTIFICATIONS_CHANGED: "notifications:changed",
      NOTIFICATIONS_ACTIVATE: "notifications:activate",
      REPORTS_EXPORT: "reports:export",
      CHAT_SEND: "chat:send",
      CHAT_PROGRESS: "chat:progress",
      CHAT_RUN_ACTION: "chat:run-action",
      CHAT_LIST: "chat:list",
      CHAT_GET: "chat:get",
      CHAT_RENAME: "chat:rename",
      CHAT_DELETE: "chat:delete",
      CHAT_CLEAR: "chat:clear"
    };
  }
});

// dist-electron/electron/preload.js
Object.defineProperty(exports, "__esModule", { value: true });
var electron_1 = require("electron");
var channels_1 = require_channels();
var api = {
  system: {
    selectFolder: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYSTEM_SELECT_FOLDER),
    selectFiles: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYSTEM_SELECT_FILES, input),
    resolveDroppedFiles: (files) => files.map((file) => ({
      path: electron_1.webUtils.getPathForFile(file),
      name: file.name,
      size: file.size,
      type: file.type
    })),
    openExternal: (url) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYSTEM_OPEN_EXTERNAL, { url }),
    revealPath: (targetPath) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYSTEM_REVEAL_PATH, { path: targetPath }),
    getZoom: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYSTEM_GET_ZOOM),
    setZoom: (factor) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYSTEM_SET_ZOOM, { factor }),
    stepZoom: (delta) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYSTEM_STEP_ZOOM, { delta }),
    onZoomChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.SYSTEM_ZOOM_CHANGED, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.SYSTEM_ZOOM_CHANGED, handler);
      };
    }
  },
  tasks: {
    start: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.TASKS_START, input),
    wait: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.TASKS_WAIT, { id }),
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.TASKS_LIST),
    get: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.TASKS_GET, { id }),
    cancel: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.TASKS_CANCEL, { id }),
    onProgress: (callback) => {
      const handler = (_event, task) => callback(task);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.TASKS_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.TASKS_PROGRESS, handler);
      };
    }
  },
  dashboard: {
    overview: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DASHBOARD_OVERVIEW, input),
    unified: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DASHBOARD_UNIFIED, input),
    syncUnified: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DASHBOARD_UNIFIED_SYNC, input),
    refreshRanks: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DASHBOARD_REFRESH_RANKS, input),
    onUnifiedSyncProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.DASHBOARD_UNIFIED_SYNC_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.DASHBOARD_UNIFIED_SYNC_PROGRESS, handler);
      };
    },
    ask: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DASHBOARD_ASK, input),
    onAskProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.DASHBOARD_ASK_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.DASHBOARD_ASK_PROGRESS, handler);
      };
    }
  },
  products: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_LIST, input),
    get: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_GET, { id }),
    fetchInfo: (url) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_FETCH_INFO, { url }),
    lookupSites: (query) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_LOOKUP_SITES, { query }),
    create: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_CREATE, input),
    update: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_UPDATE, input),
    archive: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_ARCHIVE, { id }),
    move: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_MOVE, input),
    importGsc: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PRODUCTS_IMPORT_GSC, input),
    onImportProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.PRODUCTS_IMPORT_GSC_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.PRODUCTS_IMPORT_GSC_PROGRESS, handler);
      };
    }
  },
  workspaces: {
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WORKSPACES_LIST),
    create: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WORKSPACES_CREATE, input),
    update: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WORKSPACES_UPDATE, input),
    delete: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WORKSPACES_DELETE, { id })
  },
  connectors: {
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_LIST),
    upsert: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_UPSERT, input),
    enable: (name, enabled) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_ENABLE, { name, enabled }),
    test: (name, options) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_TEST, { name, options }),
    testPost: (name, productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_TEST_POST, { name, productId }),
    dataForSeoAccount: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_DATAFORSEO_ACCOUNT),
    oauthStart: (name, options) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_OAUTH_START, { name, ...options }),
    oauthComplete: (name, url) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_OAUTH_COMPLETE, { name, url }),
    oauthCancel: (name) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_OAUTH_CANCEL, { name }),
    oauthOpen: (name, browserId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_OAUTH_OPEN, { name, browserId }),
    detectBrowsers: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_BROWSERS),
    onOauthUrl: (callback) => {
      const handler = (_event, payload) => callback(payload);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.CONNECTORS_OAUTH_URL, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.CONNECTORS_OAUTH_URL, handler);
      };
    },
    oauthStatus: (name) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_OAUTH_STATUS, { name }),
    oauthRevoke: (name) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_OAUTH_REVOKE, { name }),
    deleteGoogleServiceAccount: (accountId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_GOOGLE_SA_DELETE, { accountId }),
    analyzePageIndex: (options) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_ANALYZE_PAGE_INDEX, options),
    onPageIndexProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.CONNECTORS_PAGE_INDEX_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.CONNECTORS_PAGE_INDEX_PROGRESS, handler);
      };
    },
    secretStatus: (name) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_SECRET_STATUS, { name }),
    secretValues: (name, productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_SECRET_VALUES, { name, productId }),
    pages: (name) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_PAGES, { name }),
    restoreProfile: (name, entryId, productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_RESTORE_PROFILE, { name, entryId, productId }),
    setProjectMapping: (name, productId, assigned) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_SET_PROJECT_MAPPING, { name, productId, assigned }),
    setProjectMuted: (name, productId, muted) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_SET_PROJECT_MUTED, { name, productId, muted }),
    setFacebookMapping: (name, productId, mode) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONNECTORS_SET_FACEBOOK_MAPPING, { name, productId, mode })
  },
  syncLogs: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LOGS_LIST, input),
    clear: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LOGS_CLEAR, input)
  },
  aiLogs: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_LOGS_LIST, input),
    clear: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_LOGS_CLEAR, input)
  },
  apiLogs: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.API_LOGS_LIST, input),
    count: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.API_LOGS_COUNT, input),
    clear: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.API_LOGS_CLEAR, input)
  },
  content: {
    regenerationVersion: 4,
    campaignOutputFormatVersion: 1,
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_LIST, input),
    create: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_CREATE, input),
    update: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_UPDATE, input),
    approve: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_APPROVE, { id }),
    archive: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_ARCHIVE, { id }),
    delete: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_DELETE, { id }),
    bulkDelete: (ids) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_BULK_DELETE, { ids }),
    bulkUpdate: (ids, patch) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_BULK_UPDATE, { ids, patch }),
    duplicate: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_DUPLICATE, { id }),
    regenerate: (id, options) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_REGENERATE, { id, options }),
    writeFromCluster: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_WRITE_FROM_CLUSTER, input),
    schedule: (id, scheduledAt) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_SCHEDULE, { id, scheduledAt }),
    publish: (id, channels) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_PUBLISH, { id, channels }),
    publishHistory: (contentId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CONTENT_PUBLISH_HISTORY, { contentId }),
    onGenerationProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.CONTENT_GENERATION_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.CONTENT_GENERATION_PROGRESS, handler);
      };
    }
  },
  assets: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_LIST, input),
    get: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_GET, { id }),
    import: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_IMPORT, input),
    importUrl: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_IMPORT_URL, input),
    update: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_UPDATE, input),
    remove: (id, removeBytes) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_DELETE, { id, removeBytes }),
    download: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_DOWNLOAD, { id }),
    downloadPath: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_DOWNLOAD_PATH, input),
    downloadPathsZip: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_DOWNLOAD_PATHS_ZIP, input),
    validateMedia: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_VALIDATE_MEDIA, input),
    dataUrl: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_DATA_URL, { id }),
    previewUrl: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSETS_PREVIEW_URL, { id }),
    collections: {
      list: (productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSET_COLLECTIONS_LIST, { productId }),
      upsert: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSET_COLLECTIONS_UPSERT, input),
      remove: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.ASSET_COLLECTIONS_DELETE, { id })
    }
  },
  videoSources: {
    fetch: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_SOURCE_FETCH, input)
  },
  video: {
    pipelines: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_PIPELINES_LIST),
    runs: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_RUNS_LIST, input),
    getRun: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_RUN_GET, { id }),
    writeStoryboard: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_STORYBOARD_WRITE, input),
    updateStoryboard: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_STORYBOARD_UPDATE, input),
    command: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_STORYBOARD_COMMAND, input),
    resolveGate: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_GATE_RESOLVE, input),
    compose: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_COMPOSE_START, input),
    review: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_REVIEW_GET, { runId }),
    cancel: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_RUN_CANCEL, { runId }),
    discard: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_RUN_DISCARD, { runId }),
    restoreRevision: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.VIDEO_REVISION_RESTORE, input),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.VIDEO_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.VIDEO_PROGRESS, handler);
      };
    }
  },
  design: {
    formats: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_FORMATS),
    templates: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_TEMPLATES_LIST, input),
    designSystems: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_SYSTEMS_LIST),
    docs: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_DOCS_LIST, input),
    get: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_DOC_GET, { id }),
    remove: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_DOC_DELETE, { id }),
    renderPreview: (spec) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_RENDER_PREVIEW, spec),
    renderHtml: (spec) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_RENDER_HTML, spec),
    renderVideo: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_RENDER_VIDEO, input),
    save: (spec) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_SAVE, spec),
    generate: (spec) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_GENERATE, spec),
    fromPrompt: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_FROM_PROMPT, input),
    refine: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_REFINE, input),
    articleImages: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_ARTICLE_IMAGES, input),
    generateImage: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_IMAGE_GENERATE, input),
    imageGenStatus: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DESIGN_IMAGE_GEN_STATUS),
    onPromptProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.DESIGN_PROMPT_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.DESIGN_PROMPT_PROGRESS, handler);
      };
    }
  },
  mediaGeneration: {
    catalog: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_CATALOG, input),
    listProviders: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_PROVIDERS_LIST),
    saveProvider: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_PROVIDER_SAVE, input),
    deleteProvider: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_PROVIDER_DELETE, { id }),
    saveProviderSecret: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_PROVIDER_SECRET_SAVE, input),
    removeProviderSecret: (profileId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_PROVIDER_SECRET_REMOVE, { profileId }),
    testProvider: (profileId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_PROVIDER_TEST, { profileId }),
    getDefaults: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_DEFAULTS_GET),
    setDefaults: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_DEFAULTS_SET, input),
    listJobs: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_JOBS_LIST, input),
    getJob: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_JOB_GET, { id }),
    create: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_CREATE, input),
    cancel: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_CANCEL, { id }),
    remove: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MEDIA_GENERATION_DELETE, input),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.MEDIA_GENERATION_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.MEDIA_GENERATION_PROGRESS, handler);
      };
    }
  },
  schedule: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_LIST, input),
    get: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_GET, { id }),
    upsert: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_UPSERT, input),
    reschedule: (id, scheduledAt) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_RESCHEDULE, { id, scheduledAt }),
    cancel: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_CANCEL, { id }),
    remove: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_DELETE, { id }),
    publishNow: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_PUBLISH_NOW, { id }),
    platforms: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SCHEDULE_PLATFORMS)
  },
  comments: {
    listForPost: (postId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_LIST_FOR_POST, { postId }),
    listForProduct: (productId, limit) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_LIST_FOR_PRODUCT, { productId, limit }),
    detail: (commentId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_DETAIL, { commentId }),
    replaceForTarget: (targetId, comments) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_REPLACE_FOR_TARGET, { targetId, comments }),
    cancel: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_CANCEL, { id }),
    publishNow: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_PUBLISH_NOW, { id }),
    capability: (connectorName) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_CAPABILITY, { connectorName }),
    declinePermission: (connectorName, scopes) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENTS_PERMISSION_DECLINE, { connectorName, scopes })
  },
  commentSnippets: {
    list: (productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENT_SNIPPETS_LIST, { productId }),
    upsert: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENT_SNIPPETS_UPSERT, input),
    remove: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.COMMENT_SNIPPETS_DELETE, { id })
  },
  distributionHistory: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DISTRIBUTION_HISTORY_LIST, input)
  },
  distributionPerformance: {
    dashboard: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_DASHBOARD, input),
    capabilities: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_CAPABILITIES, input),
    setPermissionDecision: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_PERMISSION_DECISION, input),
    sync: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_SYNC, input),
    onSyncProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_SYNC_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_SYNC_PROGRESS, handler);
      };
    }
  },
  ai: {
    localStatus: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_LOCAL_STATUS, input),
    testConnection: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_TEST_CONNECTION, input),
    generateSystemPrompt: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_GENERATE_SYSTEM_PROMPT, input),
    seoAudit: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_SEO_AUDIT, input),
    recommend: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_FIRST_RUN_RECOMMEND, input),
    onSeoAuditProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.AI_SEO_AUDIT_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.AI_SEO_AUDIT_PROGRESS, handler);
      };
    }
  },
  aiProviders: {
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_LIST),
    saveProfile: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_SAVE_PROFILE, input),
    deleteProfile: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_DELETE_PROFILE, { id }),
    saveSecret: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_SAVE_SECRET, input),
    removeSecret: (profileId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_REMOVE_SECRET, { profileId }),
    test: (profileId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_TEST, { profileId }),
    getActiveRoute: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_GET_ACTIVE_ROUTE),
    setActiveRoute: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_PROVIDERS_SET_ACTIVE_ROUTE, input)
  },
  seo: {
    list: (productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SEO_LIST, { productId }),
    create: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SEO_CREATE, input),
    updateStatus: (id, status) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SEO_UPDATE_STATUS, { id, status })
  },
  rank: {
    snapshots: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_SNAPSHOTS, input),
    alerts: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_ALERTS, input),
    acknowledge: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_ALERT_ACK, { id }),
    domainAuthority: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_DOMAIN_AUTHORITY, input),
    bulkDomainAuthority: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_BULK_DOMAIN_AUTHORITY, input),
    backlinkProfile: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_BACKLINK_PROFILE, input),
    captureGscLinks: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_CAPTURE_GSC_LINKS, input),
    runAutomation: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_RUN_AUTOMATION, input),
    runBatch: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.RANK_RUN_BATCH, input),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.RANK_AUTOMATION_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.RANK_AUTOMATION_PROGRESS, handler);
      };
    }
  },
  keywords: {
    overview: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.KEYWORDS_OVERVIEW, input),
    ideas: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.KEYWORDS_IDEAS, input),
    planner: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.KEYWORDS_PLANNER, input),
    ranked: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.KEYWORDS_RANKED, input),
    serpPosition: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.KEYWORDS_SERP_POSITION, input),
    cluster: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.KEYWORDS_CLUSTER, input),
    onClusterProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.KEYWORDS_CLUSTER_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.KEYWORDS_CLUSTER_PROGRESS, handler);
      };
    }
  },
  serp: {
    brief: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SERP_BRIEF, input),
    analysis: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SERP_ANALYSIS, input)
  },
  aiVisibility: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_LIST, input),
    get: (id, options) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_GET, { id, ...options }),
    upsert: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_UPSERT, input),
    remove: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_DELETE, { id }),
    run: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_RUN, { id }),
    snapshots: (trackerId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_SNAPSHOTS, { trackerId }),
    deleteSnapshot: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_DELETE_SNAPSHOT, { id }),
    responses: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AI_VISIBILITY_RESPONSES, input),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.AI_VISIBILITY_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.AI_VISIBILITY_PROGRESS, handler);
      };
    }
  },
  performance: {
    pageSpeed: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PERFORMANCE_PAGESPEED, input),
    searchInsights: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PERFORMANCE_SEARCH_INSIGHTS, input)
  },
  indexnow: {
    verifyKey: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_VERIFY_KEY, input),
    submit: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_SUBMIT, input),
    sitemapUrls: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_SITEMAP_URLS, input),
    history: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_HISTORY, input),
    checkIndex: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_CHECK_INDEX, input),
    onCheckIndexProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.INDEXNOW_CHECK_INDEX_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.INDEXNOW_CHECK_INDEX_PROGRESS, handler);
      };
    },
    clearHistory: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_CLEAR_HISTORY, input),
    bingKeyStatus: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_BING_KEY_STATUS),
    getBingKey: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_BING_KEY_GET),
    setBingKey: (apiKey) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_BING_KEY_SET, { apiKey }),
    checkBingKey: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_BING_KEY_CHECK),
    getKey: (productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_GET_KEY, { productId }),
    setKey: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_SET_KEY, input),
    getKeyLocation: (productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_GET_KEY_LOCATION, { productId }),
    setKeyLocation: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.INDEXNOW_SET_KEY_LOCATION, input)
  },
  googleIndex: {
    history: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.GOOGLE_INDEX_HISTORY, input),
    clearHistory: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.GOOGLE_INDEX_CLEAR_HISTORY, input),
    inspect: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.GOOGLE_INDEX_INSPECT, input),
    inspectCache: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.GOOGLE_INDEX_INSPECT_CACHE, input)
  },
  audit: {
    start: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUDIT_START, input),
    cancel: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUDIT_CANCEL, { runId }),
    get: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUDIT_GET, { runId }),
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUDIT_LIST, input),
    remove: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUDIT_DELETE, { runId }),
    export: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUDIT_EXPORT, { runId }),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.AUDIT_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.AUDIT_PROGRESS, handler);
      };
    }
  },
  promptExplorer: {
    explore: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PROMPT_EXPLORER_EXPLORE, input),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.PROMPT_EXPLORER_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.PROMPT_EXPLORER_PROGRESS, handler);
      };
    },
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PROMPT_EXPLORER_LIST, input),
    get: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PROMPT_EXPLORER_GET, { runId }),
    remove: (runId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PROMPT_EXPLORER_DELETE, { runId })
  },
  skills: {
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SKILLS_LIST),
    status: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SKILLS_STATUS),
    install: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SKILLS_INSTALL, input),
    reveal: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SKILLS_REVEAL, input)
  },
  writingStyle: {
    generate: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WRITING_STYLE_GENERATE, input),
    save: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WRITING_STYLE_SAVE, input),
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WRITING_STYLE_LIST),
    remove: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.WRITING_STYLE_DELETE, input)
  },
  repurpose: {
    listAccounts: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_LIST_ACCOUNTS, input),
    listPosts: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_LIST_POSTS, input),
    probeWatchUrl: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_PROBE_WATCH_URL, input),
    fetchUrl: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_FETCH_URL, input),
    importMedia: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_IMPORT_MEDIA, input),
    listPipelines: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_PIPELINES_LIST, input),
    listPipelineLogs: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_PIPELINES_LOGS, input),
    savePipeline: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_PIPELINES_SAVE, input),
    pausePipeline: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_PIPELINES_PAUSE, { id }),
    runPipeline: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_PIPELINES_RUN, { id }),
    deletePipeline: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPURPOSE_PIPELINES_DELETE, { id })
  },
  folderPipelines: {
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.FOLDER_PIPELINES_LIST, input),
    scan: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.FOLDER_PIPELINES_SCAN, input),
    save: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.FOLDER_PIPELINES_SAVE, input),
    run: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.FOLDER_PIPELINES_RUN, { id }),
    remove: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.FOLDER_PIPELINES_DELETE, { id })
  },
  mcp: {
    configJson: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MCP_CONFIG),
    configure: (enabled) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.MCP_CONFIGURE, { enabled })
  },
  automation: {
    googleWebmasterAccount: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_GOOGLE_ACCOUNT),
    openGoogleLogin: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_GOOGLE_LOGIN),
    openGoogleWebmaster: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_GOOGLE_OPEN, input),
    syncGoogleAccount: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_GOOGLE_SYNC),
    resetGoogleSession: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_GOOGLE_RESET),
    runGoogleWebmasterAutomation: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_GOOGLE_WEBMASTER_RUN, input),
    onGoogleWebmasterProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.AUTOMATION_GOOGLE_WEBMASTER_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.AUTOMATION_GOOGLE_WEBMASTER_PROGRESS, handler);
      };
    },
    browserExtensionInfo: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_BROWSER_EXTENSION_INFO),
    installBrowserExtension: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_BROWSER_EXTENSION_INSTALL),
    browserCaptures: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_BROWSER_CAPTURES, input),
    openBrowserExtensionsManager: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.AUTOMATION_BROWSER_OPEN_EXTENSIONS)
  },
  directories: {
    list: (activeOnly = false) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DIRECTORIES_LIST, { activeOnly }),
    submissions: (productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DIRECTORIES_SUBMISSIONS, { productId }),
    exportManual: (productId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DIRECTORIES_EXPORT_MANUAL, { productId }),
    updateStatus: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DIRECTORIES_UPDATE_STATUS, input),
    runAssisted: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DIRECTORIES_RUN_ASSISTED, input),
    confirmSubmit: (approve) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DIRECTORIES_CONFIRM_SUBMIT, { approve }),
    stopAssisted: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.DIRECTORIES_STOP_ASSISTED),
    onAutomationProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.DIRECTORIES_AUTOMATION_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.DIRECTORIES_AUTOMATION_PROGRESS, handler);
      };
    }
  },
  pipelines: {
    run: (pipelineType, productId, trigger, payload) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PIPELINES_RUN, { pipelineType, productId, trigger, payload }),
    listRuns: (productId, limit) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.PIPELINES_LIST_RUNS, { productId, limit })
  },
  settings: {
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SETTINGS_LIST),
    get: (key) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SETTINGS_GET, { key }),
    set: (key, value) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SETTINGS_SET, { key, value })
  },
  sync: {
    getStatus: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_GET_STATUS),
    suggestFolders: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SUGGEST_FOLDERS),
    pickFolder: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_PICK_FOLDER),
    inspectTarget: (targetPath) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_INSPECT_TARGET, { targetPath }),
    createFolder: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_CREATE_FOLDER, input),
    joinFolder: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_JOIN_FOLDER, input),
    testS3: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_TEST_S3, input),
    createS3: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_CREATE_S3, input),
    joinS3: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_JOIN_S3, input),
    runNow: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_RUN_NOW),
    cancel: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_CANCEL),
    setPaused: (paused) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SET_PAUSED, { paused }),
    disconnect: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_DISCONNECT),
    listTransports: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LIST_TRANSPORTS),
    listDevices: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LIST_DEVICES),
    retireDevice: (deviceId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_RETIRE_DEVICE, { deviceId }),
    listConflicts: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LIST_CONFLICTS),
    resolveConflict: (conflictId, selection) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_RESOLVE_CONFLICT, { conflictId, selection }),
    listJobs: (limit) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LIST_JOBS, { limit }),
    setBlobPolicy: (policy) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SET_BLOB_POLICY, { policy }),
    listBlobs: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LIST_BLOBS),
    downloadBlob: (blobId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_DOWNLOAD_BLOB, { blobId }),
    getDiagnostics: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_GET_DIAGNOSTICS),
    setAutomationOwner: (deviceId, workspaceId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SET_AUTOMATION_OWNER, { deviceId, workspaceId }),
    listScopes: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LIST_SCOPES),
    setScopeEnabled: (scopeId, enabled) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SET_SCOPE, { scopeId, enabled }),
    setSyncMode: (mode) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SET_MODE, { mode }),
    previewChanges: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_PREVIEW_CHANGES),
    pushChanges: (selection) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_PUSH_CHANGES, { selection }),
    fetchChanges: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_FETCH_CHANGES),
    listStaged: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_LIST_STAGED),
    applyStaged: (operationIds) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_APPLY_STAGED, { operationIds }),
    skipStaged: (operationIds) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SKIP_STAGED, { operationIds }),
    setDeviceRole: (deviceId, role) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_SET_DEVICE_ROLE, { deviceId, role }),
    startNearbyHost: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_START_NEARBY_HOST, input),
    joinNearby: (code) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_JOIN_NEARBY, { code }),
    getNearbyPairing: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_GET_NEARBY_PAIRING),
    confirmNearby: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_CONFIRM_NEARBY),
    cancelNearby: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.SYNC_CANCEL_NEARBY),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.SYNC_PROGRESS, handler);
      return () => electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.SYNC_PROGRESS, handler);
    },
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.SYNC_STATUS, handler);
      return () => electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.SYNC_STATUS, handler);
    },
    onDataChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.SYNC_DATA_CHANGED, handler);
      return () => electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.SYNC_DATA_CHANGED, handler);
    }
  },
  updates: {
    check: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.UPDATES_CHECK),
    download: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.UPDATES_DOWNLOAD),
    install: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.UPDATES_INSTALL),
    getVersion: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.UPDATES_GET_VERSION),
    getStatus: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.UPDATES_GET_STATUS),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.UPDATES_STATUS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.UPDATES_STATUS, handler);
      };
    }
  },
  menu: {
    onOpenSettings: (callback) => {
      const handler = (_event, payload) => callback(payload);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.MENU_OPEN_SETTINGS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.MENU_OPEN_SETTINGS, handler);
      };
    },
    onOpenUpdates: (callback) => {
      const handler = () => callback();
      electron_1.ipcRenderer.on(channels_1.CHANNELS.MENU_OPEN_UPDATES, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.MENU_OPEN_UPDATES, handler);
      };
    }
  },
  license: {
    getInfo: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_GET_INFO),
    getLimits: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_GET_LIMITS),
    activate: (licenseKey) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_ACTIVATE, { licenseKey }),
    validate: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_VALIDATE),
    deactivate: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_DEACTIVATE),
    canAddWorkspace: (currentCount) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_CAN_ADD_WORKSPACE, { currentCount }),
    canAddProject: (currentCount) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_CAN_ADD_PROJECT, { currentCount }),
    canUseImportExport: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.LICENSE_CAN_USE_IMPORT_EXPORT),
    onChange: (callback) => {
      const handler = (_event, snapshot) => callback(snapshot);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.LICENSE_CHANGED, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.LICENSE_CHANGED, handler);
      };
    }
  },
  backup: {
    previewExport: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.BACKUP_PREVIEW_EXPORT, input),
    export: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.BACKUP_EXPORT, input),
    inspectImport: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.BACKUP_INSPECT_IMPORT),
    import: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.BACKUP_IMPORT, input)
  },
  storage: {
    analyze: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_ANALYZE),
    clean: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_CLEAN, input),
    savePolicy: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_SAVE_POLICY, input),
    listProfiles: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_PROFILES_LIST),
    upsertProfile: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_PROFILES_UPSERT, input),
    saveProfileSecret: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_PROFILES_SECRET, input),
    testProfile: (profileId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_PROFILES_TEST, { profileId }),
    deleteProfile: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.STORAGE_PROFILES_DELETE, { id })
  },
  chat: {
    send: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CHAT_SEND, input),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.CHAT_PROGRESS, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.CHAT_PROGRESS, handler);
      };
    },
    runAction: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CHAT_RUN_ACTION, input),
    list: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CHAT_LIST, input),
    get: (conversationId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CHAT_GET, { conversationId }),
    rename: (conversationId, title) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CHAT_RENAME, { conversationId, title }),
    remove: (conversationId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CHAT_DELETE, { conversationId }),
    clear: (conversationId) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.CHAT_CLEAR, { conversationId })
  },
  notifications: {
    list: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.NOTIFICATIONS_LIST),
    markRead: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.NOTIFICATIONS_MARK_READ, { id }),
    markAllRead: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.NOTIFICATIONS_MARK_ALL_READ),
    remove: (id) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.NOTIFICATIONS_REMOVE, { id }),
    clear: () => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.NOTIFICATIONS_CLEAR),
    setPreferences: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.NOTIFICATIONS_SET_PREFERENCES, input),
    onChanged: (callback) => {
      const handler = (_event, snapshot) => callback(snapshot);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.NOTIFICATIONS_CHANGED, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.NOTIFICATIONS_CHANGED, handler);
      };
    },
    onActivate: (callback) => {
      const handler = (_event, notification) => callback(notification);
      electron_1.ipcRenderer.on(channels_1.CHANNELS.NOTIFICATIONS_ACTIVATE, handler);
      return () => {
        electron_1.ipcRenderer.removeListener(channels_1.CHANNELS.NOTIFICATIONS_ACTIVATE, handler);
      };
    }
  },
  reports: {
    export: (input) => electron_1.ipcRenderer.invoke(channels_1.CHANNELS.REPORTS_EXPORT, input)
  }
};
electron_1.contextBridge.exposeInMainWorld("api", api);
