# =============================================================
# FIX-CONFLICTS.PS1 — Strip git merge conflict markers
# Keeps the HEAD (our) version, discards prime-system/main
# Run from: PRIME Build directory
# =============================================================

$repoRoot = $PSScriptRoot
$extensions = @("*.js", "*.yml", "*.html", "*.json")
$fixed = 0
$skipped = 0

Write-Host ""
Write-Host "PRIME IQE — Resolving merge conflicts" -ForegroundColor Cyan
Write-Host "Keeping HEAD (ours) in all conflicts" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

Get-ChildItem -Path $repoRoot -Recurse -Include $extensions |
  Where-Object { $_.FullName -notmatch '\\.git\\' } |
  ForEach-Object {
    $file = $_.FullName
    $content = [System.IO.File]::ReadAllText($file)

    if ($content -match '<<<<<<<') {
      # Strip conflict blocks: keep everything between <<<<<<< HEAD and =======
      # Discard everything between ======= and >>>>>>> branch-name
      $result = [System.Text.RegularExpressions.Regex]::Replace(
        $content,
        '<<<<<<< [^\r\n]+\r?\n(.*?)=======\r?\n.*?>>>>>>> [^\r\n]+\r?\n',
        '$1',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
      )

      [System.IO.File]::WriteAllText($file, $result, [System.Text.Encoding]::UTF8)
      Write-Host "  FIXED  $($_.Name)" -ForegroundColor Green
      $fixed++
    } else {
      $skipped++
    }
  }

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Done. Fixed: $fixed files | Skipped (clean): $skipped files" -ForegroundColor Green
Write-Host ""

# Verify no conflict markers remain
$remaining = Get-ChildItem -Path $repoRoot -Recurse -Include $extensions |
  Where-Object { $_.FullName -notmatch '\\.git\\' } |
  Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match '<<<<<<<' }

if ($remaining.Count -eq 0) {
  Write-Host "Verification PASSED — zero conflict markers remain." -ForegroundColor Green
  Write-Host ""
  Write-Host "Next: run these git commands to push to prime-system:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host '  git add -A' -ForegroundColor White
  Write-Host '  git commit -m "Fix: resolve all merge conflicts — PRIME IQE v2 clean"' -ForegroundColor White
  Write-Host '  git push prime-system main' -ForegroundColor White
  Write-Host ""
} else {
  Write-Host "WARNING: $($remaining.Count) files still have conflict markers:" -ForegroundColor Red
  $remaining | ForEach-Object { Write-Host "  $($_.Name)" -ForegroundColor Red }
}
