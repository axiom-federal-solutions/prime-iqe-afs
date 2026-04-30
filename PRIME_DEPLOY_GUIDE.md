# PRIME IQE — Deployment Guide
**Axiom Federal Solutions / Walker Contractors LLC**
Generated: April 27, 2026

---

## ✅ ALREADY DONE (No Action Required)

| Step | Status | Details |
|------|--------|---------|
| Supabase project created | ✅ DONE | `prime-iqe-afs` — us-east-1 |
| Database URL | ✅ DONE | `https://czoyvxyfewqaoewzxlin.supabase.co` |
| All 29 tables deployed | ✅ DONE | Core + Extended + System tables + Views |
| GitHub repo created | ✅ DONE | `axiom-federal-solutions/prime-iqe-afs` |
| Secret: SUPABASE_URL | ✅ DONE | Already saved to GitHub Secrets |
| Secret: FROM_EMAIL | ✅ DONE | Already saved to GitHub Secrets |
| Secret: FROM_NAME | ✅ DONE | Already saved to GitHub Secrets |

---

## 🔧 STEP 1 — Push Code to GitHub (5 commands, ~2 minutes)

Open **PowerShell** or **Windows Terminal** and run these commands exactly:

```powershell
cd "C:\Users\renke\OneDrive\Documents\Claude\Projects\AFS_PRIME\Prime Build\PRIME Build"

git init
git add .
git commit -m "Initial PRIME IQE system — 50 files, 9 agents, 29 tables"
git remote add origin https://github.com/axiom-federal-solutions/prime-iqe-afs.git
git push -u origin main
```

> GitHub will ask for your username and password. Use your GitHub username and a **Personal Access Token** (not your GitHub password).
> Get a token at: https://github.com/settings/tokens → Generate new token (classic) → check `repo` scope

---

## 🔑 STEP 2 — Add 6 Remaining GitHub Secrets

Go to: **https://github.com/axiom-federal-solutions/prime-iqe-afs/settings/secrets/actions**

Click **"New repository secret"** for each one below:

### Secret 1: SUPABASE_SERVICE_ROLE_KEY
**Where to get it:**
1. Go to https://supabase.com/dashboard/project/czoyvxyfewqaoewzxlin/settings/api
2. Scroll to **"Project API Keys"**
3. Copy the **`service_role`** key (the long one starting with `eyJ...`)
4. ⚠️ This is different from the anon key — make sure you copy `service_role`

---

### Secret 2: ANTHROPIC_API_KEY
**Where to get it:**
1. Go to https://console.anthropic.com/settings/keys
2. Click **"Create Key"**
3. Name it `PRIME-IQE-AFS`
4. Copy the key (starts with `sk-ant-api03-...`)
5. Set a **$10/month spending limit** on that key for safety

---

### Secret 3: SENDGRID_API_KEY
**Where to get it:**
1. Go to https://app.sendgrid.com/settings/api_keys
2. Click **"Create API Key"**
3. Name: `PRIME-IQE`
4. Permission: **"Restricted Access"** → enable **Mail Send** only
5. Copy the key (starts with `SG.`)

> **Also do this:** Go to https://app.sendgrid.com/settings/sender_auth and verify `PrimeOpps1@gmail.com` as a sender.

---

### Secret 4: SAM_API_KEY
**Where to get it:**
1. Go to https://sam.gov → Sign In → click your account name → **"API Keys"**
2. If you don't have one, click **"Generate API Key"**
3. Copy the key
4. Free tier = 1,000 calls/day (PRIME uses ~50/day across 4 scans)

---

### Secret 5: CAGE_CODE
**Value:** Your company's CAGE code from SAM.gov
- Find it at: https://sam.gov → search "Walker Contractors LLC"
- It's a 5-character alphanumeric code

---

### Secret 6: BONDING_COMPANY
**Value:** The name of your surety/bonding company
- Example: `Travelers Casualty and Surety` or `Zurich Insurance`
- This is just a text label used in compliance reports

---

## ⚡ STEP 3 — Enable GitHub Actions

After pushing your code:
1. Go to https://github.com/axiom-federal-solutions/prime-iqe-afs/actions
2. Click **"I understand my workflows, go ahead and enable them"**
3. The workflows will start running on their scheduled times

---

## 🚀 STEP 4 — Trigger First SCOUT Run (Manual)

Don't want to wait until 6 AM? Run SCOUT immediately:
1. Go to https://github.com/axiom-federal-solutions/prime-iqe-afs/actions/workflows/scout-sam.yml
2. Click **"Run workflow"** → **"Run workflow"**
3. This triggers SCOUT → JUDGE → BRANDI alert chain right now

---

## 📅 Automated Schedule (Once Live)

| Time (CT) | What runs |
|-----------|-----------|
| 5:30 AM daily | VAULT — compliance check |
| 6:00 AM daily | BRANDI — morning brief to PrimeOpps1@gmail.com |
| 6:00 AM daily | SCOUT — SAM.gov scan |
| 12:00 PM daily | SCOUT — SAM.gov scan |
| 6:00 PM daily | SCOUT — SAM.gov scan |
| 11:00 PM daily | SCOUT — SAM.gov scan |
| Monday 7:00 AM | BRANDI — weekly supply digest |
| Sunday 10:00 PM | RECON — market intelligence |

---

## 💰 Monthly Cost Breakdown

| Service | Cost | Notes |
|---------|------|-------|
| Supabase | $0 | Free tier — well within limits |
| GitHub Actions | $0 | Free tier — ~2,000 mins/month used |
| Claude AI (Anthropic) | ~$5–7 | Haiku for scoring, Sonnet for proposals |
| SendGrid | $0 | Free tier — 100 emails/day, we send ~35/month |
| SAM.gov API | $0 | Free with account |
| **TOTAL** | **~$5–7/mo** | Under $10/mo target |

---

## 🔒 Security Notes

- All API keys are in GitHub Secrets — never in the code
- The `.env.example` file shows what's needed but has NO real values
- Add `.env` to `.gitignore` before committing (it's already there)
- The SYSTEM_HALT kill switch is in your Supabase `system_config` table
- To emergency stop all agents: set `SYSTEM_HALT` = `'true'` in Supabase

---

## 📊 Verify It's Working

After setup, check these to confirm the system is live:

1. **GitHub Actions tab** — workflows showing as scheduled/running
2. **Supabase Table Editor** — `agent_logs` table populating with entries
3. **Email** — morning brief arriving at `PrimeOpps1@gmail.com` by 6 AM CT
4. **Supabase Table Editor** — `opportunities` table filling with SAM.gov data

---

## 🆘 If Something Breaks

| Problem | Fix |
|---------|-----|
| Workflow fails | Check Actions tab → click failed run → read logs |
| No email from BRANDI | Verify SendGrid sender authentication for PrimeOpps1@gmail.com |
| SAM.gov returning errors | Check `SAM_CALLS_TODAY` in `system_config` table — may have hit 1,000/day limit |
| Database connection errors | Verify `SUPABASE_SERVICE_ROLE_KEY` secret is the service_role key (not anon) |
| Kill switch accidentally on | Go to Supabase → `system_config` → set `SYSTEM_HALT` value to `'false'` |

---

*PRIME IQE v1.0 — Built for Axiom Federal Solutions · Walker Contractors LLC · UEI: USMQMFAGL9M4*
