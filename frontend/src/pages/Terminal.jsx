import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scan, Fingerprint, Lock, Shield, ScanFace, UserCheck, UserX, Loader2, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { apiService } from '../services/api.service';

export default function Terminal() {
    const [time, setTime] = useState(new Date());
    const [status, setStatus] = useState('idle'); // idle, scanning, success, denied
    const [user, setUser] = useState(null);
    const [activeMethod, setActiveMethod] = useState(null);
    const [camEnabled, setCamEnabled] = useState(false);
    const [camError, setCamError] = useState(null);
    const [errorMsg, setErrorMsg] = useState(''); // New state for dynamic errors

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [stream, setStream] = useState(null);

    // Initial check for Secure Context (Chrome requires this for camera)
    const isSecure = window.isSecureContext;

    // Clock Update
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Initialize Camera on Mount
    useEffect(() => {
        if (isSecure) {
            startCamera();
        } else {
            setCamError("Site not in Secure Context. Camera blocked by browser.");
        }
        return () => stopCamera();
    }, []);

    const startCamera = async () => {
        setCamError(null);
        try {
            console.log("🎥 Attempting to start camera...");
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 640, height: 480 }
            });

            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
                setCamEnabled(true);
                console.log("✅ Camera started successfully");
            } else {
                // Ref might not be ready, retry once
                setTimeout(() => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = mediaStream;
                        setCamEnabled(true);
                    }
                }, 500);
            }
        } catch (err) {
            console.error("❌ Camera activation failed:", err);
            setCamEnabled(false);
            setCamError(err.name === 'NotAllowedError' ? "Camera permission denied" : "Hardware error or camera in use");
        }
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    };

    // Automatic Face Recognition Flow
    useEffect(() => {
        let interval;
        if (status === 'idle' && camEnabled) {
            interval = setInterval(() => {
                captureAndVerify();
            }, 2000); // Check every 2 seconds
        }
        return () => clearInterval(interval);
    }, [status, camEnabled]);

    const captureAndVerify = async () => {
        if (status !== 'idle' || !videoRef.current || !canvasRef.current) return;

        const context = canvasRef.current.getContext('2d');
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);

        canvasRef.current.toBlob(async (blob) => {
            if (!blob) return;

            setStatus('scanning');
            setActiveMethod('Face');

            try {
                const response = await apiService.verifyFace(blob);
                if (response.success) {
                    setUser(response.user);
                    setStatus('success');
                    setTimeout(() => reset(), 3000); // Show success for 3 seconds
                } else {
                    setErrorMsg(response.message || 'Face not recognized');
                    setStatus('denied');
                    setTimeout(() => reset(), 2500);
                }
            } catch (error) {
                console.error("Verification error:", error);
                setErrorMsg(error.message || 'Verification system error');
                setStatus('denied');
                setTimeout(() => reset(), 3000);
            }
        }, 'image/jpeg', 0.8);
    };

    const handleVerifySync = async (method) => {
        // Placeholder for Fingerprint/RFID
        setStatus('scanning');
        setActiveMethod(method);
        setTimeout(() => setStatus('denied'), 2000);
        setTimeout(() => reset(), 4000);
    };

    const reset = () => {
        setStatus('idle');
        setUser(null);
        setActiveMethod(null);
        setErrorMsg('');
    };

    const formatTime = (date) => date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    return (
        <div className="h-screen w-screen bg-[#050510] overflow-hidden relative flex items-center justify-center font-sans">
            {/* Background Animations */}
            <div className="absolute inset-0 z-0">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 blur-[120px] rounded-full animate-pulse-slow" />
            </div>

            {/* Terminal Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 w-full max-w-lg h-[85vh] bg-slate-900/40 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col p-8 md:p-12"
            >
                {/* Header */}
                <header className="flex justify-between items-center mb-12">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-white font-bold tracking-wider">SECURE ACCESS</h1>
                            <p className="text-blue-400/60 text-[10px] uppercase font-black tracking-widest">Version 2.4.0</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="text-right">
                            <div className="text-2xl font-light text-white tracking-tight">{formatTime(time)}</div>
                            <p className="text-slate-500 text-[10px] uppercase font-bold">{format(time, 'EEEE, MMM dd')}</p>
                        </div>
                        <Link
                            to="/admin"
                            className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                            title="Admin Panel"
                        >
                            <Settings className="w-5 h-5" />
                        </Link>
                    </div>
                </header>

                {/* Scan Area */}
                <div className="flex-1 flex flex-col items-center justify-center relative">
                    <AnimatePresence mode="wait">
                        {status === 'idle' || status === 'scanning' ? (
                            <motion.div
                                key="scan"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 1.1 }}
                                className="relative w-full aspect-square max-w-[320px]"
                            >
                                {/* Scan Ring Outer */}
                                <div className={`absolute inset-0 rounded-full border-2 border-slate-800 flex items-center justify-center ${status === 'scanning' ? 'animate-pulse' : ''}`}>
                                    <div className={`w-[90%] h-[90%] rounded-full border border-blue-500/20 border-dashed ${status === 'scanning' ? 'animate-spin-slow' : ''}`} />
                                </div>

                                {/* Scanner Visual */}
                                <div className="absolute inset-4 rounded-full bg-slate-950/50 backdrop-blur-sm overflow-hidden flex items-center justify-center border border-white/5">
                                    {status === 'scanning' && (
                                        <motion.div
                                            initial={{ top: '0%' }}
                                            animate={{ top: '100%' }}
                                            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                            className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent z-20 shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                                        />
                                    )}

                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        playsInline
                                        className={`w-full h-full object-cover grayscale opacity-40 transition-opacity ${camEnabled ? 'block' : 'hidden'}`}
                                        style={{ transform: 'scaleX(-1)' }} // Mirror
                                    />

                                    {!camEnabled && (
                                        <div className="flex flex-col items-center gap-4">
                                            <ScanFace className={`w-32 h-32 transition-colors duration-500 ${status === 'scanning' ? 'text-blue-500' : 'text-slate-700'}`} />
                                            {camError && <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest">{camError}</p>}
                                            <button
                                                onClick={startCamera}
                                                className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 text-[10px] font-black uppercase tracking-widest rounded-full border border-blue-500/20 transition-all active:scale-95"
                                            >
                                                {camError ? 'Retry Camera' : 'Start Camera'}
                                            </button>
                                            {!isSecure && (
                                                <p className="max-w-[200px] text-[8px] text-slate-500 text-center leading-relaxed">
                                                    Browser requires HTTPS or Localhost for camera access. Try using <span className="text-blue-400">localhost:5173</span> explicitly.
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {/* Overlay Gradient */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-blue-500/10 to-transparent pointer-events-none" />
                                </div>
                                <canvas ref={canvasRef} className="hidden" />

                                {/* Status Label */}
                                <div className="absolute -bottom-10 left-0 right-0 text-center">
                                    <p className={`text-sm font-bold tracking-widest uppercase transition-colors duration-500 ${status === 'scanning' ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`}>
                                        {status === 'scanning' ? `Verifying ${activeMethod}...` : 'Ready for verification'}
                                    </p>
                                </div>
                            </motion.div>
                        ) : status === 'success' ? (
                            <motion.div
                                key="success"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center text-center"
                            >
                                <div className="w-48 h-48 rounded-full bg-emerald-500/10 border-4 border-emerald-500/30 flex items-center justify-center mb-8 relative">
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1.5, opacity: 0 }}
                                        transition={{ duration: 1, repeat: Infinity }}
                                        className="absolute inset-0 rounded-full bg-emerald-500/20"
                                    />
                                    <UserCheck className="w-24 h-24 text-emerald-500" />
                                </div>
                                <h2 className="text-3xl font-black text-white tracking-tighter mb-2">ACCESS GRANTED</h2>
                                <p className="text-slate-500 text-xs mt-6 tracking-[0.3em] uppercase">Welcome Back, {user?.name || 'Authorized User'}</p>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="denied"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center text-center"
                            >
                                <div className="w-40 h-40 rounded-full bg-red-500/10 border-4 border-red-500/30 flex items-center justify-center mb-8">
                                    <UserX className="w-20 h-20 text-red-500" />
                                </div>
                                <h2 className="text-3xl font-black text-white tracking-tighter mb-2">ACCESS DENIED</h2>
                                <p className="text-red-400 font-bold uppercase tracking-[0.2em] text-xs mb-1">{errorMsg}</p>
                                <p className="text-red-400/40 font-medium uppercase tracking-[0.1em] text-[10px]">Sorry, Please try again</p>
                                <button
                                    onClick={reset}
                                    className="mt-10 text-slate-500 hover:text-white text-[10px] font-black uppercase tracking-widest border-b border-white/10"
                                >
                                    Try Again
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer Controls */}
                <footer className="mt-12">
                    <div className="flex justify-center gap-4">
                        <button
                            onClick={() => handleVerifySync('Fingerprint')}
                            disabled={status !== 'idle'}
                            className="flex-1 max-w-[140px] h-20 rounded-3xl bg-slate-900 border border-white/5 flex flex-col items-center justify-center gap-2 hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed group"
                        >
                            <Fingerprint className="w-6 h-6 text-slate-400 group-hover:text-blue-400 transition-colors" />
                            <span className="text-[10px] font-black tracking-widest text-slate-600 group-hover:text-blue-200 uppercase">Biometric</span>
                        </button>
                        <button
                            onClick={() => handleVerifySync('RFID')}
                            disabled={status !== 'idle'}
                            className="flex-1 max-w-[140px] h-20 rounded-3xl bg-slate-900 border border-white/5 flex flex-col items-center justify-center gap-2 hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed group"
                        >
                            <Scan className="w-6 h-6 text-slate-400 group-hover:text-blue-400 transition-colors" />
                            <span className="text-[10px] font-black tracking-widest text-slate-600 group-hover:text-blue-200 uppercase">ID Card</span>
                        </button>
                    </div>
                </footer>
            </motion.div>
        </div>
    );
}
