@echo off
cd /d "%~dp0"
echo Installing dependencies...
npm install
echo Starting server...
node server.js
pause
