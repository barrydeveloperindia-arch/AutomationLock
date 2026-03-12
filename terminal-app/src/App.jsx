import { useState, useEffect, useRef } from 'react';
import { Camera, Fingerprint, X, CheckCircle2, LogOut, AlertTriangle, Clock, ShieldAlert, Unlock, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { NativeBiometric } from 'capacitor-native-biometric';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BleClient } from '@capacitor-community/bluetooth-le';

// Firewall Unblocked! We can now beam traffic wirelessly over Wi-Fi without ADB!
const API_BASE = 'http://192.168.2.154:8000';
const RESET_DELAY = 5; // seconds

const BLE_MAC = '58:8C:81:CC:65:29';
const DOOR_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const DOOR_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

// ── Animated countdown ring ───────────────────────────────────────────────────
function CountdownRing({ seconds, total = RESET_DELAY, color = '#10b981' }) {
    const R = 22, C = 2 * Math.PI * R;
    const pct = seconds / total;
    return (
        <svg width={56} height={56} className="rotate-[-90deg]">
            <circle cx={28} cy={28} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
            <circle cx={28} cy={28} r={R} fill="none" stroke={color} strokeWidth={4}
                strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
                strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }} />
        </svg>
    );
}

// ── Live clock ────────────────────────────────────────────────────────────────
function LiveClock() {
    const [time, setTime] = useState(new Date());
    useEffect(() => {
        const t = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return (
        <div className="text-center">
            <div className="text-7xl font-black tabular-nums tracking-tight text-white">
                {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </div>
            <div className="text-slate-400 text-base font-medium mt-1 uppercase tracking-[0.2em]">
                {time.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
        </div>
    );
}

export default function App() {
    // view: 'home' | 'face' | 'fingerprint' | 'checkin' | 'checkout' | 'error'
    const [view, setView] = useState('home');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [employees, setEmployees] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [result, setResult] = useState(null);
    const [countdown, setCountdown] = useState(RESET_DELAY);
    const [adminPin, setAdminPin] = useState('');
    const [selectedEmp, setSelectedEmp] = useState(null);
    const videoRef = useRef(null);
    const streamRef = useRef(null);

    // ── Local Door BLE Controller ─────────────────────────────────────────────
    const triggerDoorUnlock = async () => {
        try {
            console.log('Initializing BleClient...');
            await BleClient.initialize();

            console.log(`Connecting to lock: ${BLE_MAC}`);
            await BleClient.connect(BLE_MAC);

            const buffer = new ArrayBuffer(2);
            const view = new DataView(buffer);
            view.setUint8(0, 'O'.charCodeAt(0));
            view.setUint8(1, 'N'.charCodeAt(0));

            console.log('Sending direct ON GATT command to BLE door...');
            await BleClient.write(BLE_MAC, DOOR_SERVICE_UUID, DOOR_CHAR_UUID, view);

            // Hold open for 5.5 seconds then auto-relock
            setTimeout(async () => {
                try {
                    console.log('Sending OFF GATT command to auto-lock door...');
                    const offBuffer = new ArrayBuffer(3);
                    const offView = new DataView(offBuffer);
                    offView.setUint8(0, 'O'.charCodeAt(0));
                    offView.setUint8(1, 'F'.charCodeAt(0));
                    offView.setUint8(2, 'F'.charCodeAt(0));
                    await BleClient.write(BLE_MAC, DOOR_SERVICE_UUID, DOOR_CHAR_UUID, offView);

                    console.log('Relocked. Disconnecting BLE...');
                    await BleClient.disconnect(BLE_MAC);
                } catch (e) {
                    console.error('Auto-lock failed:', e);
                }
            }, 5500);

        } catch (err) {
            console.error('BLE Door Error:', err);
        }
    };

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/terminal/users`);
                setEmployees(res.data.filter(u => u.status !== 'Deleted'));
            } catch (err) { console.error('Failed to fetch employees:', err); }
        };
        fetchEmployees();
    }, []);

    // ── Auto-reset countdown ──────────────────────────────────────────────────
    useEffect(() => {
        const resultViews = ['checkin', 'checkout', 'error'];
        if (!resultViews.includes(view)) return;

        setCountdown(RESET_DELAY);
        const tick = setInterval(() => setCountdown(c => c - 1), 1000);
        const done = setTimeout(reset, RESET_DELAY * 1000);
        return () => { clearInterval(tick); clearTimeout(done); };
    }, [view]);

    const reset = () => {
        setView('home');
        setLoading(false);
        setMessage('');
        setResult(null);
        setSearchTerm('');
        setCountdown(RESET_DELAY);
    };

    // ── Face Scan Live Feed ───────────────────────────────────────────────────
    const handleFaceScan = () => {
        setView('face');
        setMessage('Initializing biometric camera…');
    };

    useEffect(() => {
        let interval;
        const startCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
                setMessage('Analyzing...');

                // Interval captures frame every 2s and sends to backend silently
                if (view === 'face') {
                    interval = setInterval(captureAndVerify, 2000);
                } else if (view === 'admin_scan') {
                    // admin registration handles its own capture
                }
            } catch (err) {
                console.error(err);
                setMessage('Camera access denied or unavailable.');
                setView('error');
            }
        };

        if (view === 'face' || view === 'admin_scan') {
            startCamera();
        } else {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }
            if (interval) clearInterval(interval);
        }

        return () => {
            if (interval) clearInterval(interval);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, [view]);

    const captureAndVerify = () => {
        if (!videoRef.current || view !== 'face') return;

        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        if (canvas.width === 0) return; // Video not playing yet

        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
            if (!blob) return;
            try {
                const form = new FormData();
                form.append('file', blob, 'face.jpg');

                const res = await axios.post(`${API_BASE}/api/biometrics/face/verify`, form, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });

                if (res.data.success && view === 'face') {
                    // Success!
                    const isCheckout = !!(res.data.check_out || res.data.checkout);
                    const now = new Date();
                    setResult({
                        name: res.data.user?.name || res.data.name || res.data.employee_name || 'Employee',
                        time: res.data.check_in
                            ? new Date(res.data.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                            : now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                        checkoutTime: res.data.check_out
                            ? new Date(res.data.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                            : now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                        workingHours: res.data.working_hours != null ? formatWorkHours(res.data.working_hours) : null,
                        isCheckout,
                    });
                    setView(isCheckout ? 'checkout' : 'checkin');
                    triggerDoorUnlock();
                }
            } catch (err) {
                // Output real errors if backend fails (e.g., Engine Offline 503 or Network Error)
                if (err.response?.status === 401 || err.response?.status === 403) {
                    setMessage(err.response.data.message || 'Face Not Identified');
                    setTimeout(() => { if (view === 'face') setMessage('Analyzing...') }, 1200);
                } else if (err.response?.status === 503) {
                    setMessage('Biometric Engine Offline');
                } else if (err.code === 'ERR_NETWORK') {
                    setMessage('Network disconnected');
                }
            }
        }, 'image/jpeg', 0.9);
    };

    const captureAndRegister = () => {
        if (!videoRef.current || view !== 'admin_scan' || !selectedEmp) return;

        setLoading(true);
        setMessage('Capturing & Enrolling...');
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
            if (!blob) { setLoading(false); return; }
            try {
                const form = new FormData();
                form.append('file', blob, 'register.jpg');
                form.append('employeeId', selectedEmp.employee_id || selectedEmp.id);
                form.append('email', selectedEmp.email);
                form.append('name', selectedEmp.name);
                form.append('re_enroll', 'true');

                const res = await axios.post(`${API_BASE}/api/biometrics/face/register`, form, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });

                if (res.data.success) {
                    setMessage('Enrollment Successful!');
                    setTimeout(() => {
                        reset();
                    }, 2500);
                }
            } catch (err) {
                setMessage(err.response?.data?.message || 'Enrollment failed');
                setTimeout(() => setMessage('Tap Capture to try again'), 2000);
            } finally {
                setLoading(false);
            }
        }, 'image/jpeg', 0.9);
    };

    // ── Fingerprint ───────────────────────────────────────────────────────────
    const handleFingerprintScan = async () => {
        try {
            const avail = await NativeBiometric.isAvailable();
            if (!avail.isAvailable) throw new Error('Sensor not available');
            await NativeBiometric.verify({
                reason: 'Authenticate for attendance',
                title: 'Terminal Security',
                subtitle: 'Place your finger on the sensor',
                negativeButtonText: 'Cancel',
            });
            setView('fingerprint');
        } catch (err) {
            console.warn('Biometric fallback:', err.message);
            setView('fingerprint');
        }
    };

    const markManualAttendance = async (employee) => {
        setLoading(true);
        try {
            const res = await axios.post(`${API_BASE}/api/attendance/mark`, {
                employee_id: employee.id,
                method: 'fingerprint',
                device_id: 'office_terminal',
            });
            const data = res.data || {};
            const isCheckout = !!(data.check_out);
            const now = new Date();
            setResult({
                name: employee.name,
                time: data.check_in
                    ? new Date(data.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                    : now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                checkoutTime: data.check_out
                    ? new Date(data.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                    : now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                workingHours: data.working_hours != null ? formatWorkHours(data.working_hours) : null,
                isCheckout,
            });
            setView(isCheckout ? 'checkout' : 'checkin');
            triggerDoorUnlock();
        } catch (err) {
            setMessage(err.response?.data?.error || 'Connection failure');
            setView('error');
        } finally {
            setLoading(false);
        }
    };

    // ── Helper ────────────────────────────────────────────────────────────────
    const formatWorkHours = (wh) => {
        const h = Math.floor(wh);
        const m = Math.round((wh - h) * 60);
        return `${h}h ${String(m).padStart(2, '0')}m`;
    };

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="w-screen h-screen kiosk-gradient flex flex-col items-center justify-center p-8 text-white relative overflow-hidden">

            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 px-8 py-5 flex items-center justify-between border-b border-white/[0.04] z-10">
                <div onClick={() => { if (view === 'home') setView('admin_auth'); }} className="cursor-pointer hover:opacity-80 transition-opacity">
                    <div className="text-xs font-black uppercase tracking-[0.3em] text-blue-400">AuraLock</div>
                    <div className="text-[10px] text-slate-600 font-medium uppercase tracking-widest">Smart Biometric Terminal</div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">System Online</span>
                </div>
                <div className="text-slate-600 text-[10px] font-medium uppercase tracking-widest">Terminal ID: TX-082</div>
            </div>

            <AnimatePresence mode="wait">

                {/* ── ADMIN AUTH ── */}
                {view === 'admin_auth' && (
                    <motion.div key="admin_auth" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass p-8 rounded-3xl w-full max-w-md flex flex-col gap-6 items-center z-20">
                        <div className="flex items-center justify-between w-full border-b border-white/[0.06] pb-4">
                            <h2 className="text-lg font-black flex items-center gap-2"><ShieldAlert size={20} className="text-blue-400" /> Admin Access</h2>
                            <button onClick={reset} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
                        </div>
                        <input type="password" placeholder="Enter Admin PIN" className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 text-center text-xl tracking-widest focus:outline-none focus:border-blue-500/50" value={adminPin} onChange={e => setAdminPin(e.target.value)} autoFocus />
                        <button onClick={() => { if (adminPin === '1234') { setView('admin_select'); setAdminPin(''); } else { setMessage('Invalid PIN'); setTimeout(() => setMessage(''), 2000); } }} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-black text-white uppercase tracking-widest transition-colors flex items-center justify-center gap-2"><Unlock size={18} /> Authenticate</button>
                        {message && <p className="text-red-400 text-sm font-bold">{message}</p>}
                    </motion.div>
                )}

                {/* ── ADMIN EMPLOYEE SELECT ── */}
                {view === 'admin_select' && (
                    <motion.div key="admin_select" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass p-8 rounded-3xl w-full max-w-2xl flex flex-col gap-5 z-20">
                        <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
                            <h2 className="text-lg font-black flex items-center gap-2"><UserPlus size={20} className="text-blue-400" /> Select Employee for Face Registration</h2>
                            <button onClick={reset} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
                        </div>
                        <input type="text" placeholder="Search by name…" className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 text-base focus:outline-none focus:border-blue-500/50 placeholder:text-slate-600 transition-colors" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoFocus />
                        <div className="grid grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
                            {employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())).map(emp => (
                                <button key={emp.id} onClick={() => { setSelectedEmp(emp); setView('admin_scan'); setMessage('Ready to capture'); }} className="flex items-center gap-3 p-4 glass hover:glass-active rounded-2xl transition-all text-left">
                                    <div className="w-10 h-10 rounded-full bg-slate-800 overflow-hidden shrink-0"><img src={emp.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=1e293b&color=94a3b8`} alt="" className="w-full h-full object-cover" /></div>
                                    <div><div className="font-bold text-sm truncate">{emp.name}</div><div className="text-slate-500 text-[10px]">{emp.department || 'General'}</div></div>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* ── ADMIN CAPTURE SCAN ── */}
                {view === 'admin_scan' && (
                    <motion.div key="admin_scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-10 z-20">
                        <h2 className="text-2xl font-black text-white tracking-tight">Register: {selectedEmp?.name}</h2>
                        <div className="relative w-64 h-64">
                            {/* Corner brackets */}
                            {[['top-0 left-0', 'border-t-2 border-l-2'], ['top-0 right-0', 'border-t-2 border-r-2'], ['bottom-0 left-0', 'border-b-2 border-l-2'], ['bottom-0 right-0', 'border-b-2 border-r-2']].map(([pos, br], i) => (<div key={i} className={`absolute w-8 h-8 ${pos} ${br} border-blue-400 rounded-sm`} />))}
                            <div className="w-full h-full rounded-2xl flex items-center justify-center bg-blue-500/5 border border-blue-500/10 overflow-hidden relative">
                                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center"><div className="w-40 h-52 rounded-[100px] border-[3px] border-emerald-400/40 border-dashed" /></div>
                            </div>
                        </div>
                        <div className="flex flex-col gap-4 text-center w-full max-w-sm">
                            <p className="text-xl font-bold text-emerald-300 min-h-[30px]">{message}</p>
                            <button onClick={captureAndRegister} disabled={loading} className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl font-black text-white uppercase tracking-widest transition-colors flex items-center justify-center">
                                {loading ? 'Processing...' : 'Capture & Save'}
                            </button>
                            <button onClick={reset} disabled={loading} className="px-6 py-2 bg-slate-800 rounded-xl font-bold text-white uppercase text-[10px] tracking-widest hover:bg-slate-700 transition-colors">Cancel</button>
                        </div>
                    </motion.div>
                )}

                {/* ── HOME ── */}
                {view === 'home' && (
                    <motion.div key="home"
                        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }}
                        className="flex flex-col items-center gap-14 w-full max-w-3xl">

                        <LiveClock />

                        <div className="w-full">
                            <p className="text-center text-slate-500 text-xs font-black uppercase tracking-[0.3em] mb-6">
                                Select Verification Method
                            </p>
                            <div className="grid grid-cols-2 gap-6">
                                {/* Face Scan */}
                                <motion.button
                                    whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}
                                    onClick={handleFaceScan}
                                    className="glass p-10 rounded-3xl flex flex-col items-center gap-5 group relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <div className="p-5 rounded-2xl bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors border border-blue-500/20">
                                        <Camera size={56} className="text-blue-400" />
                                    </div>
                                    <div className="text-center">
                                        <h2 className="text-xl font-black tracking-tight">Face Scan</h2>
                                        <p className="text-slate-500 mt-1 text-xs font-medium">Automated recognition</p>
                                    </div>
                                </motion.button>

                                {/* Fingerprint */}
                                <motion.button
                                    whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}
                                    onClick={handleFingerprintScan}
                                    className="glass p-10 rounded-3xl flex flex-col items-center gap-5 group relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <div className="p-5 rounded-2xl bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors border border-emerald-500/20">
                                        <Fingerprint size={56} className="text-emerald-400" />
                                    </div>
                                    <div className="text-center">
                                        <h2 className="text-xl font-black tracking-tight">Fingerprint</h2>
                                        <p className="text-slate-500 mt-1 text-xs font-medium">Native biometric verify</p>
                                    </div>
                                </motion.button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ── FINGERPRINT EMPLOYEE PICKER ── */}
                {view === 'fingerprint' && (
                    <motion.div key="fingerprint"
                        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="glass p-8 rounded-3xl w-full max-w-2xl flex flex-col gap-5">
                        <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
                            <h2 className="text-lg font-black">Select Employee</h2>
                            <button onClick={reset} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
                        </div>
                        <input type="text" placeholder="Search by name…"
                            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 text-base focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-600 transition-colors"
                            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoFocus />
                        <div className="grid grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
                            {employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                .map(emp => (
                                    <button key={emp.id} onClick={() => markManualAttendance(emp)} disabled={loading}
                                        className="flex items-center gap-3 p-4 glass hover:glass-active rounded-2xl transition-all text-left">
                                        <div className="w-10 h-10 rounded-full bg-slate-800 overflow-hidden shrink-0">
                                            <img src={emp.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=1e293b&color=94a3b8`}
                                                alt="" className="w-full h-full object-cover" />
                                        </div>
                                        <div>
                                            <div className="font-bold text-sm truncate">{emp.name}</div>
                                            <div className="text-slate-500 text-[10px]">{emp.department || 'General'}</div>
                                        </div>
                                    </button>
                                ))}
                        </div>
                    </motion.div>
                )}

                {/* ── FACE SCANNING ── */}
                {view === 'face' && (
                    <motion.div key="face"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex flex-col items-center gap-10">
                        <div className="relative w-64 h-64">
                            {/* Corner brackets */}
                            {[['top-0 left-0', 'border-t-2 border-l-2'], ['top-0 right-0', 'border-t-2 border-r-2'],
                            ['bottom-0 left-0', 'border-b-2 border-l-2'], ['bottom-0 right-0', 'border-b-2 border-r-2']].map(([pos, br], i) => (
                                <div key={i} className={`absolute w-8 h-8 ${pos} ${br} border-blue-400 rounded-sm`} />
                            ))}
                            <div className="w-full h-full rounded-2xl flex items-center justify-center bg-blue-500/5 border border-blue-500/10 overflow-hidden relative">
                                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                                {/* Face Guide Overlay */}
                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                    <div className="w-40 h-52 rounded-[100px] border-[3px] border-blue-400/40 border-dashed" />
                                </div>
                            </div>
                            {/* Scanning line */}
                            <motion.div
                                animate={{ y: ['0%', '100%', '0%'] }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent top-0"
                            />
                        </div>
                        <div className="text-center">
                            <p className="text-xl font-bold text-blue-300">{message}</p>
                            <p className="text-slate-600 text-xs mt-2 font-medium uppercase tracking-widest">Do not move</p>
                        </div>
                        <button onClick={reset} className="px-6 py-2 bg-slate-800 rounded-xl font-bold text-white uppercase text-[10px] tracking-widest hover:bg-slate-700 transition-colors">Cancel</button>
                    </motion.div>
                )}

                {/* ── CHECK-IN SUCCESS (WELCOME) ── */}
                {view === 'checkin' && (
                    <motion.div key="checkin"
                        initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                        className="flex flex-col items-center gap-8 text-center">

                        {/* Pulsing ring + icon */}
                        <div className="relative">
                            <motion.div
                                animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0, 0.3] }}
                                transition={{ duration: 2, repeat: Infinity }}
                                className="absolute inset-0 rounded-full bg-emerald-500/30"
                            />
                            <div className="w-36 h-36 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center relative">
                                <CheckCircle2 size={72} className="text-emerald-400" />
                            </div>
                        </div>

                        {/* Text */}
                        <div>
                            <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                                className="text-[11px] font-black uppercase tracking-[0.4em] text-emerald-400 mb-3">
                                ✦ WELCOME ✦
                            </motion.p>
                            <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                                className="text-5xl font-black text-white tracking-tight mb-2">
                                {result?.name}
                            </motion.h2>
                            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
                                className="text-emerald-400 font-black text-lg uppercase tracking-widest mb-1">
                                Check In Successful
                            </motion.p>
                            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
                                className="text-slate-400 text-2xl font-bold tabular-nums flex items-center justify-center gap-2">
                                <Clock size={18} className="text-slate-500" />
                                {result?.time}
                            </motion.p>
                        </div>

                        {/* Countdown */}
                        <div className="flex items-center gap-3 opacity-60">
                            <CountdownRing seconds={countdown} color="#10b981" />
                            <span className="text-xs text-slate-500 font-bold">Resetting in {countdown}s</span>
                        </div>
                    </motion.div>
                )}

                {/* ── CHECK-OUT SUCCESS (GOODBYE) ── */}
                {view === 'checkout' && (
                    <motion.div key="checkout"
                        initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                        className="flex flex-col items-center gap-8 text-center">

                        <div className="relative">
                            <motion.div
                                animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0, 0.3] }}
                                transition={{ duration: 2, repeat: Infinity }}
                                className="absolute inset-0 rounded-full bg-indigo-500/30"
                            />
                            <div className="w-36 h-36 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center relative">
                                <LogOut size={72} className="text-indigo-400" />
                            </div>
                        </div>

                        <div>
                            <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                                className="text-[11px] font-black uppercase tracking-[0.4em] text-indigo-400 mb-3">
                                ✦ GOODBYE ✦
                            </motion.p>
                            <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                                className="text-5xl font-black text-white tracking-tight mb-2">
                                {result?.name}
                            </motion.h2>
                            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
                                className="text-indigo-400 font-black text-lg uppercase tracking-widest mb-1">
                                Check Out Successful
                            </motion.p>
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
                                className="flex flex-col items-center gap-1 mt-2">
                                <p className="text-slate-400 text-xl font-bold tabular-nums flex items-center gap-2">
                                    <Clock size={18} className="text-slate-500" />
                                    {result?.checkoutTime}
                                </p>
                                {result?.workingHours && (
                                    <div className="mt-2 px-6 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                                        <span className="text-indigo-300 font-black text-base tracking-widest">
                                            {result.workingHours} worked today
                                        </span>
                                    </div>
                                )}
                            </motion.div>
                        </div>

                        <div className="flex items-center gap-3 opacity-60">
                            <CountdownRing seconds={countdown} color="#818cf8" />
                            <span className="text-xs text-slate-500 font-bold">Resetting in {countdown}s</span>
                        </div>
                    </motion.div>
                )}

                {/* ── ERROR / NOT RECOGNIZED ── */}
                {view === 'error' && (
                    <motion.div key="error"
                        initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                        className="flex flex-col items-center gap-8 text-center">

                        <div className="relative">
                            <motion.div
                                animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0, 0.3] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                                className="absolute inset-0 rounded-full bg-red-500/30"
                            />
                            <motion.div
                                animate={{ rotate: [-4, 4, -4, 4, 0] }}
                                transition={{ delay: 0.1, duration: 0.5 }}
                                className="w-36 h-36 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center relative">
                                <AlertTriangle size={72} className="text-red-400" />
                            </motion.div>
                        </div>

                        <div>
                            <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                                className="text-[11px] font-black uppercase tracking-[0.4em] text-red-400 mb-3">
                                ✦ ACCESS DENIED ✦
                            </motion.p>
                            <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                                className="text-5xl font-black text-white tracking-tight mb-2">
                                Face Not Recognized
                            </motion.h2>
                            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
                                className="text-red-400/80 text-lg font-bold uppercase tracking-widest mb-1">
                                Please Try Again
                            </motion.p>
                            {message && message !== 'Face not recognized' && (
                                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
                                    className="text-slate-600 text-sm mt-1">{message}</motion.p>
                            )}
                        </div>

                        <motion.button
                            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                            onClick={reset}
                            className="px-8 py-3 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-2xl font-black text-sm uppercase tracking-widest transition-all">
                            Try Again
                        </motion.button>

                        <div className="flex items-center gap-3 opacity-60">
                            <CountdownRing seconds={countdown} color="#f87171" />
                            <span className="text-xs text-slate-500 font-bold">Auto-reset in {countdown}s</span>
                        </div>
                    </motion.div>
                )}

            </AnimatePresence>
        </div>
    );
}
