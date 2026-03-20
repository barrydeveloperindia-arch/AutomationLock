import React, { useState, useEffect, useCallback } from 'react';
import {
    ShieldCheck, ShieldAlert, ShieldQuestion, Search, Filter,
    RefreshCw, Clock, Monitor, Activity, ChevronLeft, ChevronRight,
    ScanFace, Fingerprint, CreditCard, User, Loader2, X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { apiService } from '../services/api';

const PAGE_SIZE = 20;

// ── Status badge ───────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
    const map = {
        success: { label: 'Granted', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', Icon: ShieldCheck },
        failed: { label: 'Denied', bg: 'bg-red-500/10    text-red-400    border-red-500/20', Icon: ShieldAlert },
        ambiguous: { label: 'Ambiguous', bg: 'bg-amber-500/10  text-amber-400  border-amber-500/20', Icon: ShieldQuestion },
        warning: { label: 'Warning', bg: 'bg-orange-500/10 text-orange-400 border-orange-500/20', Icon: ShieldAlert },
    };
    const s = map[status] || map.failed;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${s.bg}`}>
            <s.Icon className="w-3 h-3" />
            {s.label}
        </span>
    );
};

// ── Method badge ───────────────────────────────────────────────────────────────
const MethodBadge = ({ method }) => {
    const map = {
        face: { label: 'Face', Icon: ScanFace, cls: 'text-blue-400' },
        fingerprint: { label: 'Fingerprint', Icon: Fingerprint, cls: 'text-violet-400' },
        remote: { label: 'Remote', Icon: Monitor, cls: 'text-emerald-400' },
        rfid: { label: 'RFID', Icon: CreditCard, cls: 'text-teal-400' },
        manual: { label: 'Manual', Icon: User, cls: 'text-slate-400' },
    };
    const m = map[method?.toLowerCase()] || map.face;
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${m.cls}`}>
            <m.Icon className="w-3.5 h-3.5" />
            {m.label}
        </span>
    );
};

// ── Confidence bar ─────────────────────────────────────────────────────────────
const ConfidenceBar = ({ value }) => {
    if (value == null) return <span className="text-slate-700 text-[11px]">—</span>;
    const pct = Math.round(value * 100);
    const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2 w-28">
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-bold text-slate-500 w-8 text-right">{pct}%</span>
        </div>
    );
};

// ── Stat pill ─────────────────────────────────────────────────────────────────
const StatPill = ({ label, value, color, icon: Icon }) => (
    <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border border-white/[0.06] rounded-xl">
        <Icon className={`w-4 h-4 ${color}`} />
        <div>
            <p className="text-[18px] font-black text-white leading-none">{value ?? '--'}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
        </div>
    </div>
);

