@echo off
rem Analiz365 - site degisikliklerini GitHub'a gonderir (canli yayin). Sonuc yayinla.log dosyasina yazilir.
chcp 65001 >nul
cd /d "%~dp0"
set "GIT=git"
where git >nul 2>nul || set "GIT=D:\Git\cmd\git.exe"
echo ==== %date% %time% > yayinla.log
echo [1/4] Degisiklikler hazirlaniyor...
"%GIT%" add js css sw.js scripts .github index.html manifest.json >> yayinla.log 2>&1
rem Commit mesaji: komut satirindan verilir (yayinla.bat "mesaj") ya da sorulur; bos birakilirsa tarihli varsayilan
set "MSG=%~1"
if "%MSG%"=="" set /p "MSG=Degisiklik aciklamasi (bos birakilabilir): "
if "%MSG%"=="" set "MSG=Site guncellendi (%date% %time:~0,5%)"
"%GIT%" add lig sitemap.xml yayinla.bat >> yayinla.log 2>&1
"%GIT%" commit -m "%MSG%" >> yayinla.log 2>&1
echo [2/4] Sunucudaki son hal aliniyor...
"%GIT%" pull --rebase --autostash origin main >> yayinla.log 2>&1
if errorlevel 1 (
  echo HATA: birlestirme basarisiz, geri aliniyor. >> yayinla.log
  "%GIT%" rebase --abort >> yayinla.log 2>&1
  echo SONUC: HATA-PULL >> yayinla.log
  echo HATA: ayrinti yayinla.log dosyasinda.
  timeout /t 15
  exit /b 1
)
echo [3/4] GitHub'a gonderiliyor...
"%GIT%" push origin HEAD:main >> yayinla.log 2>&1
if errorlevel 1 (
  echo SONUC: HATA-PUSH >> yayinla.log
  echo HATA: gonderilemedi, ayrinti yayinla.log dosyasinda.
  timeout /t 15
  exit /b 1
)
"%GIT%" log -1 --oneline >> yayinla.log 2>&1
echo SONUC: TAMAM >> yayinla.log
echo [4/4] Tamam! Site birkac dakika icinde guncellenir.
timeout /t 8
