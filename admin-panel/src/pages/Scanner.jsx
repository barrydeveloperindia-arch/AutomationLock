import { useState, useEffect, useRef } from 'react';
import { Camera, Fingerprint, X, CheckCircle2, LogOut, AlertTriangle, Clock, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

// Capacitor imports (assumed available in mobile build environment)
// If running in web browser for testing, these will fail or need mocks
let NativeBiometric, CapCamera, CameraResultType, CameraSource;
try {
    const Biometric = await import('capacitor-native-biometric');
    const Cam = await import('@capacitor/camera');
    NativeBiometric = Biometric.NativeBiometric;
    CapCamera = Cam.Camera;
    CameraResultType = Cam.CameraResultType;
    CameraSource = Cam.CameraSource;
} catch (e) {
    console.warn("Capacitor plugins not available in this environment (Web Fallback)");
}

// LAN IP of the backend server — phone and PC must be on the same WiFi network.
// In the integrated app, we prefer using the same proxy or a shared config.
const API_BASE = window.location.origin === 'http://localhost:5181' ? '' : 'http://192.168.2.165:8000';
const RESET_DELAY = 3; // seconds

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
            <div className="text-7xl font-black tabular-nums tracking-tight text-white/90">
                {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </div>
            <div className="text-slate-500 text-sm font-bold mt-2 uppercase tracking-[0.3em] opacity-80">
                {time.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
        </div>
    );
}

export default function Scanner() {
    const navigate = useNavigate();
    // view: 'home' | 'face' | 'fingerprint' | 'checkin' | 'checkout' | 'error'
    const [view, setView] = useState('face'); // Start on face scan directly
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('Initializing Terminal...');
    const [employees, setEmployees] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [result, setResult] = useState(null);
    const [countdown, setCountdown] = useState(RESET_DELAY);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/users`);
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

    const stopCamera = (s) => {
        if (s) {
            s.getTracks().forEach(track => track.stop());
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    };

    const reset = () => {
        setLoading(false);
        setResult(null);
        setSearchTerm('');
        setCountdown(RESET_DELAY);
        setIsProcessing(false);
        setView('face'); // This will trigger the camera useEffect below
    };

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [stream, setStream] = useState(null);

    // ── Refined Camera Lifecycle with Safeguards ─────────────────────────────
    useEffect(() => {
        let active = true;
        let currentStream = null;

        const initCamera = async () => {
            if (view !== 'face') return;
            
            // Wait for video element to mount if it hasn't yet
            let attempts = 0;
            while (!videoRef.current && attempts < 10) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }

            if (!videoRef.current) return;

            try {
                setMessage('Starting camera...');
                
                // 1. Stop existing tracks & Clear srcObject
                if (videoRef.current.srcObject) {
                    const tracks = videoRef.current.srcObject.getTracks();
                    tracks.forEach(track => track.stop());
                    videoRef.current.srcObject = null;
                }

                // 2. Hardware Release Delay (300ms)
                await new Promise(r => setTimeout(r, 300));

                // 3. Fresh Start
                const s = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
                });
                
                if (!active) {
                    s.getTracks().forEach(t => t.stop());
                    return;
                }

                currentStream = s;
                setStream(s);
                videoRef.current.srcObject = s;
                
                try {
                    await videoRef.current.play();
                    setMessage('Looking for face...');
                } catch (playErr) {
                    console.warn("Autoplay interrupted:", playErr.message);
                }
            } catch (err) {
                console.error("Camera re-initialization failed:", err);
                setMessage("Camera Error");
                setView('error');
            }
        };

        initCamera();

        return () => {
            active = false;
            stopCamera(currentStream);
            setStream(null);
        };
    }, [view]);

    // ── Continuous Face Verification Loop ────────────────────────────────────
    useEffect(() => {
        if (view !== 'face' || isProcessing || loading) return;

        const loop = setInterval(async () => {
            if (view !== 'face' || isProcessing || loading) return;
            await captureAndVerify();
        }, 4000); 

        return () => clearInterval(loop);
    }, [view, isProcessing, loading]);

    const captureAndVerify = async () => {
        if (!videoRef.current || !canvasRef.current || view !== 'face' || isProcessing) return;
        
        const video = videoRef.current;
        // Detailed logging for hardware state
        console.log(`📸 [Scanner] Hardware check: readyState=${video.readyState}, paused=${video.paused}, dim=${video.videoWidth}x${video.videoHeight}`);
        
        if (video.readyState !== 4 || video.paused) {
            console.warn("⚠️ [Scanner] Video not ready or paused. Skipping scan.");
            return;
        }

        if (video.videoWidth === 0 || video.videoHeight === 0) {
            console.warn("⚠️ [Scanner] Video dimensions are zero. Likely black frame. Skipping.");
            return;
        }

        setIsProcessing(true);
        setMessage('Face detected...');
        try {
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);
            
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
            if (!blob) throw new Error("Capture failed: Blob is null");

            console.log(`📦 [Scanner] Request: format=image/jpeg, size=${(blob.size / 1024).toFixed(1)}KB, res=${canvas.width}x${canvas.height}`);

            const form = new FormData();
            form.append('file', blob, 'terminal_face.jpg');

            console.log(`📡 [Scanner] Sending to: ${API_BASE}/api/biometrics/face/verify`);
            const res = await axios.post(`${API_BASE}/api/biometrics/face/verify`, form);
            
            // MANDATORY LOGGING
            console.log("📥 [Scanner] RAW RESPONSE:", JSON.stringify(res.data, null, 2));

            if (res.data.success) {
                const isCheckout = !!(res.data.check_out || res.data.checkout);
                const now = new Date();
                const empName = res.data.employeeName || res.data.user?.name || res.data.name || res.data.employee_name || 'Employee';
                
                console.log(`✅ [Scanner] Authorized: ${empName}`);
                
                setResult({
                    name: empName,
                    time: res.data.check_in
                        ? new Date(res.data.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                        : now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                    checkoutTime: res.data.check_out
                        ? new Date(res.data.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                        : now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                    workingHours: res.data.working_hours != null ? formatWorkHours(res.data.working_hours) : null,
                    isCheckout,
                });
                setMessage(`Access Granted – Welcome ${empName}`);
                setView(isCheckout ? 'checkout' : 'checkin');
            } else {
                console.warn("❌ [Scanner] Recognition Failed:", res.data.message);
                setMessage(res.data.message || 'Unknown Person – Access Denied');
                setView('error');
            }
        } catch (err) {
            console.error("🚨 [Scanner] API Error:", err);
            const backendMsg = err.response?.data?.message || err.message;
            if (err.response?.status === 404 || err.response?.status === 401 || err.response?.status === 403) {
                setMessage(backendMsg || 'Unknown Person – Access Denied');
                setView('error');
            } else {
                console.debug("Scan loop error:", err.message);
                setMessage('Looking for face...');
            }
        } finally {
            setIsProcessing(false);
        }
    };

    // ── Continuous Fingerprint Listener ──────────────────────────────────────
    useEffect(() => {
        let active = true;
        const fingerprintLoop = async () => {
            if (!active) return;
            try {
                if (NativeBiometric) {
                    const avail = await NativeBiometric.isAvailable();
                    if (avail.isAvailable) {
                        await NativeBiometric.verify({
                            reason: 'Automatic authentication',
                            title: 'Fingerprint Sensor Active',
                            subtitle: 'Touch sensor for instant access',
                            negativeButtonText: 'Cancel'
                        });
                        // If verified, we still need to identify WHICH user. 
                        // Since fingerprint usually just verifies "owner" on mobile,
                        // and user wants it as a fallback, we'll open the picker or show instruction.
                        setView('fingerprint');
                    }
                }
            } catch (err) {
                // If cancelled or failed, just restart the listener
                if (active) setTimeout(fingerprintLoop, 2000);
            }
        };

        fingerprintLoop();
        return () => { active = false; };
    }, []);

    const markManualAttendance = async (employee) => {
        setLoading(true);
        try {
            const res = await axios.post(`${API_BASE}/api/logs/iot`, {
                id: employee.employee_id || employee.id,
                method: 'fingerprint',
                status: 'success',
                message: 'Unlock via Terminal Touch',
                timestamp: Math.floor(Date.now() / 1000),
                signature: 'internal_request'
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
        <div className="w-screen h-screen bg-[#020617] flex flex-col items-center justify-center p-8 text-white relative overflow-hidden">
            {/* Background Texture */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(30,58,138,0.1),transparent)]" />
            
            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 px-8 py-6 flex items-center justify-between border-b border-white/[0.03] bg-black/20 backdrop-blur-md z-50">
                <button 
                    onClick={() => navigate('/')}
                    className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-xl transition-colors text-slate-400 hover:text-white"
                >
                    <ArrowLeft size={20} />
                    <span className="text-xs font-bold uppercase tracking-widest">Back to Home</span>
                </button>
                <div className="flex flex-col items-center">
                    <div className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">AuraLock Terminal</div>
                    <div className="text-[8px] text-slate-600 font-bold uppercase tracking-widest mt-0.5">Biometric Scanner v4.0</div>
                </div>
                <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Live</span>
                </div>
            </div>

            {/* Hidden canvas for capturing frames */}
            <canvas ref={canvasRef} className="hidden" />

            <AnimatePresence mode="wait">

                {/* ── TERMINAL VIEW (Unified Face Scan) ── */}
                {view === 'face' && (
                    <motion.div key="face"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex flex-col items-center gap-12 text-center z-10 w-full max-w-4xl">
                        
                        <LiveClock />

                        <div className="relative w-80 h-80 md:w-[400px] md:h-[400px]">
                            {/* Scanning UI Brackets */}
                            {[['top-0 left-0', 'border-t-4 border-l-4'], ['top-0 right-0', 'border-t-4 border-r-4'],
                            ['bottom-0 left-0', 'border-b-4 border-l-4'], ['bottom-0 right-0', 'border-b-4 border-r-4']].map(([pos, br], i) => (
                                <div key={i} className={`absolute w-16 h-16 ${pos} ${br} border-blue-500 rounded-2xl z-20`} />
                            ))}

                            {/* Live Video Feed */}
                            <div className="w-full h-full rounded-[2.5rem] overflow-hidden bg-black border-2 border-white/5 shadow-2xl relative">
                                <video 
                                    ref={videoRef} 
                                    autoPlay 
                                    playsInline 
                                    muted 
                                    className="w-full h-full object-cover scale-x-[-1]" 
                                />
                                
                                {/* Overlay Gradient */}
                                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/40" />

                                {/* Scanning Line Animation */}
                                <motion.div
                                    animate={{ y: ['0%', '100%', '0%'] }}
                                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                                    className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent z-10 opacity-60"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-4">
                            <div className="px-6 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-blue-400 animate-ping' : view === 'face' ? 'bg-blue-400' : 'bg-emerald-400'}`} />
                                <span className="text-xl font-black text-blue-200 uppercase tracking-widest">{message}</span>
                            </div>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.4em]">Biometric Terminal Active</p>
                        </div>
                    </motion.div>
                )}

                {/* ── FINGERPRINT EMPLOYEE PICKER ── */}
                {view === 'fingerprint' && (
                    <motion.div key="fingerprint"
                        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                        className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 p-10 rounded-[3rem] w-full max-w-2xl flex flex-col gap-8 shadow-2xl z-10">
                        <div className="flex items-center justify-between border-b border-white/[0.05] pb-6">
                            <div>
                                <h1 className="text-3xl font-black text-white">Select Identity</h1>
                                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1 italic">Fingerprint Verified • Manual Override</p>
                            </div>
                            <button onClick={reset} className="p-3 hover:bg-white/10 rounded-full transition-colors text-slate-500"><X size={24} /></button>
                        </div>
                        <input type="text" placeholder="Search by name..."
                            className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl p-6 text-xl focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-700 transition-colors"
                            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoFocus />
                        <div className="grid grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                .map(emp => (
                                    <button key={emp.id} onClick={() => markManualAttendance(emp)} disabled={loading}
                                        className="flex items-center gap-4 p-5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] rounded-[2rem] transition-all text-left group">
                                        <div className="w-14 h-14 rounded-2xl bg-slate-800/50 border border-white/[0.05] overflow-hidden shrink-0 group-hover:scale-105 transition-transform">
                                            <img src={emp.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=334155&color=cbd5e1`}
                                                alt="" className="w-full h-full object-cover" />
                                        </div>
                                        <div className="overflow-hidden">
                                            <div className="font-bold text-lg truncate text-white/90">{emp.name}</div>
                                            <div className="text-slate-600 text-[10px] font-black uppercase tracking-widest truncate">{emp.department || 'General'}</div>
                                        </div>
                                    </button>
                                ))}
                        </div>
                    </motion.div>
                )}

                {/* ── CHECK-IN SUCCESS ── */}
                {view === 'checkin' && (
                    <motion.div key="checkin"
                        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center gap-10 text-center z-10">
                        <div className="relative">
                            <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0, 0.2] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-[-20px] rounded-full bg-emerald-500/20" />
                            <div className="w-40 h-40 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.1)]">
                                <CheckCircle2 size={84} className="text-emerald-400" />
                            </div>
                        </div>
                        <div className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.6em] text-emerald-400">Access Granted</p>
                            <h2 className="text-6xl font-black text-white tracking-tighter">Welcome {result?.name}</h2>
                            <div className="flex flex-col items-center gap-2 pt-2">
                                <p className="text-emerald-500 font-black text-xl uppercase tracking-widest translate-y-1">Verification Success</p>
                                <p className="text-slate-500 text-3xl font-black tabular-nums">{result?.time}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 bg-white/[0.02] px-6 py-3 rounded-2xl border border-white/5 grayscale">
                            <CountdownRing seconds={countdown} color="#10b981" />
                            <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Auto-reset: {countdown}s</span>
                        </div>
                    </motion.div>
                )}

                {/* ── CHECK-OUT SUCCESS ── */}
                {view === 'checkout' && (
                    <motion.div key="checkout"
                        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center gap-10 text-center z-10">
                        <div className="relative">
                            <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0, 0.2] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-[-20px] rounded-full bg-indigo-500/20" />
                            <div className="w-40 h-40 rounded-full bg-indigo-500/10 border-2 border-indigo-500/30 flex items-center justify-center shadow-[0_0_40px_rgba(99,102,241,0.1)]">
                                <LogOut size={84} className="text-indigo-400" />
                            </div>
                        </div>
                        <div className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.6em] text-indigo-400">Shift Ended</p>
                            <h2 className="text-6xl font-black text-white tracking-tighter">Goodbye {result?.name}</h2>
                            <div className="flex flex-col items-center gap-2 pt-2">
                                <p className="text-indigo-400 font-black text-xl uppercase tracking-widest">Access Granted</p>
                                <p className="text-slate-400 text-2xl font-black tabular-nums">{result?.checkoutTime}</p>
                                {result?.workingHours && (
                                    <div className="mt-4 px-8 py-2 rounded-full bg-indigo-500/5 border border-indigo-500/20">
                                        <span className="text-indigo-300 font-black text-sm tracking-[0.2em] uppercase">
                                            {result.workingHours} Total
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-4 bg-white/[0.02] px-6 py-3 rounded-2xl border border-white/5 grayscale">
                            <CountdownRing seconds={countdown} color="#6366f1" />
                            <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Auto-reset: {countdown}s</span>
                        </div>
                    </motion.div>
                )}

                {/* ── ERROR ── */}
                {view === 'error' && (
                    <motion.div key="error"
                        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center gap-10 text-center z-10">
                        <div className="relative">
                            <motion.div animate={{ rotate: [-5, 5, -5, 5, 0] }} transition={{ duration: 0.4 }} className="w-40 h-40 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.1)]">
                                <AlertTriangle size={84} className="text-red-400" />
                            </motion.div>
                        </div>
                        <div className="space-y-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.6em] text-red-500">Security Warning</p>
                            <h2 className="text-5xl font-black text-white tracking-tighter">Access Denied</h2>
                            <p className="text-red-400 text-xl font-black uppercase tracking-widest">{message}</p>
                            <p className="text-slate-500 text-sm font-medium italic opacity-70">Please use fingerprint fallback</p>
                        </div>
                        <div className="flex items-center gap-4 opacity-30">
                            <CountdownRing seconds={countdown} color="#ef4444" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Back: {countdown}s</span>
                        </div>
                    </motion.div>
                )}

            </AnimatePresence>
        </div>
    );
}
