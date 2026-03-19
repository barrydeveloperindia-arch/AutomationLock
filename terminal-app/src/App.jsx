import { useState, useEffect, useRef } from 'react';
import { Fingerprint, CheckCircle2, ShieldAlert, Unlock, Bluetooth, BluetoothConnected, BluetoothOff, AlertCircle, ScanFace, Hexagon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { NativeBiometric } from 'capacitor-native-biometric';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { BackgroundMode } from '@anuradev/capacitor-background-mode';
import { Haptics } from '@capacitor/haptics';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'https://smart-door-backend-50851729985.asia-south1.run.app';

const BLE_MAC = '58:8C:81:CC:65:29';
const DOOR_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const DOOR_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

export default function App() {
    const [view, setView] = useState('loading'); // 'loading', 'setup', 'dashboard', 'success', 'error'
    const [employees, setEmployees] = useState([]);
    const [myIdentity, setMyIdentity] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [bleStatus, setBleStatus] = useState('disconnected');
    const [result, setResult] = useState(null);
    const [liveScanActive, setLiveScanActive] = useState(false);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    // Initial Identity Check & Background OS Engine
    useEffect(() => {
        const setupBackgroundImmunity = async () => {
            try {
                // Must be requested explicitly on Android 13+, otherwise enable() fails silently!
                await BackgroundMode.requestNotificationsPermission();
                await BackgroundMode.requestDisableBatteryOptimizations();

                await BackgroundMode.enable({
                    title: 'Tesla Mode Active',
                    text: 'Proximity Radar engaged in pocket',
                    hidden: false
                });
                await BackgroundMode.disableWebViewOptimizations();
            } catch (e) {
                console.error('Android OS heavily rejected background immunity:', e);
            }
        };
        setupBackgroundImmunity();

        const savedIdentity = localStorage.getItem('aura_identity');
        if (savedIdentity) {
            setMyIdentity(JSON.parse(savedIdentity));
            setView('dashboard');
        } else {
            fetchEmployees();
            setView('setup');
        }
    }, []);

    const fetchEmployees = async () => {
        try {
            const res = await axios.get(`${API_BASE}/api/terminal/users`);
            setEmployees(res.data.filter(u => u.status !== 'Deleted'));
        } catch (err) { console.error('Failed to fetch employees'); }
    };

    const linkDeviceToEmployee = (emp) => {
        localStorage.setItem('aura_identity', JSON.stringify(emp));
        setMyIdentity(emp);
        setView('dashboard');
    };

    const handleClearIdentity = () => {
        localStorage.removeItem('aura_identity');
        setMyIdentity(null);
        fetchEmployees(); // CRITICAL: Re-hydrate the identity pool from the Cloud!
        setView('setup');
    };

    // BLE System with Strict Radio Lifecycle Management
    const isUnlockingRef = useRef(false);
    const autoPromptedRef = useRef(false);

    useEffect(() => {
        if (view !== 'dashboard') return;
        let scanCycleTimer;
        let isScanning = false;

        const initBLE = async () => {
            try {
                await BleClient.initialize();
                const enabled = await BleClient.isEnabled();
                if (!enabled) return setBleStatus('disabled');

                const runDiscoveryCycle = async () => {
                    // Critical Mutex: Android crashes if LE Sweep runs concurrently with GATT Connect
                    if (isScanning || isUnlockingRef.current) return;
                    isScanning = true;
                    let foundThisCycle = false;

                    try { await BleClient.stopLEScan(); } catch (e) { }

                    try {
                        await BleClient.requestLEScan({ services: [DOOR_SERVICE_UUID] }, (res) => { // Hardware-Level C++ UUID Filter (REQUIRED for Android Screen-Off Mode)
                            if (res.device?.deviceId?.toLowerCase() === BLE_MAC.toLowerCase() || res.device?.name?.toLowerCase().includes('smartdoor')) {
                                foundThisCycle = true;
                                BleClient.stopLEScan().catch(() => { });
                                setBleStatus('ready');
                            }
                        });
                    } catch (e) { }

                    // Allow 4 seconds for the ESP32 packet to strike the antenna
                    setTimeout(() => {
                        BleClient.stopLEScan().catch(() => { });
                        isScanning = false;
                        if (!foundThisCycle && !isUnlockingRef.current) {
                            setBleStatus('searching');
                            autoPromptedRef.current = false; // User has physically departed. Re-arm the auto-unlock trigger securely!
                        }
                    }, 4000);
                };

                runDiscoveryCycle();
                scanCycleTimer = setInterval(runDiscoveryCycle, 10000);

            } catch (e) {
                setBleStatus('offline');
            }
        };

        initBLE();

        return () => {
            if (scanCycleTimer) clearInterval(scanCycleTimer);
            BleClient.stopLEScan().catch(() => { });
        };
    }, [view]);

    // Tesla Auto-Unlock (Zero-Click Proximity Execution)
    useEffect(() => {
        if (view !== 'dashboard') return;
        if (bleStatus === 'ready' && !autoPromptedRef.current) {
            autoPromptedRef.current = true;
            setLiveScanActive(true); // Engages the native WEBRTC Continuous stream!
        } else if (bleStatus === 'offline' || bleStatus === 'disconnected' || bleStatus === 'searching') {
            autoPromptedRef.current = false; // Reset when they walk away
            setLiveScanActive(false);
        }
    }, [bleStatus, view]);

    // Live Surveillance Loop (Bypasses manual shutter requirement)
    useEffect(() => {
        let stream = null;
        let interval = null;

        const startLiveCamera = async () => {
            try {
                // CRITICAL FIX: The Android OS WebView Sandbox strictly blocks raw HTML5 WebRTC `getUserMedia` calls 
                // silently with 'Permission Denied' unless the overarching Native App actively forces the OS Permission Prompt beforehand!
                try { await Camera.requestPermissions(); } catch (pe) { console.error("Permission escalation failed", pe); }

                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }

                // Continuous analysis (1 frame every 1.5 seconds)
                interval = setInterval(() => {
                    executeLiveFrameCapture();
                }, 1500);
            } catch (err) {
                console.error("Native OS blocked continuous camera access:", err);
            }
        };

        if (liveScanActive && view === 'dashboard') {
            startLiveCamera();
        }

        return () => {
            if (interval) clearInterval(interval);
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [liveScanActive, view]);

    // Zero-Biometric Pocket Trust Workflow
    const executeTeslaUnlock = async () => {
        try {
            isUnlockingRef.current = true;

            // Trigger Pocket Feedback (Double-Vibrate & Voice)
            try {
                await Haptics.vibrate({ duration: 400 });
                setTimeout(() => Haptics.vibrate({ duration: 400 }), 600);
            } catch (e) { console.error(e); }

            try {
                await TextToSpeech.speak({
                    text: 'Aura Lock Disengaged',
                    rate: 1.1,
                });
            } catch (e) { }

            setLoading(true);
            setMessage('Awaiting Biometric Scan...');

            try {
                const bioCheck = await NativeBiometric.isAvailable();
                if (bioCheck.isAvailable) {
                    await NativeBiometric.verifyIdentity({
                        reason: "Authorize Door Unlock Protocol",
                        title: "Aura Lock Validation"
                    });
                }
            } catch (authErr) {
                isUnlockingRef.current = false;
                throw new Error("Biometric Scan Failed / Cancelled");
            }

            setMessage('Initializing Direct Lock Relay...');
            await triggerDoorUnlock();

            try {
                const res = await axios.post(`${API_BASE}/api/attendance/mark`, {
                    employee_id: myIdentity.employee_id || myIdentity.id,
                    method: 'tesla_proximity_auth',
                    device_id: 'internal_secure_enclave'
                });
                setResult(res.data);
            } catch (apiError) {
                console.warn('Logged auth locally due to API timeout/disconnect');
            }

            setView('success');

            setTimeout(() => {
                setView('dashboard');
                setMessage('');
                setResult(null);
                setBleStatus('ready'); // Leave it at ready so it doesn't pulse 'searching' unless they actually walk away
                isUnlockingRef.current = false; // Unmutes the background Promiscuous Scanner
            }, 6000);
        } catch (err) {
            setMessage(err.response?.data?.error || err.message || 'Background Auth Failed');
            setView('error');
            setTimeout(() => {
                setView('dashboard');
                isUnlockingRef.current = false;
            }, 3000);
        } finally {
            setLoading(false);
        }
    };

    // Continuous Live AI Optical Engine
    const executeLiveFrameCapture = async () => {
        if (!videoRef.current || !canvasRef.current || isUnlockingRef.current) return;

        try {
            const context = canvasRef.current.getContext('2d');
            canvasRef.current.width = videoRef.current.videoWidth || 640;
            canvasRef.current.height = videoRef.current.videoHeight || 480;
            if (canvasRef.current.width === 0) return; // Camera still booting

            context.drawImage(videoRef.current, 0, 0);

            canvasRef.current.toBlob(async (blob) => {
                if (!blob) return;

                try {
                    isUnlockingRef.current = true; // Lock the BLE thread
                    const form = new FormData();
                    form.append('file', blob, 'capture.jpg');

                    const res = await axios.post(`${API_BASE}/api/biometrics/face/verify`, form, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });

                    if (res.data.success) {
                        try { await Haptics.vibrate({ duration: 400 }); } catch (e) { }
                        try { await TextToSpeech.speak({ text: 'Aura Vision Verified', rate: 1.1 }); } catch (e) { }

                        setLiveScanActive(false); // Kill surveillance explicitly

                        // FIX: Transition the UI IMMEDIATELY to prevent the "frozen" camera bug
                        setResult(res.data);
                        setView('success');

                        // Now trigger the asynchronous BLE Handshake in the background
                        await triggerDoorUnlock();

                        setTimeout(() => {
                            setView('dashboard');
                            setMessage('');
                            setResult(null);
                            setBleStatus('ready');
                            isUnlockingRef.current = false;
                        }, 4000);
                    } else {
                        isUnlockingRef.current = false; // Not a match, unlock for next frame
                        setMessage(`Engine: ${res.data.message || 'No match'}`);
                    }
                } catch (err) {
                    isUnlockingRef.current = false; // Verification failed, silently retry next frame
                    const cloudRejection = err.response?.data?.message || err.message;
                    setMessage(`Optical: ${cloudRejection}`);
                }
            }, 'image/jpeg', 0.8);
        } catch (e) {
            console.error("Canvas manipulation failure", e);
            isUnlockingRef.current = false;
        }
    };

    // Admin Silent Override - No Attendance Logging
    const executeAdminOverrideUnlock = async () => {
        try {
            isUnlockingRef.current = true;

            try {
                await Haptics.vibrate({ duration: 300 });
            } catch (e) { }

            try {
                await TextToSpeech.speak({
                    text: 'Admin Override Engaged',
                    rate: 1.1,
                });
            } catch (e) { }

            setLoading(true);
            setMessage('Bypassing Web Servers (Direct BLE Hook)...');
            await triggerDoorUnlock();

            setView('success');

            setTimeout(() => {
                setView('dashboard');
                setMessage('');
                setResult(null);
                setBleStatus('ready');
                isUnlockingRef.current = false;
            }, 6000);
        } catch (err) {
            setMessage(err.message || 'Direct Override Failed');
            setView('error');
            setTimeout(() => {
                setView('dashboard');
                isUnlockingRef.current = false;
            }, 3000);
        } finally {
            setLoading(false);
        }
    };

    // Door Unlock Strategy
    const triggerDoorUnlock = async () => {
        try {
            await BleClient.initialize();
            // Wait 500ms for OS to cleanly flush the GATT pipeline after scanner dump
            await new Promise(resolve => setTimeout(resolve, 500));
            await BleClient.connect(BLE_MAC);

            const buffer = new ArrayBuffer(2);
            const dataView = new DataView(buffer);
            dataView.setUint8(0, 'O'.charCodeAt(0));
            dataView.setUint8(1, 'N'.charCodeAt(0));
            await BleClient.write(BLE_MAC, DOOR_SERVICE_UUID, DOOR_CHAR_UUID, dataView);

            setTimeout(async () => {
                const offBuf = new ArrayBuffer(3);
                const offView = new DataView(offBuf);
                offView.setUint8(0, 'O'.charCodeAt(0));
                offView.setUint8(1, 'F'.charCodeAt(0));
                offView.setUint8(2, 'F'.charCodeAt(0));
                await BleClient.write(BLE_MAC, DOOR_SERVICE_UUID, DOOR_CHAR_UUID, offView);
                await BleClient.disconnect(BLE_MAC);
            }, 5500);
        } catch (err) {
            console.error('BLE Failed:', err);
        }
    };

    // BYOD Personal Fingerprint Workflow
    const unlockWithFingerprint = async () => {
        try {
            setLoading(true);
            const avail = await NativeBiometric.isAvailable();
            if (!avail.isAvailable) {
                throw new Error("Biometric sensor not configured on this device.");
            }

            await NativeBiometric.verifyIdentity({
                reason: 'Authenticate to unlock Englabs door',
                title: 'Englabs Security',
                subtitle: `Confirm identity for ${myIdentity.name}`,
            });

            // 1. Log Attendance remotely across Wifi/4G
            setMessage('Authenticating...');
            const res = await axios.post(`${API_BASE}/api/attendance/mark`, {
                employee_id: myIdentity.employee_id || myIdentity.id,
                method: 'fingerprint_byod',
                device_id: 'iphone_byod'
            });

            // 2. Trigger Door via Local BLE
            setMessage('Unlocking Door...');
            triggerDoorUnlock();

            setResult(res.data);
            setView('success');

            // Auto close after 4 sec
            setTimeout(() => {
                setView('dashboard');
                setMessage('');
                setResult(null);
            }, 4000);

        } catch (err) {
            if (err.message !== 'User canceled') {
                setMessage(err.response?.data?.error || err.message || 'Verification Failed');
                setView('error');
                setTimeout(() => setView('dashboard'), 3000);
            }
        } finally {
            setLoading(false);
        }
    };

    if (view === 'loading') return <div className="w-screen h-screen kiosk-gradient flex items-center justify-center"><div className="animate-spin text-emerald-500"><AlertCircle size={40} /></div></div>;

    return (
        <div className="w-screen h-screen kiosk-gradient flex flex-col items-center justify-center p-6 text-slate-800 relative overflow-hidden">
            {/* Header / Englabs Branding */}
            <div className="absolute top-0 w-full pt-12 pb-6 px-8 flex justify-between items-center z-10 bg-gradient-to-b from-white/90 to-transparent">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.15)] flex items-center justify-center p-2 overflow-hidden border border-emerald-500/10">
                        <svg viewBox="0 0 100 100" className="w-full h-full text-emerald-500" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M 20,65 C 40,85 80,85 80,50 C 80,15 40,15 40,50 C 40,85 80,85 95,70" />
                            <path d="M 12,58 C 32,78 72,78 72,43 C 72,8 32,8 32,43 C 32,78 72,78 87,63" />
                        </svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[16px] font-black tracking-[0.2em] text-slate-900 leading-tight">ENGLABS</span>
                        <span className="text-[8px] font-bold uppercase tracking-[0.4em] text-emerald-600 leading-none">Aura Lock</span>
                    </div>
                </div>
                {view === 'dashboard' && (
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${bleStatus === 'ready' || bleStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {bleStatus === 'ready' ? 'Door in Range' : 'Out of bounds'}
                        </span>
                    </div>
                )}
            </div>

            <AnimatePresence mode="wait">
                {/* ── STEP 1: INITIAL DEVICE SETUP ── */}
                {view === 'setup' && (
                    <motion.div key="setup" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm glass p-8 rounded-3xl z-20">
                        <h2 className="text-2xl font-black mb-2 text-center text-slate-900">Device Pairing</h2>
                        <p className="text-xs text-slate-500 text-center mb-6">Select your identity to permanently bond this app to your smartphone.</p>

                        <input type="text" placeholder="Search your name..."
                            className="w-full bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:border-emerald-500 transition-colors mb-4"
                            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />

                        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                            {employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())).map(emp => (
                                <button key={emp.id} onClick={() => linkDeviceToEmployee(emp)}
                                    className="flex items-center gap-3 p-4 bg-white/50 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 rounded-xl shadow-sm transition-all text-left">
                                    <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden shrink-0">
                                        <img src={emp.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=f1f5f9&color=0f172a`} alt="" className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <div className="font-bold text-sm text-slate-800">{emp.name}</div>
                                        <div className="text-[10px] text-slate-500">{emp.department || 'Staff Member'}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* ── STEP 2: PERSONAL DASHBOARD ── */}
                {view === 'dashboard' && (
                    <motion.div key="dashboard" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center w-full z-20 mt-10">
                        {/* Profile Pill */}
                        <div className="glass px-6 py-4 rounded-full flex items-center gap-4 mb-16 border border-emerald-500/10">
                            <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 border-2 border-white shadow-sm">
                                <img src={myIdentity?.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(myIdentity?.name)}&background=f1f5f9&color=0f172a`} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex flex-col text-left">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Authenticated As</span>
                                <span className="font-black text-lg text-slate-900 tracking-tight">{myIdentity?.name}</span>
                            </div>
                        </div>

                        {/* DUAL BIOMETRIC GATEWAY UI */}
                        <div className="flex gap-4 w-full justify-center max-w-sm">
                            {liveScanActive ? (
                                <motion.div
                                    key="live-scanner"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="relative w-full h-[360px] rounded-[2.5rem] bg-slate-900 border-4 border-white shadow-[0_20px_60px_rgba(16,185,129,0.3)] overflow-hidden flex items-center justify-center shrink-0"
                                >
                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                                    />
                                    <canvas ref={canvasRef} className="hidden" />

                                    <motion.div
                                        initial={{ top: '-10%' }}
                                        animate={{ top: '110%' }}
                                        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                                        className="absolute left-0 right-0 h-1 bg-emerald-400 z-20 shadow-[0_0_20px_rgba(16,185,129,1)]"
                                    />

                                    <div className="absolute bottom-6 left-0 right-0 flex justify-center z-30">
                                        <div className="px-6 py-2 bg-slate-900/60 backdrop-blur-md rounded-full text-white tracking-[0.3em] text-[10px] font-black uppercase shadow-lg border border-white/10">
                                            Scanning Face
                                        </div>
                                    </div>

                                    <button onClick={() => setLiveScanActive(false)} className="absolute top-4 right-4 w-10 h-10 bg-slate-900/40 hover:bg-red-500/80 backdrop-blur-md rounded-full flex justify-center items-center text-white transition-colors z-30">
                                        <X size={18} strokeWidth={3} />
                                    </button>
                                </motion.div>
                            ) : (
                                <>
                                    {/* Option A: OS Hardware Biometric (Fingerprint/Local FaceID) */}
                                    <motion.button
                                        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                                        onClick={executeTeslaUnlock} disabled={loading || bleStatus !== 'ready'}
                                        className={`w-36 h-40 rounded-[2rem] flex flex-col items-center justify-center gap-4 transition-all duration-500 ${bleStatus === 'ready' ? 'bg-white shadow-[0_10px_40px_rgba(16,185,129,0.15)] border border-emerald-500/20' : 'bg-slate-100 border border-slate-200 opacity-60'}`}>
                                        <Fingerprint size={50} className={`${bleStatus === 'ready' ? 'text-emerald-500' : 'text-slate-400'}`} />
                                        <span className={`font-black text-xs uppercase tracking-widest text-center leading-tight ${bleStatus === 'ready' ? 'text-slate-800' : 'text-slate-400'}`}>
                                            Local<br />Auth
                                        </span>
                                    </motion.button>

                                    {/* Option B: Force Manual Camera Backup */}
                                    <motion.button
                                        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                                        onClick={() => setLiveScanActive(true)} disabled={loading || bleStatus !== 'ready'}
                                        className={`w-36 h-40 rounded-[2rem] flex flex-col items-center justify-center gap-4 transition-all duration-500 ${bleStatus === 'ready' ? 'bg-gradient-to-br from-emerald-500 to-emerald-400 shadow-[0_10px_40px_rgba(16,185,129,0.3)] border border-white/40' : 'bg-slate-100 border border-slate-200 opacity-60'}`}>
                                        <ScanFace size={50} className={`${bleStatus === 'ready' ? 'text-white drop-shadow-sm' : 'text-slate-400'}`} />
                                        <span className={`font-black text-xs uppercase tracking-widest text-center leading-tight ${bleStatus === 'ready' ? 'text-white' : 'text-slate-400'}`}>
                                            Live<br />Optical
                                        </span>
                                    </motion.button>
                                </>
                            )}
                        </div>

                        {message && (
                            <p className="mt-6 text-center text-[10px] font-black tracking-widest uppercase px-4 py-2 bg-red-50 border border-red-200 text-red-600 shadow-sm rounded-lg max-w-[300px]">
                                {message}
                            </p>
                        )}

                        {myIdentity?.name?.toLowerCase() === 'bharat anand' && (
                            <button onClick={executeAdminOverrideUnlock} disabled={loading || bleStatus !== 'ready'} className="mt-6 px-6 py-2 bg-emerald-50 border border-emerald-200 rounded-full text-[10px] text-emerald-600 font-bold uppercase tracking-widest hover:bg-emerald-100 transition-colors disabled:opacity-30">
                                Admin Silent Override
                            </button>
                        )}

                        <button onClick={handleClearIdentity} className="absolute bottom-8 text-[10px] text-slate-400 font-bold uppercase tracking-widest underline hover:text-red-500 transition-colors">
                            Reset Identity (Remove Device)
                        </button>
                    </motion.div>
                )}

                {/* ── SUCCESS SCREEN ── */}
                {view === 'success' && (
                    <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6 z-20">
                        <div className="w-32 h-32 rounded-full bg-emerald-50 border-4 border-emerald-500 flex items-center justify-center text-emerald-500 shadow-[0_0_60px_rgba(16,185,129,0.3)]">
                            <Unlock size={50} strokeWidth={3} />
                        </div>
                        <h2 className="text-4xl font-black text-slate-900 tracking-tight">Door Unlocked</h2>
                        <p className="text-emerald-600 font-bold text-lg text-center leading-tight">Identity Verified<br />& Attendance Logged</p>
                    </motion.div>
                )}

                {/* ── ERROR SCREEN ── */}
                {view === 'error' && (
                    <motion.div key="error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6 z-20">
                        <div className="w-32 h-32 rounded-full bg-red-50 border-4 border-red-500 flex items-center justify-center text-red-500 shadow-[0_0_60px_rgba(239,68,68,0.3)]">
                            <ShieldAlert size={50} strokeWidth={3} />
                        </div>
                        <h2 className="text-4xl font-black text-slate-900 tracking-tight">Access Denied</h2>
                        <p className="text-red-500 font-bold text-lg text-center max-w-[300px] leading-tight">{message}</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
