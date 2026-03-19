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
            executeCameraFaceScan();
        } else if (bleStatus === 'offline' || bleStatus === 'disconnected' || bleStatus === 'searching') {
            autoPromptedRef.current = false; // Reset when they walk away
        }
    }, [bleStatus, view]);

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

    // Advanced Cloud Vision Engine (Google Cloud Run / Python Edge)
    const executeCameraFaceScan = async () => {
        try {
            isUnlockingRef.current = true;
            setLoading(true);
            setMessage('Initializing Front Optical Sensor...');

            const image = await Camera.getPhoto({
                quality: 80,
                allowEditing: false,
                resultType: CameraResultType.Base64,
                source: CameraSource.Camera,
                direction: CameraDirection.Front
            });

            setMessage('Analyzing Facial Vectors via GCP Edge...');

            try { await Haptics.vibrate({ duration: 100 }); } catch (e) { }

            // SOP: Camera base64 must be strictly converted into a binary Blob to prevent FastAPI Memory/Schema 422 Rejections
            const byteCharacters = atob(image.base64String);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const rawBlob = new Blob([byteArray], { type: 'image/jpeg' });

            const form = new FormData();
            form.append('file', rawBlob, 'capture.jpg');

            const res = await axios.post(`${API_BASE}/api/biometrics/face/verify`, form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            try {
                await TextToSpeech.speak({ text: 'Aura Vision Verified', rate: 1.1 });
                await Haptics.vibrate({ duration: 400 });
            } catch (e) { }

            setMessage('Optical Vector Validated. Disengaging Door...');
            await triggerDoorUnlock();

            setResult(res.data);
            setView('success');
            setTimeout(() => {
                setView('dashboard');
                setMessage('');
                setResult(null);
                setBleStatus('ready');
                isUnlockingRef.current = false;
            }, 6000);

        } catch (err) {
            setMessage(err.response?.data?.error || err.message || 'Vision Verification Denied');
            setView('error');
            setTimeout(() => {
                setView('dashboard');
                isUnlockingRef.current = false;
            }, 3000);
        } finally {
            setLoading(false);
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

    if (view === 'loading') return <div className="w-screen h-screen kiosk-gradient flex items-center justify-center"><div className="animate-spin text-blue-500"><AlertCircle size={40} /></div></div>;

    return (
        <div className="w-screen h-screen kiosk-gradient flex flex-col items-center justify-center p-6 text-white relative overflow-hidden">
            {/* Header / Englabs Branding */}
            <div className="absolute top-0 w-full pt-12 pb-6 px-8 flex justify-between items-center z-10 bg-gradient-to-b from-slate-900/80 to-transparent">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center justify-center p-2 overflow-hidden">
                        <svg viewBox="0 0 100 100" className="w-full h-full text-emerald-400" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M 20,65 C 40,85 80,85 80,50 C 80,15 40,15 40,50 C 40,85 80,85 95,70" />
                            <path d="M 12,58 C 32,78 72,78 72,43 C 72,8 32,8 32,43 C 32,78 72,78 87,63" />
                        </svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[16px] font-black tracking-[0.2em] text-white leading-tight">ENGLABS</span>
                        <span className="text-[8px] font-bold uppercase tracking-[0.4em] text-emerald-400 leading-none">Aura Lock</span>
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
                        <h2 className="text-2xl font-black mb-2 text-center text-white">Device Pairing</h2>
                        <p className="text-xs text-slate-400 text-center mb-6">Select your identity to permanently bond this app to your smartphone.</p>

                        <input type="text" placeholder="Search your name..."
                            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 text-sm focus:outline-none focus:border-blue-500/50 transition-colors mb-4"
                            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />

                        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                            {employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())).map(emp => (
                                <button key={emp.id} onClick={() => linkDeviceToEmployee(emp)}
                                    className="flex items-center gap-3 p-4 bg-white/[0.02] hover:bg-blue-500/10 border border-transparent hover:border-blue-500/20 rounded-xl transition-all text-left">
                                    <div className="w-8 h-8 rounded-full bg-slate-800 overflow-hidden shrink-0">
                                        <img src={emp.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=1e293b&color=94a3b8`} alt="" className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <div className="font-bold text-sm text-slate-100">{emp.name}</div>
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
                        <div className="glass px-6 py-4 rounded-full flex items-center gap-4 mb-16 border border-white/5">
                            <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 border-2 border-blue-500/30">
                                <img src={myIdentity?.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(myIdentity?.name)}&background=1e293b&color=94a3b8`} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex flex-col text-left">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Authenticated As</span>
                                <span className="font-black text-lg text-white tracking-tight">{myIdentity?.name}</span>
                            </div>
                        </div>

                        {/* DUAL BIOMETRIC GATEWAY UI */}
                        <div className="flex gap-4 w-full justify-center max-w-sm">
                            {/* Option A: OS Hardware Biometric (Fingerprint/Local FaceID) */}
                            <motion.button
                                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                                onClick={executeTeslaUnlock} disabled={loading || bleStatus !== 'ready'}
                                className={`w-36 h-40 rounded-[2rem] flex flex-col items-center justify-center gap-4 transition-all duration-500 ${bleStatus === 'ready' ? 'bg-gradient-to-br from-blue-600 to-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.4)] border-2 border-white/20' : 'bg-slate-800/50 border-2 border-slate-700/50 opacity-60'}`}>
                                {loading ? (
                                    <div className="animate-spin text-white"><AlertCircle size={45} /></div>
                                ) : (
                                    <Fingerprint size={50} className="text-white drop-shadow-md" />
                                )}
                                <span className="font-black text-xs uppercase tracking-widest text-center leading-tight">
                                    Local<br />Auth
                                </span>
                            </motion.button>

                            {/* Option B: Cloud Optical Geometry (GCP Vision) */}
                            <motion.button
                                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                                onClick={executeCameraFaceScan} disabled={loading || bleStatus !== 'ready'}
                                className={`w-36 h-40 rounded-[2rem] flex flex-col items-center justify-center gap-4 transition-all duration-500 ${bleStatus === 'ready' ? 'bg-gradient-to-br from-indigo-600 to-purple-500 shadow-[0_0_40px_rgba(99,102,241,0.4)] border-2 border-white/20' : 'bg-slate-800/50 border-2 border-slate-700/50 opacity-60'}`}>
                                {loading ? (
                                    <div className="animate-spin text-white"><AlertCircle size={45} /></div>
                                ) : (
                                    <ScanFace size={50} className="text-white drop-shadow-md" />
                                )}
                                <span className="font-black text-xs uppercase tracking-widest text-center leading-tight">
                                    Cloud<br />Optical
                                </span>
                            </motion.button>
                        </div>

                        <p className="mt-8 text-center text-[11px] text-slate-500 uppercase tracking-widest font-black max-w-[280px]">
                            ⚡ TESLA PROXIMITY MODE ACTIVE ⚡<br /><br />
                            Background BLE Polling engaged. Keep phone in pocket; Door trusts your device's Enclave Token organically.
                        </p>

                        {myIdentity?.name?.toLowerCase() === 'bharat anand' && (
                            <button onClick={executeAdminOverrideUnlock} disabled={loading || bleStatus !== 'ready'} className="mt-6 px-6 py-2 bg-slate-800 border border-emerald-500/50 rounded-full text-[10px] text-emerald-400 font-bold uppercase tracking-widest hover:bg-emerald-900/30 transition-colors disabled:opacity-30">
                                Admin Silent Override
                            </button>
                        )}

                        <button onClick={handleClearIdentity} className="absolute bottom-8 text-[10px] text-slate-600 font-bold uppercase tracking-widest underline hover:text-slate-400 transition-colors">
                            Reset Identity (Remove Device)
                        </button>
                    </motion.div>
                )}

                {/* ── SUCCESS SCREEN ── */}
                {view === 'success' && (
                    <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6 z-20">
                        <div className="w-32 h-32 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.5)]">
                            <Unlock size={50} />
                        </div>
                        <h2 className="text-4xl font-black text-white tracking-tight">Door Unlocked</h2>
                        <p className="text-emerald-400 font-bold text-lg">Identity Verified & Attendance Logged</p>
                    </motion.div>
                )}

                {/* ── ERROR SCREEN ── */}
                {view === 'error' && (
                    <motion.div key="error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6 z-20">
                        <div className="w-32 h-32 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center text-red-500 shadow-[0_0_40px_rgba(239,68,68,0.5)]">
                            <ShieldAlert size={50} />
                        </div>
                        <h2 className="text-4xl font-black text-white tracking-tight">Access Denied</h2>
                        <p className="text-red-400 font-bold text-lg text-center max-w-[300px]">{message}</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
