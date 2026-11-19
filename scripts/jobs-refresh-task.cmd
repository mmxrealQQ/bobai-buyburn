@echo off
rem The daily Windows task "BOBAI jobs refresh" (2026-11-19): runs scripts\jobs-refresh.mjs from the project folder
rem (escrow job scan -> agent jobs -> publish -> deploy). Its own log is data\jobs-refresh.log; this adds the console output.
cd /d D:\ai\fourmeme
node scripts\jobs-refresh.mjs >> data\jobs-refresh-console.log 2>&1
