import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Fingerprint, CheckCircle2, AlertCircle, Clock, Calendar, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { apiService } from '../services/api.service';

export default function Attendance() {
    const { user, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const [status, setStatus] = useState('idle'); // idle, verifying, success, error
    const [message, setMessage] = useState('');
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
                <AlertCircle className="w-16 h-16 text-slate-700 mb-6" />
                <h2 className="text-xl font-bold text-white mb-2">Authentication Required</h2>
                <p className="text-slate-500 mb-8 max-w-xs">Please log in to your employee account to record attendance.</p>
                <Link to="/login" className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold">Sign In</Link>
            </div>
        );
    }

    const handleVerify = async () => {
        setStatus('verifying');
        setMessage('Verifying phone biometrics...');

        // Simulate mobile biometric delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            const response = await apiService.recordPhoneAttendance();
            if (response.success) {
                setStatus('success');
                setMessage(response.message || 'Attendance recorded successfully!');
                // Auto reset or navigate after 3s
                setTimeout(() => setStatus('idle'), 3000);
            } else {
                setStatus('error');
                setMessage(response.message || 'Verification failed');
            }
        } catch (error) {
            console.error("Attendance Error:", error);
            setStatus('error');
            setMessage(error.message || 'System error. Please try again.');
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-6 flex flex-col items-center">
            {/* Header */}
            <header className="w-full max-w-md flex items-center justify-between mb-12">
                <Link to="/" className="p-2 -ml-2 text-slate-500 hover:text-white transition-colors">
                    <ArrowLeft className="w-6 h-6" />
                </Link>
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-bold tracking-tight text-white">ATTENDANCE</span>
                </div>
                <div className="w-10"></div> {/* Spacer */}
            </header>

            <main className="w-full max-w-md flex-1 flex flex-col items-center">
                {/* User Info */}
                <div className="text-center mb-12">
                    <div className="w-20 h-20 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4 text-2xl font-black text-blue-500">
                        {user?.name?.[0] || 'U'}
                    </div>
                    <h1 className="text-2xl font-black text-white tracking-tight">{user?.name}</h1>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Employee Check-In</p>
                </div>

                {/* Time Display */}
                <div className="bg-white/[0.03] border border-white/[0.05] rounded-3xl p-8 w-full mb-12 flex flex-col items-center">
                    <div className="flex items-center gap-3 text-slate-400 mb-2">
                        <Calendar className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        </span>
                    </div>
                    <div className="text-5xl font-black text-white tracking-tighter tabular-nums">
                        {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    </div>
                </div>

                {/* Interaction Area */}
                <div className="flex-1 w-full flex flex-col items-center justify-center">
                    <AnimatePresence mode="wait">
                        {status === 'idle' ? (
                            <motion.button
                                key="idle"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 1.1 }}
                                onClick={handleVerify}
                                className="group relative w-48 h-48 rounded-full bg-slate-900 border-4 border-slate-800 flex flex-col items-center justify-center shadow-2xl hover:bg-slate-800 transition-all active:scale-95"
                            >
                                <div className="absolute inset-0 rounded-full border-4 border-blue-500/20 group-hover:border-blue-500/40 animate-pulse-slow" />
                                <Fingerprint className="w-20 h-20 text-blue-500 mb-2 group-hover:scale-110 transition-transform" />
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Verify Fingerprint</span>
                            </motion.button>
                        ) : status === 'verifying' ? (
                            <motion.div
                                key="verifying"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center text-center"
                            >
                                <div className="w-24 h-24 rounded-full border-4 border-blue-500/20 flex items-center justify-center relative mb-8">
                                    <div className="absolute inset-[-4px] rounded-full border-4 border-transparent border-t-blue-500 animate-spin" />
                                    <Fingerprint className="w-12 h-12 text-blue-500 animate-pulse" />
                                </div>
                                <p className="text-blue-400 font-bold uppercase tracking-widest animate-pulse">{message}</p>
                            </motion.div>
                        ) : status === 'success' ? (
                            <motion.div
                                key="success"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center text-center"
                            >
                                <div className="w-24 h-24 rounded-full bg-emerald-500/10 border-4 border-emerald-500/30 flex items-center justify-center mb-8">
                                    <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                                </div>
                                <h2 className="text-2xl font-black text-white tracking-tighter mb-2">RECORDED</h2>
                                <p className="text-emerald-400 font-bold uppercase tracking-widest text-[10px]">{message}</p>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="error"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center text-center"
                            >
                                <div className="w-24 h-24 rounded-full bg-red-500/10 border-4 border-red-500/30 flex items-center justify-center mb-8">
                                    <AlertCircle className="w-12 h-12 text-red-500" />
                                </div>
                                <h2 className="text-2xl font-black text-white tracking-tighter mb-2">FAILED</h2>
                                <p className="text-red-400 font-bold uppercase tracking-widest text-[10px] mb-8">{message}</p>
                                <button onClick={() => setStatus('idle')} className="text-slate-500 font-black uppercase tracking-widest text-[10px] border-b border-slate-800 pb-1">Retry Check-In</button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer Info */}
                <div className="mt-12 text-center text-slate-600">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Corporate Security Node // 08-F</p>
                </div>
            </main>
        </div>
    );
}
