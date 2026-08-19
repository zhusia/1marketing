"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGED_MARKETING_MCP_SERVER_NAMES = exports.MARKETING_MCP_GROUPS_ENV = exports.MARKETING_MCP_GROUPS = exports.MARKETING_MCP_PROMPT_ALIASES = exports.MARKETING_MCP_SERVER_NAME = void 0;
exports.deleteManagedMarketingMcpEntries = deleteManagedMarketingMcpEntries;
exports.parseMarketingMcpGroups = parseMarketingMcpGroups;
exports.marketingMcpDescription = marketingMcpDescription;
exports.marketingMcpInstructions = marketingMcpInstructions;
/**
 * The single machine name written into every client config. It must start with a letter —
 * see docs/common-errors/mcp-server-name-starts-with-number.md.
 */
exports.MARKETING_MCP_SERVER_NAME = 'onemarketingtool';
exports.MARKETING_MCP_PROMPT_ALIASES = ['1mkt', 'onemarketingtool', '1marketingtool'];
exports.MARKETING_MCP_GROUPS = ['rank', 'content', 'video', 'browser'];
/** Comma-separated group list an agent can set to expose only some tools, e.g. "rank,content". */
exports.MARKETING_MCP_GROUPS_ENV = 'ONEMARKETINGTOOL_MCP_GROUPS';
/**
 * Every server name this app has ever written into a client config, including the four
 * per-domain servers that preceded the merge. Setup deletes all of them before writing the
 * current entry, so upgrading collapses the old layout instead of leaving orphans behind.
 */
exports.MANAGED_MARKETING_MCP_SERVER_NAMES = [
    exports.MARKETING_MCP_SERVER_NAME,
    'onemarketingtool-rank',
    'onemarketingtool-browser',
    'onemarketingtool-content',
    'onemarketingtool-video',
    '1marketingtool-rank',
    '1marketingtool-browser',
    '1marketingtool-content',
    '1marketingtool-video',
];
function deleteManagedMarketingMcpEntries(servers) {
    for (const name of exports.MANAGED_MARKETING_MCP_SERVER_NAMES)
        delete servers[name];
}
/** Unknown or empty group names fall back to every group rather than exposing nothing. */
function parseMarketingMcpGroups(raw) {
    const wanted = (raw ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
    if (!wanted.length)
        return [...exports.MARKETING_MCP_GROUPS];
    const groups = exports.MARKETING_MCP_GROUPS.filter((group) => wanted.includes(group));
    return groups.length ? groups : [...exports.MARKETING_MCP_GROUPS];
}
function marketingMcpDescription() {
    const aliases = exports.MARKETING_MCP_PROMPT_ALIASES.map((alias) => `"${alias}"`).join(', ');
    return `1MarketingTool rank, content, video, and website-capture tools. Also called ${aliases}.`;
}
function marketingMcpInstructions(groups) {
    const aliases = exports.MARKETING_MCP_PROMPT_ALIASES.map((alias) => `"${alias}"`).join(', ');
    return [
        'This is the 1MarketingTool integration.',
        `Treat ${aliases}, and "1MarketingTool" as aliases and direct requests to use these marketing tools.`,
        `The canonical machine namespace is "${exports.MARKETING_MCP_SERVER_NAME}"; never create a numeric MCP server alias.`,
        `Exposed tool groups: ${groups.join(', ')} — each tool name is prefixed with its group.`,
        '1MarketingTool must be running; every tool proxies to the app over a loopback bridge.',
    ].join(' ');
}
//# sourceMappingURL=mcp-names.js.map