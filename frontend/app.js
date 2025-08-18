// Configuration
const CONFIG = {
    // Local development configuration - no API keys needed in frontend
    API_BASE_URL: 'https://beholder.josephmiller101.workers.dev', // Production Cloudflare Worker
    
    // Debug settings - can be enabled via URL parameter ?debug=true
    DEBUG: new URLSearchParams(window.location.search).get('debug') === 'true',
    
    // Map settings
    INITIAL_CENTER: { lat: 51.5074, lng: -0.1278 }, // Default view (London dataset)
    INITIAL_ZOOM: 12,
    
    // Visualization settings
    HEATMAP_ZOOM_THRESHOLD: 16, // Show heatmap up to and including zoom 15
    MAX_POINTS_TO_SHOW: 5000,
    
    // Animation settings
    ANIMATION: {
        FADE_DURATION: 800,      // Duration of fade in/out animations in ms
        DEBOUNCE_DELAY: 150,     // Delay for debouncing map updates in ms
        MIN_ALPHA: 0,            // Minimum alpha for fade animations
        HEX_BASE_ALPHA: 100,     // Base alpha for hexagon colors
        HEX_EMPTY_ALPHA: 30,     // Alpha for empty hex display
        POINT_BASE_ALPHA: 255,   // Base alpha for pins/text
        LINE_OPACITY: {
            LARGE: 160,          // Large hexagon line opacity
            MEDIUM: 130,         // Medium hexagon line opacity
            SMALL: 110           // Small hexagon line opacity (unused)
        },
        LINE_WIDTH: {
            LARGE: 2,            // Large hexagon line width
            MEDIUM: 1.5,         // Medium hexagon line width
            SMALL: 1             // Small hexagon line width (unused)
        }
    },
    
    // Search UI
    SEARCH_PLACEHOLDER: 'Enter address',

    // Autocomplete/pan behaviors
    AUTOCOMPLETE: {
        PAN_DELAY_MS: 100,       // Delay after selection before panning (ms)
        GEOCODER_PAN_DELAY_MS: 50
    },

    // API
    API: {
        TIMEOUT_MS: 60000
    },

    // UI thresholds
    UI: {
        TEXT_ZOOM_THRESHOLD: 18
    },

    // Map buffers for bbox expansion
    MAP: {
        BUFFER_DEFAULT: 0.01,
        BUFFER_Z13_PLUS: 0.005,
        BUFFER_Z10_PLUS: 0.015,
        BUFFER_LOW: 0.02
    },

    // H3 resolution zoom ranges
    H3: {
        R7_MIN_ZOOM: 9,
        R7_MAX_ZOOM: 12,
        R9_MIN_ZOOM: 13,
        R9_MAX_ZOOM: 15
    },

    // Pin icon dimensions and sizing
    ICONS: {
        INTRINSIC_WIDTH: 512,
        INTRINSIC_HEIGHT: 512,
        ANCHOR_X: 256,
        ANCHOR_Y: 512,
        SIZE_PX: 64,
        SIZE_MIN: 56,
        SIZE_MAX: 72,
        PICKING_RADIUS: 6
    },

    // Text icon overlay settings
    TEXT_ICON: {
        ICON_WIDTH: 64,
        ICON_HEIGHT: 64,
        ANCHOR_X: 32,
        ANCHOR_Y: 32,
        SIZE_PX: 24,
        SIZE_MIN: 18,
        SIZE_MAX: 30,
        PIXEL_OFFSET_Y: -28
    },

    // Spinner overlay settings
    SPINNER: {
        CONTAINER_SIZE: 24,
        INNER_SIZE: 12,
        BORDER_WIDTH: 2,
        OFFSET_Y: 30,
        OFFSET_X: 0,
        TOP_MARGIN: 4,
        SPEED_S: 1
    },


    // Color scale configuration - easily adjustable
    COLOR_SCALE: {
        // Define the gradient stops: score -> [R, G, B, A] (alpha optional, defaults to 255)
        // Must have at least score 1 and 10 defined
        STOPS: {
            1: [255, 0, 0, 150],     // Red (worst) - semi-opaque
            5.5: [255, 255, 0, 30],  // Yellow (neutral) - mostly transparent
            10: [0, 255, 0, 150]     // Green (best) - semi-opaque
        }
        // Examples of other color scales:
        // Blue to Pink:
        // STOPS: {
        //     1: [0, 0, 255],      // Blue (worst)
        //     5.5: [128, 0, 255],  // Purple (middle)
        //     10: [255, 0, 128]    // Pink (best)
        // }
        // Cool to Warm:
        // STOPS: {
        //     1: [0, 100, 255],    // Cool blue
        //     5.5: [255, 255, 255], // White
        //     10: [255, 50, 0]     // Warm orange
        // }
    }
};

// Debug utility
const debug = (...args) => {
    if (CONFIG.DEBUG) {
        console.log('[DEBUG]', ...args);
    }
};

class BeautyHeatmap {
    constructor() {
        this.map = null;
        this.overlay = null;
        this.heatData = [];
        this.pointData = [];
        this.showHeatmap = true;
        this.showPoints = true;
        this.iconCache = new Map();
        this.externalPinSvg = null;
        this.textIconCache = new Map();
        
        // Show debug UI if debug mode is enabled
        this.initDebugUI();
        this.lastVisibility = null;
        
        this.init();
    }
    
    initDebugUI() {
        if (CONFIG.DEBUG) {
            // Show debug UI elements
            const zoomInfoElement = document.getElementById('zoomInfo');
            
            if (zoomInfoElement) {
                zoomInfoElement.style.display = 'block';
            }
        }
    }
    
    async loadGoogleMaps() {
        return new Promise(async (resolve, reject) => {
            if (window.google && window.google.maps) {
                resolve();
                return;
            }
            
            try {
                // Get Google Maps script URL from backend (which has the API key)
                const response = await fetch(`${CONFIG.API_BASE_URL}/maps-script`);
                if (!response.ok) {
                    throw new Error('Failed to get Maps script URL from backend');
                }
                
                const { scriptUrl } = await response.json();
                
                // Use Google's recommended async loading pattern
                window.initMap = () => {
                    delete window.initMap; // Clean up
                    resolve();
                };
                
                const script = document.createElement('script');
                script.src = `${scriptUrl}&callback=initMap&loading=async`;
                script.async = true;
                script.defer = true;
                script.onerror = () => reject(new Error('Failed to load Google Maps'));
                
                document.head.appendChild(script);
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    async init() {
        try {
            // Check if Google Maps is already loaded, or load it
            if (!window.google || !window.google.maps) {
                await this.loadGoogleMaps();
            }
            
            // Initialize map
            this.map = new google.maps.Map(document.getElementById('map'), {
                center: CONFIG.INITIAL_CENTER,
                zoom: CONFIG.INITIAL_ZOOM,
                clickableIcons: false, // Prevent Google POIs from stealing clicks behind our overlay
                draggableCursor: 'default', // Override Google Maps default draggable cursor
                draggingCursor: 'grabbing', // Keep grabbing cursor when actually dragging
                styles: [
                    {
                        featureType: 'all',
                        elementType: 'labels',
                        stylers: [{ visibility: 'on' }]
                    }
                ]
            });
            
            
            // Initialize deck.gl overlay - try different global patterns
            let GoogleMapsOverlay;
            if (window.deck && window.deck.GoogleMapsOverlay) {
                GoogleMapsOverlay = window.deck.GoogleMapsOverlay;
            } else if (window.DeckGL && window.DeckGL.GoogleMapsOverlay) {
                GoogleMapsOverlay = window.DeckGL.GoogleMapsOverlay;
            } else if (window.GoogleMapsOverlay) {
                GoogleMapsOverlay = window.GoogleMapsOverlay;
            } else {
                throw new Error('GoogleMapsOverlay not found in global scope');
            }
            
            this.overlay = new GoogleMapsOverlay({
                interleaved: true,
                getCursor: ({ isHovering, isDragging }) => {
                    // Use Google Maps setOptions to control cursor for GoogleMapsOverlay
                    if (isHovering) {
                        this.map.setOptions({ draggableCursor: "pointer" });
                    } else {
                        this.map.setOptions({ draggableCursor: "default" });
                    }
                    
                    const cursor = isDragging ? 'grabbing' : (isHovering ? 'pointer' : 'default');
                    return cursor;
                }
            });
            this.overlay.setMap(this.map);
            
            
            // deck.gl is loaded and working
            // Set up event listeners
            this.setupEventListeners();

            // Attach Places Autocomplete to the address input
            this.setupAutocomplete();
            
            // Load initial data
            await this.refreshData();
            
            
            // Initialize zoom info display
            this.updateZoomInfo(this.map.getZoom());
            
        } catch (error) {
            console.error('Failed to initialize map:', error);
            if (error.message.includes('ExpiredKeyMapError') || error.message.includes('API key')) {
                alert('Google Maps API key is expired or invalid. Please update the API key in the backend.');
            } else {
                alert('Failed to load map. Please check your API keys and try again.');
            }
        }
    }
    setupAutocomplete() {
        const input = document.getElementById('addressInput');
        if (!window.google || !google.maps.places) {
            this.showFallbackInput();
            return;
        }
        
        // Use modern PlaceAutocompleteElement
        if (google.maps.places.PlaceAutocompleteElement) {
            this.setupPlaceAutocompleteElement(input);
        } else {
            console.warn('PlaceAutocompleteElement not available - showing fallback input');
            this.showFallbackInput();
        }
    }
    
    showFallbackInput() {
        const input = document.getElementById('addressInput');
        input.style.display = 'block';
        input.placeholder = CONFIG.SEARCH_PLACEHOLDER;
        
        // Allow Enter key submission for fallback
        if (!input.hasAttribute('data-enter-listener')) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.addPoint();
                }
            });
            input.setAttribute('data-enter-listener', 'true');
        }
    }

