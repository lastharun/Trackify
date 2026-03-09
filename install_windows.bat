@echo off
title TicaretTakip Kurulum (Windows)
color 0A

echo ===================================================
echo     TicaretTakip - Windows Otomatik Kurulum
echo ===================================================
echo.
echo Lutfen Node.js'in (v18 veya uzeri) yuklu oldugundan emin olun.
echo Yuklu degilse: https://nodejs.org adresinden indirip kurun.
echo.
pause

echo.
echo 1/3: Ana proje bagimliliklari kuruluyor...
call npm install

echo.
echo 2/3: Tarayici otomasyonlari (Playwright) indiriliyor...
call npx playwright install chromium

echo.
echo 3/3: Frontend (Arayuz) bagimliliklari kuruluyor...
cd frontend
call npm install
cd ..

echo.
echo ===================================================
echo KURULUM TAMAMLANDI!
echo ===================================================
echo Projeyi baslatmak icin "start_project.bat" dosyasina cift tiklayin.
echo.
pause
