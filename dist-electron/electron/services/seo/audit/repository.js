"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.siteAuditRepository = exports.SiteAuditRepository = void 0;
const db_1 = require("../../../db");
const DEFAULT_CONFIG = { maxPages: 100, respectRobots: true, useSitemap: true };
function parseConfig(raw) {
    try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
    catch {
        return DEFAULT_CONFIG;
    }
}
function mapRun(row) {
    return {
        id: row.id,
        productId: row.product_id,
        rootUrl: row.root_url,
        host: row.host,
        status: row.status,
        config: parseConfig(row.config_json),
        pagesCrawled: row.pages_crawled,
        pagesTotal: row.pages_total,
        issuesHigh: row.issues_high,
        issuesMedium: row.issues_medium,
        issuesLow: row.issues_low,
        healthScore: row.health_score,
        error: row.error,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}
function mapPage(row) {
    return {
        id: row.id,
        url: row.url,
        statusCode: row.status_code,
        redirectUrl: row.redirect_url,
        title: row.title,
        metaDescription: row.meta_description,
        canonical: row.canonical,
        robotsMeta: row.robots_meta,
        h1Count: row.h1_count,
        h2Count: row.h2_count,
        wordCount: row.word_count,
        imagesTotal: row.images_total,
        imagesMissingAlt: row.images_missing_alt,
        internalLinks: row.internal_links,
        externalLinks: row.external_links,
        hasStructuredData: row.has_structured_data === 1,
        hasViewport: row.has_viewport === 1,
        isIndexable: row.is_indexable === 1,
        responseTimeMs: row.response_time_ms,
        issueCount: row.issue_count,
    };
}
function mapIssue(row) {
    let examples = [];
    try {
        examples = JSON.parse(row.examples_json);
    }
    catch {
        examples = [];
    }
    return {
        code: row.code,
        label: ISSUE_LABELS[row.code] ?? row.code,
        severity: row.severity,
        description: ISSUE_DESCRIPTIONS[row.code] ?? '',
        count: row.count,
        examples,
    };
}
// Labels/descriptions are re-attached on read so persisted rows stay compact and
// copy can evolve without a migration. Kept in sync with issues.ts rule codes.
const ISSUE_LABELS = {
    'broken-page': 'Broken pages (4xx/5xx)',
    'missing-title': 'Missing <title>',
    'missing-h1': 'Missing H1',
    'missing-meta-description': 'Missing meta description',
    'thin-content': 'Thin content',
    'title-length': 'Title length',
    'meta-description-length': 'Long meta description',
    'multiple-h1': 'Multiple H1s',
    'images-missing-alt': 'Images missing alt text',
    'missing-canonical': 'Missing canonical',
    'missing-viewport': 'Missing viewport meta',
    noindex: 'Noindex pages',
    redirect: 'Redirects',
    'slow-response': 'Slow responses',
};
const ISSUE_DESCRIPTIONS = {
    'broken-page': 'Pages that returned an HTTP error or could not be reached.',
    'missing-title': 'Indexable pages with no title tag.',
    'missing-h1': 'Indexable pages without an H1 heading.',
    'missing-meta-description': 'Indexable pages without a meta description.',
    'thin-content': 'Indexable pages with very little body content.',
    'title-length': 'Titles that are too short or too long for search snippets.',
    'meta-description-length': 'Meta descriptions longer than the snippet limit.',
    'multiple-h1': 'Pages with more than one H1 heading.',
    'images-missing-alt': 'Pages with images missing alt attributes.',
    'missing-canonical': 'Indexable pages without a canonical link.',
    'missing-viewport': 'HTML pages without a responsive viewport meta tag.',
    noindex: 'Crawled pages excluded from indexing via a robots meta tag.',
    redirect: 'URLs that responded with a 3xx redirect.',
    'slow-response': 'Pages that were slow to respond.',
};
class SiteAuditRepository {
    db = (0, db_1.getDb)();
    createRun(run) {
        this.db
            .prepare(`INSERT INTO site_audit_runs
          (id, product_id, root_url, host, status, config_json, pages_crawled, pages_total,
           issues_high, issues_medium, issues_low, health_score, error, started_at, completed_at)
         VALUES
          (@id, @productId, @rootUrl, @host, @status, @configJson, @pagesCrawled, @pagesTotal,
           @issuesHigh, @issuesMedium, @issuesLow, @healthScore, @error, @startedAt, @completedAt)`)
            .run({
            id: run.id,
            productId: run.productId,
            rootUrl: run.rootUrl,
            host: run.host,
            status: run.status,
            configJson: JSON.stringify(run.config),
            pagesCrawled: run.pagesCrawled,
            pagesTotal: run.pagesTotal,
            issuesHigh: run.issuesHigh,
            issuesMedium: run.issuesMedium,
            issuesLow: run.issuesLow,
            healthScore: run.healthScore,
            error: run.error,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
        });
    }
    setPagesTotal(runId, pagesTotal) {
        this.db.prepare('UPDATE site_audit_runs SET pages_total = ? WHERE id = ?').run(pagesTotal, runId);
    }
    finalizeRun(runId, update) {
        this.db
            .prepare(`UPDATE site_audit_runs SET
           status = @status, pages_crawled = @pagesCrawled, pages_total = @pagesTotal,
           issues_high = @issuesHigh, issues_medium = @issuesMedium, issues_low = @issuesLow,
           health_score = @healthScore, error = @error, completed_at = @completedAt
         WHERE id = @runId`)
            .run({ runId, ...update });
    }
    replacePages(runId, pages) {
        const insert = this.db.prepare(`INSERT INTO site_audit_pages
        (id, run_id, url, status_code, redirect_url, title, meta_description, canonical, robots_meta,
         h1_count, h2_count, word_count, images_total, images_missing_alt, internal_links, external_links,
         has_structured_data, has_viewport, is_indexable, response_time_ms, issue_count)
       VALUES
        (@id, @runId, @url, @statusCode, @redirectUrl, @title, @metaDescription, @canonical, @robotsMeta,
         @h1Count, @h2Count, @wordCount, @imagesTotal, @imagesMissingAlt, @internalLinks, @externalLinks,
         @hasStructuredData, @hasViewport, @isIndexable, @responseTimeMs, @issueCount)`);
        const tx = this.db.transaction((rows) => {
            this.db.prepare('DELETE FROM site_audit_pages WHERE run_id = ?').run(runId);
            for (const page of rows) {
                insert.run({
                    id: page.id,
                    runId,
                    url: page.url,
                    statusCode: page.statusCode,
                    redirectUrl: page.redirectUrl,
                    title: page.title,
                    metaDescription: page.metaDescription,
                    canonical: page.canonical,
                    robotsMeta: page.robotsMeta,
                    h1Count: page.h1Count,
                    h2Count: page.h2Count,
                    wordCount: page.wordCount,
                    imagesTotal: page.imagesTotal,
                    imagesMissingAlt: page.imagesMissingAlt,
                    internalLinks: page.internalLinks,
                    externalLinks: page.externalLinks,
                    hasStructuredData: page.hasStructuredData ? 1 : 0,
                    hasViewport: page.hasViewport ? 1 : 0,
                    isIndexable: page.isIndexable ? 1 : 0,
                    responseTimeMs: page.responseTimeMs,
                    issueCount: page.issueCount,
                });
            }
        });
        tx(pages);
    }
    replaceIssues(runId, groups) {
        const insert = this.db.prepare(`INSERT INTO site_audit_issues (id, run_id, code, severity, count, examples_json)
       VALUES (@id, @runId, @code, @severity, @count, @examplesJson)`);
        const tx = this.db.transaction((rows) => {
            this.db.prepare('DELETE FROM site_audit_issues WHERE run_id = ?').run(runId);
            for (const group of rows) {
                insert.run({
                    id: `${runId}:${group.code}`,
                    runId,
                    code: group.code,
                    severity: group.severity,
                    count: group.count,
                    examplesJson: JSON.stringify(group.examples),
                });
            }
        });
        tx(groups);
    }
    getRun(runId) {
        const row = this.db.prepare('SELECT * FROM site_audit_runs WHERE id = ?').get(runId);
        return row ? mapRun(row) : null;
    }
    getRunDetail(runId) {
        const run = this.getRun(runId);
        if (!run)
            return null;
        const pages = this.db.prepare('SELECT * FROM site_audit_pages WHERE run_id = ? ORDER BY issue_count DESC, url ASC').all(runId).map(mapPage);
        const issues = this.db.prepare('SELECT * FROM site_audit_issues WHERE run_id = ?').all(runId).map(mapIssue);
        const severityRank = { high: 0, medium: 1, low: 2 };
        issues.sort((a, b) => severityRank[a.severity] !== severityRank[b.severity]
            ? severityRank[a.severity] - severityRank[b.severity]
            : b.count - a.count);
        return { run, pages, issues };
    }
    listRuns(input) {
        const limit = Math.max(1, Math.min(input?.limit ?? 50, 200));
        const rows = input?.productId
            ? this.db
                .prepare('SELECT * FROM site_audit_runs WHERE product_id = ? ORDER BY started_at DESC LIMIT ?')
                .all(input.productId, limit)
            : this.db.prepare('SELECT * FROM site_audit_runs ORDER BY started_at DESC LIMIT ?').all(limit);
        return rows.map(mapRun);
    }
    deleteRun(runId) {
        const result = this.db.prepare('DELETE FROM site_audit_runs WHERE id = ?').run(runId);
        return result.changes > 0;
    }
}
exports.SiteAuditRepository = SiteAuditRepository;
exports.siteAuditRepository = new SiteAuditRepository();
//# sourceMappingURL=repository.js.map