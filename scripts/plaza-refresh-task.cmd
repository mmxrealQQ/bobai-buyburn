@echo off
rem The Windows task "BOBAI Plaza refresh" (2026-10-24, weekly; daily since 2026-11-19, operator: "es muss alles top
rem aktuell und up to date sein"): runs scripts\plaza-refresh.mjs from the project folder, and on Sundays the checkup
rem outreach on the Brain Board (scripts\board-outreach.mjs --confirm: a finding is told once in 14 days, at most 10
rem entries; weekly on purpose, so the board is not filled daily). Their own logs are data\plaza-refresh.log and the
rem board; this adds the console output.
cd /d D:\ai\fourmeme
node scripts\plaza-refresh.mjs >> data\plaza-refresh-console.log 2>&1
for /f %%d in ('powershell -NoProfile -Command "(Get-Date).DayOfWeek"') do set BOBAI_DOW=%%d
if /i "%BOBAI_DOW%"=="Sunday" node scripts\board-outreach.mjs --confirm >> data\board-outreach-console.log 2>&1
