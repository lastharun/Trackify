const API_BASE = "http://localhost:3001/api";

async function loadProducts() {
    console.log("Dashboard: Loading products...");
    const list = document.getElementById('product-list');
    list.innerHTML = '<div style="padding:40px; text-align:center; opacity:0.5;">Yükleniyor...</div>';

    try {
        const res = await fetch(`${API_BASE}/products?limit=100`);
        const data = await res.json();
        const products = data.products || [];
        renderDashboard(products);
        document.getElementById('total-count').innerText = `Total: ${data.total || 0}`;
        document.getElementById('max-count').innerText = data.total || 0;
    } catch (err) {
        console.error("Dashboard load failed:", err);
        list.innerHTML = '<div style="color:#ef4444; padding:40px; text-align:center;">Backend sunucusuna bağlanılamadı. (localhost:3001)</div>';
    }
}

function renderDashboard(products) {
    const list = document.getElementById('product-list');
    if (products.length === 0) {
        list.innerHTML = '<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Henüz takip edilen ürün yok. "Add Tracking" ile ürün ekleyin.</div>';
        return;
    }

    list.innerHTML = products.map(p => `
        <div class="product-card" data-id="${p.id}">
            <div style="display:flex; align-items:center; width:100%;">
                <input type="checkbox" class="bulk-checkbox" onchange="updateBulkBar()" style="margin-right:20px; width:20px; height:20px; cursor:pointer;">
                <img src="${p.last_image_url || 'icon.png'}" class="product-img" onerror="this.src='icon.png'">
                <div class="product-main">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div>
                            <div style="font-size: 12px; color: rgba(255,255,255,0.4); display: flex; align-items: center; gap: 6px; margin-bottom:4px;">
                                <img src="https://www.google.com/s2/favicons?domain=${p.domain}" width="14">
                                ${p.domain}
                            </div>
                            <div class="product-title">${p.title || 'İsimsiz Ürün'}</div>
                        </div>
                        <div style="text-align: right;">
                            <div class="price-text">${p.last_price ? p.last_price.toLocaleString('tr-TR') : '---'} TRY</div>
                            <div style="font-size: 11px; color: #10b981; opacity: 0.8;">${p.last_checked_at ? new Date(p.last_checked_at).toLocaleTimeString() : 'Bekleniyor'}</div>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 16px; margin-left: 20px;">
                    <button onclick="toggleItemStatus(${p.id}, ${p.is_active})" title="Durum" style="background:none; border:none; cursor:pointer; font-size:18px; filter: grayscale(${p.is_active ? 0 : 1});">🔔</button>
                    <button onclick="deleteProduct(${p.id})" title="Sil" style="background:none; border:none; cursor:pointer; font-size:18px;">🗑️</button>
                </div>
            </div>
        </div>
    `).join('');
}

async function toggleItemStatus(id, current) {
    try {
        await fetch(`${API_BASE}/products/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: current ? 0 : 1 })
        });
        loadProducts();
    } catch (err) { console.error(err); }
}

async function deleteProduct(id) {
    if (!confirm('İstediğinize emin misiniz?')) return;
    try {
        await fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' });
        loadProducts();
    } catch (err) { console.error(err); }
}

function updateBulkBar() {
    const checked = document.querySelectorAll('.bulk-checkbox:checked').length;
    const bar = document.getElementById('bulk-bar');
    if (checked > 0) {
        bar.style.display = 'flex';
        document.getElementById('selected-count').innerText = checked;
    } else {
        bar.style.display = 'none';
    }
}

async function bulkDelete() {
    const ids = Array.from(document.querySelectorAll('.bulk-checkbox:checked')).map(c => c.closest('.product-card').dataset.id);
    if (!confirm(`${ids.length} ürünü silmek istediğinize emin misiniz?`)) return;
    for (const id of ids) await fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' });
    loadProducts();
    updateBulkBar();
}

document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    document.getElementById('refresh-btn').addEventListener('click', loadProducts);
    document.getElementById('close-bulk').addEventListener('click', () => {
        document.querySelectorAll('.bulk-checkbox').forEach(c => c.checked = false);
        updateBulkBar();
    });
    document.querySelector('.btn-delete').addEventListener('click', bulkDelete);
});
