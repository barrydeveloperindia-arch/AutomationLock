import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Scanner from './Scanner';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock framer-motion
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

describe('Terminal Safeguards & Error Transparency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        axios.get.mockResolvedValue({ data: [] });
        
        // Mocking navigator.mediaDevices
        global.navigator.mediaDevices = {
            getUserMedia: vi.fn().mockResolvedValue({
                getTracks: () => [{ stop: vi.fn() }]
            })
        };

        // Mock video properties
        Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
            get: () => 4
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
            get: () => false
        });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

        // Mock canvas context
        HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
            drawImage: vi.fn(),
            toBlob: vi.fn(),
        });
        HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((callback) => {
            callback(new Blob(['test'], { type: 'image/jpeg' }));
        });
    });

    it('displays the specific backend message for ambiguous matches', async () => {
        axios.post.mockResolvedValue({ 
            data: { success: false, message: 'Ambiguous Match: Multiple users similar.' } 
        });

        renderWithRouter(<Scanner />);
        
        vi.useFakeTimers();
        // Skip mounting delays
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000); 
        });
        // Skip scan interval
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4000); 
        });

        await waitFor(() => {
            expect(screen.getByText(/Ambiguous Match/i)).toBeInTheDocument();
        }, { timeout: 3000 });
        
        vi.useRealTimers();
    }, 10000);

    it('displays "No face detected" when backend returns specific error', async () => {
        axios.post.mockResolvedValue({ 
            data: { success: false, message: 'No face detected.' } 
        });

        renderWithRouter(<Scanner />);
        
        vi.useFakeTimers();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000); 
        });

        await waitFor(() => {
            expect(screen.getByText(/No face detected/i)).toBeInTheDocument();
        }, { timeout: 3000 });
        
        vi.useRealTimers();
    }, 10000);

    it('handles 401 Unauthorized with backend message', async () => {
        axios.post.mockRejectedValue({ 
            response: { status: 401, data: { message: 'Too many requests' } } 
        });

        renderWithRouter(<Scanner />);
        
        vi.useFakeTimers();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000); 
        });

        await waitFor(() => {
            expect(screen.getByText(/Too many requests/i)).toBeInTheDocument();
        }, { timeout: 3000 });
        
        vi.useRealTimers();
    }, 10000);
});
