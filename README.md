# PRIME — Procurement & Renovation Intelligence Matching Engine

**Axiom Federal Solutions | Walker Contractors LLC**

A team of 9 AI agents that find, score, price, and bid on federal government contracts — automatically — for less than $9/month.

---

## What PRIME Does

| Agent | Job | Schedule | Cost/Mo |
|-------|-----|----------|---------|
| **SCOUT** | Finds contracts on SAM.gov | 4x daily | ~$2 |
| **JUDGE** | Scores each contract 0-100 | After each SCOUT | ~$6 |
| **VAULT** | Checks compliance / blocks bad bids | Daily 5:30 AM | $0 |
| **RECON** | Tracks incumbents & intel | Daily 11:00 AM | ~$3 |
| **DRAFT** | Writes proposals | On approval | ~$4 |
| **BID ENGINE** | Calculates competitive price | On approval | ~$1 |
| **LEDGER** | Learns from wins/losses | Weekly | ~$1 |
| **EXEC** | Tracks costs & payments | Daily | ~$2 |
| **BRANDI** | Sends daily email brief | Daily 6:00 AM | $0 |

**Total: ~$9/month**

---

## Folder Structure

```
prime-system/
├── agents/          ← One file per agent
├── lib/             ← Shared tools (database, AI)
├── config/          ← Settings and NAICS codes
├── .github/
│   └── workflows/   ← GitHub Actions schedules
├── package.json     ← Node.js dependencies
└── .gitignore       ← Protects secrets from being uploaded
```

---

## Required GitHub Secrets

Go to: **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Where to Get It |
|-------------|-----------------|
| `SAM_API_KEY` | api.data.gov (free registration) |
| `SAM_UEI` | Your SAM.gov registration UEI number |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SENDGRID_API_KEY` | sendgrid.com (free tier) |

**Never put keys in code files. Always use GitHub Secrets.**

---

## Tech Stack

- **Runtime**: Node.js 20 on GitHub Actions (free)
- **Database**: Supabase PostgreSQL (free tier)
- **AI**: Claude Haiku (bulk) + Claude Sonnet (proposals)
- **Email**: SendGrid (free tier — 100 emails/day)
- **Scheduling**: GitHub Actions cron (free — 2,000 min/month)

---

*CONFIDENTIAL — Axiom Federal Solutions — Not for distribution*
