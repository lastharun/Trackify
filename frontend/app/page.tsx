'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Package, TrendingUp, AlertCircle, Plus, ArrowRight, Trash2, Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function Dashboard() {
    const [stats, setStats] = useState<{ totalProducts: number, priceChanges: number, recentChanges: any[] }>({ totalProducts: 0, priceChanges: 0, recentChanges: [] });
    const [products, setProducts] = useState<any[]>([]);
    const [totalProducts, setTotalProducts] = useState(0);
    const [prices, setPrices] = useState<Record<number, any>>({});

    // Filtering / Sorting / Pagination States
    const [search, setSearch] = useState('');
    const [domainFilter, setDomainFilter] = useState('all');
    const [sortField, setSortField] = useState('unread_changes');
    const [sortOrder, setSortOrder] = useState('DESC');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);

    // Sidebar State
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [newUrl, setNewUrl] = useState('');
    const [newDomain, setNewDomain] = useState('trendyol');
    const [newInterval, setNewInterval] = useState(30);
    const [loading, setLoading] = useState(false);
    const [now, setNow] = useState(Date.now());

    // Live ticker - updates every second
    useEffect(() => {
        const ticker = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(ticker);
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 15000);
        return () => clearInterval(interval);
    }, [search, domainFilter, sortField, sortOrder, page, limit]);

    const fetchData = async () => {
        try {
            const offset = (page - 1) * limit;
            const queryParams = new URLSearchParams({
                search,
                domain: domainFilter,
                sort: sortField,
                order: sortOrder,
                limit: limit.toString(),
                offset: offset.toString()
            });

            const [statsRes, prodRes] = await Promise.all([
                fetch('http://localhost:3001/api/stats'),
                fetch(`http://localhost:3001/api/products?${queryParams}`)
            ]);

            const statsData = await statsRes.json();
            const prodData = await prodRes.json();

            setStats(statsData);
            setProducts(prodData.products || []);
            setTotalProducts(prodData.total || 0);

            // Fetch latest price for each product in parallel
            if (prodData.products) {
                const priceResults = await Promise.all(
                    prodData.products.map((p: any) =>
                        fetch(`http://localhost:3001/api/products/${p.id}/history`)
                            .then(r => r.json())
                            .then(h => ({ id: p.id, latest: h.priceHistory?.[0] || null }))
                            .catch(() => ({ id: p.id, latest: null }))
                    )
                );
                const priceMap: Record<number, any> = {};
                priceResults.forEach(r => { priceMap[r.id] = r.latest; });
                setPrices(priceMap);
            }
        } catch (e) {
            console.error('Error fetching data', e);
        }
    };

    const handleAddProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await fetch('http://localhost:3001/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: newUrl,
                    domain: newDomain,
                    trackingInterval: newInterval
                })
            });
            setNewUrl('');
            fetchData();
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Bu ürünü takipten çıkarmak istiyor musunuz?')) return;
        try {
            await fetch(`http://localhost:3001/api/products/${id}`, { method: 'DELETE' });
            fetchData();
        } catch (e) {
            console.error(e);
        }
    };

    const getElapsed = (lastCheckedAt: string | null) => {
        if (!lastCheckedAt) return null;
        const checked = new Date(lastCheckedAt + (lastCheckedAt.endsWith('Z') ? '' : 'Z')).getTime();
        const secs = Math.floor((now - checked) / 1000);
        if (secs < 60) return `${secs}sn önce`;
        if (secs < 3600) return `${Math.floor(secs / 60)}dk ${secs % 60}sn önce`;
        return `${Math.floor(secs / 3600)}sa önce`;
    };

    const toggleSort = (field: string) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
        } else {
            setSortField(field);
            setSortOrder('DESC');
        }
    };

    const totalPages = Math.ceil(totalProducts / limit);

    return (
        <div className="flex min-h-screen bg-[#F8FAFC]">

            {/* Sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-slate-200 transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-64' : 'w-16'}`}>
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-4 h-20 border-b border-slate-100 flex items-center justify-between overflow-hidden">
                        {sidebarOpen && (
                            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4">
                                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-200">
                                    <TrendingUp className="w-5 h-5 text-white" />
                                </div>
                                <span className="font-bold text-lg text-slate-800 tracking-tight lowercase">takip</span>
                            </div>
                        )}
                        <button
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            className={`p-2 hover:bg-slate-100 rounded-lg transition-all ${!sidebarOpen ? 'mx-auto' : ''}`}
                        >
                            {sidebarOpen ? <ChevronLeft className="w-5 h-5 text-slate-400" /> : <TrendingUp className="w-5 h-5 text-blue-600" />}
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-8 space-y-10">
                        {/* Stats Widgets */}
                        <div className="space-y-4">
                            <div className={`group p-4 rounded-2xl border transition-all ${sidebarOpen ? 'bg-blue-50/30 border-blue-100 hover:border-blue-200' : 'p-0 border-none'}`}>
                                <div className={`flex items-center gap-4 ${!sidebarOpen ? 'justify-center py-2' : ''}`}>
                                    <div className="w-10 h-10 rounded-xl bg-white border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm">
                                        <Package className="w-5 h-5" />
                                    </div>
                                    {sidebarOpen && (
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Takiptekiler</p>
                                            <p className="text-xl font-black text-slate-900">{stats.totalProducts}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className={`group p-4 rounded-2xl border transition-all ${sidebarOpen ? 'bg-orange-50/30 border-orange-100 hover:border-orange-200' : 'p-0 border-none'}`}>
                                <div className={`flex items-center gap-4 ${!sidebarOpen ? 'justify-center py-2' : ''}`}>
                                    <div className="w-10 h-10 rounded-xl bg-white border border-orange-100 flex items-center justify-center text-orange-600 shadow-sm">
                                        <TrendingUp className="w-5 h-5" />
                                    </div>
                                    {sidebarOpen && (
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Değişimler</p>
                                            <p className="text-xl font-black text-slate-900">{stats.priceChanges}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {sidebarOpen && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                {/* Form Section */}
                                <div className="bg-slate-50/50 rounded-2xl p-6 border border-slate-100">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <Plus className="w-4 h-4 text-blue-600" /> Yeni Takip
                                    </h3>
                                    <form onSubmit={handleAddProduct} className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-slate-500 ml-1">PAZARYERİ</label>
                                            <select
                                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-4 focus:ring-blue-50 outline-none transition-all"
                                                value={newDomain} onChange={e => setNewDomain(e.target.value)}
                                            >
                                                <option value="trendyol">Trendyol</option>
                                                <option value="hepsiburada">Hepsiburada</option>
                                                <option value="amazon">Amazon</option>
                                                <option value="generic">Diğer</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-slate-500 ml-1">SIKLIK</label>
                                            <select
                                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                                value={newInterval} onChange={e => setNewInterval(Number(e.target.value))}
                                            >
                                                <option value={1}>1 Dakika</option>
                                                <option value={30}>30 Dakika</option>
                                                <option value={60}>1 Saat</option>
                                                <option value={1440}>1 Gün</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-slate-500 ml-1">ÜRÜN URL</label>
                                            <input
                                                type="url" required placeholder="https://..."
                                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-blue-50 transition-all font-mono"
                                                value={newUrl} onChange={e => setNewUrl(e.target.value)}
                                            />
                                        </div>
                                        <button
                                            disabled={loading}
                                            className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                                        >
                                            {loading ? 'Ekleniyor...' : 'Takibi Başlat'}
                                        </button>
                                    </form>
                                </div>

                                {/* Activity Feed */}
                                <div className="space-y-4 px-2">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                                        Canlı Hareketler
                                        <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
                                    </h3>
                                    <div className="space-y-3">
                                        {stats.recentChanges?.slice(0, 3).map((c: any) => (
                                            <div key={c.id} className="text-[11px] bg-white p-3 rounded-xl border border-slate-100 shadow-sm opacity-80 hover:opacity-100 transition-opacity">
                                                <div className="flex justify-between font-bold text-slate-900 mb-1">
                                                    <span>Ürün #{c.product_id}</span>
                                                    <span className="text-blue-600 italic">+{c.change_type}</span>
                                                </div>
                                                <div className="text-slate-500 truncate">{c.new_value}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* Main Area */}
            <main className={`flex-1 transition-all duration-300 ease-in-out ${sidebarOpen ? 'ml-64' : 'ml-16'}`}>
                <div className="p-6 w-full space-y-6">

                    {/* Header Bar */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="hidden sm:block">
                            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Sistem Durumu: Aktif</p>
                        </div>

                        {/* Search & Global Filter */}
                        <div className="flex items-center gap-4 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm w-full lg:w-auto">
                            <div className="relative flex-1 lg:w-80">
                                <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3" />
                                <input
                                    type="text" placeholder="Ürün veya URL ara..."
                                    className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-blue-50 transition-all"
                                    value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                                />
                            </div>
                            <div className="w-px h-8 bg-slate-200 hidden md:block"></div>
                            <div className="flex items-center gap-2">
                                <Filter className="w-4 h-4 text-slate-400" />
                                <select
                                    className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer pr-4"
                                    value={domainFilter} onChange={e => { setDomainFilter(e.target.value); setPage(1); }}
                                >
                                    <option value="all">Hepsi</option>
                                    <option value="trendyol">Trendyol</option>
                                    <option value="hepsiburada">Hepsiburada</option>
                                    <option value="amazon">Amazon</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Table Section */}
                    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/40 overflow-hidden group">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-[#F8FAFC] border-b border-slate-100">
                                    <tr>
                                        {[
                                            { label: 'Ürün Bilgisi', sort: 'title' },
                                            { label: 'Platform', sort: 'domain' },
                                            { label: 'Fiyat Durumu', sort: 'price' },
                                            { label: 'Sıklık', sort: 'tracking_interval' },
                                            { label: 'Son Hareket', sort: 'updated_at' },
                                            { label: 'Check', sort: 'last_checked_at' }
                                        ].map(h => (
                                            <th key={h.sort}
                                                className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] cursor-pointer hover:bg-slate-100 transition-colors"
                                                onClick={() => toggleSort(h.sort)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    {h.label}
                                                    {sortField === h.sort && (
                                                        <span className="text-blue-600 animate-in fade-in zoom-in duration-300">
                                                            {sortOrder === 'ASC' ? '▲' : '▼'}
                                                        </span>
                                                    )}
                                                </div>
                                            </th>
                                        ))}
                                        <th className="px-8 py-6 text-right w-20"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {products.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-8 py-32 text-center">
                                                <div className="flex flex-col items-center gap-4 animate-in fade-in duration-1000">
                                                    <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center">
                                                        <Package className="w-10 h-10 text-slate-200" />
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-900 font-black text-lg">Eşleşen sonuç yok</p>
                                                        <p className="text-slate-400 text-sm mt-1">Farklı bir arama terimi veya filtre deneyin.</p>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {products.map((p, idx) => {
                                        const lastPriceChange = stats.recentChanges?.find((c: any) => c.product_id === p.id && c.change_type === 'PRICE');
                                        return (
                                            <tr key={p.id}
                                                className={`group/row transition-all hover:bg-blue-50/20 ${p.unread_changes > 0 ? 'bg-blue-50/40' : ''}`}
                                                style={{ animationDelay: `${idx * 50}ms` }}
                                            >
                                                <td className="px-8 py-6">
                                                    <div className="flex flex-col max-w-sm">
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-bold text-slate-900 truncate" title={p.title || p.url}>
                                                                {p.title || 'Veri Bekleniyor...'}
                                                            </span>
                                                            {p.unread_changes > 0 && (
                                                                <span className="bg-blue-600 text-white text-[8px] font-black px-2 py-0.5 rounded-full shadow-lg shadow-blue-100 uppercase tracking-tighter">YENİ</span>
                                                            )}
                                                        </div>
                                                        <span className="text-[11px] text-slate-400 font-medium truncate mt-1">{p.url}</span>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6">
                                                    <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider ${p.domain === 'hepsiburada' ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                                                        p.domain === 'trendyol' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                                                            'bg-slate-100 text-slate-600 border border-slate-200'
                                                        }`}>
                                                        {p.domain}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-6">
                                                    {prices[p.id] ? (
                                                        <div className="flex flex-col">
                                                            <span className="text-xl font-black text-slate-900 tabular-nums">
                                                                {prices[p.id].price?.toLocaleString('tr-TR')} <span className="text-sm font-bold text-slate-400 ml-1">{prices[p.id].currency || 'TL'}</span>
                                                            </span>
                                                            {lastPriceChange && (
                                                                <span className={`flex items-center gap-1 text-[10px] font-black mt-1 ${Number(lastPriceChange.new_value) < Number(lastPriceChange.old_value) ? 'text-emerald-500' : 'text-rose-500'
                                                                    }`}>
                                                                    {Number(lastPriceChange.new_value) < Number(lastPriceChange.old_value) ? '▼ Fırsat Yakalandı' : '▲ Fiyat Artışı'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : p.last_extraction_status === 'PRODUCT_NOT_FOUND' ? (
                                                        <div className="flex items-center gap-2 text-rose-600 bg-rose-50 px-3 py-1.5 rounded-xl w-fit border border-rose-100">
                                                            <AlertCircle className="w-3.5 h-3.5" />
                                                            <span className="text-[10px] font-black uppercase tracking-widest">Kaldırıldı</span>
                                                        </div>
                                                    ) : (
                                                        <div className="h-10 w-32 bg-slate-50 rounded-xl animate-pulse"></div>
                                                    )}
                                                </td>
                                                <td className="px-8 py-6 font-bold text-slate-500 text-sm">{p.tracking_interval}dk</td>
                                                <td className="px-8 py-6">
                                                    {lastPriceChange ? (
                                                        <div className="flex items-center gap-2 group-hover/row:scale-110 transition-transform origin-left">
                                                            <span className="px-2 py-1 bg-slate-50 rounded text-[11px] font-bold text-slate-400 line-through tabular-nums">{lastPriceChange.old_value}</span>
                                                            <ArrowRight className="w-4 h-4 text-slate-300" />
                                                            <span className="text-sm font-black text-blue-600 tabular-nums underline decoration-blue-200 underline-offset-4">{lastPriceChange.new_value}</span>
                                                        </div>
                                                    ) : <span className="text-slate-300">---</span>}
                                                </td>
                                                <td className="px-8 py-6 font-black text-slate-400 text-[10px] uppercase tracking-tighter">
                                                    {p.last_checked_at ? getElapsed(p.last_checked_at) : 'Sıraya Alındı'}
                                                </td>
                                                <td className="px-8 py-6 text-right">
                                                    <div className="flex items-center justify-end gap-1 opacity-0 translate-x-4 group-hover/row:opacity-100 group-hover/row:translate-x-0 transition-all duration-300">
                                                        <Link href={`/products/${p.id}`} className="p-3 text-slate-900 bg-white border border-slate-200 rounded-2xl hover:bg-slate-900 hover:text-white transition-all shadow-sm">
                                                            <ArrowRight className="w-5 h-5" />
                                                        </Link>
                                                        <button onClick={() => handleDelete(p.id)} className="p-3 text-rose-500 bg-white border border-slate-200 rounded-2xl hover:bg-rose-500 hover:text-white transition-all shadow-sm">
                                                            <Trash2 className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Bar */}
                        <div className="px-10 py-8 bg-[#F8FAFC] flex flex-col sm:flex-row items-center justify-between border-t border-slate-100 gap-8">
                            <div className="flex items-center gap-10">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sayfa Başı Karar</p>
                                    <div className="flex gap-2">
                                        {[10, 25, 50].map(v => (
                                            <button
                                                key={v} onClick={() => { setLimit(v); setPage(1); }}
                                                className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${limit === v ? 'bg-slate-900 text-white shadow-xl' : 'bg-white border text-slate-400 hover:border-slate-300'}`}
                                            >
                                                {v}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="h-10 w-px bg-slate-200"></div>
                                <p className="text-sm font-bold text-slate-500">
                                    Görüntülenen: <span className="text-slate-900">{(page - 1) * limit + 1}-{Math.min(page * limit, totalProducts)}</span> / <span>{totalProducts}</span>
                                </p>
                            </div>

                            <div className="flex items-center gap-1.5">
                                <button
                                    disabled={page === 1} onClick={() => setPage(page - 1)}
                                    className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-900 hover:text-white hover:border-slate-900 disabled:opacity-30 transition-all shadow-sm group"
                                >
                                    <ChevronLeft className="w-6 h-6 group-active:scale-75 transition-transform" />
                                </button>
                                <div className="flex gap-1.5">
                                    {Array.from({ length: totalPages }, (_, i) => i + 1).filter(pNum => pNum === 1 || pNum === totalPages || (pNum >= page - 1 && pNum <= page + 1)).map((pNum, i, arr) => (
                                        <div key={pNum} className="flex items-center gap-1.5">
                                            {i > 0 && arr[i - 1] !== pNum - 1 && <span className="text-slate-300 font-black">...</span>}
                                            <button
                                                onClick={() => setPage(pNum)}
                                                className={`w-12 h-12 rounded-2xl font-black text-sm transition-all ${page === pNum ? 'bg-blue-600 text-white shadow-xl shadow-blue-200 -translate-y-1' : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'}`}
                                            >
                                                {pNum}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                                    className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-900 hover:text-white hover:border-slate-900 disabled:opacity-30 transition-all shadow-sm group"
                                >
                                    <ChevronRight className="w-6 h-6 group-active:scale-75 transition-transform" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
