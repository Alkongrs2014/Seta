@echo off
rem مشرف النفق: يشغّل publish-tunnel.mjs (نفق Cloudflare المجاني + نشر العنوان في config.js) ويعيده عند التوقف.
setlocal
cd /d "%~dp0.."
if not exist data\logs mkdir data\logs
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
:loop
"%NODE%" scripts\publish-tunnel.mjs >> data\logs\tunnel.log 2>&1
timeout /t 10 /nobreak >nul
goto loop
