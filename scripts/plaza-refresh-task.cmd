@echo off
rem The weekly Windows task "BOBAI Plaza refresh" (2026-10-24): runs scripts\plaza-refresh.mjs from the project folder,
rem then the checkup outreach on the Brain Board (scripts\board-outreach.mjs --confirm: a finding is told once in 14
rem days, at most 10 entries). Their own logs are data\plaza-refresh.log and the board; this adds the console output.
cd /d D:\ai\fourmeme
node scripts\plaza-refresh.mjs >> data\plaza-refresh-console.log 2>&1
node scripts\board-outreach.mjs --confirm >> data\board-outreach-console.log 2>&1
