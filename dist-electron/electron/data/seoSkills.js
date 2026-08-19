"use strict";
/**
 * Agent skill pack. SEO workflows are adapted from OpenSEO's `.agents/skills/**` to
 * 1MarketingTool's own MCP tools (the bundled `onemarketingtool` server). Shipped as a
 * TS data module (same convention as directories.ts) so it survives packaging/asar,
 * then written to a CLI agent's skills directory on demand by SkillsService.
 *
 * Tool reference (provided by the `onemarketingtool` MCP server; the app must be running
 * with DataForSEO connected):
 *   shared:  get_products
 *   rank:    rank_check_domain, rank_run_automation, rank_list_snapshots, rank_list_alerts
 *   keyword: keyword_explore, keyword_overview, keyword_ranked_for_domain, keyword_serp_position
 *   content: content_write_piece, content_generate_campaign, content_list_library
 *   browser: browser_get_website_brand
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_SKILLS = void 0;
const PREAMBLE = `> Tools below come from the **1MarketingTool MCP server** (\`onemarketingtool\`). 1MarketingTool must be running and DataForSEO connected. Tool calls return JSON; summarize for the user, don't dump raw payloads. Locations default to "United States" unless the user says otherwise.`;
exports.AGENT_SKILLS = [
    {
        name: 'get-website-brand',
        type: 'design',
        title: 'Get Website Brand',
        description: 'Capture a website\'s visual language as a reusable local design system for 1MarketingTool Design Studio.',
        body: `# Get Website Brand

Use this skill when the user wants new marketing artwork to match an existing website.

## Required input
- One public HTTP or HTTPS website URL.

## Workflow
1. Call \`browser_get_website_brand\` with the URL.
2. The tool opens the page in an isolated hidden browser, captures its rendered appearance and computed visual signals,
   and saves a reusable website design system locally.
3. Report the captured system name, source URL, palette, and short visual summary.
4. Tell the user they can select **Website style** or the captured system by name in Design Studio.

Do not invent colours, typography, or layout rules that are absent from the capture. If the page cannot be loaded,
report the exact error and leave existing saved website styles unchanged.`,
    },
    {
        name: 'write-like-a-human',
        type: 'writing',
        title: 'Write Like a Human',
        description: 'User writing style preference: write like a human without AI slop.',
        body: `# Write Like a Human

User's writing style preference: write like a human without AI slop.

1. **No antithesis.** Do not use structures like "It's not X, it's Y" / "Not just X, but Y" / "X isn't the problem, Y is" or similar variations. Write direct, affirmative statements without relying on contrast for rhythm.
2. **Plain punctuation, native-language spelling.** Use plain US-keyboard punctuation, but preserve every Unicode letter, diacritic, and native script required by the requested language. Never romanize or strip accents from non-English copy; Vietnamese must use full Vietnamese spelling and tone marks. Specifically:
- Use \`-\` instead of em dash and en dash characters
- Use \`"\` and \`'\` instead of curly quotes
- Use \`...\` instead of ellipsis characters
- Use \`-\` or \`*\` instead of decorative bullet characters
- Do not use decorative Unicode emojis unless explicitly requested
3. *(To be expanded.)*

## Working principles
- **Concise & direct.** Give clear recommendations. Avoid long lists of options like "it depends".
- **Clear structure** - use markdown tables, headers, and bullets when comparing data.
- **Search the web** when up-to-date data is needed (TVL, prices, ecosystem changes). Do not rely on memory for fast-changing numbers.
- **Keep technical terms in English** even in Vietnamese conversations (NAV, DVN, ERC-4626, vault, looping, etc.).`,
    },
    {
        name: 'seo-keyword-research',
        type: 'seo',
        title: 'Keyword Research',
        description: 'Discover and qualify keywords for a topic or product using volume, difficulty, intent, and live SERP checks.',
        body: `# SEO Keyword Research

${PREAMBLE}

## Goal
Turn a seed topic (or a product) into a shortlist of keywords worth targeting, qualified by demand, difficulty, intent, and how the site currently ranks.

## Required inputs
- A seed keyword or topic. If the user gives a product instead, call \`get_products\` to get its domain first.
- Optional: target location.

## Workflow
1. **Expand.** Call \`keyword_explore\` with the seed to get related ideas. Pull a few seeds if the topic is broad.
2. **Qualify.** Batch the candidates into \`keyword_overview\` (accepts a \`keywords\` array) to get search volume, difficulty, CPC, competition, and intent.
3. **Prioritize.** Favor keywords with real volume, difficulty the site can realistically win, and intent that matches the page you'd build. Drop off-topic or wrong-audience terms.
4. **Reality-check the winners.** For the top handful, call \`keyword_serp_position\` with the user's domain to see if they already rank (quick win to improve vs. net-new).

## Output
A ranked table: \`Keyword | Volume | Difficulty | Intent | Current position | Recommendation (target / improve / skip)\`. Lead with a 2-3 line summary of the best opportunities and why.`,
    },
    {
        name: 'seo-keyword-clustering',
        type: 'seo',
        title: 'Keyword Clustering',
        description: 'Group keywords into page-level topic clusters and map each cluster to an existing or new page.',
        body: `# SEO Keyword Clustering

${PREAMBLE}

## Goal
Group keywords into page-level clusters and decide which existing or new page should target each cluster. This is keyword *mapping*, not just semantic grouping.

## Required inputs
- A keyword list, a seed topic, or a target domain.
- Optional: existing URLs to map against.

## Gather the candidate set
- From a seed: \`keyword_explore\` to expand, then \`keyword_overview\` to enrich.
- From a domain/page: \`keyword_ranked_for_domain\` to get the exact terms it already ranks for (and their URLs).

## Workflow
1. Remove duplicates, irrelevant terms, and terms that need a different product or audience.
2. Build clusters around **search intent and page type** — same intent + similar ranking pages belong together; different intent or SERP format should split. Similar wording does not guarantee the same cluster.
3. For borderline terms, sample \`keyword_serp_position\` to confirm SERP overlap before merging.
4. Assign each cluster to an existing URL, a proposed new page, or a "later/skip" bucket.
5. Flag **cannibalization** — two pages competing for one intent.

## Output
Start with a summary (cluster count, pages to create, pages to update, cannibalization risks), then a table:
\`Cluster | Primary keyword | Secondary keywords | Intent | Target page | Priority | Notes\`.`,
    },
    {
        name: 'seo-competitor-analysis',
        type: 'seo',
        title: 'Competitor Analysis',
        description: "Analyze a competitor domain — its authority, the keywords it ranks for, and where you outrank or trail it.",
        body: `# SEO Competitor Analysis

${PREAMBLE}

## Goal
Understand a competitor's organic footprint and find the gaps and threats that matter for the user's site.

## Required inputs
- The competitor domain. Optional: the user's own domain for head-to-head comparison.

## Workflow
1. **Authority.** \`rank_check_domain\` on the competitor for Ahrefs Domain Rating. Repeat for the user's domain to set a baseline.
2. **Footprint.** \`keyword_ranked_for_domain\` on the competitor to list the keywords (and pages) it ranks for.
3. **Gap.** \`keyword_ranked_for_domain\` on the user's domain too; the keywords the competitor ranks for that the user doesn't are the opportunity set. Qualify them with \`keyword_overview\`.
4. **Head-to-head.** For the most valuable shared keywords, \`keyword_serp_position\` for both domains to see who currently wins.

## Output
- A short authority comparison (Domain Rating).
- A **gap table**: \`Keyword | Volume | Competitor position | Your position | Opportunity\`.
- 3-5 prioritized recommendations (which gaps to chase first and why).`,
    },
    {
        name: 'seo-content-brief',
        type: 'seo',
        title: 'Content Brief',
        description: 'Turn a target keyword into a SERP-grounded content brief, and optionally save the draft to the content library.',
        body: `# SEO Content Brief

${PREAMBLE}

## Goal
Produce a brief for one target keyword that's grounded in what currently ranks, then (optionally) draft and save it.

## Required inputs
- The target keyword and the product/domain it's for (\`get_products\` to resolve the product ID).

## Workflow
1. **Qualify the keyword.** \`keyword_overview\` for volume, difficulty, and intent — confirm it's worth a dedicated page.
2. **Ground in the SERP.** \`keyword_serp_position\` (and the user's domain) to see who ranks and where the user currently sits.
3. **Draft the brief:** search intent, suggested title + meta description, an H2/H3 outline, the questions the page must answer, and internal-linking ideas. Keep it specific to the product — no generic filler.
4. **Optional — save it.** With the user's confirmation, call \`content_write_piece\` (\`productId\`, \`type: 'blog'\` or \`'seo_brief'\`-style, \`title\`, \`content\` in markdown) to store it in the 1MarketingTool content library.

## Output
The brief in markdown. If saved, confirm the library item that was created.`,
    },
    {
        name: 'seo-rank-tracking',
        type: 'seo',
        title: 'Rank Tracking',
        description: 'Run rank automation for a project, then read snapshots and alerts to report movement and what changed.',
        body: `# SEO Rank Tracking

${PREAMBLE}

## Goal
Refresh and interpret a project's rank/authority data — what moved, what's alerting, and what to do about it.

## Required inputs
- Which project (or "all"). Use \`get_products\` to list domains if unsure.

## Workflow
1. **Refresh (optional).** \`rank_run_automation\` for the product (or all) to fetch fresh Ahrefs Domain Rating and generate change alerts.
2. **Read movement.** \`rank_list_snapshots\` (optionally by \`productId\`) for the authority history; compare the latest to prior rows.
3. **Triage alerts.** \`rank_list_alerts\` for significant same-source changes.
4. **Spot-check a domain.** \`rank_check_domain\` for a one-off current read on any domain.

## Output
A short status: current Domain Rating + delta vs. last snapshot, any open alerts (with severity), and 1-3 recommended actions. Note when numbers are stale and a refresh would help.`,
    },
    {
        name: 'seo-coach',
        type: 'seo',
        title: 'SEO Coach',
        description: 'Friendly SEO coach mode — orient the user, recommend the next action, and drive the right 1MarketingTool tools.',
        body: `# SEO Coach

${PREAMBLE}

## Goal
Be a warm, beginner-friendly SEO coach. Help the user understand what to do next and run the right tools for them — don't lecture.

## First response
Orient before acting:
- Ask whether they're new to SEO, experienced, or in between — and adapt depth.
- Ask what site/project they're working on (\`get_products\` to see what's available).
- Offer 2-4 concrete next options, not a long menu.

## Routing — pick the matching workflow
- "What should I write about?" → keyword research + clustering (\`keyword_explore\`, \`keyword_overview\`, \`keyword_ranked_for_domain\`).
- "How do I compare to X?" → competitor analysis (\`rank_check_domain\`, \`keyword_ranked_for_domain\`).
- "Are my rankings moving?" → rank tracking (\`rank_run_automation\`, \`rank_list_snapshots\`, \`rank_list_alerts\`).
- "Help me write this page" → content brief, then \`content_write_piece\` to save.

## Style
Explain *why* each step matters in one line, run the tool, then translate the JSON into plain advice. Always end with a single clear next step. Confirm before any action that spends DataForSEO credits (\`rank_run_automation\`).`,
    },
];
//# sourceMappingURL=seoSkills.js.map