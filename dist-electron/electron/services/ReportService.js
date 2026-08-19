"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportService = exports.ReportService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const AiVisibilityService_1 = require("./AiVisibilityService");
const SiteAuditService_1 = require("./seo/SiteAuditService");
const BADGE_URL = 'https://stoicsoft.com/1marketingtool';
const ENGINE_LABEL = { ai_overview: 'AI Overview', ai_mode: 'AI Mode' };
/** The logo mark from design/1mt-icon-light.svg, inlined so the report needs no network. */
const LOGO_SVG = `<svg viewBox="0 0 1024 1024" width="22" height="22" aria-hidden="true">
  <path d="M 152 640 A 360 360 0 0 0 872 640" fill="none" stroke="#0B132B" stroke-width="68" stroke-linecap="round" opacity="0.45"/>
  <path d="M 307 640 A 205 205 0 0 0 717 640" fill="none" stroke="#2563EB" stroke-width="68" stroke-linecap="round"/>
  <circle cx="512" cy="640" r="92" fill="#22D3EE"/>
</svg>`;
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function formatDate(value) {
    if (value == null)
        return '—';
    const date = typeof value === 'number' ? new Date(value) : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime()))
        return String(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatPercent(value, digits = 0) {
    return value == null ? '—' : `${value.toFixed(digits)}%`;
}
function formatNumber(value, digits = 0) {
    return value == null ? '—' : value.toFixed(digits);
}
function slug(value) {
    return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'report';
}
/** Inline SVG line chart. Deliberately dependency-free so the file stays self-contained. */
function sparkline(points, options = {}) {
    const usable = points.filter((point) => point.value != null);
    if (usable.length < 2)
        return '<p class="empty">Not enough history yet — run this at least twice to chart a trend.</p>';
    const width = 720;
    const height = 200;
    const padX = 34;
    const padY = 22;
    const values = usable.map((point) => point.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const stepX = (width - padX * 2) / (usable.length - 1);
    const coords = usable.map((point, index) => {
        const x = padX + index * stepX;
        const y = height - padY - ((point.value - min) / span) * (height - padY * 2);
        return { x, y, ...point };
    });
    const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`).join(' ');
    const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padY} L ${coords[0].x.toFixed(1)} ${height - padY} Z`;
    const dots = coords
        .map((coord) => `<circle cx="${coord.x.toFixed(1)}" cy="${coord.y.toFixed(1)}" r="3.5"><title>${escapeHtml(coord.label)}: ${escapeHtml(coord.value.toFixed(1))}${escapeHtml(options.suffix ?? '')}</title></circle>`)
        .join('');
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Trend chart">
  <path class="chart-area" d="${area}"/>
  <path class="chart-line" d="${line}"/>
  ${dots}
  <text class="chart-tick" x="${padX}" y="14">${escapeHtml(max.toFixed(0))}${escapeHtml(options.suffix ?? '')}</text>
  <text class="chart-tick" x="${padX}" y="${height - 4}">${escapeHtml(min.toFixed(0))}${escapeHtml(options.suffix ?? '')}</text>
  <text class="chart-tick chart-tick-end" x="${width - padX}" y="${height - 4}">${escapeHtml(coords[coords.length - 1].label)}</text>
</svg>`;
}
function metricTile(label, value, note) {
    return `<div class="tile">
    <span class="tile-label">${escapeHtml(label)}</span>
    <strong class="tile-value">${escapeHtml(value)}</strong>
    ${note ? `<span class="tile-note">${escapeHtml(note)}</span>` : ''}
  </div>`;
}
function table(headers, rows, emptyCopy) {
    if (rows.length === 0)
        return `<p class="empty">${escapeHtml(emptyCopy)}</p>`;
    return `<div class="table-wrap"><table>
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
    <tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
        .join('')}</tbody>
  </table></div>`;
}
const REPORT_CSS = `
  :root {
    color-scheme: light dark;
    --page: #f8fafc; --card: #ffffff; --subtle: #f1f5f9; --line: rgba(0,0,0,0.08);
    --fg: #0b132b; --fg-soft: #475569; --fg-hint: #94a3b8;
    --accent: #2563eb; --accent-soft: rgba(37,99,235,0.10);
    --danger: #dc2626; --warn: #d97706; --ok: #059669;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page: #000000; --card: #0a0a0a; --subtle: #141414; --line: rgba(255,255,255,0.10);
      --fg: #ededed; --fg-soft: #a1a1a1; --fg-hint: #6f6f6f;
      --accent: #3b82f6; --accent-soft: rgba(59,130,246,0.14);
      --danger: #f87171; --warn: #fbbf24; --ok: #34d399;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 64px; background: var(--page); color: var(--fg);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 940px; margin: 0 auto; display: flex; flex-direction: column; gap: 26px; }
  header.report-head { display: flex; flex-direction: column; gap: 8px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--fg-hint); font-weight: 650; }
  h1 { margin: 0; font-size: 27px; letter-spacing: -0.02em; font-weight: 700; }
  .subtitle { margin: 0; color: var(--fg-soft); font-size: 14px; }
  section.card {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 22px;
    display: flex; flex-direction: column; gap: 14px;
  }
  section.card > h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
  section.card > p.section-copy { margin: -8px 0 0; color: var(--fg-soft); font-size: 13px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .tile { background: var(--subtle); border-radius: 11px; padding: 12px 13px; display: flex; flex-direction: column; gap: 3px; }
  .tile-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-hint); font-weight: 600; }
  .tile-value { font-size: 24px; font-weight: 700; letter-spacing: -0.02em;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; }
  .tile-note { font-size: 12px; color: var(--fg-soft); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-hint); font-weight: 650; }
  td.num, th.num { text-align: right; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; }
  tbody tr:last-child td { border-bottom: none; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; }
  .pill-high { background: rgba(220,38,38,0.12); color: var(--danger); }
  .pill-medium { background: rgba(217,119,6,0.14); color: var(--warn); }
  .pill-low { background: var(--accent-soft); color: var(--accent); }
  .score { display: flex; align-items: baseline; gap: 10px; }
  .score-value { font-size: 46px; font-weight: 700; letter-spacing: -0.03em;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; }
  .score-good { color: var(--ok); } .score-mid { color: var(--warn); } .score-bad { color: var(--danger); }
  .chart { width: 100%; height: auto; }
  .chart-line { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
  .chart-area { fill: var(--accent-soft); stroke: none; }
  .chart circle { fill: var(--accent); }
  .chart-tick { font-size: 11px; fill: var(--fg-hint); font-family: ui-monospace, monospace; }
  .chart-tick-end { text-anchor: end; }
  .empty { margin: 0; color: var(--fg-hint); font-size: 13px; }
  .issue { border: 1px solid var(--line); border-radius: 11px; padding: 12px 14px; display: flex; flex-direction: column; gap: 7px; }
  .issue-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .issue-label { font-weight: 620; }
  .issue-count { margin-left: auto; font-size: 12px; color: var(--fg-hint);
    font-family: ui-monospace, monospace; }
  .issue-desc { margin: 0; font-size: 13px; color: var(--fg-soft); }
  .issue ul { margin: 0; padding-left: 17px; font-size: 12.5px; color: var(--fg-soft); word-break: break-all; }
  .stack { display: flex; flex-direction: column; gap: 10px; }
  footer.badge {
    display: flex; align-items: center; gap: 10px; padding-top: 6px;
    border-top: 1px solid var(--line); color: var(--fg-hint); font-size: 12.5px;
  }
  footer.badge a { color: var(--accent); text-decoration: none; font-weight: 600; }
  footer.badge .badge-meta { margin-left: auto; }
  @media print {
    body { padding: 0; background: #fff; }
    section.card { break-inside: avoid; border-color: rgba(0,0,0,0.12); }
  }
`;
function shell_(title, bodyHtml, generatedAt) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="1MarketingTool">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
${bodyHtml}
<footer class="badge">
  ${LOGO_SVG}
  <span>Made with <a href="${BADGE_URL}">1MarketingTool</a></span>
  <span class="badge-meta">Generated ${escapeHtml(new Date(generatedAt).toLocaleString())}</span>
</footer>
</div>
</body>
</html>`;
}
function renderAiVisibilityReport(detail, generatedAt) {
    const { tracker, metrics, previous, series, terms, competitors, citationDomains, range } = detail;
    const deltaNote = (current, prior, suffix = 'pts') => {
        if (prior == null)
            return undefined;
        const delta = current - prior;
        if (Math.abs(delta) < 0.5)
            return 'Flat vs. previous period';
        return `${delta > 0 ? '+' : ''}${delta.toFixed(0)} ${suffix} vs. previous period`;
    };
    const rangeLabel = range.days > 0 ? `${range.startDate} → ${range.endDate}` : 'All history';
    const body = `
<header class="report-head">
  <span class="eyebrow">AI visibility report</span>
  <h1>${escapeHtml(tracker.name)}</h1>
  <p class="subtitle">${escapeHtml(rangeLabel)} · ${escapeHtml(String(tracker.termCount))} tracked terms · ${escapeHtml(tracker.engines.map((engine) => ENGINE_LABEL[engine] ?? engine).join(', '))} · ${escapeHtml(tracker.brandVariants.join(', '))}</p>
</header>

<section class="card">
  <h2>Headline metrics</h2>
  <div class="tiles">
    ${metricTile('Visibility', formatPercent(metrics.visibility), deltaNote(metrics.visibility, previous?.visibility))}
    ${metricTile('Share of voice', formatPercent(metrics.shareOfVoice), deltaNote(metrics.shareOfVoice, previous?.shareOfVoice))}
    ${metricTile('Top-3 visibility', formatPercent(metrics.top3Visibility))}
    ${metricTile('Avg. position', formatNumber(metrics.averagePosition, 1))}
    ${metricTile('Answers analyzed', String(metrics.totalQueries), `${metrics.brandQueries} mention the brand`)}
    ${metricTile('Citations', String(metrics.totalCitations))}
  </div>
</section>

<section class="card">
  <h2>Visibility trend</h2>
  ${sparkline(series.map((point) => ({ label: point.date, value: point.visibility })), { suffix: '%' })}
</section>

<section class="card">
  <h2>Tracked terms</h2>
  ${table(['Term', 'Visibility', 'Avg. position', 'Citations'], terms.slice(0, 40).map((term) => [
        escapeHtml(term.term),
        `<span class="num">${escapeHtml(formatPercent(term.visibility))}</span>`,
        `<span class="num">${escapeHtml(formatNumber(term.averagePosition, 1))}</span>`,
        `<span class="num">${escapeHtml(String(term.citations))}</span>`,
    ]), 'No terms have been analyzed yet.')}
</section>

<section class="card">
  <h2>Competitive landscape</h2>
  <p class="section-copy">Brands named alongside yours in the same AI answers.</p>
  ${table(['Brand', 'Visibility', 'Mentions', 'Avg. position'], competitors.slice(0, 15).map((competitor) => [
        escapeHtml(competitor.brand),
        `<span class="num">${escapeHtml(formatPercent(competitor.visibility))}</span>`,
        `<span class="num">${escapeHtml(String(competitor.mentions))}</span>`,
        `<span class="num">${escapeHtml(formatNumber(competitor.averagePosition, 1))}</span>`,
    ]), 'No competing brands were detected in these answers.')}
</section>

<section class="card">
  <h2>Cited sources</h2>
  <p class="section-copy">The domains AI engines cited when answering these prompts.</p>
  ${table(['Domain', 'Citations', 'Share'], citationDomains.slice(0, 15).map((domain) => [
        escapeHtml(domain.domain),
        `<span class="num">${escapeHtml(String(domain.citations))}</span>`,
        `<span class="num">${escapeHtml(formatPercent(domain.share))}</span>`,
    ]), 'No citations were captured for this period.')}
</section>`;
    return {
        title: `${tracker.name} — AI visibility report`,
        fileName: `${slug(tracker.name)}-ai-visibility-${new Date(generatedAt).toISOString().slice(0, 10)}.html`,
        html: shell_(`${tracker.name} — AI visibility report`, body, generatedAt),
    };
}
function renderSiteAuditReport(detail, generatedAt) {
    const { run, issues, pages } = detail;
    const totalIssues = run.issuesHigh + run.issuesMedium + run.issuesLow;
    const scoreClass = run.healthScore == null ? '' : run.healthScore >= 80 ? 'score-good' : run.healthScore >= 55 ? 'score-mid' : 'score-bad';
    const worstPages = [...pages].sort((left, right) => right.issueCount - left.issueCount).slice(0, 25);
    const body = `
<header class="report-head">
  <span class="eyebrow">Technical SEO audit</span>
  <h1>${escapeHtml(run.host)}</h1>
  <p class="subtitle">Crawled ${escapeHtml(formatDate(run.startedAt))} · ${escapeHtml(run.rootUrl)}</p>
</header>

<section class="card">
  <h2>Health</h2>
  <div class="score">
    <span class="score-value ${scoreClass}">${escapeHtml(run.healthScore == null ? '—' : String(run.healthScore))}</span>
    <span class="subtitle">health score out of 100</span>
  </div>
  <div class="tiles">
    ${metricTile('Pages crawled', String(run.pagesCrawled))}
    ${metricTile('Total issues', String(totalIssues))}
    ${metricTile('High severity', String(run.issuesHigh))}
    ${metricTile('Medium severity', String(run.issuesMedium))}
    ${metricTile('Low severity', String(run.issuesLow))}
  </div>
</section>

<section class="card">
  <h2>Issues found</h2>
  <p class="section-copy">Grouped by type, most severe first, with example pages.</p>
  ${issues.length === 0
        ? '<p class="empty">Every crawled page passed the on-page checks.</p>'
        : `<div class="stack">${issues
            .map((group) => `<div class="issue">
      <div class="issue-head">
        <span class="pill pill-${escapeHtml(group.severity)}">${escapeHtml(group.severity)}</span>
        <span class="issue-label">${escapeHtml(group.label)}</span>
        <span class="issue-count">${escapeHtml(String(group.count))} page${group.count === 1 ? '' : 's'}</span>
      </div>
      <p class="issue-desc">${escapeHtml(group.description)}</p>
      <ul>${group.examples
            .slice(0, 5)
            .map((example) => `<li>${escapeHtml(example.url)}${example.detail ? ` — ${escapeHtml(example.detail)}` : ''}</li>`)
            .join('')}${group.count > group.examples.length
            ? `<li>+${group.count - group.examples.length} more page${group.count - group.examples.length === 1 ? '' : 's'}</li>`
            : ''}</ul>
    </div>`)
            .join('')}</div>`}
</section>

<section class="card">
  <h2>Pages needing attention</h2>
  ${table(['Page', 'Status', 'Words', 'Issues'], worstPages.map((page) => [
        escapeHtml(page.url),
        `<span class="num">${escapeHtml(page.statusCode === 0 ? 'ERR' : String(page.statusCode))}</span>`,
        `<span class="num">${escapeHtml(page.isIndexable ? String(page.wordCount) : '—')}</span>`,
        `<span class="num">${escapeHtml(String(page.issueCount))}</span>`,
    ]), 'No pages were crawled in this run.')}
</section>`;
    return {
        title: `${run.host} — technical SEO audit`,
        fileName: `${slug(run.host)}-site-audit-${new Date(generatedAt).toISOString().slice(0, 10)}.html`,
        html: shell_(`${run.host} — technical SEO audit`, body, generatedAt),
    };
}
/**
 * Builds polished, self-contained HTML reports for sharing outside the app (clients, teammates,
 * social proof). Everything — CSS, chart, logo — is inlined so the file opens anywhere with no
 * network access, and every report carries the "Made with 1MarketingTool" footer badge.
 */
class ReportService {
    build(request) {
        const generatedAt = Date.now();
        if (request.kind === 'aiVisibility') {
            const detail = AiVisibilityService_1.aiVisibilityService.getDetail(request.id, { rangeDays: request.rangeDays ?? 30, compare: true });
            if (!detail)
                throw new Error('Tracker not found.');
            if (!detail.latestSnapshotDate)
                throw new Error('Run this tracker at least once before exporting a report.');
            return renderAiVisibilityReport(detail, generatedAt);
        }
        if (request.kind === 'siteAudit') {
            const detail = SiteAuditService_1.siteAuditService.getRunDetail(request.id);
            if (!detail)
                throw new Error('Audit not found.');
            return renderSiteAuditReport(detail, generatedAt);
        }
        throw new Error(`Unsupported report kind: ${String(request.kind)}`);
    }
    /** Build the report, prompt for a location, and write it. Returns a canceled result if dismissed. */
    async export(request) {
        const report = this.build(request);
        const result = await electron_1.dialog.showSaveDialog({
            title: 'Save shareable report',
            defaultPath: path_1.default.join(electron_1.app.getPath('downloads'), report.fileName),
            filters: [{ name: 'Web page', extensions: ['html'] }],
        });
        if (result.canceled || !result.filePath) {
            return { canceled: true, filePath: null, title: report.title };
        }
        const filePath = result.filePath.toLowerCase().endsWith('.html') ? result.filePath : `${result.filePath}.html`;
        fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
        fs_1.default.writeFileSync(filePath, report.html, 'utf8');
        electron_1.shell.showItemInFolder(filePath);
        return { canceled: false, filePath, title: report.title };
    }
}
exports.ReportService = ReportService;
exports.reportService = new ReportService();
//# sourceMappingURL=ReportService.js.map