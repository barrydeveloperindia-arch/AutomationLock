import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Scanner from './Scanner';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }) => <div {...props}>{children}</div>,
        button: ({ children, ...props }) => <button {...props}>{children}</button>,
    },
    AnimatePresence: ({ children }) => <>{children}</>,
}));

const renderWithRouter = (ui) => {
    return render(ui, { wrapper: BrowserRouter });
};

describe('Scanner Component (Automated Terminal)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        axios.get.mockResolvedValue({ data: [] });
        
        // Mocking navigator.mediaDevices
        global.navigator.mediaDevices = {
            getUserMedia: vi.fn().mockResolvedValue({
                getTracks: () => [{ stop: vi.fn() }]
            })
        };
    });

    it('renders the automated terminal with live camera and status', async () => {
        renderWithRouter(<Scanner />);
        
        expect(await screen.findByText(/AuraLock Terminal/i)).toBeInTheDocument();
        expect(await screen.findByText(/Looking for face/i)).toBeInTheDocument();
    });

    it('displays terminal status information', async () => {
        renderWithRouter(<Scanner />);
        expect(await screen.findByText(/Biometric Terminal Active/i)).toBeInTheDocument();
    });

    it('returns to home screen when Back to Home is clicked', async () => {
        renderWithRouter(<Scanner />);
        const backBtn = await screen.findByText(/Back to Home/i);
        fireEvent.click(backBtn);
        expect(backBtn).toBeInTheDocument();
    });
});
