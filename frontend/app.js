// Configuration
const CONFIG = {
    // Local development configuration - no API keys needed in frontend
    API_BASE_URL: 'http://localhost:8787', // Local Cloudflare Worker
    
    // Map settings
    INITIAL_CENTER: { lat: 51.5074, lng: -0.1278 }, // London
    INITIAL_ZOOM: 12,
    
    // Visualization settings
    HEATMAP_ZOOM_THRESHOLD: 16, // Show heatmap up to and including zoom 15
    MAX_POINTS_TO_SHOW: 5000,
    
    // Colors for beauty scores
    BEAUTY_COLORS: {
        1: [255, 0, 0, 180],     // Red - Bad
        2: [255, 0, 0, 180],
        3: [255, 128, 0, 180],   // Orange - Lackluster  
        4: [255, 128, 0, 180],
        5: [255, 255, 0, 180],   // Yellow - Okay
        6: [255, 255, 0, 180],
        7: [128, 255, 0, 180],   // Light Green - Good
        8: [128, 255, 0, 180],
        9: [0, 255, 0, 180],     // Green - Excellent
        10: [0, 255, 0, 180]
    }
};

class BeautyHeatmap {
    constructor() {
        console.log('BeautyHeatmap constructor called!');
        this.map = null;
        this.overlay = null;
        this.heatData = [];
        this.pointData = [];
        this.showHeatmap = true;
        this.showPoints = true;
        this.iconCache = new Map();
        this.pinAtlasUrl = null;
        this.pinAtlasMapping = null;
        this.externalPinSvg = null;
        
        this.init();
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
                
                const script = document.createElement('script');
                script.src = scriptUrl;
                script.async = true;
                script.defer = true;
                
                script.onload = () => resolve();
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
            
            console.log('🗺️ Map initialized with draggableCursor: default');
            console.log('🗺️ Map div cursor:', this.map.getDiv().style.cursor);
            
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
                    if (this.lastCursorState !== cursor) {
                        console.log('🎯 Cursor changing to:', cursor, { isHovering, isDragging });
                        this.lastCursorState = cursor;
                    }
                    return cursor;
                }
            });
            this.overlay.setMap(this.map);
            
            console.log('Map and overlay initialized, setting up event listeners...');
            
            // deck.gl is loaded and working
            // Set up event listeners
            this.setupEventListeners();

            // Attach Places Autocomplete to the address input
            this.setupAutocomplete();
            
            console.log('Loading initial data...');
            // Load initial data
            await this.loadStats();
            await this.refreshData();
            
            console.log('Initialization complete!');
            
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
        if (!window.google || !google.maps.places) return;
        const autocomplete = new google.maps.places.Autocomplete(input, {
            fields: ['formatted_address', 'geometry', 'place_id'],
            componentRestrictions: { country: 'gb' },
            types: ['geocode']
        });
        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place && place.geometry && place.geometry.location) {
                this.map.panTo(place.geometry.location);
                this.map.setZoom(16);
            }
        });
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
        
        // Control events
        document.getElementById('addPointBtn').addEventListener('click', () => this.addPoint());
        
        // Allow Enter key to submit
        document.getElementById('addressInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPoint();
        });
    }
    
    async refreshData() {
        try {
            console.log('refreshData called');
            
            // Check if we need to trigger fade-out before loading new data
            const newZoom = this.map.getZoom();
            const newResolution = this.getH3Resolution(newZoom);
            const newShowHexagons = newZoom < CONFIG.HEATMAP_ZOOM_THRESHOLD;
            const newShowPoints = newZoom >= CONFIG.HEATMAP_ZOOM_THRESHOLD;
            
            // Simplified approach: Just log zoom changes, handle fade-out in updateVisualization
            if (this.lastZoom !== undefined && newZoom !== this.lastZoom) {
                console.log(`Zoom transition: ${this.lastZoom} → ${newZoom}`);
            }
            
            this.lastZoom = newZoom;
            const bounds = this.map.getBounds();
            if (!bounds) {
                console.log('No map bounds available, loading all data instead');
                // Fallback: load all data without bbox filtering
                const pointResponse = await fetch(`${CONFIG.API_BASE_URL}/points?bbox=-180,-90,180,90`);
                if (pointResponse.ok) {
                    this.pointData = await pointResponse.json();
                    console.log('Loaded all point data:', this.pointData.length, 'items');
                }
                const heatResponse = await fetch(`${CONFIG.API_BASE_URL}/heat?bbox=-180,-90,180,90&z=12`);
                if (heatResponse.ok) {
                    this.heatData = await heatResponse.json();
                    console.log('Loaded all heat data:', this.heatData.length, 'items');
                }
                this.updateVisualization();
                return;
            }
            
            const zoom = this.map.getZoom();
            console.log('Map zoom:', zoom, 'Bounds:', bounds.toString());
            const bbox = [
                bounds.getSouthWest().lng(),
                bounds.getSouthWest().lat(),
                bounds.getNorthEast().lng(),
                bounds.getNorthEast().lat()
            ].join(',');
            
            if (zoom < CONFIG.HEATMAP_ZOOM_THRESHOLD) {
                // Load heatmap data - but only for the zoom ranges where we want to show hexagons
                const resolution = this.getH3Resolution(zoom);
                if (resolution !== null) {
                    console.log('Loading heatmap data for zoom', zoom, 'resolution', resolution);
                    const response = await fetch(`${CONFIG.API_BASE_URL}/heat?bbox=${bbox}&z=${zoom}`);
                    if (response.ok) {
                        this.heatData = await response.json();
                        console.log('Loaded heatmap data:', this.heatData.length, 'items');
                        if (this.heatData.length > 0) {
                            console.log('First hexagon sample:', this.heatData[0]);
                            console.log('H3 index length (indicates resolution):', this.heatData[0].h3?.length);
                        }
                    } else {
                        console.error('Failed to load heatmap data:', response.status);
                    }
                } else {
                    // Clear heatmap data when we don't want to show hexagons
                    this.heatData = [];
                    console.log('Cleared heatmap data - zoom level outside hexagon range');
                }
            } else {
                // Load point data
                console.log('Loading point data for zoom', zoom);
                const response = await fetch(`${CONFIG.API_BASE_URL}/points?bbox=${bbox}`);
                if (response.ok) {
                    this.pointData = await response.json();
                    console.log('Loaded point data:', this.pointData.length, 'items');
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
        }, 150); // Wait 150ms after map stops moving
    }
    
    startFadeAnimation() {
        // Cancel any existing animation
        if (this.fadeAnimationId) {
            cancelAnimationFrame(this.fadeAnimationId);
        }
        
        const FADE_DURATION = 800; // Same as TRANSITION_DURATION
        
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
        const layers = [];
        const zoom = this.map.getZoom();
        
        // Global transition speed control - lower number = faster transitions
        const TRANSITION_DURATION = 800; // Slower fade-in to see the effect
        
        // Add small delay to ensure smooth transitions for new objects
        if (!this.lastUpdateTime || (Date.now() - this.lastUpdateTime) > 100) {
            this.lastUpdateTime = Date.now();
        }
        
        // Update zoom info display
        this.updateZoomInfo(zoom);
        // Cursor is managed by deck.gl getCursor function
        
        
        const resolution = this.getH3Resolution(zoom);
        const showHexagons = zoom < CONFIG.HEATMAP_ZOOM_THRESHOLD && this.showHeatmap && this.heatData.length > 0 && resolution !== null;
        const showPoints = zoom >= CONFIG.HEATMAP_ZOOM_THRESHOLD && this.showPoints && this.pointData.length > 0;
        
        // Separate visibility for different hexagon resolutions  
        const showLargeHex = showHexagons && resolution === 7;   // Zoom 9-12: Large R7 hexagons
        const showMediumHex = showHexagons && resolution === 9;  // Zoom 13-15: Medium R9 hexagons
        const showSmallHex = false; // No small hexagons defined in getH3Resolution
        
        // Visibility logic for different layer types
        
        // Hexagons will be added below with opacity transitions
        
        // Store data by resolution for consistent transitions
        if (!this.hexDataByResolution) {
            this.hexDataByResolution = { 7: [], 9: [] };
        }
        
        // Handle fade-out for hexagons that should no longer be visible
        let shouldAnimate = false;
        const now = Date.now();
        
        // Simple rule: if a resolution shouldn't be shown, fade it out
        [7, 9].forEach(res => {
            const shouldShow = (res === 7 && showLargeHex) || (res === 9 && showMediumHex);
            
            if (this.hexDataByResolution[res]?.length > 0) {
                this.hexDataByResolution[res] = this.hexDataByResolution[res].map(hex => {
                    if (!shouldShow && !hex._fadeOutTime) {
                        console.log(`Fading out resolution ${res} hexagon`);
                        shouldAnimate = true;
                        return { ...hex, _fadeOutTime: now };
                    }
                    return hex;
                });
            }
        });
        
        // Update the current resolution's data and clear others to prevent overlap
        if (resolution && this.heatData.length > 0) {
            // Don't recreate data if we're currently animating to prevent infinite loop
            if (!this.fadeAnimationId) {
                // Keep existing hexagons for current resolution to avoid reanimating
                const existingHexagons = this.hexDataByResolution[resolution] || [];
                const existingHexagonIds = new Set(existingHexagons.map(h => h.h3));
                
                // Don't clear current resolution data if it exists, just update other resolutions
                if (resolution !== this.lastResolution) {
                    [7, 9].forEach(res => {
                        if (res !== resolution) {
                            // Mark for fade-out instead of clearing immediately
                            if (this.hexDataByResolution[res]?.length > 0) {
                                this.hexDataByResolution[res] = this.hexDataByResolution[res].map(hex => {
                                    if (!hex._fadeOutTime) {
                                        shouldAnimate = true;
                                        return { ...hex, _fadeOutTime: now };
                                    }
                                    return hex;
                                });
                            }
                        }
                    });
                    this.lastResolution = resolution;
                }
                
                // Separate new vs existing hexagons
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
                
                // Start animation if we have new hexagons
                const newHexagons = dataWithTimestamps.filter(h => h._spawnTime === now);
                if (newHexagons.length > 0) {
                    shouldAnimate = true;
                }
            }
        }
        
        // Create separate hexagon layers for each resolution that can fade independently
        if (Object.values(this.hexDataByResolution).some(data => data.length > 0)) {
            let H3HexagonLayer;
            if (window.deck && window.deck.H3HexagonLayer) {
                H3HexagonLayer = window.deck.H3HexagonLayer;
            } else if (window.DeckGL) {
                H3HexagonLayer = window.DeckGL.H3HexagonLayer;
            } else {
                throw new Error('H3HexagonLayer not found in global scope');
            }
            
            // Create layers for each resolution type that always exist
            const resolutions = [
                { res: 7, show: showLargeHex, lineWidth: 2, lineOpacity: 160, name: 'large' },
                { res: 9, show: showMediumHex, lineWidth: 1.5, lineOpacity: 130, name: 'medium' }
            ];
            
            resolutions.forEach(({ res, show, lineWidth, lineOpacity, name }) => {
                // Always create layers if they have data, even if not currently visible (for fade-out)
                if (this.hexDataByResolution[res]?.length > 0) {
                    console.log(`Creating ${name} hex layer: ${this.hexDataByResolution[res].length} hexagons, show=${show}`);
                    
                    layers.push(new H3HexagonLayer({
                    id: `h3-hexagons-${name}`,
                    data: this.hexDataByResolution[res], // Use stored data for this resolution
                    getHexagon: d => d.h3,
                    // Note: getId doesn't work with H3HexagonLayer (uses array indices)
                    // Manual fade-in/out using timestamps (deck.gl transitions don't work with H3HexagonLayer)
                    getFillColor: d => {
                        const c = this.getBeautyHexColor(d.avg);
                        const now = Date.now();
                        const baseAlpha = c[3] || 150; // Use the alpha from getBeautyHexColor
                        
                        // Handle fade-out first (takes priority)
                        if (d._fadeOutTime) {
                            const fadeOutAge = now - d._fadeOutTime;
                            const fadeOutProgress = Math.min(fadeOutAge / TRANSITION_DURATION, 1.0);
                            const a = Math.round(baseAlpha * (1.0 - fadeOutProgress)); // Fade from full to 0
                            return [c[0], c[1], c[2], a];
                        }
                        
                        // If layer shouldn't be shown and no fade-out, make invisible
                        if (!show) return [c[0], c[1], c[2], 0];
                        
                        // Handle fade-in
                        if (d._spawnTime) {
                            const fadeInAge = now - d._spawnTime;
                            const fadeInProgress = Math.min(fadeInAge / TRANSITION_DURATION, 1.0);
                            const a = Math.round(fadeInProgress * baseAlpha); // Fade from 0 to full
                            return [c[0], c[1], c[2], a];
                        }
                        
                        // No animation, just show at full opacity
                        return [c[0], c[1], c[2], baseAlpha];
                    },
                    getLineColor: d => {
                        const now = Date.now();
                        // Handle line fade-out too
                        if (d._fadeOutTime) {
                            const fadeOutAge = now - d._fadeOutTime;
                            const fadeOutProgress = Math.min(fadeOutAge / TRANSITION_DURATION, 1.0);
                            const alpha = Math.round(lineOpacity * (1.0 - fadeOutProgress));
                            return [255, 255, 255, alpha];
                        }
                        return [255, 255, 255, Math.round(lineOpacity * (show ? 1.0 : 0.0))];
                    },
                    visible: true,
                    lineWidthMinPixels: lineWidth,
                    extruded: false,
                    stroked: true,
                    filled: true,
                    pickable: show, // Make pickable when visible
                    onHover: this.onHexagonHover.bind(this),
                    onClick: this.onHexagonClick.bind(this),
                    // DISABLE transitions - H3HexagonLayer doesn't support object identity
                    // Transitions cause wrong hexagons to change color due to array index matching
                    updateTriggers: {
                        // Trigger color recompute when data length, visibility, or animation frame changes
                        getFillColor: [this.hexDataByResolution[res]?.length, show, this.animationTrigger],
                        getLineColor: [this.hexDataByResolution[res]?.length, show, this.animationTrigger]
                    }
                }));
                }
            });
        }
        
        if (this.pointData.length > 0) {
            // Show individual points as large, crisp pins with readable labels
            let IconLayer, TextLayer;
            if (window.deck && window.deck.IconLayer) {
                IconLayer = window.deck.IconLayer;
                TextLayer = window.deck.TextLayer;
            } else if (window.DeckGL) {
                IconLayer = window.DeckGL.IconLayer;
                TextLayer = window.DeckGL.TextLayer;
            } else {
                console.error('Required deck.gl layers not found in global scope');
                return;
            }

            const getPosition = d => [parseFloat(d.lng), parseFloat(d.lat)];

            // Load external SVG icon once and recolor per score
            await this.ensureExternalPin();

            // Pin icons (anchor at tip) from a sprite atlas for crisp rendering
            const pointAlpha = showPoints ? 255 : 0;
            
            layers.push(new IconLayer({
                id: 'beauty-pins',
                data: this.pointData,
                getPosition,
                // Use unique ID for object identity matching
                getId: d => d.id || d.place_id || `${d.lat}-${d.lng}`,
                // Use per-point SVG URL derived from the external base SVG and score color
                getIcon: d => ({
                    url: this.getExternalPinForScore(d.beauty),
                    width: 1024,
                    height: 1024,
                    anchorY: 1024
                }),
                sizeUnits: 'pixels',
                getSize: 64,
                sizeMinPixels: 56,
                sizeMaxPixels: 72,
                pickable: true,
                pickingRadius: 12, // Make picking a bit more forgiving
                parameters: { depthTest: false }, // Ensure pins render and pick above anything else
                onHover: this.onPointHover.bind(this),
                onClick: this.onPointClick.bind(this),
                getColor: d => [255, 255, 255, pointAlpha],
                transitions: { getColor: { duration: TRANSITION_DURATION } },
                updateTriggers: { getColor: [pointAlpha] }
            }));

            // Score label centered inside the pin head
            layers.push(new TextLayer({
                id: 'beauty-pin-labels',
                data: this.pointData,
                getPosition,
                // Use same stable ID as IconLayer for consistent matching
                getId: d => d.id || d.place_id || `${d.lat}-${d.lng}`,
                getText: d => `${Math.round(parseFloat(d.beauty))}`,
                getColor: d => [255, 255, 255, pointAlpha],
                getSize: 18,
                sizeUnits: 'pixels',
                sizeMinPixels: 18,
                sizeMaxPixels: 18,
                textAnchor: 'middle',
                alignmentBaseline: 'center',
                billboard: true,
                fontFamily: 'Arial Black, Arial, sans-serif',
                // No outline/background for a clean look
                fontSettings: { sdf: false },
                getPixelOffset: [0, -24],
                pickable: false, // Avoid text intercepting clicks; let icons handle picking
                parameters: { depthTest: false },
                transitions: { getColor: { duration: TRANSITION_DURATION } },
                updateTriggers: { getColor: [pointAlpha] }
            }));
        }
        
        // Start animation if needed
        if (shouldAnimate && !this.fadeAnimationId) {
            this.startFadeAnimation();
        }
        
        this.overlay.setProps({ layers });
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
    
    getBeautyColor(beauty) {
        const score = Math.round(Math.max(1, Math.min(10, beauty || 5)));
        return CONFIG.BEAUTY_COLORS[score] || [128, 128, 128, 180];
    }
    
    getBeautyIconColor(beauty) {
        const score = Math.max(1, Math.min(10, beauty || 5));
        
        // Return bright RGB colors for IconLayer
        if (score <= 2) return [255, 51, 51];
        if (score <= 4) return [255, 136, 0];
        if (score <= 6) return [255, 221, 0];
        if (score <= 8) return [136, 255, 0];
        return [0, 255, 68];
    }
    
    getBeautyHexColor(avgBeauty) {
        // Handle empty hexagons (make them transparent)
        if (!avgBeauty || avgBeauty === 0) {
            return [128, 128, 128, 30]; // Very transparent gray
        }
        
        // Color based on beauty score (1-10 scale)
        const normalized = Math.max(1, Math.min(10, avgBeauty)) / 10; // 0.1 to 1.0
        
        if (normalized <= 0.2) {
            // 1-2: Red (bad)
            return [255, 0, 0, 150];
        } else if (normalized <= 0.4) {
            // 3-4: Orange (lackluster)
            return [255, 128, 0, 150];
        } else if (normalized <= 0.6) {
            // 5-6: Yellow (okay)
            return [255, 255, 0, 150];
        } else if (normalized <= 0.8) {
            // 7-8: Light Green (good)
            return [128, 255, 0, 150];
        } else {
            // 9-10: Green (excellent)
            return [0, 255, 0, 150];
        }
    }
    
    getH3Resolution(zoom) {
        if (zoom < 9) return null;               // Below zoom 9: no hexagons
        if (zoom >= 9 && zoom <= 12) return 7;  // Large R7 hexagons
        if (zoom >= 13 && zoom <= 15) return 9; // Medium R9 hexagons (now includes zoom 15)
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
    <path d='M24 2c-9.94 0-18 8.06-18 18 0 12.5 18 36 18 36s18-23.5 18-36C42 10.06 33.94 2 24 2z' fill='${fill}' stroke='rgba(0,0,0,0.6)' stroke-width='2'/>
    <circle cx='24' cy='22' r='9' fill='white' fill-opacity='0.95'/>
  </g>
</svg>`;

        this.iconCache.set(rounded, svg);
        return svg;
    }

    // Build a small sprite atlas with 10 color-coded pins once
    ensurePinAtlas() {
        if (this.pinAtlasUrl && this.pinAtlasMapping) return;

        const canvas = document.createElement('canvas');
        const cols = 5;
        const rows = 2;
        const cellW = 48;
        const cellH = 64;
        canvas.width = cols * cellW;
        canvas.height = rows * cellH;
        const ctx = canvas.getContext('2d');

        const drawPin = (x, y, fill) => {
            ctx.save();
            ctx.translate(x + cellW / 2, y);
            // Shadow
            ctx.shadowColor = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 2;
            // Body
            ctx.beginPath();
            // simple rounded pin path
            ctx.moveTo(0, 6);
            ctx.arc(0, 22, 18, Math.PI, 0);
            ctx.lineTo(12, 46);
            ctx.lineTo(0, 64);
            ctx.lineTo(-12, 46);
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.stroke();
            // Subtle glossy highlight at top (very low alpha)
            /*
            ctx.beginPath();
            ctx.ellipse(0, 16, 10, 6, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fill();
            */
            ctx.restore();
        };

        const colors = (score) => {
            const [r, g, b] = this.getBeautyIconColor(score);
            return `rgb(${r},${g},${b})`;
        };

        this.pinAtlasMapping = {};
        for (let s = 1; s <= 10; s++) {
            const idx = s - 1;
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const x = col * cellW;
            const y = row * cellH;
            drawPin(x, y, colors(s));
            this.pinAtlasMapping[`s${s}`] = { x, y, width: cellW, height: cellH, anchorY: cellH };
        }

        this.pinAtlasUrl = canvas.toDataURL();
    }

    async ensureExternalPin() {
        if (this.externalPinSvg) return;
        // Fetch the SVG from project root via relative path from frontend
        const resp = await fetch('./assets/location.svg');
        if (!resp.ok) throw new Error('Failed to load external pin SVG');
        this.externalPinSvg = await resp.text();
    }

    getExternalPinForScore(beauty) {
        const rounded = Math.max(1, Math.min(10, Math.round(beauty || 5)));
        const cacheKey = `ext_${rounded}`;
        if (this.iconCache.has(cacheKey)) return this.iconCache.get(cacheKey);
        const [r, g, b] = this.getBeautyIconColor(rounded);
        const color = `rgb(${r},${g},${b})`;
        // Replace currentColor in the SVG with the desired fill color and remove stroke for crisp edges
        const colored = this.externalPinSvg
            .replace(/currentColor/gi, color)
            .replace(/stroke=".*?"/gi, '')
            .replace(/stroke-width=".*?"/gi, '');
        const url = `data:image/svg+xml;utf8,${encodeURIComponent(colored)}`;
        this.iconCache.set(cacheKey, url);
        return url;
    }
    
    onHexagonHover(info) {
        if (info.object) {
            // You could show hexagon info on hover if needed
            // console.log('Hexagon hovered:', info.object);
        }
    }
    
    onHexagonClick(info) {
        if (info.object) {
            const hexData = info.object;
            const avgBeauty = parseFloat(hexData.avg || 0);
            const scoreColor = avgBeauty >= 7 ? '#4CAF50' : avgBeauty >= 5 ? '#FF9800' : '#F44336';
            
            const content = `
                <div style="max-width: 280px; font-family: Arial, sans-serif;">
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <h3 style="margin: 0; color: ${scoreColor};">Area Average: ${avgBeauty.toFixed(1)}/10</h3>
                    </div>
                    <p style="margin: 5px 0;"><strong>🔷 Hexagon:</strong> ${hexData.h3}</p>
                    <div style="background: #f5f5f5; padding: 10px; border-radius: 5px; margin: 10px 0;">
                        <strong>📊 Statistics:</strong><br>
                        <em>This hexagon represents the average beauty score of multiple locations in this area</em>
                    </div>
                    <p style="margin: 5px 0; font-size: 12px; color: #666;">
                        <strong>🎯 Resolution:</strong> H3 Level ${this.getH3Resolution(this.map.getZoom())}<br>
                        <strong>🗺️ Zoom to see individual points</strong>
                    </p>
                </div>
            `;
            
            const infoWindow = new google.maps.InfoWindow({
                content: content,
                position: { lat: parseFloat(hexData.lat), lng: parseFloat(hexData.lng) }
            });
            
            infoWindow.open(this.map);
        }
    }
    
    onPointHover(info, event) {
        console.log('🎯 onPointHover called:', {
            hasInfo: !!info,
            hasObject: !!(info && info.object)
        });
        
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
    
    async addPoint() {
        console.log('Add point button clicked!');
        
        const addressInput = document.getElementById('addressInput');
        const loading = document.getElementById('loading');
        const button = document.getElementById('addPointBtn');
        
        const address = addressInput.value.trim();
        
        console.log('Address:', address);
        
        if (!address) {
            alert('Please enter a London address');
            return;
        }
        
        try {
            // Show loading
            const spinner = document.getElementById('addressSpinner');
            if (spinner) spinner.style.display = 'inline-block';
            button.disabled = true;
            
            const payload = { address: address };
            
            // Use real AI evaluation on the server (no precomputed values)
            
            console.log('Making API request to:', `${CONFIG.API_BASE_URL}/point`);
            console.log('Payload:', payload);
            
            // Optimistically fly to the typed address while the server processes
            try {
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ address, componentRestrictions: { country: 'GB' } }, (results, status) => {
                    if (status === 'OK' && results && results[0]) {
                        const loc = results[0].geometry.location;
                        this.map.panTo(loc);
                        this.map.setZoom(16);
                    }
                });
            } catch (_) {}

            // Add a client-side timeout so the UI doesn't hang forever
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

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
                
                // Fly to inputted address immediately (optimistic UX) and then to final point location
                if (result.point) {
                    const target = { lat: parseFloat(result.point.lat), lng: parseFloat(result.point.lng) };
                    this.map.panTo(target);
                    this.map.setZoom(16);
                }

                // Refresh data and open the info window for this new point
                await this.refreshData();
                await this.loadStats();

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
        } finally {
            // Hide loading
            const spinner = document.getElementById('addressSpinner');
            if (spinner) spinner.style.display = 'none';
            button.disabled = false;
        }
    }
    
    async loadStats() {
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}/stats`);
            if (response.ok) {
                const stats = await response.json();
                const statsElement = document.getElementById('stats');
                statsElement.innerHTML = `
                    <div><strong>Total Points:</strong> ${stats.total_points || 0}</div>
                    <div><strong>Average Beauty:</strong> ${stats.avg_beauty ? parseFloat(stats.avg_beauty).toFixed(1) : 'N/A'}/10</div>
                    <div><strong>Range:</strong> ${stats.min_beauty || 'N/A'} - ${stats.max_beauty || 'N/A'}</div>
                `;
            }
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }
}

// Initialize the application when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new BeautyHeatmap();
});
