# 1MarketingTool

Local-first marketing automation for desktop.

Open-source Electron app that brings content publishing, SEO, analytics and
repurposing into one workspace — using your own accounts and API keys.

## Open-source build

This is the **fully unlocked** open-source build. The previous commercial
licensing (LemonSqueezy) and entitlement gate are removed:

- No license key is required.
- All Pro features are available to everyone.
- No calls to `store.stoicsoft.com` or `api.lemonsqueezy.com`.
- Baked-in hosted secrets (Google OAuth client secret, relay upload token) are
  removed. Provide your own credentials via env vars if you need those paths:
  - `MARKETING_GOOGLE_CLIENT_SECRET`
  - `MARKETING_RELAY_UPLOAD_TOKEN`

The code in this repository is a build of the desktop app source
(compiled output). It is published for reference and self-hosting.

## Running

```bash
npm install
npm start
```

Requires Node.js >= 20 and Electron.

## Features

- Multi-channel publishing (X, LinkedIn, Facebook/Instagram, TikTok, Pinterest,
  YouTube, Bluesky, Telegram, Hashnode, custom APIs)
- SEO toolkit: keyword clusters, site audit, SERP scraping, AI answers,
  DataForSEO / Ahrefs integrations, Google Search Console & IndexNow
- AI content generation and repurposing (BYO API keys)
- Google Analytics / Search Console dashboards with globe & map views
- Scheduling, publishing pipelines, cross-device sync (LAN + S3)

## License

ISC
