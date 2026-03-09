# TicaretTakip - Windows Kurulum ve Çalıştırma Rehberi

Bu proje Node.js tabanlıdır ve Windows'ta tamamen sorunsuz bir şekilde çalışabilmektedir. Aşağıdaki adımları takip ederek projeyi kendi Windows bilgisayarınızda ayağa kaldırabilirsiniz.

## Gereksinimler

- Bilgisayarınızda **Node.js (v18.x veya daha yüksek)** yüklü olmalıdır. Değilse [nodejs.org](https://nodejs.org/) adresinden LTS sürümünü indirip "Next, Next" diyerek varsayılan seçeneklerle kurun.

## 1. İlk Etap: Kolay Kurulum (Sadece Bir Kere)

Projenin kök dizinindeki (bu rehberin bulunduğu klasördeki) `install_windows.bat` dosyasına **çift tıklayarak** çalıştırın.

Açılan siyah komut (CMD) ekranı, projedeki tüm gerekli paketleri, arka plan botlarını ve arayüz kodlarını otomatik olarak indirecektir. `KURULUM TAMAMLANDI!` yazısını görene kadar bekleyin ve ekran kapanana kadar bir tuşa basıp çıkın.

## 2. Sistemi Çalıştırma (Her Zaman)

Kurulum tamamlandıktan sonra, sistemi başlatmak için **her seferinde** `start_project.bat` dosyasına çift tıklamanız yeterlidir. 

Bu dosya:
1. Arka plan veritabanı API'sini başlatır (`http://localhost:3001` üzerinde).
2. Otomatik fiyat ve stok kontrol eden Robotları (Workers) başlatır.
3. Yönetim Paneli Web Sitesini (Frontend) başlatır (`http://localhost:3000` üzerinde).

`start_project.bat` ekranını (siyah CMD ekranı) arka planda **açık bıraktığınız sürece** takipleriniz, bildirimleriniz ve arayüzünüz kesintisiz olarak çalışmaya devam eder.

## 3. Chrome Eklentisi Nasıl Yüklenir?

Windows'ta Chrome (veya Brave, Edge gibi Chromium tabanlı) üzerinde eklentiyi yüklemek için:

1. Tarayıcınızda `chrome://extensions/` (veya `edge://extensions/`) adresine gidin.
2. Sağ üstten **Geliştirici Modu (Developer mode)** butonunu aktif hale getirin.
3. Sol üstte çıkan **Paketlenmemiş öğe yükle (Load unpacked)** butonuna tıklayın.
4. Çıkan dosya gezgini ekranında bu projedeki `/extension` klasörünü seçin.
5. "Trackify Takip" eklentisi tarayıcınıza eklenecektir. Parça parça pinleyebilir ve kullanmaya başlayabilirsiniz.

## 4. Sorun Giderme

- **"npm" veya "node" bulunamadı hatası alıyorsanız:** Node.js bilgisayarınızda yüklü değildir veya yükledikten sonra bilgisayarınızı yeniden başlatmamışsınız demektir.
- **Port 3000 zaten kullanımda hatası verirse:** Daha önce açtığınız bir CMD ekranı arka planda açık kalmıştır. Görev Yöneticisinden "Node.js" ismindeki programları sonlandırıp tekrar `start_project.bat` çalıştırın.