    setupPlaceAutocompleteElement(input) {
        // Create the new web component
        const autocompleteElement = new google.maps.places.PlaceAutocompleteElement({
            requestedRegion: 'GB',
            componentRestrictions: { country: 'gb' },
            types: ['geocode']
        });
        
        // Replace the input with the new component
        input.style.display = 'none';
        autocompleteElement.id = 'place-autocomplete';
        // Accessible name via ARIA; placeholder is not supported by this component
        autocompleteElement.setAttribute('aria-label', CONFIG.SEARCH_PLACEHOLDER);
        
        // Apply CSS custom properties for theming
        const styles = getComputedStyle(document.documentElement);
        const bgColor = styles.getPropertyValue('--bg-primary').trim();
        const textColor = styles.getPropertyValue('--text-primary').trim();
        const borderColor = styles.getPropertyValue('--border-color').trim();
        
        autocompleteElement.style.width = '100%';
        autocompleteElement.style.maxWidth = '100%';
        autocompleteElement.style.minWidth = '0';
        autocompleteElement.style.padding = '8px';
        autocompleteElement.style.margin = '5px 0';
        autocompleteElement.style.border = `1px solid ${borderColor}`;
        autocompleteElement.style.borderRadius = '4px';
        autocompleteElement.style.boxSizing = 'border-box';
        autocompleteElement.style.backgroundColor = bgColor;
        autocompleteElement.style.color = textColor;
        
        // Force light color scheme
        autocompleteElement.style.colorScheme = 'light';
        
        // Hide the clear button using CSS - try multiple approaches for shadow DOM
        const style = document.createElement('style');
        style.textContent = `
            gmp-place-autocomplete::part(clear-button) {
                display: none !important;
            }
            gmp-place-autocomplete button.clear-button {
                display: none !important;
            }
            gmp-place-autocomplete button[aria-label="Clear input"] {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
        
        // Also try to hide it via JavaScript after the element is fully loaded
        setTimeout(() => {
            const clearButton = autocompleteElement.shadowRoot?.querySelector('button.clear-button') || 
                              autocompleteElement.shadowRoot?.querySelector('button[aria-label="Clear input"]');
            if (clearButton) {
                clearButton.style.display = 'none';
            } else {
                // If shadow DOM is closed, try observing for changes in the autocomplete element
                const observer = new MutationObserver(() => {
                    // Try to find and hide clear buttons that might appear
                    const allButtons = document.querySelectorAll('button[aria-label="Clear input"]');
                    allButtons.forEach(btn => btn.style.display = 'none');
                });
                observer.observe(document.body, { childList: true, subtree: true });
                
                // Stop observing after 5 seconds to avoid performance issues
                setTimeout(() => observer.disconnect(), 5000);
            }

            // Best-effort: ensure inner input shows placeholder when empty
            try {
                const innerInput = autocompleteElement.shadowRoot?.querySelector('input');
                if (innerInput && (!autocompleteElement.value || autocompleteElement.value.trim() === '')) {
                    innerInput.setAttribute('placeholder', CONFIG.SEARCH_PLACEHOLDER);
                }
            } catch (_) {}
        }, 1000);
        
        // Insert the component before the hidden input
        input.parentNode.insertBefore(autocompleteElement, input);
        
        // Listen for place selection from dropdown
        autocompleteElement.addEventListener('gmp-select', async (event) => {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({
                fields: ['displayName', 'formattedAddress', 'location']
            });
            
            if (place.location) {
                try {
                    // Use a small delay to ensure mobile browser has finished with dropdown
                    setTimeout(() => {
                        if (this.map && place.location) {
                            // Check if map container is still visible
                            const mapElement = document.getElementById('map');
                            if (mapElement && mapElement.offsetWidth > 0 && mapElement.offsetHeight > 0) {
                                // Trigger map resize in case mobile viewport changed
                                google.maps.event.trigger(this.map, 'resize');
                                this.map.panTo(place.location);
                                this.map.setZoom(17);
                            }
                            // Update the hidden input for form compatibility
                            input.value = place.formattedAddress || place.displayName || '';
                            // Create placeholder marker and start loading process
                            this.createPlaceholderMarker(place.location);
                            // Automatically submit the selected address
                            this.addPoint();
                        }
                    }, CONFIG.AUTOCOMPLETE.PAN_DELAY_MS);
                } catch (error) {
                    console.error('Error handling place selection:', error);
                }
            }
        });
        
        // Handle Enter key submission
        autocompleteElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Check if dropdown is visible - if so, let it handle the selection
                const dropdown = document.querySelector('.pac-container');
                if (dropdown && window.getComputedStyle(dropdown).display !== 'none') {
                    // Dropdown is visible, let it handle the enter key
                    return;
                }
                
                // No dropdown visible, treat as manual submission
                e.preventDefault();
                const currentValue = autocompleteElement.value;
                if (currentValue && currentValue.trim()) {
                    input.value = currentValue.trim();
                    this.addPoint();
                }
            }
        });
        
        // Store reference
        this.autocompleteElement = autocompleteElement;
    }
    
    

    
    setupEventListeners() {
        // Map events
        this.map.addListener('idle', () => this.debouncedRefreshData());
        
        // Hide search box when in Street View mode
        this.map.getStreetView().addListener('visible_changed', () => {
            const streetViewVisible = this.map.getStreetView().getVisible();
            const controls = document.querySelector('.controls');
            if (controls) {
                if (streetViewVisible) {
                    controls.classList.add('popup-open');
                } else {
                    controls.classList.remove('popup-open');
                }
            }
        });
        
        // Close open info window when clicking on the map background
        this.map.addListener('click', () => {
            if (this.suppressNextMapClickClose) {
                // Ignore the map click that follows a marker click
                this.suppressNextMapClickClose = false;
                return;
            }
            if (this.infoWindow) {
                this.infoWindow.close();
                // Show the controls when popup closes
                document.querySelector('.controls')?.classList.remove('popup-open');
            }
        });
        
        // Also close when clicking anywhere outside the InfoWindow (captures focus-first clicks)
        if (!this.boundDocumentPointerDown) {
            this.boundDocumentPointerDown = (ev) => {
                if (!this.infoWindow) return;
                const wrapper = document.getElementById('bh-iw');
                if (wrapper) {
                    const inPopup = (ev.target === wrapper) ||
                        (typeof ev.composedPath === 'function' && ev.composedPath().includes(wrapper)) ||
                        (ev.target.closest && ev.target.closest('#bh-iw'));
                    if (inPopup) return; // Click inside popup; don't close
                }
                
                
                this.infoWindow.close();
                // Show the controls when popup closes
                document.querySelector('.controls')?.classList.remove('popup-open');
            };
            document.addEventListener('pointerdown', this.boundDocumentPointerDown, true);
        }
    }
    
    async refreshData() {
        try {
            
            // Check if we need to trigger fade-out before loading new data
            const newZoom = this.map.getZoom();
            const newResolution = this.getH3Resolution(newZoom);
            
            this.lastZoom = newZoom;
            const bounds = this.map.getBounds();
            if (!bounds) {
                // Fallback: load data based on zoom level, not both
                if (newZoom >= CONFIG.HEATMAP_ZOOM_THRESHOLD) {
                    // High zoom: load points only
                    const pointResponse = await fetch(`${CONFIG.API_BASE_URL}/points?bbox=-180,-90,180,90`);
                    if (pointResponse.ok) {
                        this.pointData = await pointResponse.json();
                    }
                    this.heatData = []; // Clear heatmap data
                } else {
                    // Low zoom: load heat only  
                    const heatResponse = await fetch(`${CONFIG.API_BASE_URL}/heat?bbox=-180,-90,180,90&z=${newZoom}`);
                    if (heatResponse.ok) {
                        this.heatData = await heatResponse.json();
                    }
                    this.pointData = []; // Clear point data
                }
                this.updateVisualization();
                return;
            }
            
            const zoom = this.map.getZoom();
            
            // Add buffer to prevent hexagons from disappearing at screen edges
            // Buffer size depends on zoom level and hexagon resolution
            let buffer = CONFIG.MAP.BUFFER_DEFAULT; // Default buffer in degrees
            if (zoom >= 13) {
                buffer = CONFIG.MAP.BUFFER_Z13_PLUS; // Smaller buffer for smaller hexagons at high zoom
            } else if (zoom >= 10) {
                buffer = CONFIG.MAP.BUFFER_Z10_PLUS; // Medium buffer for medium zoom
            } else {
                buffer = CONFIG.MAP.BUFFER_LOW; // Larger buffer for large hexagons at low zoom
            }
            
            const bbox = [
                bounds.getSouthWest().lng() - buffer,
                bounds.getSouthWest().lat() - buffer,
                bounds.getNorthEast().lng() + buffer,
                bounds.getNorthEast().lat() + buffer
            ].join(',');
            
            if (zoom < CONFIG.HEATMAP_ZOOM_THRESHOLD) {
                // Load heatmap data - but only for the zoom ranges where we want to show hexagons
                const resolution = this.getH3Resolution(zoom);
                if (resolution !== null) {
                    const response = await fetch(`${CONFIG.API_BASE_URL}/heat?bbox=${bbox}&z=${zoom}`);
                    if (response.ok) {
                        this.heatData = await response.json();
                    } else {
                        console.error('Failed to load heatmap data:', response.status);
                    }
                } else {
                    // Clear heatmap data when we don't want to show hexagons
                    this.heatData = [];
                }
            } else {
                // Load point data
                const response = await fetch(`${CONFIG.API_BASE_URL}/points?bbox=${bbox}`);
                if (response.ok) {
                    this.pointData = await response.json();
                    // Preserve placeholder point (temporary white marker) during fetch refreshes
                    // so it stays visible until the POST /point completes.
                    if (this.placeholderPoint && this.map.getZoom() >= CONFIG.HEATMAP_ZOOM_THRESHOLD) {
                        const hasPlaceholder = this.pointData.some(p => p._isPlaceholder);
                        if (!hasPlaceholder) {
                            this.pointData = [...this.pointData, this.placeholderPoint];
                        }
                    }
                } else {
                    console.error('Failed to load point data:', response.status);
                }
            }
            
            // Only update visualization after data is loaded to prevent double updates
            this.updateVisualization();
            
        } catch (error) {
            console.error('Failed to refresh data:', error);
        }
    }
    
    debouncedRefreshData() {
        // Debounce rapid refresh calls to prevent flickering from overlapping updates
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        
        this.refreshTimeout = setTimeout(() => {
            this.refreshData();
            this.refreshTimeout = null;
        }, CONFIG.ANIMATION.DEBOUNCE_DELAY);
    }
    
    startFadeAnimation() {
        // Cancel any existing animation
        if (this.fadeAnimationId) {
            cancelAnimationFrame(this.fadeAnimationId);
        }
        
        const FADE_DURATION = CONFIG.ANIMATION.FADE_DURATION;
        
        const animate = () => {
            // Check if any hexagons are still fading in or out
            const now = Date.now();
            let stillAnimating = false;
            let animatingCount = 0;
            
            // Clean up completed fade-out hexagons and check for ongoing animations
            [7, 9].forEach(res => {
                this.hexDataByResolution[res] = this.hexDataByResolution[res].filter(hex => {
                    // Check fade-in animation
                    if (hex._spawnTime && (now - hex._spawnTime) < FADE_DURATION) {
                        stillAnimating = true;
                        animatingCount++;
                        return true; // Keep hexagon
                    }
                    
                    // Check fade-out animation
                    if (hex._fadeOutTime) {
                        if ((now - hex._fadeOutTime) < FADE_DURATION) {
                            stillAnimating = true;
                            animatingCount++;
                            return true; // Keep hexagon (still fading out)
                        } else {
                            return false; // Remove hexagon (fade-out complete)
                        }
                    }
                    
                    return true; // Keep hexagon (no animation)
                });
            });
            
            // Clean up completed fade-out points and check for ongoing animations
            this.pointData = this.pointData.filter(point => {
                let hasActiveAnimation = false;
                
                // Check fade-in animation
                if (point._spawnTime && (now - point._spawnTime) < FADE_DURATION) {
                    stillAnimating = true;
                    animatingCount++;
                    hasActiveAnimation = true;
                }
                
                // Check text fade-in animation
                if (point._textSpawnTime && (now - point._textSpawnTime) < FADE_DURATION) {
                    stillAnimating = true;
                    animatingCount++;
                    hasActiveAnimation = true;
                }
                
                // Check fade-out animation
                if (point._fadeOutTime) {
                    if ((now - point._fadeOutTime) < FADE_DURATION) {
                        stillAnimating = true;
                        animatingCount++;
                        hasActiveAnimation = true;
                    } else {
                        return false; // Remove point (fade-out complete)
                    }
                }
                
                // Check text fade-out animation
                if (point._textFadeOutTime) {
                    if ((now - point._textFadeOutTime) < FADE_DURATION) {
                        stillAnimating = true;
                        animatingCount++;
                        hasActiveAnimation = true;
                    } else {
                        // Clean up completed text fade-out timestamp but keep the point
                        delete point._textFadeOutTime;
                    }
                }
                
                return true; // Keep point (remove only on complete point fade-out)
            });
            
            if (stillAnimating) {
                // Force deck.gl to recalculate colors by updating a trigger
                this.animationTrigger = (this.animationTrigger || 0) + 1;
                this.updateVisualization();
                this.fadeAnimationId = requestAnimationFrame(animate);
            } else {
                this.fadeAnimationId = null;
            }
        };
        
        // Start animation
        this.fadeAnimationId = requestAnimationFrame(animate);
    }
    
    
    
    async updateVisualization() {
        const zoom = this.map.getZoom();
        const resolution = this.getH3Resolution(zoom);
        
        // Update UI components
        this.updateZoomInfo(zoom);
        
        // Calculate visibility states
        const visibility = this.calculateVisibility(zoom, resolution);
        
        // Handle hexagon data and animations
        const shouldAnimate = this.updateHexagonData(resolution, visibility);
        
        // Create layers
        const layers = [];
        this.addHexagonLayers(layers, visibility);
        await this.addPointLayers(layers, visibility);
        
        // Start animation if needed
        if (shouldAnimate && !this.fadeAnimationId) {
            this.startFadeAnimation();
        }
        
        this.overlay.setProps({ layers });
    }
    
    
    
    calculateVisibility(zoom, resolution) {
        const showHexagons = zoom < CONFIG.HEATMAP_ZOOM_THRESHOLD && this.showHeatmap && this.heatData.length > 0 && resolution !== null;
        const showPoints = zoom >= CONFIG.HEATMAP_ZOOM_THRESHOLD && this.showPoints && this.pointData.length > 0;
        const showText = showPoints && zoom >= CONFIG.UI.TEXT_ZOOM_THRESHOLD; // Text only shows at configured zoom
        
        return {
            showHexagons,
            showPoints,
            showText,
            showLargeHex: showHexagons && resolution === 7,   // Zoom 9-12: Large R7 hexagons
            showMediumHex: showHexagons && resolution === 9,  // Zoom 13-15: Medium R9 hexagons
            showSmallHex: false // No small hexagons defined in getH3Resolution
        };
    }
    
    updateHexagonData(resolution, visibility) {
        // Initialize data structure
        if (!this.hexDataByResolution) {
            this.hexDataByResolution = { 7: [], 9: [] };
        }
        
        let shouldAnimate = false;
        const now = Date.now();
        
        // Handle fade-out for hexagons that should no longer be visible
        shouldAnimate = this.handleHexagonFadeOut(visibility, now) || shouldAnimate;
        
        // Update current resolution data
        if (resolution && this.heatData.length > 0 && !this.fadeAnimationId) {
            shouldAnimate = this.updateCurrentResolutionData(resolution, now) || shouldAnimate;
        }
        
        // Handle point data animations too
        shouldAnimate = this.updatePointData(visibility, now) || shouldAnimate;
        
        return shouldAnimate;
    }
    
    handleHexagonFadeOut(visibility, now) {
        let shouldAnimate = false;
        
        [7, 9].forEach(res => {
            const shouldShow = (res === 7 && visibility.showLargeHex) || (res === 9 && visibility.showMediumHex);
            
            if (this.hexDataByResolution[res]?.length > 0) {
                this.hexDataByResolution[res] = this.hexDataByResolution[res].map(hex => {
                    if (!shouldShow && !hex._fadeOutTime) {
                        shouldAnimate = true;
                        return { ...hex, _fadeOutTime: now };
                    }
                    return hex;
                });
            }
        });
        
        return shouldAnimate;
    }
    
    updateCurrentResolutionData(resolution, now) {
        let shouldAnimate = false;
        
        // Keep existing hexagons for current resolution to avoid reanimating
        const existingHexagons = this.hexDataByResolution[resolution] || [];
        const existingHexagonIds = new Set(existingHexagons.map(h => h.h3));
        
        // Handle resolution changes
        if (resolution !== this.lastResolution) {
            shouldAnimate = this.fadeOutOtherResolutions(resolution, now) || shouldAnimate;
            this.lastResolution = resolution;
        }
        
        // Process current resolution data
        const dataWithTimestamps = this.heatData.map(hex => {
            if (existingHexagonIds.has(hex.h3)) {
                // Keep existing hexagon with its original spawn time
                const existing = existingHexagons.find(h => h.h3 === hex.h3);
                return { ...hex, _spawnTime: existing._spawnTime };
            } else {
                // New hexagon gets current timestamp for fade-in
                shouldAnimate = true;
                return { ...hex, _spawnTime: now };
            }
        });
        
        // Set data only for current resolution
        this.hexDataByResolution[resolution] = dataWithTimestamps;
        
        return shouldAnimate;
    }
    
    fadeOutOtherResolutions(currentResolution, now) {
        let shouldAnimate = false;
        
        [7, 9].forEach(res => {
            if (res !== currentResolution && this.hexDataByResolution[res]?.length > 0) {
                this.hexDataByResolution[res] = this.hexDataByResolution[res].map(hex => {
                    if (!hex._fadeOutTime) {
                        shouldAnimate = true;
                        return { ...hex, _fadeOutTime: now };
                    }
                    return hex;
                });
            }
        });
        
        return shouldAnimate;
    }
    
    updatePointData(visibility, now) {
        let shouldAnimate = false;
        
        // Handle point fade-out when switching to hexagons
        if (this.pointData.length > 0 && !visibility.showPoints) {
            this.pointData = this.pointData.map(point => {
                if (!point._fadeOutTime) {
                    shouldAnimate = true;
                    return { ...point, _fadeOutTime: now };
                }
                return point;
            });
            // Clear existing point tracking when hiding points
            this.existingPointData = [];
        }
        
        // Handle text visibility transitions (zoom level 18)
        if (this.pointData.length > 0 && visibility.showPoints) {
            const wasShowingText = this.lastVisibility && this.lastVisibility.showText;
            const isTextTransition = wasShowingText !== visibility.showText;
            
            if (isTextTransition) {
                this.pointData = this.pointData.map(point => {
                    if (visibility.showText && !wasShowingText) {
                        // Transitioning to show text - add spawn time for text fade-in
                        shouldAnimate = true;
                        return { ...point, _textSpawnTime: now };
                    } else if (!visibility.showText && wasShowingText) {
                        // Transitioning to hide text - add fade-out time for text
                        shouldAnimate = true;
                        return { ...point, _textFadeOutTime: now };
                    }
                    return point;
                });
            }
        }
        
        // Handle point fade-in when switching to points
        if (this.pointData.length > 0 && visibility.showPoints) {
            // Check if we're transitioning from hexagons to points
            const wasShowingHexagons = this.lastVisibility && (this.lastVisibility.showLargeHex || this.lastVisibility.showMediumHex);
            const isTransitionFromHexagons = wasShowingHexagons && !visibility.showLargeHex && !visibility.showMediumHex;
            
            // If transitioning from hexagons to points, reset tracking to force fade-in
            if (isTransitionFromHexagons) {
                this.existingPointData = [];
            }
            
            // Keep track of existing points to avoid re-animating them on pan
            if (!this.existingPointData) {
                this.existingPointData = [];
            }
            
            const existingPointIds = new Set(this.existingPointData.map(p => p.id || p.place_id || `${p.lat}-${p.lng}`));
            
            this.pointData = this.pointData.map(point => {
                const pointId = point.id || point.place_id || `${point.lat}-${point.lng}`;
                const existingPoint = this.existingPointData.find(p => (p.id || p.place_id || `${p.lat}-${p.lng}`) === pointId);
                
                if (existingPoint && existingPoint._spawnTime) {
                    // Keep existing spawn time to avoid re-animation
                    return { ...point, _spawnTime: existingPoint._spawnTime };
                } else if (!existingPointIds.has(pointId)) {
                    // Truly new point - add spawn time
                    shouldAnimate = true;
                    return { ...point, _spawnTime: now };
                }
                
                return point;
            });
            
            // Update our tracking of existing points
            this.existingPointData = [...this.pointData];
        }
        
        // Store current visibility for next update
        this.lastVisibility = visibility;
        
        return shouldAnimate;
    }
    
    addHexagonLayers(layers, visibility) {
        if (!Object.values(this.hexDataByResolution).some(data => data.length > 0)) {
            return;
        }
        
        const H3HexagonLayer = this.getH3HexagonLayer();
        const resolutions = [
            { res: 7, show: visibility.showLargeHex, lineWidth: CONFIG.ANIMATION.LINE_WIDTH.LARGE, lineOpacity: CONFIG.ANIMATION.LINE_OPACITY.LARGE, name: 'large' },
            { res: 9, show: visibility.showMediumHex, lineWidth: CONFIG.ANIMATION.LINE_WIDTH.MEDIUM, lineOpacity: CONFIG.ANIMATION.LINE_OPACITY.MEDIUM, name: 'medium' }
        ];
        
        resolutions.forEach(({ res, show, lineWidth, lineOpacity, name }) => {
            if (this.hexDataByResolution[res]?.length > 0) {
                layers.push(this.createHexagonLayer(H3HexagonLayer, res, show, lineWidth, lineOpacity, name));
            }
        });
    }
    
    async addPointLayers(layers, visibility) {
        if (this.pointData.length === 0) {
            return;
        }
        
        const { IconLayer, TextLayer } = this.getDeckGLLayers();
        
        // Load external SVG icon once and recolor per score
        await this.ensureExternalPin();
        
        layers.push(this.createPointIconLayer(IconLayer, visibility.showPoints));
        
        // Always create text icon layer when points are visible, visibility controlled by animation
        if (visibility.showPoints) {
            layers.push(this.createPointTextIconLayer(IconLayer, visibility.showText));
        }
    }
    
    getH3HexagonLayer() {
        if (window.deck && window.deck.H3HexagonLayer) {
            return window.deck.H3HexagonLayer;
        } else if (window.DeckGL) {
            return window.DeckGL.H3HexagonLayer;
        } else {
            throw new Error('H3HexagonLayer not found in global scope');
        }
    }
    
    getDeckGLLayers() {
        if (window.deck && window.deck.IconLayer) {
            return { IconLayer: window.deck.IconLayer, TextLayer: window.deck.TextLayer };
        } else if (window.DeckGL) {
            return { IconLayer: window.DeckGL.IconLayer, TextLayer: window.DeckGL.TextLayer };
        } else {
            throw new Error('Required deck.gl layers not found in global scope');
        }
    }
    
    createHexagonLayer(H3HexagonLayer, res, show, lineWidth, lineOpacity, name) {
        return new H3HexagonLayer({
            id: `h3-hexagons-${name}`,
            data: this.hexDataByResolution[res],
            getHexagon: d => d.h3,
            getFillColor: d => this.calculateHexagonFillColor(d, show),
            getLineColor: d => this.calculateHexagonLineColor(d, show, lineOpacity),
            visible: true,
            lineWidthMinPixels: lineWidth,
            extruded: false,
            stroked: false,
            filled: true,
            pickable: false,
            onHover: this.onHexagonHover.bind(this),
            onClick: this.onHexagonClick.bind(this),
            updateTriggers: {
                getFillColor: [this.hexDataByResolution[res]?.length, show, this.animationTrigger],
                getLineColor: [this.hexDataByResolution[res]?.length, show, this.animationTrigger]
            }
        });
    }
    
    calculateHexagonFillColor(d, show) {
        const c = this.getBeautyHexColor(d.avg);
        const now = Date.now();
        const baseAlpha = c[3] || CONFIG.ANIMATION.HEX_BASE_ALPHA;
        const TRANSITION_DURATION = CONFIG.ANIMATION.FADE_DURATION;
        
        // Handle fade-out first (takes priority)
        if (d._fadeOutTime) {
            const fadeOutAge = now - d._fadeOutTime;
            const fadeOutProgress = Math.min(fadeOutAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(baseAlpha * (1.0 - fadeOutProgress));
            return [c[0], c[1], c[2], a];
        }
        
        // If layer shouldn't be shown and no fade-out, make invisible
        if (!show) return [c[0], c[1], c[2], CONFIG.ANIMATION.MIN_ALPHA];
        
        // Handle fade-in
        if (d._spawnTime) {
            const fadeInAge = now - d._spawnTime;
            const fadeInProgress = Math.min(fadeInAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(fadeInProgress * baseAlpha);
            return [c[0], c[1], c[2], a];
        }
        
        // No animation, just show at full opacity
        return [c[0], c[1], c[2], baseAlpha];
    }
    
    calculateHexagonLineColor(d, show, lineOpacity) {
        const now = Date.now();
        const TRANSITION_DURATION = CONFIG.ANIMATION.FADE_DURATION;
        
        // Handle line fade-out too
        if (d._fadeOutTime) {
            const fadeOutAge = now - d._fadeOutTime;
            const fadeOutProgress = Math.min(fadeOutAge / TRANSITION_DURATION, 1.0);
            const alpha = Math.round(lineOpacity * (1.0 - fadeOutProgress));
            return [255, 255, 255, alpha];
        }
        
        return [255, 255, 255, Math.round(lineOpacity * (show ? 1.0 : 0.0))];
    }
    
    calculatePointColor(d, showPoints) {
        const now = Date.now();
        const baseAlpha = CONFIG.ANIMATION.POINT_BASE_ALPHA;
        const TRANSITION_DURATION = CONFIG.ANIMATION.FADE_DURATION;
        
        // Handle fade-out first (takes priority)
        if (d._fadeOutTime) {
            const fadeOutAge = now - d._fadeOutTime;
            const fadeOutProgress = Math.min(fadeOutAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(baseAlpha * (1.0 - fadeOutProgress));
            return [255, 255, 255, a];
        }
        
        // If layer shouldn't be shown and no fade-out, make invisible
        if (!showPoints) {
            return [255, 255, 255, CONFIG.ANIMATION.MIN_ALPHA];
        }
        
        // Handle fade-in
        if (d._spawnTime) {
            const fadeInAge = now - d._spawnTime;
            const fadeInProgress = Math.min(fadeInAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(fadeInProgress * baseAlpha);
            return [255, 255, 255, a];
        }
        
        // No animation, just show at full opacity
        return [255, 255, 255, baseAlpha];
    }
    
    calculateTextColor(d, showText) {
        const now = Date.now();
        const baseAlpha = CONFIG.ANIMATION.POINT_BASE_ALPHA;
        const TRANSITION_DURATION = CONFIG.ANIMATION.FADE_DURATION;
        
        // Handle placeholder points
        if (d._isPlaceholder) {
            return [255, 255, 255, 0]; // Hide placeholder text
        }
        
        // Handle text-specific fade-out first (takes priority)
        if (d._textFadeOutTime) {
            const fadeOutAge = now - d._textFadeOutTime;
            const fadeOutProgress = Math.min(fadeOutAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(baseAlpha * (1.0 - fadeOutProgress));
            return [255, 255, 255, a];
        }
        
        // Handle point fade-out (when switching to hexagons)
        if (d._fadeOutTime) {
            const fadeOutAge = now - d._fadeOutTime;
            const fadeOutProgress = Math.min(fadeOutAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(baseAlpha * (1.0 - fadeOutProgress));
            return [255, 255, 255, a];
        }
        
        // If text shouldn't be shown, make invisible
        if (!showText) {
            return [255, 255, 255, 0];
        }
        
        // Handle text-specific fade-in
        if (d._textSpawnTime) {
            const fadeInAge = now - d._textSpawnTime;
            const fadeInProgress = Math.min(fadeInAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(fadeInProgress * baseAlpha);
            return [255, 255, 255, a];
        }
        
        // Handle point fade-in (when switching from hexagons)
        if (d._spawnTime) {
            const fadeInAge = now - d._spawnTime;
            const fadeInProgress = Math.min(fadeInAge / TRANSITION_DURATION, 1.0);
            const a = Math.round(fadeInProgress * baseAlpha);
            return [255, 255, 255, a];
        }
        
        // No animation, show at full opacity
        return [255, 255, 255, baseAlpha];
    }
    
    createPointIconLayer(IconLayer, showPoints) {
        const getPosition = d => [parseFloat(d.lng), parseFloat(d.lat)];
        
        // Sort data from south to north (lower latitude to higher latitude)
        // This ensures northern markers render on top of southern ones
        const sortedData = [...this.pointData].sort((a, b) => {
            const latA = parseFloat(a.lat) || 0;
            const latB = parseFloat(b.lat) || 0;
            return latB - latA; // North first, south on top
        });
        
        return new IconLayer({
            id: 'beauty-pins',
            data: sortedData,
            getPosition,
            getId: d => d.id || d.place_id || `${d.lat}-${d.lng}`,
            getIcon: d => ({
                url: this.getExternalPinForScore(d.beauty),
                // Match the intrinsic SVG dimensions to ensure correct anchoring
                width: CONFIG.ICONS.INTRINSIC_WIDTH,
                height: CONFIG.ICONS.INTRINSIC_HEIGHT,
                anchorX: CONFIG.ICONS.ANCHOR_X,
                anchorY: CONFIG.ICONS.ANCHOR_Y
            }),
            sizeUnits: 'pixels',
            getSize: CONFIG.ICONS.SIZE_PX,
            sizeMinPixels: CONFIG.ICONS.SIZE_MIN,
            sizeMaxPixels: CONFIG.ICONS.SIZE_MAX,
            pickable: true,
            pickingRadius: CONFIG.ICONS.PICKING_RADIUS,
            parameters: { depthTest: false },
            onHover: this.onPointHover.bind(this),
            onClick: this.onPointClick.bind(this),
            getColor: d => this.calculatePointColor(d, showPoints),
            updateTriggers: { getColor: [this.pointData.length, showPoints, this.animationTrigger] }
        });
    }
    
    createPointTextIconLayer(IconLayer, showText) {
        const getPosition = d => [parseFloat(d.lng), parseFloat(d.lat)];
        
        return new IconLayer({
            id: 'beauty-pin-text-icons',
            data: this.pointData.filter(d => {
                const num = parseFloat(d.beauty);
                return Number.isFinite(num) && !d._isPlaceholder;
            }),
            getPosition,
            getId: d => `text-${d.id || d.place_id || `${d.lat}-${d.lng}`}`,
            getIcon: d => {
                const num = parseFloat(d.beauty);
                if (!Number.isFinite(num) || d._isPlaceholder) {
                    return null; // No icon for invalid numbers or placeholders
                }
                
                const iconUrl = this.getTextIcon(Math.round(num));
                if (!iconUrl) {
                    return null; // Safety check - don't return invalid icons
                }
                
                return {
                    url: iconUrl,
                    width: CONFIG.TEXT_ICON.ICON_WIDTH,
                    height: CONFIG.TEXT_ICON.ICON_HEIGHT,
                    anchorX: CONFIG.TEXT_ICON.ANCHOR_X,
                    anchorY: CONFIG.TEXT_ICON.ANCHOR_Y
                };
            },
            sizeUnits: 'pixels',
            getSize: CONFIG.TEXT_ICON.SIZE_PX,
            sizeMinPixels: CONFIG.TEXT_ICON.SIZE_MIN,
            sizeMaxPixels: CONFIG.TEXT_ICON.SIZE_MAX,
            getPixelOffset: [0, CONFIG.TEXT_ICON.PIXEL_OFFSET_Y],
            pickable: false,
            parameters: { 
                depthTest: false,
                depthMask: false
            },
            getColor: d => this.calculateTextColor(d, showText),
            updateTriggers: { 
                getColor: [this.pointData.length, showText, this.animationTrigger]
            }
        });
    }
    
    updateZoomInfo(zoom) {
        const zoomInfoElement = document.getElementById('zoomInfo');
        if (!zoomInfoElement) return;
        
        let mode = 'Unknown';
        let modeColor = '#666';
        
        if (zoom < CONFIG.HEATMAP_ZOOM_THRESHOLD) {
            const resolution = this.getH3Resolution(zoom);
            if (resolution === null) {
                mode = 'No Hexagons (Zoom < 9)';
                modeColor = '#666';
            } else if (this.showHeatmap && this.heatData.length > 0) {
                // Determine actual resolution from the data
                const firstHex = this.heatData[0];
                let actualResolution = 'Unknown';
                if (firstHex && firstHex.h3) {
                    // Backend now returns correct resolution based on zoom ranges
                    if (zoom >= 9 && zoom <= 12) actualResolution = 'R7 (Large)';
                    else if (zoom >= 13 && zoom <= 15) actualResolution = 'R9 (Medium)';
                    else actualResolution = 'Unknown';
                }
                mode = `H3 Hexagons ${actualResolution}`;
                modeColor = '#ff6b35'; // Orange for hexagons
            } else {
                mode = 'Hexagons (No Data)';
                modeColor = '#999';
            }
        } else {
            if (this.showPoints && this.pointData.length > 0) {
                mode = 'Individual Points';
                modeColor = '#4CAF50'; // Green for points
            } else {
                mode = 'Points (No Data)';
                modeColor = '#999';
            }
        }
        
        zoomInfoElement.innerHTML = `
            <div>Zoom: ${(zoom || 0).toFixed(1)} | Threshold: &lt;${CONFIG.HEATMAP_ZOOM_THRESHOLD}</div>
            <div style="color: ${modeColor}">Mode: ${mode}</div>
            <div style="font-size: 11px; opacity: 0.8;">Heat: ${this.heatData.length} | Points: ${this.pointData.length}</div>
        `;
    }
    
    // Centralized color interpolation function
    interpolateColorScale(score) {
        const clampedScore = Math.max(1, Math.min(10, score || 5));
        const stops = CONFIG.COLOR_SCALE.STOPS;
        
        // Get sorted stop points
        const stopPoints = Object.keys(stops).map(Number).sort((a, b) => a - b);
        
        // Find which two stops we're between
        let lowerStop = stopPoints[0];
        let upperStop = stopPoints[stopPoints.length - 1];
        
        for (let i = 0; i < stopPoints.length - 1; i++) {
            if (clampedScore >= stopPoints[i] && clampedScore <= stopPoints[i + 1]) {
                lowerStop = stopPoints[i];
                upperStop = stopPoints[i + 1];
                break;
            }
        }
        
        // If exactly at a stop point, return that color
        if (clampedScore === lowerStop) return [...stops[lowerStop]];
        if (clampedScore === upperStop) return [...stops[upperStop]];
        
        // Interpolate between the two stops
        const range = upperStop - lowerStop;
        const position = (clampedScore - lowerStop) / range;
        
        const lower = stops[lowerStop];
        const upper = stops[upperStop];
        
        const [r1, g1, b1, a1 = 255] = lower;
        const [r2, g2, b2, a2 = 255] = upper;
        
        const r = Math.round(r1 + (r2 - r1) * position);
        const g = Math.round(g1 + (g2 - g1) * position);
        const b = Math.round(b1 + (b2 - b1) * position);
        const a = Math.round(a1 + (a2 - a1) * position);
        
        return [r, g, b, a];
    }
    
    getBeautyIconColor(beauty) {
        const [r, g, b, a] = this.interpolateColorScale(beauty);
        // For markers, we want to keep them visible, so use the color but keep them opaque
        return [r, g, b];
    }
    
    getBeautyHexColor(avgBeauty) {
        // Handle empty hexagons (make them transparent)
        if (!avgBeauty || avgBeauty === 0) {
            return [128, 128, 128, CONFIG.ANIMATION.HEX_EMPTY_ALPHA]; // Very transparent gray
        }
        
        // Use centralized color interpolation with alpha
        const [r, g, b, a] = this.interpolateColorScale(avgBeauty);
        // Use the interpolated alpha instead of the fixed base alpha
        return [r, g, b, a];
    }
    
    getH3Resolution(zoom) {
        if (zoom < CONFIG.H3.R7_MIN_ZOOM) return null;               // Below min zoom: no hexagons
        if (zoom >= CONFIG.H3.R7_MIN_ZOOM && zoom <= CONFIG.H3.R7_MAX_ZOOM) return 7;  // Large R7 hexagons
        if (zoom >= CONFIG.H3.R9_MIN_ZOOM && zoom <= CONFIG.H3.R9_MAX_ZOOM) return 9; // Medium R9 hexagons
        return null; // Zoom 16+ will show individual points
    }

    // Create or reuse a colorized SVG pin for a rounded score bucket
    getMarkerIcon(beauty) {
        const rounded = Math.max(1, Math.min(10, Math.round(beauty || 5)));
        if (this.iconCache.has(rounded)) return this.iconCache.get(rounded);

        const [r, g, b] = this.getBeautyIconColor(rounded);
        const fill = `rgb(${r},${g},${b})`;

        // High-contrast pin with white inner highlight and dark stroke
        const svg = `data:image/svg+xml;utf8,
<svg xmlns='http://www.w3.org/2000/svg' width='48' height='64' viewBox='0 0 48 64'>
  <defs>
    <filter id='shadow' x='-20%' y='-20%' width='140%' height='140%'>
      <feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='rgba(0,0,0,0.35)'/>
    </filter>
  </defs>
  <g filter='url(#shadow)'>
    <path d='M24 2c-9.94 0-18 8.06-18 18 0 12.5 18 36 18 36s18-23.5 18-36C42 10.06 33.94 2 24 2z' fill='${fill}' stroke='rgba(0,0,0,0.8)' stroke-width='4'/>
    <circle cx='24' cy='22' r='9' fill='white' fill-opacity='0.95'/>
  </g>
</svg>`;

        this.iconCache.set(rounded, svg);
        return svg;
    }

    async ensureExternalPin() {
        if (this.externalPinSvg) return;
        // Fetch the SVG from project root via relative path from frontend
        const resp = await fetch('./assets/location.svg');
        if (!resp.ok) throw new Error('Failed to load external pin SVG');
        this.externalPinSvg = await resp.text();
    }

    getExternalPinForScore(beauty) {
        // Handle placeholders or non-numeric values: use a white pin
        const numeric = Number(beauty);
        if (!Number.isFinite(numeric)) {
            return this.getExternalPinWithColor('white', 'ext_placeholder');
        }
        const rounded = Math.max(1, Math.min(10, Math.round(numeric || 5)));
        const cacheKey = `ext_${rounded}`;
        if (this.iconCache.has(cacheKey)) return this.iconCache.get(cacheKey);
        
        // Fallback if SVG not loaded yet
        if (!this.externalPinSvg) {
            return this.getMarkerIcon(beauty);
        }
        
        const [r, g, b] = this.getBeautyIconColor(rounded);
        const color = `rgb(${r},${g},${b})`;
        return this.getExternalPinWithColor(color, cacheKey);
    }
    
    getExternalPinWithColor(color, cacheKey = null) {
        if (cacheKey && this.iconCache.has(cacheKey)) {
            return this.iconCache.get(cacheKey);
        }
        
        // Fallback if SVG not loaded yet
        if (!this.externalPinSvg) {
            return this.getMarkerIcon(5); // neutral fallback
        }
        
        // Create SVG with proper stroke and expanded viewBox to prevent clipping
        const withBorder = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="-2 -2 24 24">
            <path fill="${color}" stroke="black" stroke-width="0.25" stroke-linejoin="round" stroke-linecap="round" 
                  d="M10 20S3 10.87 3 7a7 7 0 1 1 14 0c0 3.87-7 13-7 13zm0-11a2 2 0 1 0 0-4a2 2 0 0 0 0 4z"/>
        </svg>`;
        
        const url = `data:image/svg+xml;utf8,${encodeURIComponent(withBorder)}`;
        
        // Debug: log the final SVG for the first few icons to see what we're generating
        if (CONFIG.DEBUG && Math.random() < 0.1) {
            console.log('Generated icon SVG:', withBorder);
        }
        
        if (cacheKey) {
            this.iconCache.set(cacheKey, url);
        }
        
        return url;
    }
    
