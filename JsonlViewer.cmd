@echo off
rem Starts JsonlViewer and opens it in the default browser. Ctrl+C in this window stops it.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not on PATH. Install it from https://nodejs.org and try again. & pause & exit /b 1)
node server.js %*
