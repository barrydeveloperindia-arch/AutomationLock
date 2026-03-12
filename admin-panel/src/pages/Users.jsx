import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';
import {
    Search, Trash2, Edit2, UserPlus, X, Save,
    ScanFace, Fingerprint, AlertTriangle, UserX, UserCheck,
    Briefcase, CheckCircle2, Camera, RefreshCw, Loader2,
    ShieldCheck, AlertCircle, Upload
} from 'lucide-react';

const DEPARTMENTS = ['Engineering', 'Operations', 'Security', 'Management', 'HR', 'General'];
const EMPTY_FORM = { name: '', email: '', employee_id: '', department: 'Engineering', role: 'employee' };

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ toasts, dismiss }) {
    return (
        <div className="fixed top-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
            {toasts.map(t => (
                <div key={t.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-2xl text-sm font-bold
                        pointer-events-auto animate-in slide-in-from-right-8 duration-300
                        ${t.type === 'success'
                            ? 'bg-emerald-950 border-emerald-500/30 text-emerald-300'
                            : 'bg-red-950 border-red-500/30 text-red-300'}`}>
                    {t.type === 'success'
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        : <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
                    <span>{t.message}</span>
                    <button onClick={() => dismiss(t.id)} className="ml-2 opacity-50 hover:opacity-100 transition-opacity">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}

function useToast() {
    const [toasts, setToasts] = useState([]);
    const add = useCallback((message, type = 'success') => {
        const id = Date.now();
        setToasts(t => [...t, { id, message, type }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
    }, []);
    const dismiss = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);
    return { toasts, add, dismiss };
}

// ── Modal Shell ───────────────────────────────────────────────────────────────
function Modal({ open, onClose, children, maxW = 'max-w-lg' }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div className={`relative z-10 w-full ${maxW} bg-[#0a0f1e] border border-white/[0.08] rounded-3xl shadow-2xl p-8`}
                onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────
function DeleteDialog({ user, onConfirm, onCancel }) {
    return (
        <Modal open={!!user} onClose={onCancel}>
            <div className="flex flex-col items-center text-center gap-5">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <div>
                    <h2 className="text-xl font-black text-white mb-2">Confirm Deletion</h2>
                    <p className="text-sm text-slate-400 leading-relaxed">
                        Permanently delete <span className="text-white font-bold">{user?.name}</span> and all related records
                        (attendance, access logs, biometrics).{' '}
                        <span className="text-red-400 font-bold">This cannot be undone.</span>
                    </p>
                </div>
                <div className="flex gap-3 w-full pt-2">
                    <button onClick={onCancel}
                        className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 text-sm font-bold transition-all">
                        Cancel
                    </button>
                    <button onClick={onConfirm}
                        className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-black transition-all shadow-lg shadow-red-600/20">
                        Delete Permanently
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
function EmployeeModal({ mode, initialData, onSave, onClose }) {
    const [form, setForm] = useState(initialData || EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim() || !form.email.trim()) { setErr('Name and email are required.'); return; }
        setSaving(true); setErr('');
        try { await onSave(form); onClose(); }
        catch (error) { setErr(error?.response?.data?.message || error.message || 'Save failed.'); }
        finally { setSaving(false); }
    };

    const field = (label, key, type = 'text', placeholder = '') => (
        <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</label>
            <input type={type} value={form[key] || ''}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full bg-slate-950 border border-white/[0.07] rounded-xl px-4 py-2.5 text-sm text-white
                           focus:outline-none focus:border-blue-500/40 transition-colors placeholder:text-slate-700" />
        </div>
    );

    return (
        <Modal open onClose={onClose}>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-black text-white">{mode === 'add' ? 'Add Employee' : 'Edit Employee'}</h2>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
                {field('Full Name', 'name', 'text', 'e.g. Rahul Sharma')}
                {field('Email', 'email', 'email', 'e.g. rahul@company.com')}
                {field('Employee ID', 'employee_id', 'text', 'e.g. EMP-001')}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Department</label>
                    <select value={form.department || 'Engineering'}
                        onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                        className="w-full bg-slate-950 border border-white/[0.07] rounded-xl px-4 py-2.5 text-sm text-white
                                   focus:outline-none focus:border-blue-500/40 appearance-none transition-colors">
                        {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                    </select>
                </div>
                {err && <p className="text-xs font-bold text-red-400 bg-red-500/10 px-3 py-2 rounded-xl border border-red-500/20">{err}</p>}
                <div className="flex gap-3 pt-2">
                    <button type="button" onClick={onClose}
                        className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-bold transition-all">
                        Cancel
                    </button>
                    <button type="submit" disabled={saving}
                        className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-black transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2">
                        <Save className="w-4 h-4" />
                        {saving ? 'Saving...' : mode === 'add' ? 'Add Employee' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// ── Face Enrollment Modal ─────────────────────────────────────────────────────
function FaceEnrollModal({ user, onDone, onClose }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const [captured, setCaptured] = useState(null);
    const [loading, setLoading] = useState(false);
    const [camError, setCamError] = useState('');
    const [status, setStatus] = useState('');
    const fileInputRef = useRef(null);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            setCaptured(event.target.result);
            stopCamera();
        };
        reader.readAsDataURL(file);
    };

    const startCamera = useCallback(async () => {
        setCamError('');
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
            streamRef.current = s;
            if (videoRef.current) videoRef.current.srcObject = s;
        } catch {
            setCamError('Camera access denied or not available in this browser.');
        }
    }, []);

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
    }, []);

    useEffect(() => { startCamera(); return stopCamera; }, [startCamera, stopCamera]);

    const capture = () => {
        if (!videoRef.current || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0);
        setCaptured(canvasRef.current.toDataURL('image/jpeg'));
        stopCamera();
    };

    const retake = () => { setCaptured(null); setStatus(''); startCamera(); };

    const enroll = async () => {
        if (!captured) return;
        setLoading(true); setStatus('');
        try {
            const res = await fetch(captured);
            const blob = await res.blob();
            const result = await apiService.registerFace(
                blob,
                user.employee_id || user.id,
                user.email,
                user.name,
                true   // re_enroll=true → bypass duplicate-ID guard for existing employees
            );
            if (result.success) {
                setStatus('success');
                // Refresh full user list to get updated join data
                setTimeout(() => { onDone(result.user || { ...user, face_registered: true }); onClose(); }, 1200);
            } else {
                throw new Error(result.message || 'Registration failed');
            }
        } catch (err) {
            setStatus('error:' + (err.response?.data?.message || err.message || 'Enrollment failed'));
        } finally {
            setLoading(false);
        }
    };

    const errMsg = status.startsWith('error:') ? status.slice(6) : '';

    return (
        <Modal open onClose={onClose} maxW="max-w-2xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-lg font-black text-white flex items-center gap-2">
                        <ScanFace className="w-5 h-5 text-blue-400" /> Enroll Face
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">Enrolling biometric identity for <span className="text-white font-bold">{user.name}</span></p>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Camera */}
                <div className="space-y-3">
                    <div className="relative aspect-square rounded-2xl overflow-hidden bg-slate-900 border border-white/[0.07]">
                        {camError ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                                <AlertCircle className="w-10 h-10 text-red-400 opacity-50" />
                                <p className="text-xs text-slate-500">{camError}</p>
                            </div>
                        ) : captured ? (
                            <img src={captured} alt="Captured" className="w-full h-full object-cover" />
                        ) : (
                            <>
                                <video ref={videoRef} autoPlay playsInline muted
                                    className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                                {/* Face guide overlay */}
                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                    <div className="w-40 h-52 rounded-full border-2 border-blue-400/40" />
                                </div>
                                <div className="absolute bottom-3 left-0 right-0 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    Position face in oval
                                </div>
                            </>
                        )}

                        {loading && (
                            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                                <p className="text-xs text-slate-400 font-bold">Processing biometric…</p>
                            </div>
                        )}

                        {status === 'success' && (
                            <div className="absolute inset-0 bg-emerald-950/90 flex flex-col items-center justify-center gap-3">
                                <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                                <p className="text-sm font-black text-emerald-300">Face Enrolled!</p>
                            </div>
                        )}
                    </div>

                    {!captured ? (
                        <div className="flex gap-2">
                            <button onClick={capture} disabled={!!camError || loading}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[13px] font-black rounded-xl transition-all">
                                <Camera className="w-4 h-4" /> Capture Photo
                            </button>
                            <button onClick={() => fileInputRef.current?.click()} disabled={loading}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[13px] font-black rounded-xl transition-all">
                                <Upload className="w-4 h-4" /> Upload Photo
                            </button>
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
                        </div>
                    ) : (
                        <button onClick={retake} disabled={loading}
                            className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all">
                            <RefreshCw className="w-4 h-4" /> Retake
                        </button>
                    )}
                </div>

                {/* Info + Enroll */}
                <div className="flex flex-col justify-between">
                    <div className="space-y-4">
                        <InfoRow label="Employee" value={user.name} />
                        <InfoRow label="ID" value={user.employee_id || '—'} mono />
                        <InfoRow label="Email" value={user.email} mono />
                        <InfoRow label="Department" value={user.department || 'General'} />

                        <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-[11px] text-slate-500 leading-relaxed">
                            Capture a clear, front-facing photo. The biometric engine will extract and store a secure face embedding. No raw image is stored.
                        </div>
                    </div>

                    <div className="space-y-3 mt-4">
                        {errMsg && (
                            <p className="text-xs font-bold text-red-400 bg-red-500/10 px-3 py-2 rounded-xl border border-red-500/20 flex items-center gap-2">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {errMsg}
                            </p>
                        )}
                        <button onClick={enroll} disabled={!captured || loading || status === 'success'}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-black rounded-xl transition-all shadow-lg shadow-emerald-600/20">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                            {loading ? 'Enrolling…' : 'Enroll Face'}
                        </button>
                    </div>
                </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
        </Modal>
    );
}

function InfoRow({ label, value, mono = false }) {
    return (
        <div>
            <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-0.5">{label}</div>
            <div className={`text-sm font-bold text-white ${mono ? 'font-mono text-slate-300' : ''}`}>{value}</div>
        </div>
    );
}

// ── Fingerprint Enrollment Modal ──────────────────────────────────────────────
function FingerprintEnrollModal({ user, onDone, onClose }) {
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [err, setErr] = useState('');

    const enroll = async () => {
        setLoading(true); setErr('');
        try {
            // Admin web panel can't trigger device biometrics — mark as enrolled manually
            // In production the terminal/hardware device handles actual fingerprint capture
            await apiService.updateUser(user.id, { fingerprint_registered: true });
            setDone(true);
            setTimeout(() => { onDone({ ...user, fingerprint_registered: true }); onClose(); }, 1200);
        } catch (err) {
            setErr(err.response?.data?.message || err.message || 'Enrollment failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal open onClose={onClose}>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-lg font-black text-white flex items-center gap-2">
                        <Fingerprint className="w-5 h-5 text-violet-400" /> Enroll Fingerprint
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">Biometric enrollment for <span className="text-white font-bold">{user.name}</span></p>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex flex-col items-center gap-6 py-4">
                {/* Animated fingerprint icon */}
                <div className={`relative w-28 h-28 rounded-full flex items-center justify-center border-2 transition-all
                    ${done ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-violet-500/10 border-violet-500/30'}`}>
                    {done ? (
                        <CheckCircle2 className="w-14 h-14 text-emerald-400" />
                    ) : (
                        <>
                            <Fingerprint className={`w-14 h-14 text-violet-400 ${loading ? 'animate-pulse' : ''}`} />
                            {loading && (
                                <div className="absolute inset-0 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
                            )}
                        </>
                    )}
                </div>

                <div className="text-center space-y-1">
                    {done ? (
                        <>
                            <p className="text-lg font-black text-emerald-400">Fingerprint Enrolled!</p>
                            <p className="text-xs text-slate-500">Record updated successfully.</p>
                        </>
                    ) : (
                        <>
                            <p className="text-base font-black text-white">Confirm Fingerprint Enrollment</p>
                            <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                                This will mark <span className="text-white">{user.name}</span>'s fingerprint as registered.
                                The actual fingerprint capture happens at the physical terminal device.
                            </p>
                        </>
                    )}
                </div>

                {err && (
                    <p className="text-xs font-bold text-red-400 bg-red-500/10 px-4 py-2 rounded-xl border border-red-500/20 flex items-center gap-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {err}
                    </p>
                )}

                {!done && (
                    <div className="flex gap-3 w-full">
                        <button onClick={onClose}
                            className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-bold transition-all">
                            Cancel
                        </button>
                        <button onClick={enroll} disabled={loading}
                            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-black transition-all shadow-lg shadow-violet-600/20">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                            {loading ? 'Enrolling…' : 'Confirm Enroll'}
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
}

// ── Biometrics Cell Component ─────────────────────────────────────────────────
function BiometricsCell({ user, onEnrollFace, onEnrollFP }) {
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {/* Face Status */}
            <div className="flex items-center">
                {user.face_registered ? (
                    <div className="flex items-center bg-emerald-500/10 border border-emerald-500/20 rounded-full overflow-hidden">
                        <span className="px-2.5 py-1 text-[10px] font-black text-emerald-400 flex items-center gap-1">
                            <ScanFace className="w-3 h-3" /> Face ✓
                        </span>
                        <button onClick={() => onEnrollFace(user)} title="Update Face Biometric"
                            className="px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-[9px] font-black text-emerald-300 border-l border-emerald-500/20 transition-all">
                            Update
                        </button>
                    </div>
                ) : (
                    <button onClick={() => onEnrollFace(user)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] font-black text-blue-400 hover:bg-blue-500/20 transition-all">
                        <ScanFace className="w-3 h-3" /> Enroll Face
                    </button>
                )}
            </div>

            {/* Fingerprint Status */}
            <div className="flex items-center">
                {user.fingerprint_registered ? (
                    <div className="flex items-center bg-violet-500/10 border border-violet-500/20 rounded-full overflow-hidden">
                        <span className="px-2.5 py-1 text-[10px] font-black text-violet-400 flex items-center gap-1">
                            <Fingerprint className="w-3 h-3" /> Finger ✓
                        </span>
                        <button onClick={() => onEnrollFP(user)} title="Update Fingerprint"
                            className="px-2 py-1 bg-violet-500/20 hover:bg-violet-500/30 text-[9px] font-black text-violet-300 border-l border-violet-500/20 transition-all">
                            Update
                        </button>
                    </div>
                ) : (
                    <button onClick={() => onEnrollFP(user)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-500/10 border border-slate-500/20 text-[10px] font-black text-slate-400 hover:bg-slate-500/20 transition-all">
                        <Fingerprint className="w-3 h-3" /> Enroll FP
                    </button>
                )}
            </div>
        </div>
    );
}

function StatusBadge({ status }) {
    const cfg = {
        Active: { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
        Disabled: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
        Deleted: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
    };
    const c = cfg[status] || cfg.Active;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${c.bg} ${c.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} /> {status || 'Active'}
        </span>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Users() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');

    // Modals
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [faceTarget, setFaceTarget] = useState(null);   // user for face enrollment
    const [fpTarget, setFpTarget] = useState(null);   // user for fingerprint enrollment
    const [actionLoading, setActionLoading] = useState(null);

    const { toasts, add: addToast, dismiss } = useToast();

    useEffect(() => { fetchUsers(); }, []);

    const fetchUsers = async () => {
        setLoading(true); setError(null);
        try {
            const data = await apiService.getUsers();
            setUsers(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to connect.');
        } finally { setLoading(false); }
    };

    const patchUser = (updated) =>
        setUsers(u => u.map(x => x.id === updated.id ? { ...x, ...updated } : x));

    const filtered = users.filter(u =>
        u.name?.toLowerCase().includes(search.toLowerCase()) ||
        u.employee_id?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())
    );

    // ── Actions ───────────────────────────────────────────────────────────────
    const handleAdd = async (form) => {
        const created = await apiService.createEmployee(form);
        setUsers(u => [created, ...u]);
        addToast(`Employee "${form.name}" added.`);
    };

    const handleEdit = async (form) => {
        // Optimization: Only send fields that actually changed
        const updates = {};
        Object.keys(form).forEach(key => {
            if (form[key] !== editTarget[key]) {
                updates[key] = form[key];
            }
        });

        if (Object.keys(updates).length === 0) {
            addToast('No changes detected.');
            setEditTarget(null);
            return;
        }

        try {
            console.log(`📡 Sending updates for ${editTarget.id}:`, updates);
            const updated = await apiService.updateUser(editTarget.id, updates);
            patchUser(updated);
            addToast('Employee details updated.');
            setEditTarget(null);
        } catch (error) {
            const msg = error.response?.data?.message || error.response?.data?.error || error.message;
            addToast(`Update failed: ${msg}`, 'error');
            throw error; // Let the modal handle the error display
        }
    };

    const handleDisableToggle = async (user) => {
        setActionLoading(user.id);
        try {
            const isDisabled = user.status === 'Disabled';
            const updated = isDisabled
                ? await apiService.enableUser(user.id)
                : await apiService.disableUser(user.id);
            patchUser(updated);
            addToast(`${user.name} ${isDisabled ? 'enabled' : 'disabled'}.`);
        } catch (err) {
            addToast(err.response?.data?.message || err.message, 'error');
        } finally { setActionLoading(null); }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        const target = deleteTarget;
        setDeleteTarget(null); setActionLoading(target.id);
        try {
            await apiService.deleteUser(target.id);
            setUsers(u => u.filter(x => x.id !== target.id));
            addToast(`${target.name} deleted.`);
        } catch (err) {
            addToast(err.response?.data?.message || err.message, 'error');
        } finally { setActionLoading(null); }
    };

    // Biometric enrollment callbacks
    const handleFaceEnrolled = (updated) => {
        patchUser(updated);
        addToast(`Face enrolled successfully for ${updated.name} ✓`);
    };

    const handleFPEnrolled = (updated) => {
        patchUser(updated);
        addToast(`Fingerprint enrolled successfully for ${updated.name} ✓`);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Toasts */}
            <Toast toasts={toasts} dismiss={dismiss} />

            {/* Modals */}
            {addOpen && <EmployeeModal mode="add" onSave={handleAdd} onClose={() => setAddOpen(false)} />}
            {editTarget && <EmployeeModal mode="edit" initialData={editTarget} onSave={handleEdit} onClose={() => setEditTarget(null)} />}
            {faceTarget && <FaceEnrollModal user={faceTarget} onDone={handleFaceEnrolled} onClose={() => setFaceTarget(null)} />}
            {fpTarget && <FingerprintEnrollModal user={fpTarget} onDone={handleFPEnrolled} onClose={() => setFpTarget(null)} />}
            <DeleteDialog user={deleteTarget} onConfirm={handleDeleteConfirm} onCancel={() => setDeleteTarget(null)} />

            {/* ── Header ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-white mb-2 tracking-tighter">Personnel Management</h1>
                    <p className="text-slate-500 text-sm font-medium uppercase tracking-[0.2em]">
                        {users.length} Employees // Biometric Access Control
                    </p>
                </div>
                <button onClick={() => setAddOpen(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-black rounded-xl transition-all shadow-lg shadow-blue-600/20">
                    <UserPlus className="w-4 h-4" /> Add Employee
                </button>
            </div>

            {/* ── Stat Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Total', value: users.length, color: 'text-blue-400' },
                    { label: 'Active', value: users.filter(u => u.status === 'Active' || !u.status).length, color: 'text-emerald-400' },
                    { label: 'Face Enrolled', value: users.filter(u => u.face_embedding || u.face_registered).length, color: 'text-indigo-400' },
                    { label: 'FP Enrolled', value: users.filter(u => u.fingerprint_registered).length, color: 'text-violet-400' },
                ].map(s => (
                    <div key={s.label} className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
                        <div className={`text-2xl font-black tabular-nums ${s.color}`}>{loading ? '—' : s.value}</div>
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* ── Table ── */}
            <div className="rounded-3xl bg-white/[0.02] border border-white/[0.05] overflow-hidden">
                {/* Search */}
                <div className="px-8 py-5 border-b border-white/[0.04] flex items-center gap-4">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search name, email or ID..."
                            className="w-full bg-slate-950 border border-white/[0.07] rounded-xl pl-9 pr-4 py-2 text-sm text-white
                                       focus:outline-none focus:border-blue-500/30 placeholder:text-slate-700" />
                    </div>
                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-auto">
                        {filtered.length} results
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-white/[0.03] bg-white/[0.01]">
                                {['Employee', 'Department', 'Status', 'Biometrics', 'Created', 'Actions'].map(h => (
                                    <th key={h} className="px-8 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.025]">
                            {loading ? (
                                [1, 2, 3, 4].map(i => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={6} className="px-8 py-5">
                                            <div className="h-10 bg-white/[0.03] rounded-xl" />
                                        </td>
                                    </tr>
                                ))
                            ) : error ? (
                                <tr><td colSpan={6} className="px-8 py-16 text-center text-red-400 font-bold">{error}</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan={6} className="px-8 py-16 text-center text-slate-600 font-semibold">No employees found.</td></tr>
                            ) : filtered.map(user => {
                                const isActioning = actionLoading === user.id;
                                const isDisabled = user.status === 'Disabled';
                                const initials = (user.name || '?').slice(0, 2).toUpperCase();
                                const createdAt = user.created_at
                                    ? new Date(user.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                    : '—';
                                return (
                                    <tr key={user.id}
                                        className={`group transition-colors ${isDisabled ? 'opacity-50' : 'hover:bg-white/[0.02]'}`}>

                                        {/* Employee */}
                                        <td className="px-8 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600/30 to-indigo-600/30 border border-blue-500/20 flex items-center justify-center text-xs font-black text-blue-400">
                                                    {initials}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-white">{user.name}</div>
                                                    <div className="text-[10px] text-slate-500 font-mono">{user.employee_id || user.email}</div>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Department */}
                                        <td className="px-8 py-4">
                                            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
                                                <Briefcase className="w-3 h-3 text-slate-600" />
                                                {user.department || 'General'}
                                            </div>
                                        </td>

                                        {/* Status */}
                                        <td className="px-8 py-4">
                                            <StatusBadge status={user.status || 'Active'} />
                                        </td>

                                        {/* Biometrics — enrollment buttons or checkmarks */}
                                        <td className="px-8 py-4">
                                            <BiometricsCell
                                                user={user}
                                                onEnrollFace={u => setFaceTarget(u)}
                                                onEnrollFP={u => setFpTarget(u)}
                                            />
                                        </td>

                                        {/* Created */}
                                        <td className="px-8 py-4">
                                            <span className="text-xs text-slate-500 tabular-nums">{createdAt}</span>
                                        </td>

                                        {/* Actions */}
                                        <td className="px-8 py-4">
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => setEditTarget(user)} title="Edit"
                                                    className="p-2 rounded-lg hover:bg-blue-500/10 text-slate-500 hover:text-blue-400 transition-all">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleDisableToggle(user)} disabled={isActioning}
                                                    title={isDisabled ? 'Enable' : 'Disable'}
                                                    className={`p-2 rounded-lg transition-all ${isDisabled
                                                        ? 'hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400'
                                                        : 'hover:bg-amber-500/10  text-slate-500 hover:text-amber-400'}`}>
                                                    {isDisabled ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                                                </button>
                                                <button onClick={() => setDeleteTarget(user)} disabled={isActioning} title="Delete"
                                                    className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-500 transition-all">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
