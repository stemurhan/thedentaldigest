@echo off
rem Ahal365 - bulteni gunceller. Parametresiz: pencere acik kalir. "auto": sessiz calisir, guncelle.log'a yazar.
cd /d "%~dp0"
if "%1"=="" (
  python scripts\update.py
  pause
) else (
  echo ==== %date% %time% >> guncelle.log
  python scripts\update.py >> guncelle.log 2>&1
)
