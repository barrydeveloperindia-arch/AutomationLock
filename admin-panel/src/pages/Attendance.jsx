import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, Clock, Fingerprint, ScanFace,
    ChevronLeft, ChevronRight, Search, FileText,
    Briefcase, Download, ArrowUpDown, ArrowUp, ArrowDown,
    Users, UserCheck, Timer, AlertTriangle, Loader2,
    CheckCircle2, X, Filter
} from 'lucide-react';
import { apiService } from '../services/api';
import { format, differenceInMinutes, parseISO, startOfWeek, startOfMonth } from 'date-fns';

const DEPARTMENTS = ['Engineering', 'Operations', 'Security', 'Management', 'HR'];
const PAGE_SIZE = 10;

// ── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce(value, delay = 300) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debouncedValue;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtTime = (iso) => iso ? format(new Date(iso), 'HH:mm:ss') : '—';
const fmtDate = (d) => d ? format(new Date(d), 'MMM dd, yyyy') : '—';

const workHoursDisplay = (record) => {
    // Prefer DB-stored working_hours value
    if (record.working_hours != null) {
        const h = Math.floor(record.working_hours);
        const m = Math.round((record.working_hours - h) * 60);
        return `${h}h ${String(m).padStart(2, '0')}m`;
    }
    // Fall back to calculated value
    if (!record.check_in || !record.check_out) return '—';
    const mins = differenceInMinutes(parseISO(record.check_out), parseISO(record.check_in));
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
    if (status === 'LATE')
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-black text-amber-400 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Late
            </span>
        );
    if (status === 'ON_TIME')
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-black text-emerald-400 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />On Time
            </span>
        );
    return <span className="text-[10px] text-slate-600 font-bold">—</span>;
}

