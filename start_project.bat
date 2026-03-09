@echo off
title TicaretTakip Auto-Restart Service
:start
echo [%date% %time%] Uygulama baslatiliyor...
:: Concurrently yerine sadece backend ve worker'ı baslatmak kalıcılık icin daha saglıklıdır.
:: Eğer proje klasöründeyseniz:
npm run dev
echo [%date% %time%] Uygulama kapandi veya stop edildi. 5 saniye icinde yeniden baslatiliyor...
timeout /t 5
goto start