export default function Logs() {
    const navigate = useNavigate();
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [refreshing, setRefreshing] = useState(false);

    // Filters
    const today = format(new Date(), 'yyyy-MM-dd');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [method, setMethod] = useState('');
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);

    const fetchLogs = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        try {
            const params = {
                page,
                limit: PAGE_SIZE,
                ...(search && { search }),
                ...(status && { status }),
                ...(method && { method }),
                ...(startDate && { startDate }),
                ...(endDate && { endDate }),
            };
            const res = await apiService.getAccessLogs(params);
            setLogs(res.logs || []);
            setTotal(res.total || res.pagination?.total || 0);
        } catch (err) {
            console.error('Failed to fetch logs', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [page, search, status, method, startDate, endDate]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    // Auto-refresh every 30s
    useEffect(() => {
        const t = setInterval(() => fetchLogs(true), 30_000);
        return () => clearInterval(t);
    }, [fetchLogs]);

    const resetFilters = () => {
        setSearch(''); setStatus(''); setMethod('');
        setStartDate(today); setEndDate(today); setPage(1);
    };
    const hasFilter = search || status || method || startDate !== today || endDate !== today;

    const totalPages = Math.ceil(total / PAGE_SIZE);

    // Summary counts from loaded page
    const granted = logs.filter(l => l.status === 'success').length;
    const denied = logs.filter(l => l.status === 'failed').length;
    const ambiguous = logs.filter(l => l.status === 'ambiguous').length;

    const inputCls = 'bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 transition-colors';
    const selCls = `${inputCls} appearance-none cursor-pointer`;

    return (
        <div className="space-y-6 animate-in fade-in duration-700">

            {/* ── Header ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white mb-1 tracking-tighter">Security Audit Log</h1>
                    <p className="text-slate-500 text-[10px] md:text-sm">Real-time biometric access events &mdash; every scan attempt recorded</p>
                </div>
                <button onClick={() => fetchLogs(true)} disabled={refreshing}
                    className="flex items-center gap-2 px-4 py-2 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] rounded-xl text-slate-400 hover:text-white text-xs font-bold transition-all disabled:opacity-50">
                    {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Refresh
                </button>
            </div>

            {/* ── Stat pills ── */}
            <div className="flex flex-wrap gap-3">
                <StatPill label="Total Events" value={total} color="text-blue-400" icon={Activity} />
                <StatPill label="Granted" value={granted} color="text-emerald-400" icon={ShieldCheck} />
                <StatPill label="Denied" value={denied} color="text-red-400" icon={ShieldAlert} />
                <StatPill label="Ambiguous" value={ambiguous} color="text-amber-400" icon={ShieldQuestion} />
            </div>

            {/* ── Filters ── */}
            <div className="card !p-4">
                <div className="flex flex-wrap gap-3 items-center">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[180px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                        <input type="text" placeholder="Search employee name…" value={search}
                            onChange={e => { setSearch(e.target.value); setPage(1); }}
                            className={`${inputCls} pl-8 w-full`} />
                    </div>

                    {/* Status */}
                    <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={selCls}>
                        <option value="">All Status</option>
                        <option value="success">Granted</option>
                        <option value="failed">Denied</option>
                        <option value="ambiguous">Ambiguous</option>
                        <option value="warning">Warning</option>
                    </select>

                    {/* Method */}
                    <select value={method} onChange={e => { setMethod(e.target.value); setPage(1); }} className={selCls}>
                        <option value="">All Methods</option>
                        <option value="FACE">Face</option>
                        <option value="FINGERPRINT">Fingerprint</option>
                        <option value="REMOTE">Remote</option>
                        <option value="RFID">RFID</option>
                        <option value="manual">Manual</option>
                    </select>

                    {/* Date range */}
                    <input type="date" value={startDate} max={endDate}
                        onChange={e => { setStartDate(e.target.value); setPage(1); }} className={inputCls} />
                    <span className="text-slate-700 text-xs font-bold">to</span>
                    <input type="date" value={endDate} min={startDate}
                        onChange={e => { setEndDate(e.target.value); setPage(1); }} className={inputCls} />

                    {/* Reset */}
                    {hasFilter && (
                        <button onClick={resetFilters}
                            className="flex items-center gap-1.5 px-3 py-2 text-slate-500 hover:text-white text-xs font-bold transition-colors">
                            <X className="w-3.5 h-3.5" /> Reset
                        </button>
                    )}
                </div>
            </div>

            {/* ── Table ── */}
            <div className="card !p-0 overflow-hidden">
                {/* Table header bar */}
                <div className="px-6 py-3 border-b border-white/[0.05] flex items-center justify-between bg-white/[0.01]">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Live Access Stream</span>
                    </div>
                    <span className="text-[10px] text-slate-600 font-bold">{total} total events</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-900/50 text-slate-600 text-[10px] font-bold uppercase tracking-widest border-b border-white/[0.05]">
                                <th className="px-4 md:px-6 py-3">Subject</th>
                                <th className="px-4 md:px-6 py-3">Method</th>
                                <th className="hidden lg:table-cell px-6 py-3">Timestamp</th>
                                <th className="hidden xl:table-cell px-6 py-3">Confidence</th>
                                <th className="hidden md:table-cell px-6 py-3">Device</th>
                                <th className="px-4 md:px-6 py-3 text-right">Result</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {loading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        {Array.from({ length: 6 }).map((_, j) => (
                                            <td key={j} className="px-6 py-4">
                                                <div className="h-4 bg-white/[0.04] rounded-lg" />
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-24 text-center">
                                        <div className="flex flex-col items-center gap-3 opacity-30">
                                            <Activity className="w-10 h-10 text-blue-400 animate-pulse" />
                                            <p className="font-bold uppercase tracking-widest text-xs">No events found</p>
                                            {hasFilter && <p className="text-slate-600 text-xs">Try adjusting your filters</p>}
                                        </div>
                                    </td>
                                </tr>
                            ) : logs.map(log => (
                                <tr key={log.id}
                                    onClick={() => log.employee_id && navigate(`/admin/access/employee/${log.employee_id}`)}
                                    className={`hover:bg-white/[0.03] cursor-pointer transition-all duration-300 group active:scale-[0.995] ${log.status === 'failed' ? 'border-l-2 border-red-500/30' : log.status === 'ambiguous' ? 'border-l-2 border-amber-500/30' : 'border-l-2 border-transparent'}`}>

                                    {/* Subject */}
                                    <td className="px-4 md:px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-white/[0.06] overflow-hidden shrink-0">
                                                {log.employees?.image_url
                                                    ? <img src={log.employees.image_url} alt="" className="w-full h-full object-cover" />
                                                    : <div className="w-full h-full flex items-center justify-center text-slate-600 font-black text-[10px]">
                                                        {log.employees?.name?.[0] || '?'}
                                                    </div>}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold text-white leading-tight truncate">
                                                    {log.employees?.name ? log.employees.name : (
                                                        log.method === 'REMOTE' ? 'Remote Unlock' :
                                                            log.method === 'FINGERPRINT' ? 'Unknown Fingerprint' : 'Unknown Person'
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-slate-600 font-medium truncate">
                                                    {log.employees?.employee_id || (log.method === 'REMOTE' ? 'Admin Panel' : 'No ID')}
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Method */}
                                    <td className="px-4 md:px-6 py-4"><MethodBadge method={log.method} /></td>

                                    {/* Timestamp */}
                                    <td className="hidden lg:table-cell px-6 py-4">
                                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                                            <Clock className="w-3 h-3 text-slate-600 shrink-0" />
                                            <div>
                                                <div>{format(parseISO(log.created_at), 'dd MMM yyyy')}</div>
                                                <div className="text-slate-600">{format(parseISO(log.created_at), 'HH:mm:ss')}</div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Confidence */}
                                    <td className="hidden xl:table-cell px-6 py-4"><ConfidenceBar value={log.confidence} /></td>

                                    {/* Device */}
                                    <td className="hidden md:table-cell px-6 py-4">
                                        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                                            <Monitor className="w-3.5 h-3.5 text-slate-700" />
                                            {log.device_id || 'terminal_01'}
                                        </span>
                                    </td>

                                    {/* Result */}
                                    <td className="px-4 md:px-6 py-4 text-right">
                                        <StatusBadge status={log.status} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* ── Pagination ── */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/[0.05] flex items-center justify-between gap-4 bg-white/[0.01]">
                        <span className="text-[11px] text-slate-600 font-bold">
                            Page {page} of {totalPages} &bull; {total} events
                        </span>
                        <div className="flex items-center gap-1">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                className="p-1.5 rounded-lg hover:bg-white/[0.05] disabled:opacity-30 transition-colors">
                                <ChevronLeft className="w-4 h-4 text-slate-400" />
                            </button>
                            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                                const pg = Math.max(1, Math.min(page - 3, totalPages - 6)) + i;
                                if (pg < 1 || pg > totalPages) return null;
                                return (
                                    <button key={pg} onClick={() => setPage(pg)}
                                        className={`w-7 h-7 rounded-lg text-[11px] font-black transition-all ${pg === page
                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                                            : 'text-slate-500 hover:bg-white/[0.05] hover:text-white'}`}>
                                        {pg}
                                    </button>
                                );
                            })}
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                                className="p-1.5 rounded-lg hover:bg-white/[0.05] disabled:opacity-30 transition-colors">
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
