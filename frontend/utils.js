/**
 * Utility functions for the Beholder Beauty Explorer frontend
 */

// Color utilities
export const BeautyColors = {
    getColorForScore(score) {
        // Continuous gradient from red (1) to green (10)
        // Clamp score between 1 and 10
        const clampedScore = Math.max(1, Math.min(10, score || 5));
        
        // Normalize score to 0-1 range
        const normalized = (clampedScore - 1) / 9;
        
        // Interpolate between red and green
        // Red at 0, yellow at 0.5, green at 1
        let r, g, b;
        
        if (normalized <= 0.5) {
            // Red to yellow transition
            const localNorm = normalized * 2; // 0 to 1 for this half
            r = 255;
            g = Math.round(255 * localNorm);
            b = 0;
        } else {
            // Yellow to green transition
            const localNorm = (normalized - 0.5) * 2; // 0 to 1 for this half
            r = Math.round(255 * (1 - localNorm));
            g = 255;
            b = 0;
        }
        
        return [r, g, b, 180];
    },
    
    getHexColorForScore(score) {
        // Continuous gradient from red (1) to green (10)
        const clampedScore = Math.max(1, Math.min(10, score || 5));
        const normalized = (clampedScore - 1) / 9;
        
        let r, g, b;
        
        if (normalized <= 0.5) {
            // Red to yellow transition
            const localNorm = normalized * 2;
            r = 255;
            g = Math.round(255 * localNorm);
            b = 0;
        } else {
            // Yellow to green transition
            const localNorm = (normalized - 0.5) * 2;
            r = Math.round(255 * (1 - localNorm));
            g = 255;
            b = 0;
        }
        
        // Convert to hex
        const toHex = (n) => n.toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    },
    
    getScoreDescription(score) {
        if (score >= 9) return 'Excellent';
        if (score >= 7) return 'Good';
        if (score >= 5) return 'Okay';
        if (score >= 3) return 'Lackluster';
        return 'Bad';
    }
};

// Geographic utilities
export const GeoUtils = {
    // Check if coordinates are within London bounds (rough)
    isInLondon(lat, lng) {
        return lat >= 51.28 && lat <= 51.70 && lng >= -0.51 && lng <= 0.33;
    },
    
    // Calculate distance between two points in kilometers
    distance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRadians(lat2 - lat1);
        const dLng = this.toRadians(lng2 - lng1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },
    
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    },
    
    // Format coordinates for display
    formatCoordinates(lat, lng) {
        return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
};

// API utilities
export const ApiUtils = {
    async request(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Network error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        
        return response.json();
    },
    
    async get(url) {
        return this.request(url);
    },
    
    async post(url, data) {
        return this.request(url, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
};

// Local storage utilities
export const StorageUtils = {
    save(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
        }
    },
    
    load(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.warn('Failed to load from localStorage:', error);
            return defaultValue;
        }
    },
    
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('Failed to remove from localStorage:', error);
        }
    }
};

// Validation utilities
export const ValidationUtils = {
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    },
    
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },
    
    isValidLondonAddress(address) {
        // Basic check for London-related keywords
        const londonKeywords = ['london', 'sw', 'se', 'nw', 'ne', 'w1', 'ec', 'wc'];
        const lowerAddress = address.toLowerCase();
        return londonKeywords.some(keyword => lowerAddress.includes(keyword));
    },
    
    sanitizeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

// Format utilities
export const FormatUtils = {
    formatDate(date) {
        return new Intl.DateTimeFormat('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(date));
    },
    
    formatNumber(num, decimals = 1) {
        return Number(num).toFixed(decimals);
    },
    
    formatBeautyScore(score) {
        if (score === null || score === undefined) return 'N/A';
        return `${this.formatNumber(score)}/10`;
    },
    
    truncateText(text, maxLength = 100) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength).trim() + '...';
    }
};

// Animation utilities
export const AnimationUtils = {
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    },
    
    animate(duration, callback) {
        const start = performance.now();
        
        function frame(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = AnimationUtils.easeInOutCubic(progress);
            
            callback(easedProgress);
            
            if (progress < 1) {
                requestAnimationFrame(frame);
            }
        }
        
        requestAnimationFrame(frame);
    }
};

// Error handling utilities
export const ErrorUtils = {
    getErrorMessage(error) {
        if (error.message) return error.message;
        if (typeof error === 'string') return error;
        return 'An unknown error occurred';
    },
    
    showError(message, duration = 5000) {
        // Create a simple error toast
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 16px;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 10000;
            max-width: 300px;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, duration);
    },
    
    showSuccess(message, duration = 3000) {
        // Create a simple success toast
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 16px;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 10000;
            max-width: 300px;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, duration);
    }
};