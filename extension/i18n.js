/**
 * Price Tracker — i18n (Internationalization)
 * Usage: add data-i18n="key" to HTML elements.
 * Call applyLanguage() after DOMContentLoaded.
 */

const TRANSLATIONS = {
    en: {
        // Sidebar / nav
        'nav.watchlist': 'Watchlist',
        'nav.settings': 'Settings',
        'nav.help': 'Help',
        'nav.telegram': 'Telegram',

        // Watchlist topbar
        'wl.search': 'Search...',
        'wl.total': 'Total',
        'wl.filter.all': 'all',
        'wl.filter.on': 'on',
        'wl.filter.off': 'off',
        'wl.filter.errors': 'errors',
        'wl.empty': '📭 No trackings found',
        'wl.loading': 'Loading...',
        'wl.backend_error': '⚠️ Backend connection failed (localhost:3001)',

        // Card
        'card.history_none': 'No history yet',
        'card.history_fail': 'Could not load',
        'card.settings': 'Settings:',
        'card.enable_tracking': 'Enable Tracking',
        'card.tracking_interval': 'Tracking Interval:',
        'card.value_type': 'Value type:',
        'card.notifications': 'Notifications:',
        'card.telegram': 'Telegram',
        'card.browser': 'Browser',
        'card.notify_if': 'Notify if:',
        'card.advanced': 'Advanced settings:',
        'card.never_stop': 'Never stop on errors',
        'card.wait_on_page': 'Wait On Page:',
        'card.delete': 'delete',

        // Bulk bar
        'bulk.selected': 'Selected:',
        'bulk.enable': 'enable',
        'bulk.disable': 'disable',
        'bulk.interval': 'Tracking Interval:',
        'bulk.clear_history': 'Clear history',
        'bulk.never_stop': 'never stop on errors',
        'bulk.stop_errors': 'stop on errors',
        'bulk.wait': 'Wait On Page:',
        'bulk.export': 'export to file',
        'bulk.delete': 'delete trackings',
        'bulk.delete_all': 'delete all',
        'bulk.select_all': 'select all',
        'bulk.close': 'close',

        // Settings
        'set.title': 'Global Settings',
        'set.subtitle': 'These settings apply to all your trackings.',
        'set.general': 'General',
        'set.enable_parsing': 'Enable Parsing',
        'set.enable_parsing_desc': 'Pause all tracking globally without deleting them.',
        'set.language': 'Language',
        'set.zero_price': 'Zero Price Is Not Valid',
        'set.zero_price_desc': 'Skip if extracted value is 0.',
        'set.keep_tab': 'Keep Tab Open',
        'set.keep_tab_desc': 'Reuse background tab for scraping.',
        'set.notifications': 'Notifications',
        'set.telegram': 'Telegram',
        'set.user_id': 'User ID:',
        'set.get_here': 'get it here',
        'set.or_qr': 'or scan via QR-code',
        'set.save': 'Save',
        'set.test': 'Send test message',
        'set.send_errors': 'Send Error Notifications',
        'set.browser_notif': 'Browser Notifications',
        'set.defaults': 'Default Settings For New Trackings',
        'set.def_interval': 'Tracking Interval:',
        'set.def_discount': 'Min Discount:',
        'set.def_wait': 'Wait On Page:',
        'set.never_stop': 'Never stop on errors',
        'set.never_stop_desc': 'Keep tracking even after repeated failures.',
        'set.portability': 'Import / Export',
        'set.portability_desc': 'Back up all trackings to JSON or restore them in bulk.',
        'set.device_id': 'This device ID:',
        'set.export_json': 'Export JSON',
        'set.import_json': 'Import JSON',
        'set.import_hint': 'Accepts exported Trackify JSON files.',

        // Popup
        'popup.add_tracking': 'Add Tracking',
        'popup.tracking_list': '☰  Tracking List',
        'popup.saving': 'Saving...',
        'popup.toast': 'Tracking element saved!',
        'popup.view_list': 'VIEW TRACKING LIST',
        'popup.backend_error': 'Backend not running!',
        'popup.open_page': 'Open a product page first',
    },

    tr: {
        // Sidebar / nav
        'nav.watchlist': 'Takip Listesi',
        'nav.settings': 'Ayarlar',
        'nav.help': 'Yardım',
        'nav.telegram': 'Telegram',

        // Watchlist topbar
        'wl.search': 'Ara...',
        'wl.total': 'Toplam',
        'wl.filter.all': 'hepsi',
        'wl.filter.on': 'aktif',
        'wl.filter.off': 'pasif',
        'wl.filter.errors': 'hatalar',
        'wl.empty': '📭 Takip bulunamadı',
        'wl.loading': 'Yükleniyor...',
        'wl.backend_error': '⚠️ Backend bağlantısı kurulamadı (localhost:3001)',

        // Card
        'card.history_none': 'Henüz geçmiş yok',
        'card.history_fail': 'Yüklenemedi',
        'card.settings': 'Ayarlar:',
        'card.enable_tracking': 'Takibi Etkinleştir',
        'card.tracking_interval': 'Kontrol Aralığı:',
        'card.value_type': 'Değer tipi:',
        'card.notifications': 'Bildirimler:',
        'card.telegram': 'Telegram',
        'card.browser': 'Tarayıcı',
        'card.notify_if': 'Bildir:',
        'card.advanced': 'Gelişmiş ayarlar:',
        'card.never_stop': 'Hatalarda durma',
        'card.wait_on_page': 'Sayfada Bekle:',
        'card.selector': 'CSS seçici:',
        'card.image_url': 'Görsel URL:',
        'card.delete': 'sil',

        // Bulk bar
        'bulk.selected': 'Seçili:',
        'bulk.enable': 'etkinleştir',
        'bulk.disable': 'devre dışı',
        'bulk.interval': 'Kontrol Aralığı:',
        'bulk.clear_history': 'Geçmişi temizle',
        'bulk.never_stop': 'hatalarda durma',
        'bulk.stop_errors': 'hatalarda dur',
        'bulk.wait': 'Sayfada Bekle:',
        'bulk.export': 'Dosyaya aktar',
        'bulk.delete': 'takipleri sil',
        'bulk.delete_all': 'tümünü sil',
        'bulk.select_all': 'tümünü seç',
        'bulk.close': 'kapat',

        // Settings
        'set.title': 'Genel Ayarlar',
        'set.subtitle': 'Bu ayarlar tüm takiplerinize uygulanır.',
        'set.general': 'Genel',
        'set.enable_parsing': 'Takibi Etkinleştir',
        'set.enable_parsing_desc': 'Takipleri silmeden genel olarak duraklat.',
        'set.language': 'Dil',
        'set.zero_price': 'Sıfır Fiyat Geçersiz',
        'set.zero_price_desc': 'Çekilen değer 0 ise geç.',
        'set.keep_tab': 'Sekmeyi Açık Tut',
        'set.keep_tab_desc': 'Arka planda sekme yeniden kullanılır.',
        'set.notifications': 'Bildirimler',
        'set.telegram': 'Telegram',
        'set.user_id': 'Kullanıcı ID:',
        'set.get_here': 'buradan al',
        'set.or_qr': 'veya QR kod ile',
        'set.save': 'Kaydet',
        'set.test': 'Test mesajı gönder',
        'set.send_errors': 'Hata Bildirimleri Gönder',
        'set.browser_notif': 'Tarayıcı Bildirimleri',
        'set.defaults': 'Yeni Takipler İçin Varsayılanlar',
        'set.def_interval': 'Kontrol Aralığı:',
        'set.def_discount': 'Min. İndirim:',
        'set.def_wait': 'Sayfada Bekle:',
        'set.never_stop': 'Hatalarda durma',
        'set.never_stop_desc': 'Tekrarlayan hatalardan sonra bile takip etmeye devam et.',
        'set.portability': 'İçe / Dışa Aktarım',
        'set.portability_desc': 'Tüm takipleri JSON olarak yedekle veya toplu geri yükle.',
        'set.device_id': 'Bu cihazın IDsi:',
        'set.export_json': 'JSON dışa aktar',
        'set.import_json': 'JSON içe aktar',
        'set.import_hint': 'Trackify dışa aktarım JSON dosyalarını kabul eder.',

        // Popup
        'popup.add_tracking': 'Takip Ekle',
        'popup.tracking_list': '☰  Takip Listesi',
        'popup.saving': 'Kaydediliyor...',
        'popup.toast': 'Takip elementi kaydedildi!',
        'popup.view_list': 'TAKİP LİSTESİNİ GÖR',
        'popup.backend_error': 'Backend çalışmıyor!',
        'popup.open_page': 'Önce bir ürün sayfası aç',
    }
};

let currentLang = 'tr';

/**
 * Load language from backend settings (or fallback to chrome.storage / 'tr')
 */
async function loadLanguage() {
    try {
        const res = await fetch('http://localhost:3001/api/settings');
        const s = await res.json();
        currentLang = (s.language === 'en') ? 'en' : 'tr';
    } catch {
        await new Promise(resolve => {
            chrome.storage.sync.get(['settings'], ({ settings }) => {
                currentLang = (settings?.language === 'en') ? 'en' : 'tr';
                resolve();
            });
        });
    }
    applyLanguage();
    return currentLang;
}

/**
 * Apply translations to all elements with data-i18n attribute.
 * Also handles data-i18n-placeholder for inputs.
 */
function applyLanguage(lang) {
    if (lang) currentLang = lang;
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.tr;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key] !== undefined) {
            if (el.tagName === 'INPUT' && el.type === 'text') {
                // handled by placeholder
            } else {
                el.textContent = dict[key];
            }
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (dict[key] !== undefined) el.placeholder = dict[key];
    });
}

/**
 * Translate a single key
 */
function t(key) {
    return (TRANSLATIONS[currentLang] || TRANSLATIONS.tr)[key] || key;
}
