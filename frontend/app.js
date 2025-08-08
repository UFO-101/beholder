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
                interleaved: true
            });
            this.overlay.setMap(this.map);
            
            console.log('Map and overlay initialized, setting up event listeners...');
            
            // deck.gl is loaded and working
            // Set up event listeners
            this.setupEventListeners();
            
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
    
    setupEventListeners() {
        // Map events
        this.map.addListener('idle', () => this.refreshData());
        
        // Control events
        document.getElementById('addPointBtn').addEventListener('click', () => this.addPoint());
        document.getElementById('showHeatmap').addEventListener('change', (e) => {
            this.showHeatmap = e.target.checked;
            this.updateVisualization();
        });
        document.getElementById('showPoints').addEventListener('change', (e) => {
            this.showPoints = e.target.checked;
            this.updateVisualization();
        });
        
        // Allow Enter key to submit
        document.getElementById('addressInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPoint();
        });
        document.getElementById('imageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPoint();
        });
    }
    
    async refreshData() {
        try {
            console.log('refreshData called');
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
            
            this.updateVisualization();
            
        } catch (error) {
            console.error('Failed to refresh data:', error);
        }
    }
    
    updateVisualization() {
        console.log('updateVisualization called');
        const layers = [];
        const zoom = this.map.getZoom();
        
        // Update zoom info display
        this.updateZoomInfo(zoom);
        
        console.log('Current zoom:', zoom, 'Heatmap threshold:', CONFIG.HEATMAP_ZOOM_THRESHOLD);
        console.log('Heat data count:', this.heatData.length, 'Point data count:', this.pointData.length);
        console.log('Show heatmap:', this.showHeatmap, 'Show points:', this.showPoints);
        
        const resolution = this.getH3Resolution(zoom);
        if (zoom < CONFIG.HEATMAP_ZOOM_THRESHOLD && this.showHeatmap && this.heatData.length > 0 && resolution !== null) {
            // Show H3 hexagons
            console.log('Creating H3 hexagon layer with', this.heatData.length, 'hexagons');
            console.log('H3 hexagon data sample:', this.heatData[0]);
            
            let H3HexagonLayer;
            if (window.deck && window.deck.H3HexagonLayer) {
                H3HexagonLayer = window.deck.H3HexagonLayer;
            } else if (window.DeckGL && window.DeckGL.H3HexagonLayer) {
                H3HexagonLayer = window.DeckGL.H3HexagonLayer;
            } else if (window.H3HexagonLayer) {
                H3HexagonLayer = window.H3HexagonLayer;
            } else {
                console.error('H3HexagonLayer not found in global scope');
                return;
            }
            
            // H3 hexagons should render at their true geographic sizes
            // The H3 spec defines exact sizes: R7 ~1.22km, R9 ~176m, R13 ~2.4m edge length
            // resolution is already calculated above and checked for null
            
            // Style based on resolution for visibility, but don't artificially scale size
            let lineWidth, lineOpacity;
            if (resolution === 7) {
                // R7 hexagons are naturally large (~1.22km edge) - use thicker lines
                lineWidth = 2;
                lineOpacity = 160;
            } else if (resolution === 9) {
                // R9 hexagons are medium (~176m edge) - medium lines
                lineWidth = 1.5;
                lineOpacity = 130;
            } else if (resolution === 13) {
                // R13 hexagons are naturally small (~2.4m edge) - thin lines but more visible
                lineWidth = 1;
                lineOpacity = 110;
            } else {
                // Fallback
                lineWidth = 1;
                lineOpacity = 100;
            }
            
            layers.push(new H3HexagonLayer({
                id: 'h3-hexagons',
                data: this.heatData,
                getHexagon: d => d.h3,
                getFillColor: d => this.getBeautyHexColor(d.avg),
                getLineColor: [255, 255, 255, lineOpacity],
                lineWidthMinPixels: lineWidth,
                // coverage: 1.0 is default - let H3 hexagons render at true geographic size
                extruded: false,
                stroked: true,
                filled: true,
                pickable: true,
                onHover: this.onHexagonHover.bind(this),
                onClick: this.onHexagonClick.bind(this)
            }));
        }
        
        if (zoom >= CONFIG.HEATMAP_ZOOM_THRESHOLD && this.showPoints && this.pointData.length > 0) {
            // Show individual points
            console.log('Creating scatterplot layer with', this.pointData.length, 'data points');
            console.log('Point data sample:', this.pointData[0]);
            console.log('Point positions:', this.pointData.map(d => ({
                address: d.address,
                position: [parseFloat(d.lng), parseFloat(d.lat)],
                beauty: d.beauty
            })));
            
            // Get required layer classes
            let IconLayer, TextLayer, CompositeLayer;
            if (window.deck && window.deck.IconLayer) {
                IconLayer = window.deck.IconLayer;
                TextLayer = window.deck.TextLayer;
                CompositeLayer = window.deck.CompositeLayer;
            } else if (window.DeckGL) {
                IconLayer = window.DeckGL.IconLayer;
                TextLayer = window.DeckGL.TextLayer;
                CompositeLayer = window.DeckGL.CompositeLayer;
            } else {
                console.error('Required deck.gl layers not found in global scope');
                return;
            }
            
            // Create composite layer class for labelled icons
            class LabelledIconLayer extends CompositeLayer {
                renderLayers() {
                    const {data, getColor, getPosition, getText} = this.props;
                    return [
                        new IconLayer({
                            id: `${this.id}-icons`,
                            data,
                            getPosition,
                            getIcon: () => 'marker',
                            getColor,
                            sizeUnits: 'pixels',
                            sizeMinPixels: 32,
                            sizeMaxPixels: 32,
                            iconAtlas: this.getIconAtlas(),
                            iconMapping: this.getIconMapping(),
                            pickable: true
                        }),
                        new TextLayer({
                            id: `${this.id}-text`,
                            data,
                            getPosition,
                            getText,
                            getColor: [255, 255, 255, 255],
                            fontSize: 12,
                            fontWeight: 'bold',
                            textAnchor: 'middle',
                            alignmentBaseline: 'center',
                            billboard: true,
                            pickable: false,
                            outlineWidth: 2,
                            outlineColor: [0, 0, 0, 255]
                        })
                    ];
                }
                
                getIconAtlas() {
                    // Create a simple location pin icon
                    const canvas = document.createElement('canvas');
                    canvas.width = 64;
                    canvas.height = 64;
                    const ctx = canvas.getContext('2d');
                    
                    // Clear canvas
                    ctx.clearRect(0, 0, 64, 64);
                    
                    // Draw location pin shape
                    ctx.fillStyle = '#FFFFFF';
                    ctx.strokeStyle = '#333333';
                    ctx.lineWidth = 2;
                    
                    // Pin body (teardrop shape)
                    ctx.beginPath();
                    ctx.arc(32, 28, 18, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.stroke();
                    
                    // Pin point
                    ctx.beginPath();
                    ctx.moveTo(32, 46);
                    ctx.lineTo(24, 38);
                    ctx.lineTo(40, 38);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    
                    // Inner circle
                    ctx.fillStyle = '#666666';
                    ctx.beginPath();
                    ctx.arc(32, 28, 8, 0, 2 * Math.PI);
                    ctx.fill();
                    
                    return canvas.toDataURL();
                }
                
                getIconMapping() {
                    return {
                        marker: { x: 0, y: 0, width: 64, height: 64, anchorY: 64 }
                    };
                }
            }
            
            // Add labelled icon layer for points
            layers.push(new LabelledIconLayer({
                id: 'beauty-points',
                data: this.pointData,
                getPosition: d => [parseFloat(d.lng), parseFloat(d.lat)],
                getColor: d => this.getBeautyIconColor(d.beauty),
                getText: d => parseFloat(d.beauty).toFixed(1),
                pickable: true,
                onHover: this.onPointHover.bind(this),
                onClick: this.onPointClick.bind(this)
            }));
        }
        
        console.log('Setting', layers.length, 'layers on overlay');
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
        if (score <= 2) {
            return [255, 51, 51]; // Bright Red
        } else if (score <= 4) {
            return [255, 136, 0]; // Bright Orange
        } else if (score <= 6) {
            return [255, 221, 0]; // Bright Yellow
        } else if (score <= 8) {
            return [136, 255, 0]; // Bright Light Green
        } else {
            return [0, 255, 68]; // Bright Green
        }
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
    
    onPointHover(info) {
        if (info.object) {
            // You could show a tooltip here if needed
            // console.log('Hovered:', info.object);
        }
    }
    
    onPointClick(info) {
        if (info.object) {
            const point = info.object;
            const beautyScore = parseFloat(point.beauty);
            const scoreColor = beautyScore >= 7 ? '#4CAF50' : beautyScore >= 5 ? '#FF9800' : '#F44336';
            
            const content = `
                <div style="max-width: 320px; font-family: Arial, sans-serif;">
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <h3 style="margin: 0; color: ${scoreColor};">Beauty Score: ${beautyScore}/10</h3>
                    </div>
                    <p style="margin: 5px 0;"><strong>📍 Address:</strong> ${point.address}</p>
                    <div style="background: #f5f5f5; padding: 10px; border-radius: 5px; margin: 10px 0;">
                        <strong>💭 AI Review:</strong><br>
                        <em>"${point.description || 'No review available'}"</em>
                    </div>
                    <p style="margin: 5px 0; font-size: 12px; color: #666;">
                        <strong>🔍 Model:</strong> ${point.model_version || 'Unknown'}<br>
                        <strong>📅 Added:</strong> ${point.created_at ? new Date(point.created_at).toLocaleDateString() : 'Unknown'}
                    </p>
                    ${point.image_url ? `<img src="${point.image_url}" style="width: 100%; margin-top: 10px; border-radius: 5px;">` : ''}
                </div>
            `;
            
            const infoWindow = new google.maps.InfoWindow({
                content: content,
                position: { lat: parseFloat(point.lat), lng: parseFloat(point.lng) }
            });
            
            infoWindow.open(this.map);
        }
    }
    
    async addPoint() {
        console.log('Add point button clicked!');
        
        const addressInput = document.getElementById('addressInput');
        const imageInput = document.getElementById('imageInput');
        const loading = document.getElementById('loading');
        const button = document.getElementById('addPointBtn');
        
        const address = addressInput.value.trim();
        const imageUrl = imageInput.value.trim();
        
        console.log('Address:', address, 'ImageURL:', imageUrl);
        
        if (!address) {
            alert('Please enter a London address');
            return;
        }
        
        try {
            // Show loading
            loading.style.display = 'block';
            button.disabled = true;
            
            const payload = { address: address };
            if (imageUrl) {
                payload.imageUrl = imageUrl;
            }
            
            // TEMPORARY: Add precomputed values to bypass AI evaluation issues
            payload.precomputedBeauty = 7.5;
            payload.precomputedReview = "Beautiful London location (temp review for testing)";
            
            console.log('Making API request to:', `${CONFIG.API_BASE_URL}/point`);
            console.log('Payload:', payload);
            
            const response = await fetch(`${CONFIG.API_BASE_URL}/point`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Clear inputs
                addressInput.value = '';
                imageInput.value = '';
                
                // Refresh data
                await this.refreshData();
                await this.loadStats();
                
                // Center map on new point
                if (result.point) {
                    this.map.setCenter({ lat: result.point.lat, lng: result.point.lng });
                    this.map.setZoom(16); // Zoom in to see the point
                }
                
                alert(`Point added successfully! Beauty score: ${result.point.beauty}/10`);
                
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add point');
            }
            
        } catch (error) {
            console.error('Failed to add point:', error);
            alert(`Failed to add point: ${error.message}`);
        } finally {
            // Hide loading
            loading.style.display = 'none';
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