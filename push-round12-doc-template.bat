@echo off
REM =============================================================
REM push-round12-doc-template.bat — Round 12: Doc template + score tier labels
REM
REM Bid drafts now produce BOTH:
REM   - Google Sheet (existing) — structured data, 6 sections
REM   - Google Doc (NEW)        — populated from Mr. Kemp's template via {{TOKEN}} replacement
REM
REM Score tier filter buttons in all 3 vertical tabs now show counts + labels:
REM   "🔥 [N] Score above 85"  (was "🔥 ≥85")
REM   "✅ [N] Score 70-84"     (was "✅ ≥70")
REM   "⏳ [N] Unscored"        (unchanged)
REM   "ALL · [N]"              (added count)
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add lib/google-docs.js
git add agents/draft-bid.js
git add .github/workflows/bid-draft.yml
git add sql/add-doc-cols-to-proposals.sql
git add index.html
git add push-round12-doc-template.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit.
) else (
  git commit -m "Round 12: Google Doc template + score tier labels with counts" -m "DOC TEMPLATE:" -m "- New lib/google-docs.js: copyFile + replaceAllText batchUpdate" -m "- agents/draft-bid.js extended: when GOOGLE_TEMPLATE_DOC_ID env var set, also" -m "  creates a Doc from the template alongside the Sheet" -m "- Doc populated via {{TOKEN}} replacement (graceful — unmatched tokens stay)" -m "- Available tokens (40+):" -m "    Company: COMPANY_NAME, COMPANY_DBA, COMPANY_CAGE, COMPANY_UEI, COMPANY_CONTACT, COMPANY_EMAIL, COMPANY_ADDRESS" -m "    Date: TODAY, GENERATED_AT, GENERATED_DATE" -m "    Opp: TITLE, SOLICITATION_NUMBER, AGENCY, NAICS, PSC, SET_ASIDE, STATE, VALUE, POSTED_DATE, DEADLINE, NOTICE_URL, DESCRIPTION" -m "    Score: PRIME_SCORE, ACQ_SCORE, LEASE_SCORE, SCORE, TIER, RECOMMENDATION, REASONING" -m "    Pricing: PRICING_MODEL, PRICING_SOURCE, PRICING_BASE, PRICING_ESCALATED, PRICING_TOTAL, PRICING_BREAKDOWN, PRICING_NOTE, COMPETITOR_AVG" -m "    Compliance: COMPLIANCE_STATUS, COMPLIANCE_TABLE" -m "    Suppliers: SUPPLIER_LIST, SUPPLIER_COUNT" -m "" -m "SCORE TIER BUTTONS:" -m "- Each vertical tab now shows count per tier in the filter button:" -m "    '🔥 [N] Score above 85' — STRONG BID tier" -m "    '✅ [N] Score 70-84'    — BID tier" -m "    '⏳ [N] Unscored'        — JUDGE pending" -m "    'ALL · [N]'              — total in current taxonomy filter" -m "" -m "MIGRATION REQUIRED:" -m "  sql/add-doc-cols-to-proposals.sql" -m "" -m "OPTIONAL SECRET:" -m "  GOOGLE_TEMPLATE_DOC_ID — Drive file ID of your bid template Doc." -m "  Without it, bid-draft creates only the Sheet (no Doc). Setup steps in next message."
)

echo.
git push origin main
if %errorlevel% neq 0 (
  echo PUSH FAILED. & pause & exit /b 1
)

echo.
echo PUSH SUCCESSFUL.
echo.
echo =====================================================
echo  TEMPLATE SETUP — One-time, ~5 minutes
echo =====================================================
echo.
echo 1. Open https://drive.google.com (logged in as PrimeOpps1@gmail.com)
echo 2. New ^> File upload ^> select WalkerContractors_BidTemplate.docx
echo 3. Right-click the uploaded file ^> Open with ^> Google Docs
echo    (this converts to native Google Doc format)
echo 4. File ^> Save as Google Docs (if not already)
echo 5. Replace fillable fields with placeholder tokens. Examples:
echo    - "Title: ___________"  -^>  "Title: {{TITLE}}"
echo    - "Agency: ___________" -^>  "Agency: {{AGENCY}}"
echo    - "Bid Amount: ____"    -^>  "Bid Amount: {{PRICING_BASE}}"
echo    Full token list in the commit message above.
echo 6. Copy the file ID from the URL:
echo    docs.google.com/document/d/^<THIS_PART^>/edit
echo 7. GitHub Settings ^> Secrets ^> Actions ^> New secret:
echo    Name:  GOOGLE_TEMPLATE_DOC_ID
echo    Value: ^<the file ID you copied^>
echo 8. Re-run sql/add-doc-cols-to-proposals.sql in Supabase
echo 9. Trigger BID DRAFT workflow — Doc + Sheet both appear in Drive
echo.
pause