// ── Method badge ──────────────────────────────────────────────────────────────
function MethodBadge({ method }) {
    const isFace = method === 'face';
    return (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border
            ${isFace ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-purple-500/10 border-purple-500/20 text-purple-400'}`}>
            {isFace ? <ScanFace className="w-3 h-3" /> : <Fingerprint className="w-3 h-3" />}
            {method || '—'}
        </div>
    );
}

// ── Sortable header cell ──────────────────────────────────────────────────────
function SortTh({ label, col, sortCol, sortDir, onSort, className = '' }) {
    const active = sortCol === col;
    const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
        <th
            className={`px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer
                        select-none hover:text-slate-300 transition-colors group ${className}`}
            onClick={() => onSort(col)}>
            <div className="flex items-center gap-1.5">
                {label}
                <Icon className={`w-3 h-3 transition-colors ${active ? 'text-blue-400' : 'text-slate-700 group-hover:text-slate-500'}`} />
            </div>
        </th>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Attendance() {
    const navigate = useNavigate();
    const [attendance, setAttendance] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [totalRecords, setTotalRecords] = useState(0);
    const [loading, setLoading] = useState(true);

    // Filters
    const today = format(new Date(), 'yyyy-MM-dd');
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [selectedDept, setSelectedDept] = useState('');
    const [searchInput, setSearchInput] = useState('');   // raw (undelayed)
    const [selectedStatus, setSelectedStatus] = useState('');   // '' | 'ON_TIME' | 'LATE'
    const [activePreset, setActivePreset] = useState('today'); // today|week|month|custom

    // Debounce the search input — only triggers fetch after 300 ms of no typing
    const searchTerm = useDebounce(searchInput, 300);

    // Pagination + Sorting
    const [page, setPage] = useState(1);
    const [sortCol, setSortCol] = useState('date');
    const [sortDir, setSortDir] = useState('desc');

    const [exporting, setExporting] = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);

    useEffect(() => { fetchEmployees(); }, []);

    // Re-fetch whenever any filter / sort / page changes
    useEffect(() => {
        fetchAttendanceData();
    }, [startDate, endDate, selectedEmployee, selectedDept, searchTerm, selectedStatus, page, sortCol, sortDir]);

    // Reset page to 1 when any filter that's not page changes
    useEffect(() => { setPage(1); }, [startDate, endDate, selectedEmployee, selectedDept, searchTerm, selectedStatus]);

    const fetchEmployees = async () => {
        try {
            const data = await apiService.getUsers();
            setEmployees(data || []);
        } catch (err) {
            console.error('Failed to fetch employees:', err);
        }
    };

    const fetchAttendanceData = async () => {
        setLoading(true);
        try {
            const result = await apiService.getAttendance({
                startDate, endDate,
                employee_id: selectedEmployee,
                department: selectedDept,
                search: searchTerm,
                status: selectedStatus,   // ← NEW
                page,
                pageSize: PAGE_SIZE,
                sortBy: sortCol,
                sortDir,
            });
            setAttendance(result.data || []);
            setTotalRecords(result.total || 0);
        } catch (err) {
            console.error('Failed to fetch attendance:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSort = useCallback((col) => {
        if (sortCol === col) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortCol(col);
            setSortDir('desc');
        }
        setPage(1);
    }, [sortCol]);

    const handleExport = async () => {
        setExporting(true);
        try {
            // Derive month/year from the startDate for convenient monthly exports
            const [yr, mo] = startDate.split('-');
            const params = {
                startDate,
                endDate,
                month: mo,
                year: yr,
                employee_id: selectedEmployee,
                department: selectedDept,
            };
            const blob = await apiService.exportAttendanceExcel(params);
            const filename = `attendance_${startDate}_to_${endDate}.xlsx`;
            const url = window.URL.createObjectURL(new Blob([blob]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export failed:', err);
            alert('Export failed. Please try again.');
        } finally {
            setExporting(false);
        }
    };

    const handleExportPdf = async () => {
        setExportingPdf(true);
        try {
            const [yr, mo] = startDate.split('-');
            const params = {
                startDate,
                endDate,
                month: mo,
                year: yr,
                employee_id: selectedEmployee,
                department: selectedDept,
            };
            const blob = await apiService.exportAttendancePDF(params);
            const filename = `attendance_${startDate}_to_${endDate}.pdf`;
            const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('PDF export failed:', err);
            alert('PDF export failed. Please try again.');
        } finally {
            setExportingPdf(false);
        }
    };

    const resetFilters = () => {
        const t = format(new Date(), 'yyyy-MM-dd');
        setStartDate(t); setEndDate(t);
        setSelectedEmployee(''); setSelectedDept('');
        setSearchInput(''); setSelectedStatus('');
        setActivePreset('today');
        setPage(1); setSortCol('date'); setSortDir('desc');
    };

    // ── Quick date presets ────────────────────────────────────────────────────
    const applyPreset = (preset) => {
        const now = new Date();
        const t = format(now, 'yyyy-MM-dd');
        setActivePreset(preset);
        setPage(1);
        if (preset === 'today') { setStartDate(t); setEndDate(t); }
        if (preset === 'week') { setStartDate(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')); setEndDate(t); }
        if (preset === 'month') { setStartDate(format(startOfMonth(now), 'yyyy-MM-dd')); setEndDate(t); }
        // 'custom' — user types dates manually
    };

    const hasActiveFilter = selectedEmployee || selectedDept || selectedStatus || searchInput
        || startDate !== format(new Date(), 'yyyy-MM-dd') || endDate !== format(new Date(), 'yyyy-MM-dd');

    const totalPages = Math.ceil(totalRecords / PAGE_SIZE);
    const presentCount = attendance.filter(r => r.check_in).length;
    const lateCount = attendance.filter(r => r.status === 'LATE').length;
    const checkedOut = attendance.filter(r => r.check_out).length;
    const onTimeCount = attendance.filter(r => r.status === 'ON_TIME').length;

    const inputCls = 'w-full bg-slate-950 border border-white/[0.07] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500/30 transition-colors';
    const selCls = `${inputCls} appearance-none cursor-pointer`;

    return (
        <div className="space-y-8 animate-in fade-in duration-700">

            {/* ── Header ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-white mb-2 tracking-tighter">Attendance Registry</h1>
                    <p className="text-slate-500 text-[10px] md:text-sm font-medium uppercase tracking-[0.2em]">
                        Verified Presence // <span className="text-blue-400">{totalRecords}</span> Records
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={handleExportPdf} disabled={exportingPdf}
                        className="flex items-center gap-2 px-5 py-2.5 bg-rose-600/80 hover:bg-rose-600 disabled:opacity-60 disabled:cursor-not-allowed border border-rose-500/40 rounded-xl text-white text-xs font-black shadow-lg shadow-rose-600/20 transition-all">
                        {exportingPdf
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                            : <><FileText className="w-4 h-4" /> Export PDF</>}
                    </button>
                    <button onClick={handleExport} disabled={exporting}
                        className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-white text-xs font-black shadow-lg shadow-emerald-600/20 transition-all">
                        {exporting
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                            : <><Download className="w-4 h-4" /> Export Excel</>}
                    </button>
                </div>
            </div>

            {/* ── Summary Stat Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Total Records', value: totalRecords, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
                    { label: 'Checked In', value: presentCount, icon: UserCheck, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
                    { label: 'On Time', value: onTimeCount, icon: CheckCircle2, color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20' },
                    { label: 'Late', value: lateCount, icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
                ].map(s => (
                    <div key={s.label} className={`p-4 rounded-2xl border ${s.bg} flex items-center gap-3 cursor-pointer transition-all hover:brightness-110`}
                        onClick={() => { setSelectedStatus(s.label === 'Late' ? 'LATE' : s.label === 'On Time' ? 'ON_TIME' : ''); setPage(1); }}>
                        <div className={`w-9 h-9 rounded-xl bg-black/20 flex items-center justify-center ${s.color}`}>
                            <s.icon className="w-4 h-4" />
                        </div>
                        <div>
                            <div className={`text-xl font-black tabular-nums ${s.color}`}>{loading ? '—' : s.value}</div>
                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Filter Bar ── */}
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-4">

                {/* Quick Date Presets */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest mr-1">Quick:</span>
                    {[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom']].map(([key, label]) => (
                        <button key={key} onClick={() => applyPreset(key)}
                            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border
                                ${activePreset === key
                                    ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/20'
                                    : 'bg-white/[0.03] border-white/[0.06] text-slate-500 hover:text-white hover:border-white/10'}`}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* Filters grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">

                    {/* Date Range */}
                    <div className="space-y-1.5 lg:col-span-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Date Range</label>
                        <div className="flex items-center gap-2">
                            <input type="date" value={startDate} max={endDate}
                                onChange={e => { setStartDate(e.target.value); setActivePreset('custom'); setPage(1); }}
                                className={inputCls} />
                            <span className="text-slate-700 shrink-0">–</span>
                            <input type="date" value={endDate} min={startDate}
                                onChange={e => { setEndDate(e.target.value); setActivePreset('custom'); setPage(1); }}
                                className={inputCls} />
                        </div>
                    </div>

                    {/* Search */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Search Name</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                            <input type="text" placeholder="Type to search…"
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                className={`${inputCls} pl-9`} />
                        </div>
                    </div>

                    {/* Department */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Department</label>
                        <select value={selectedDept}
                            onChange={e => { setSelectedDept(e.target.value); setPage(1); }}
                            className={selCls}>
                            <option value="">All Departments</option>
                            {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                        </select>
                    </div>

                    {/* Status */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</label>
                        <select value={selectedStatus}
                            onChange={e => { setSelectedStatus(e.target.value); setPage(1); }}
                            className={selCls}>
                            <option value="">All Status</option>
                            <option value="ON_TIME">On Time</option>
                            <option value="LATE">Late</option>
                        </select>
                    </div>

                    {/* Reset */}
                    <div className="flex items-end">
                        <button onClick={resetFilters}
                            className={`w-full py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5
                                ${hasActiveFilter
                                    ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                                    : 'bg-slate-900 border-white/[0.07] text-slate-600 cursor-default'}`}
                            disabled={!hasActiveFilter}>
                            <X className="w-3 h-3" /> Reset All
                        </button>
                    </div>
                </div>

                {/* Active filter chips */}
                {hasActiveFilter && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {searchInput && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg text-[10px] font-bold">
                                Name: "{searchInput}"
                                <button onClick={() => setSearchInput('')}><X className="w-2.5 h-2.5" /></button>
                            </span>)}
                        {selectedDept && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-lg text-[10px] font-bold">
                                Dept: {selectedDept}
                                <button onClick={() => setSelectedDept('')}><X className="w-2.5 h-2.5" /></button>
                            </span>)}
                        {selectedStatus && (
                            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border
                                ${selectedStatus === 'LATE'
                                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                                Status: {selectedStatus === 'LATE' ? '🟡 Late' : '🟢 On Time'}
                                <button onClick={() => setSelectedStatus('')}><X className="w-2.5 h-2.5" /></button>
                            </span>)}
                    </div>
                )}
            </div>

            {/* ── Table ── */}
            <div className="rounded-3xl bg-white/[0.02] border border-white/[0.05] overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-white/[0.03] bg-white/[0.01]">
                                <th className="px-4 md:px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                                <th className="hidden lg:table-cell px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Department</th>
                                <SortTh label="Date" col="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-center" />
                                <th className="px-4 md:px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Check In</th>
                                <th className="hidden sm:table-cell px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Check Out</th>
                                <SortTh label="Work Hours" col="working_hours" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-center hidden xl:table-cell" />
                                <th className="px-4 md:px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Status</th>
                                <th className="hidden md:table-cell px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Method</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.025]">
                            {loading ? (
                                Array(5).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        {Array(8).fill(0).map((_, j) => (
                                            <td key={j} className="px-6 py-4">
                                                <div className="h-6 bg-white/[0.04] rounded-lg" />
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : attendance.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <Calendar className="w-12 h-12 text-slate-800" />
                                            <div className="text-slate-500 text-xs font-black uppercase tracking-widest">
                                                No records match the selected filters
                                            </div>
                                            <button onClick={resetFilters}
                                                className="text-[10px] text-blue-400 hover:underline font-bold">
                                                Clear filters
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ) : attendance.map((rec) => {
                                const name = rec.employees?.name || '—';
                                const initials = name.slice(0, 2).toUpperCase();
                                return (
                                    <tr key={rec.id}
                                        className="group hover:bg-white/[0.04] cursor-pointer transition-all border-l-2 border-l-transparent hover:border-l-blue-500"
                                        onClick={() => navigate(`/admin/attendance/employee/${rec.employees?.employee_id || rec.employee_id}`)}>
                                        {/* Employee */}
                                        <td className="px-4 md:px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 md:w-9 md:h-9 shrink-0 rounded-xl bg-gradient-to-br from-blue-600/20 to-slate-800 border border-white/[0.06] flex items-center justify-center text-[10px] md:text-[11px] font-black text-blue-400 overflow-hidden">
                                                    {rec.employees?.image_url
                                                        ? <img src={rec.employees.image_url} alt="" className="w-full h-full object-cover" />
                                                        : initials}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors whitespace-nowrap truncate">
                                                        {name}
                                                    </div>
                                                    <div className="text-[9px] md:text-[10px] font-mono text-slate-500 truncate">
                                                        {rec.employees?.employee_id || '—'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Department */}
                                        <td className="hidden lg:table-cell px-6 py-4">
                                            <div className="flex items-center gap-1.5">
                                                <Briefcase className="w-3 h-3 text-slate-600 shrink-0" />
                                                <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">
                                                    {rec.employees?.department || 'General'}
                                                </span>
                                            </div>
                                        </td>

                                        {/* Date */}
                                        <td className="px-4 md:px-6 py-4 text-center">
                                            <span className="text-[11px] md:text-xs font-bold text-slate-300 tabular-nums whitespace-nowrap">
                                                {fmtDate(rec.date)}
                                            </span>
                                        </td>

                                        {/* Check In */}
                                        <td className="px-4 md:px-6 py-4">
                                            <div className="flex items-center gap-2 text-[10px] md:text-[11px] font-bold text-emerald-400 tabular-nums">
                                                <div className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                                {fmtTime(rec.check_in)}
                                            </div>
                                        </td>

                                        {/* Check Out */}
                                        <td className="hidden sm:table-cell px-6 py-4">
                                            <div className={`flex items-center gap-2 text-[11px] font-bold tabular-nums
                                                ${rec.check_out ? 'text-slate-400' : 'text-slate-700'}`}>
                                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${rec.check_out ? 'bg-slate-500' : 'bg-slate-800'}`} />
                                                {fmtTime(rec.check_out)}
                                            </div>
                                        </td>

                                        {/* Working Hours */}
                                        <td className="hidden xl:table-cell px-6 py-4 text-center">
                                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-950 border border-white/[0.05] text-xs font-black text-white tabular-nums">
                                                <Clock className="w-3 h-3 text-slate-600" />
                                                {workHoursDisplay(rec)}
                                            </div>
                                        </td>

                                        {/* Status */}
                                        <td className="px-4 md:px-6 py-4 text-center">
                                            <StatusBadge status={rec.status} />
                                        </td>

                                        {/* Method */}
                                        <td className="hidden md:table-cell px-6 py-4 text-center">
                                            <MethodBadge method={rec.method} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* ── Pagination ── */}
                <div className="px-8 py-5 border-t border-white/[0.03] flex items-center justify-between gap-4">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        Showing&nbsp;
                        <span className="text-white">{((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalRecords)}</span>
                        &nbsp;of&nbsp;
                        <span className="text-white">{totalRecords}</span>
                        &nbsp;records
                    </p>

                    <div className="flex items-center gap-2">
                        <button disabled={page === 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.05] text-slate-400 hover:text-white disabled:opacity-20 transition-all">
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        {/* Page number pills */}
                        {Array.from({ length: Math.min(5, totalPages || 1) }, (_, i) => {
                            // Sliding window: show pages around current
                            const start = Math.max(1, Math.min(page - 2, (totalPages || 1) - 4));
                            const p = start + i;
                            if (p > (totalPages || 1)) return null;
                            return (
                                <button key={p} onClick={() => setPage(p)}
                                    className={`w-8 h-8 rounded-xl text-xs font-black transition-all
                                        ${p === page
                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                                            : 'bg-white/[0.03] border border-white/[0.05] text-slate-400 hover:text-white'}`}>
                                    {p}
                                </button>
                            );
                        })}

                        <button disabled={page >= (totalPages || 1)}
                            onClick={() => setPage(p => p + 1)}
                            className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.05] text-slate-400 hover:text-white disabled:opacity-20 transition-all">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
