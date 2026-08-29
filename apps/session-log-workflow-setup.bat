@echo off
if not exist docs mkdir docs
if not exist .github mkdir .github
if not exist docs\session-log.md type nul > docs\session-log.md
if not exist docs\session-log-archive.md type nul > docs\session-log-archive.md
if not exist docs\known-issues.md type nul > docs\known-issues.md
if not exist .github\copilot-instructions.md type nul > .github\copilot-instructions.md
echo セットアップ完了
pause
