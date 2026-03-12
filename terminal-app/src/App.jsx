import React from 'react';

// Simplified identity for terminal identification
const getTerminalId = () => {
    let id = localStorage.getItem('terminal_id');
    if (!id) {
        id = `TERM-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        localStorage.setItem('terminal_id', id);
    }
    return id;
};
const TERMINAL_ID = getTerminalId();

export default function App() {
    return (
        <div style={{ 
            height: '100vh', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            backgroundColor: '#0a0f1e', 
            color: 'white',
            fontFamily: 'sans-serif'
        }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Smart Lock Terminal</h1>
            <p style={{ fontSize: '1.2rem', color: '#10b981' }}>Test Build Running Successfully</p>
            <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #1e293b', borderRadius: '8px' }}>
                <p>Terminal ID: {TERMINAL_ID}</p>
                <p>Device Scheme: https</p>
                <p>Status: UI Loaded</p>
            </div>
            <p style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#64748b' }}>
                Note: BLE and Supabase are temporarily disabled for this test.
            </p>
        </div>
    );
}
