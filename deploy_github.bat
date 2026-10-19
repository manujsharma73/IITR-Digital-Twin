@echo off
rem One-click GitHub Pages deploy. Needs Git and GitHub CLI:
rem   winget install Git.Git GitHub.cli   then run:  gh auth login
cd /d "%~dp0"
where gh >nul 2>nul || (echo GitHub CLI not found. Run: winget install GitHub.cli & pause & exit /b 1)
gh auth status >nul 2>nul || gh auth login
if not exist ".git" (
  git init -b main
  git add -A
  git commit -m "IIT Roorkee Digital Twin"
  gh repo create IITR-Digital-Twin --public --source . --push
) else (
  git add -A
  git commit -m "Update twin"
  git push
)
for /f %%u in ('gh api user --jq .login') do set GHUSER=%%u
gh api -X POST repos/%GHUSER%/IITR-Digital-Twin/pages -f "source[branch]=main" -f "source[path]=/" >nul 2>nul
echo.
echo Live in about a minute at:  https://%GHUSER%.github.io/IITR-Digital-Twin/
echo Add that address to your Google API key's HTTP referrers:  https://%GHUSER%.github.io/*
pause
