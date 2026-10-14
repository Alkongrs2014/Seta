@echo off
rem مشرف التشغيل: يُبقي خادم المنصة حيّاً ويعيد تشغيله عند أي توقّف.
rem خروج برمز 3 = نسخةٌ أخرى تعمل بالفعل ← ننتهي دون تكرار.
setlocal
cd /d "%~dp0.."
if not exist data\logs mkdir data\logs
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
:loop
echo [%date% %time%] start >> data\logs\supervisor.log
"%NODE%" server\index.js >> data\logs\stdout.log 2>&1
set "RC=%errorlevel%"
echo [%date% %time%] exit code %RC% >> data\logs\supervisor.log
if "%RC%"=="3" exit /b 0
timeout /t 5 /nobreak >nul
goto loop