    getTextIcon(number) {
        // Validate input
        if (!Number.isFinite(number)) {
            return null;
        }
        
        const rounded = Math.round(number);
        if (this.textIconCache.has(rounded)) {
            return this.textIconCache.get(rounded);
        }
        
        // Only create icons for reasonable numbers (0-99)
        if (rounded < 0 || rounded > 99) {
            return null;
        }
        
        try {
            // Create SVG text with border - viewBox sized to prevent clipping
            const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32">
                <text x="16" y="18" font-family="Arial Black, Arial, sans-serif" font-size="20" font-weight="900" 
                      text-anchor="middle" dominant-baseline="central" 
                      fill="white" stroke="black" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round">
                    ${rounded}
                </text>
            </svg>`;
            
            const url = `data:image/svg+xml;utf8,${encodeURIComponent(textSvg)}`;
            this.textIconCache.set(rounded, url);
            return url;
        } catch (error) {
            console.warn('Failed to create text icon for number:', rounded, error);
            return null;
        }
    }
    
    onHexagonHover(info) {
        // You could show hexagon info on hover if needed
    }
    
    onHexagonClick(info) {
        // Hex popup removed - no action on hex click
    }
    
    onPointHover(info, event) {
        
        // Let deck.gl handle the cursor via getCursor function
        // This method can be used for other hover effects if needed
    }
    
    onPointClick(info) {
        if (info.object) {
            const point = info.object;
            const beautyScore = parseFloat(point.beauty);
            const scoreColor = beautyScore >= 7 ? '#4CAF50' : beautyScore >= 5 ? '#FF9800' : '#F44336';
            // Prevent immediate close from the subsequent map click event
            this.suppressNextMapClickClose = true;
            
            const content = `
                <div id="bh-iw" tabindex="-1" style="max-width: 380px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0 8px 0;">
                        <div style="display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 9999px; background: ${scoreColor}; color: #fff; font-weight: 800; font-size: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); letter-spacing: 0.2px;">
                            ${beautyScore}/10
                        </div>
                        <button id="bh-close" type="button" aria-label="Close" 
                            style="flex:0 0 auto; width:28px; height:28px; border:none; border-radius:14px; background: rgba(0,0,0,0.05); color:#333; font-size:18px; line-height:28px; text-align:center; cursor:pointer;">
                            ×
                        </button>
                    </div>
                    <div style="margin: 2px 0 10px 4px; color: #1f1f1f; font-size: 14px; line-height: 1.35;">${point.address}</div>
                    ${point.image_url ? `
                        <a href="${point.image_url}" target="_blank" rel="noopener noreferrer" style="display: block; margin-top: 4px; text-decoration: none;">
                            <div style="width: 85%; margin: 0 auto; aspect-ratio: 1 / 1; border-radius: 10px; background: linear-gradient(90deg, #eee 25%, #f5f5f5 37%, #eee 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; position: relative; overflow: hidden;">
                                <img src="${point.image_url}" alt="Location image" loading="lazy"
                                     onload="this.style.opacity=1; this.parentElement.style.animation='none'; this.parentElement.style.background='transparent';"
                                     style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 10px; opacity: 0; transition: opacity 200ms ease;">
                            </div>
                        </a>` : ''}
                    <div style="background: #fafafa; border: 1px solid #eee; padding: 12px; border-radius: 10px; margin: 10px 0 6px 0;">
                        <div style="font-style: italic; color: #333; font-size: 14px; line-height: 1.45; margin-bottom: 8px;">"${point.description || 'No review available'}"</div>
                        <div style="text-align: right; font-size: 12px; color: #666;">— ${(point.model_version || 'unknown-model').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                    </div>
                    <div style="margin-top: 10px; margin-left: 4px; display: flex; justify-content: space-between; font-size: 12px; color: #666;">
                        <span>${point.created_at ? new Date(point.created_at).toLocaleDateString() : 'Unknown date'}</span>
                        <span></span>
                    </div>
                    <style>
                        @keyframes shimmer {
                            0% { background-position: 100% 0; }
                            100% { background-position: -100% 0; }
                        }
                        /* Hide default Google InfoWindow close so our button is the only X */
                        .gm-ui-hover-effect { display: none !important; }
                        #bh-iw #bh-close:hover { background: rgba(0,0,0,0.12); }
                        #bh-iw:focus { outline: none; }
                    </style>
                </div>
            `;
            
            // Close any open info windows and open a single one per map
            if (!this.infoWindow) {
                this.infoWindow = new google.maps.InfoWindow();
            }
            this.infoWindow.setContent(content);
            this.infoWindow.setPosition({ lat: parseFloat(point.lat), lng: parseFloat(point.lng) });
            
            this.infoWindow.open(this.map);
            
            // Hide the controls when popup is open
            document.querySelector('.controls')?.classList.add('popup-open');
            // Wire up custom close button after content is in the DOM
            google.maps.event.addListenerOnce(this.infoWindow, 'domready', () => {
                const btn = document.getElementById('bh-close');
                if (btn) {
                    btn.addEventListener('click', () => {
                        this.infoWindow.close();
                        // Show the controls when popup closes
                        document.querySelector('.controls')?.classList.remove('popup-open');
                    });
                }
                // Move focus away from close button to the popup container
                const iw = document.getElementById('bh-iw');
                if (iw) {
                    // In case the X was auto-focused, blur it, then focus the container
                    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
                        document.activeElement.blur();
                    }
                    iw.focus({ preventScroll: true });
                }
            });
        }
    }
    
    createPlaceholderMarker(location) {
        // Remove any existing placeholder
        this.removePlaceholderMarker();
        
        // Add a placeholder point to the data, using the same system as regular points
        this.placeholderPoint = {
            id: 'placeholder',
            lat: location.lat(),
            lng: location.lng(),
            beauty: 'placeholder', // Special value to indicate this is a placeholder
            description: 'Loading...',
            address: 'Loading...',
            _isPlaceholder: true
        };
        
        this.pointData.push(this.placeholderPoint);
        this.updateVisualization();
        
        // Also add the spinner overlay
        this.createSpinnerOverlay(location);
    }
    
    createSpinnerOverlay(location) {
        // Remove existing spinner overlay
        if (this.spinnerOverlay) {
            this.spinnerOverlay.setMap(null);
        }
        
        // Create a custom overlay for the spinner
        class SpinnerOverlay extends google.maps.OverlayView {
            constructor(position, offsetY = 30, offsetX = 0) {
                super();
                this.position = position;
                this.div = null;
                // Vertical offset in pixels so spinner sits inside the pin body (pin ~64px tall)
                this.offsetY = offsetY;
                // Small horizontal nudge to match Deck.GL canvas alignment on high-DPI
                this.offsetX = offsetX;
            }
            
            onAdd() {
                const div = document.createElement('div');
                div.style.position = 'absolute';
                div.style.width = `${CONFIG.SPINNER.CONTAINER_SIZE}px`;
                div.style.height = `${CONFIG.SPINNER.CONTAINER_SIZE}px`;
                // Center horizontally; vertical position handled via pixel offset in draw()
                div.style.transform = 'translate(-50%, 0%)';
                // Center the inner spinner perfectly within this 24x24 box
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.justifyContent = 'center';
                div.style.pointerEvents = 'none';
                div.innerHTML = `
                    <div style="
                        width: ${CONFIG.SPINNER.INNER_SIZE}px; 
                        height: ${CONFIG.SPINNER.INNER_SIZE}px; 
                        border: ${CONFIG.SPINNER.BORDER_WIDTH}px solid #f3f3f3;
                        border-top: ${CONFIG.SPINNER.BORDER_WIDTH}px solid #4285f4;
                        border-radius: 50%;
                        animation: spin ${CONFIG.SPINNER.SPEED_S}s linear infinite;
                        margin: ${CONFIG.SPINNER.TOP_MARGIN}px auto 0 auto;
                    "></div>
                `;
                
                this.div = div;
                const panes = this.getPanes();
                panes.overlayImage.appendChild(div);
            }
            
            draw() {
                const overlayProjection = this.getProjection();
                const position = overlayProjection.fromLatLngToDivPixel(this.position);
                
                if (this.div) {
                    // Use subpixel-accurate X and apply tiny offset to match Deck.GL canvas
                    this.div.style.left = (position.x + this.offsetX) + 'px';
                    // Lift the spinner upward to sit inside the marker head (pin tip is at the point)
                    this.div.style.top = Math.round(position.y - this.offsetY) + 'px';
                }
            }
            
            onRemove() {
                if (this.div) {
                    this.div.parentNode.removeChild(this.div);
                    this.div = null;
                }
            }
        }
        
        // Offsets tuned for a ~64px pin; adjust if pin size changes
        // Use zero X offset now that inner spinner is centered precisely
        this.spinnerOverlay = new SpinnerOverlay(location, CONFIG.SPINNER.OFFSET_Y, CONFIG.SPINNER.OFFSET_X);
        this.spinnerOverlay.setMap(this.map);
    }
    
    removePlaceholderMarker() {
        // Remove spinner overlay
        if (this.spinnerOverlay) {
            this.spinnerOverlay.setMap(null);
            this.spinnerOverlay = null;
        }

        // Remove placeholder point from point data if present
        if (this.placeholderPoint) {
            const hadPlaceholder = this.pointData?.some(p => p._isPlaceholder);
            this.pointData = (this.pointData || []).filter(p => !p._isPlaceholder);
            this.placeholderPoint = null;
            if (hadPlaceholder) {
                // Refresh visualization so the temporary pin disappears immediately on success/error
                this.updateVisualization();
            }
        }
    }

    async addPoint() {
        const addressInput = document.getElementById('addressInput');
        
        // Get address from autocomplete element or fallback to input
        let address;
        if (this.autocompleteElement) {
            address = this.autocompleteElement.value?.trim() || addressInput.value.trim();
        } else {
            address = addressInput.value.trim();
        }
        
        
        if (!address) {
            alert('Please enter an address');
            return;
        }
        
        try {
            // No longer show loading spinner in search box since we have placeholder marker
            
            const payload = { address: address };
            
            // Use real AI evaluation on the server (no precomputed values)
            
            
            // Optimistically fly to the typed address and create placeholder marker while the server processes
            try {
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ address, componentRestrictions: { country: 'GB' } }, (results, status) => {
                    if (status === 'OK' && results && results[0]) {
                        setTimeout(() => {
                            if (this.map && results[0]) {
                                const loc = results[0].geometry.location;
                                this.map.panTo(loc);
                                this.map.setZoom(17);
                                this.createPlaceholderMarker(loc);
                            }
                        }, CONFIG.AUTOCOMPLETE.GEOCODER_PAN_DELAY_MS);
                    }
                });
            } catch (_) {}

            // Add a client-side timeout so the UI doesn't hang forever
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.API.TIMEOUT_MS);

            const response = await fetch(`${CONFIG.API_BASE_URL}/point`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const result = await response.json();
                
                // Clear input
                addressInput.value = '';
                if (this.autocompleteElement) {
                    this.autocompleteElement.value = '';
                }
                
                // Refresh data to show the new point with proper styling first
                await this.refreshData();
                
                // Remove placeholder marker after data has been refreshed and rendered
                this.removePlaceholderMarker();

                if (result.point) {
                    const newPoint = result.point;
                    // Open single info window for the new point
                    this.onPointClick({ object: newPoint });
                }
                
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add point');
            }
            
        } catch (error) {
            console.error('Failed to add point:', error);
            alert(`Failed to add point: ${error.message}`);
            // Remove placeholder marker on error
            this.removePlaceholderMarker();
        }
    }
    
}

// Initialize the application when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new BeautyHeatmap();
});
