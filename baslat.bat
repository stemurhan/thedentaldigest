@echo off
rem Ahal365 - siteyi bu bilgisayarda acar: http://localhost:8365
cd /d "%~dp0"
start "" http://localhost:8365
python -m http.server 8365
