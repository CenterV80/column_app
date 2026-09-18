@echo off
if not exist docs mkdir docs
if not exist docs\session-log.md type nul > docs\session-log.md
if not exist docs\session-log-archive.md type nul > docs\session-log-archive.md
if not exist docs\known-issues.md type nul > docs\known-issues.md
if not exist AGENTS.md type nul > AGENTS.md
if not exist CLAUDE.md echo @AGENTS.md> CLAUDE.md
echo セットアップ完了
pause
