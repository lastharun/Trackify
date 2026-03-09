'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowLeft, Clock, MonitorSmartphone, CheckCircle, XCircle, ShieldAlert, AlertCircle, Info, Link2, ExternalLink, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { useParams } from 'next/navigation';

export default function ProductDetail() {
    const params = useParams();
    const [product, setProduct] = useState<any>(null);
    const [history, setHistory] = useState<any>({ priceHistory: [], sellerHistory: [], stockHistory: [] });
    const [changes, setChanges] = useState<any[]>([]);
    const [scrapeLogs, setScrapeLogs] = useState<any[]>([]);

    useEffect(() => {
        if (!params.id) return;

        const fetchAll = async () => {
            try {
                const [pRes, hRes, cRes, lRes] = await Promise.all([
                    fetch(`http://localhost:3001/api/products/${params.id}`),
                    fetch(`http://localhost:3001/api/products/${params.id}/history`),
                    fetch(`http://localhost:3001/api/products/${params.id}/changes`),
                    fetch(`http://localhost:3001/api/products/${params.id}/logs`)
                ]);
                setProduct(await pRes.json());
                setHistory(await hRes.json());
                setChanges(await cRes.json());
                setScrapeLogs(await lRes.json());
            } catch (e) {
                console.error(e);
            }
        };
        fetchAll();
        const interval = setInterval(fetchAll, 10000); // 10s refresh for testing
        return () => clearInterval(interval);
    }, [params.id]);

    if (!product) return <div className="p-12 text-center text-slate-500">Ürün Verisi Yükleniyor...</div>;

    const chartData = history.priceHistory.map((h: any) => ({
        date: format(new Date(h.timestamp + 'Z'), 'MM/dd HH:mm'),
        price: h.price
    })).reverse(); // Oldest first for chart

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-12">

            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 truncate max-w-3xl" title={product.title}>{product.title || product.url}</h1>
                        <p className="text-sm text-slate-500 flex items-center gap-2 mt-1">
                            <span className="capitalize">{product.domain}</span>
                            <span>•</span>
                            <a href={product.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Orijinal Sayfayı Gör</a>
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap gap-3 mb-6">
                {product.last_extraction_status === 'WAF_BLOCKED' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg border border-rose-200 text-xs font-bold uppercase tracking-wider">
                        <ShieldAlert className="w-4 h-4" /> Erişim Engellendi (Akamai/Bot)
                    </div>
                )}
                {product.last_extraction_status === 'PARTIAL_DATA' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg border border-amber-200 text-xs font-bold uppercase tracking-wider">
                        <AlertCircle className="w-4 h-4" /> Eksik Veri / Sayfa Yapısı Değişmiş
                    </div>
                )}
                {product.last_extraction_status === 'SUCCESS' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 text-xs font-bold uppercase tracking-wider">
                        <CheckCircle className="w-4 h-4" /> Sistem Sağlıklı
                    </div>
                )}
                {product.last_extraction_status === 'TIMEOUT' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-slate-700 rounded-lg border border-slate-200 text-xs font-bold uppercase tracking-wider">
                        <Clock className="w-4 h-4" /> Zaman Aşımı
                    </div>
                )}
            </div>

            {/* Debug Panel Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <div className="lg:col-span-2 bg-slate-900 rounded-xl p-5 text-slate-300 font-mono text-sm border border-slate-800 shadow-xl overflow-hidden relative">
                    <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                        <h4 className="flex items-center gap-2 text-slate-100 font-sans font-bold uppercase tracking-widest text-xs">
                            <MonitorSmartphone className="w-4 h-4 text-blue-400" /> Gelişmiş Telemetri
                        </h4>
                        <div className="flex gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${product.last_status_code >= 200 && product.last_status_code < 300 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                HTTP {product.last_status_code || '???'}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex flex-col gap-1">
                            <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Final URL (Redirect):</span>
                            <span className="text-blue-400 break-all hover:underline cursor-pointer flex items-center gap-1">
                                {product.last_final_url || product.url} <ExternalLink className="w-3 h-3" />
                            </span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Sayfa Başlığı (DOM Title):</span>
                            <span className="text-slate-300 italic">"{product.last_page_title || 'Başlık alınamadı'}"</span>
                        </div>
                        <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded border border-slate-700">
                            <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Hata Mesajı:</span>
                            <span className="text-rose-400 font-medium">{product.last_failure_reason || 'Sorun Saptanmadı'}</span>
                        </div>
                    </div>

                    <div className="mt-4 flex gap-3">
                        <div className="text-[10px] text-slate-500">DENEME: <span className="text-slate-300">{product.retry_count || 0}</span></div>
                        <div className="text-[10px] text-slate-500">SON KONTROL: <span className="text-slate-300">{product.last_checked_at ? format(new Date(product.last_checked_at + 'Z'), 'HH:mm:ss') : '-'}</span></div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center">
                        <RefreshCw className="w-6 h-6 text-blue-500" />
                    </div>
                    <h5 className="font-bold text-slate-900">Manuel Test</h5>
                    <p className="text-xs text-slate-500 px-4">Şu anki kuyruğu beklemeden hemen bir tarama başlat.</p>
                    <button
                        onClick={async () => {
                            const res = await fetch(`http://localhost:3001/api/products/${params.id}/run`, { method: 'POST' });
                            const data = await res.json();
                            alert(data.message || 'Taramaya eklendi!');
                        }}
                        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-shadow shadow-sm active:scale-95"
                    >
                        Şimdi Tara
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

                {/* Stats */}
                <div className="card p-6 flex flex-col justify-center min-h-[120px] md:col-span-1">
                    <p className="text-sm font-medium text-slate-500 mb-1">Güncel Fiyat</p>
                    <div className="flex flex-col">
                        <p className="text-3xl font-bold text-blue-600">
                            {history.priceHistory[0]?.price ? `${history.priceHistory[0].price.toLocaleString('tr-TR')} ${history.priceHistory[0].currency || 'TL'}` : '-'}
                        </p>
                        {history.priceHistory[0]?.original_price && history.priceHistory[0].original_price !== history.priceHistory[0].price && (
                            <p className="text-xs text-slate-400 line-through mt-1">
                                Orijinal: {history.priceHistory[0].original_price.toLocaleString('tr-TR')} TL
                            </p>
                        )}
                        {history.priceHistory[0]?.discounted_price && (
                            <p className="text-xs text-rose-500 font-bold mt-0.5">
                                Sepette: {history.priceHistory[0].discounted_price.toLocaleString('tr-TR')} TL
                            </p>
                        )}
                    </div>
                </div>

                <div className="card p-6 flex flex-col justify-center gap-2 md:col-span-1">
                    <p className="text-sm font-medium text-slate-500">Durum</p>
                    {product.last_extraction_status === 'WAF_BLOCKED' || product.last_extraction_status === 'SELECTOR_BROKEN' ? (
                        <div className="flex items-center gap-2 text-rose-600 font-medium">
                            <XCircle className="w-5 h-5" /> Veri Alınamadı
                        </div>
                    ) : history.stockHistory[0]?.is_in_stock ? (
                        <div className="flex items-center gap-2 text-green-600 font-medium">
                            <CheckCircle className="w-5 h-5" /> Stokta Var
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-orange-600 font-medium">
                            <XCircle className="w-5 h-5" /> Stokta Yok
                        </div>
                    )}
                </div>

                <div className="card p-6 flex flex-col justify-center gap-2 md:col-span-2">
                    <p className="text-sm font-medium text-slate-500">Kontrol Sıklığı</p>
                    <div className="flex items-center gap-2 text-slate-700 font-medium">
                        <Clock className="w-5 h-5 text-slate-400" /> Her {product.tracking_interval} dakikada bir
                    </div>
                </div>

            </div>

            {/* Chart */}
            <div className="card p-6 h-96">
                <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
                    <MonitorSmartphone className="w-5 h-5 text-blue-600" /> Fiyat Geçmişi
                </h3>
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="85%">
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis
                                dataKey="date"
                                stroke="#64748b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                dy={10}
                            />
                            <YAxis
                                stroke="#64748b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(val) => `₺${val}`}
                                dx={-10}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: '0.5rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            />
                            <Line
                                type="monotone"
                                dataKey="price"
                                stroke="#3b82f6"
                                strokeWidth={3}
                                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                                activeDot={{ r: 6, strokeWidth: 0 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex items-center justify-center text-slate-400">
                        Henüz yeterli veri noktası yok.
                    </div>
                )}
            </div>

            {/* Price History Table */}
            <div className="card p-6">
                <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
                    <MonitorSmartphone className="w-5 h-5 text-blue-600" /> Fiyat Geçmişi Tablosu
                </h3>
                {history.priceHistory.length === 0 ? (
                    <p className="text-slate-500 italic">Henüz fiyat kaydı yok.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    <th className="text-left py-3 px-4 text-slate-500 font-medium">#</th>
                                    <th className="text-left py-3 px-4 text-slate-500 font-medium">Ana Fiyat</th>
                                    <th className="text-left py-3 px-4 text-slate-500 font-medium">Orijinal / Sepet</th>
                                    <th className="text-left py-3 px-4 text-slate-500 font-medium">Önceki Fiyat</th>
                                    <th className="text-left py-3 px-4 text-slate-500 font-medium">Değişim</th>
                                    <th className="text-left py-3 px-4 text-slate-500 font-medium">Tarih</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.priceHistory.map((h: any, idx: number) => {
                                    const prev = history.priceHistory[idx + 1];
                                    const diff = prev ? (h.price - prev.price) : null;
                                    const diffPct = prev ? ((diff! / prev.price) * 100).toFixed(1) : null;
                                    return (
                                        <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                                            <td className="py-3 px-4 text-slate-400">{history.priceHistory.length - idx}</td>
                                            <td className="py-3 px-4 font-semibold text-slate-900">
                                                {h.price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {h.currency || 'TL'}
                                            </td>
                                            <td className="py-3 px-4 text-xs">
                                                {h.original_price ? (
                                                    <div className="text-slate-400 line-through">{h.original_price.toLocaleString('tr-TR')} TL</div>
                                                ) : <span className="text-slate-200">-</span>}
                                                {h.discounted_price ? (
                                                    <div className="text-rose-500 font-bold">Sepet: {h.discounted_price.toLocaleString('tr-TR')} TL</div>
                                                ) : null}
                                            </td>
                                            <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                                                {prev ? `${prev.price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${prev.currency || 'TL'}` : <span className="italic text-slate-300">İlk kayıt</span>}
                                            </td>
                                            <td className="py-3 px-4">
                                                {diff !== null ? (
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${diff > 0 ? 'bg-red-100 text-red-700' : diff < 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {Math.abs(diff).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL ({diffPct}%)
                                                    </span>
                                                ) : <span className="text-slate-300 text-xs">—</span>}
                                            </td>
                                            <td className="py-3 px-4 text-slate-400 text-xs">{format(new Date(h.timestamp + 'Z'), 'dd MMM yyyy, HH:mm')}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Change Logs */}
            <div className="card p-6">
                <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-blue-600" /> Değişiklik Kayıtları
                </h3>
                <div className="space-y-6">
                    {changes.length === 0 && <p className="text-slate-500 italic">Bu ürün için henüz değişiklik tespit edilmedi.</p>}
                    {changes.map((c: any) => (
                        <div key={c.id} className="flex gap-4 p-4 border border-slate-100 rounded-lg bg-slate-50/50">
                            <div className="flex flex-col items-center gap-1 pt-1">
                                <div className={`w-3 h-3 rounded-full ${c.change_type === 'PRICE' ? 'bg-blue-500' : c.change_type === 'STOCK' ? 'bg-orange-500' : 'bg-green-500'}`} />
                                <div className="w-px h-full bg-slate-200" />
                            </div>
                            <div className="flex-1 pb-4">
                                <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">{c.change_type} GÜNCELLEMESİ</p>
                                <p className="mt-1 text-slate-800">
                                    <span className="font-semibold">{c.field_changed}</span> eski değer:
                                    <span className="mx-2 px-2 py-0.5 bg-red-100 text-red-700 rounded text-sm line-through">{c.old_value || 'Yok'}</span>
                                    ➔
                                    <span className="mx-2 px-2 py-0.5 bg-green-100 text-green-700 rounded text-sm font-medium">{c.new_value}</span>
                                </p>
                                <p className="text-xs text-slate-400 mt-2">
                                    {format(new Date(c.timestamp + 'Z'), 'PPP p')}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Scrape Logs */}
            <div className="card p-6 border-slate-200">
                <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
                    <Info className="w-5 h-5 text-blue-600" /> Son Tarama Günlükleri (Arka Plan Kayıtları)
                </h3>
                {scrapeLogs.length === 0 ? (
                    <p className="text-slate-500 italic">Henüz tarama kaydı yok.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    <th className="text-left py-2 px-4 text-slate-500 font-medium">Süre/Tarih</th>
                                    <th className="text-left py-2 px-4 text-slate-500 font-medium">Durum</th>
                                    <th className="text-left py-2 px-4 text-slate-500 font-medium">Hiyerarşideki Başlık / Final URL</th>
                                    <th className="text-left py-2 px-4 text-slate-500 font-medium">Mesaj</th>
                                </tr>
                            </thead>
                            <tbody>
                                {scrapeLogs.map((log: any) => (
                                    <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                        <td className="py-2 px-4 text-slate-500 whitespace-nowrap">
                                            {format(new Date(log.timestamp + 'Z'), 'HH:mm:ss')}
                                            <div className="text-[9px] text-slate-400">{format(new Date(log.timestamp + 'Z'), 'dd/MM')}</div>
                                        </td>
                                        <td className="py-2 px-4">
                                            <span className={`px-2 py-0.5 rounded uppercase font-bold text-[8px] ${log.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' : log.status === 'WAF_BLOCKED' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                                {log.status_code || '???'} {log.status}
                                            </span>
                                        </td>
                                        <td className="py-2 px-4">
                                            <div className="text-slate-700 font-medium truncate max-w-sm" title={log.page_title}>{log.page_title || 'Başlık Yok'}</div>
                                            <div className="text-[9px] text-blue-400 truncate max-w-sm">{log.final_url || '-'}</div>
                                        </td>
                                        <td className="py-2 px-4 text-slate-500 italic">
                                            {log.failure_reason || 'Başarılı'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

        </div>
    );
}
