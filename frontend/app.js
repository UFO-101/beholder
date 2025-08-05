// Configuration
const CONFIG = {
    // Local development configuration
    GOOGLE_MAPS_API_KEY: 'AIzaSyBI_ZzYV93bFdOJ_TftCM6e9ufGRtM4JpU',
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
    
    loadGoogleMaps() {
        return new Promise((resolve, reject) => {
            if (window.google && window.google.maps) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_MAPS_API_KEY}&libraries=geometry`;
            script.async = true;
            script.defer = true;
            
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Google Maps'));
            
            document.head.appendChild(script);
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
            alert('Failed to load map. Please check your API keys and try again.');
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
                // Load heatmap data
                console.log('Loading heatmap data for zoom', zoom);
                const response = await fetch(`${CONFIG.API_BASE_URL}/heat?bbox=${bbox}&z=${zoom}`);
                if (response.ok) {
                    this.heatData = await response.json();
                    console.log('Loaded heatmap data:', this.heatData.length, 'items');
                } else {
                    console.error('Failed to load heatmap data:', response.status);
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
        
        if (zoom < CONFIG.HEATMAP_ZOOM_THRESHOLD && this.showHeatmap && this.heatData.length > 0) {
            // Show heatmap
            console.log('Creating heatmap layer with', this.heatData.length, 'data points');
            console.log('Heatmap data sample:', this.heatData[0]);
            
            let HeatmapLayer;
            if (window.deck && window.deck.HeatmapLayer) {
                HeatmapLayer = window.deck.HeatmapLayer;
            } else if (window.DeckGL && window.DeckGL.HeatmapLayer) {
                HeatmapLayer = window.DeckGL.HeatmapLayer;
            } else if (window.HeatmapLayer) {
                HeatmapLayer = window.HeatmapLayer;
            } else {
                console.error('HeatmapLayer not found in global scope');
                return;
            }
            
            layers.push(new HeatmapLayer({
                id: 'heatmap',
                data: this.heatData,
                getPosition: d => [parseFloat(d.lng), parseFloat(d.lat)],
                getWeight: d => parseFloat(d.avg) || 5,
                radiusPixels: 80,
                colorRange: [
                    [255, 0, 0, 180],      // Red (low beauty)
                    [255, 128, 0, 180],    // Orange
                    [255, 255, 0, 180],    // Yellow  
                    [128, 255, 0, 180],    // Light Green
                    [0, 255, 0, 180]       // Green (high beauty)
                ],
                intensity: 2,
                threshold: 0.03
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
            
            let ScatterplotLayer;
            if (window.deck && window.deck.ScatterplotLayer) {
                ScatterplotLayer = window.deck.ScatterplotLayer;
            } else if (window.DeckGL && window.DeckGL.ScatterplotLayer) {
                ScatterplotLayer = window.DeckGL.ScatterplotLayer;
            } else if (window.ScatterplotLayer) {
                ScatterplotLayer = window.ScatterplotLayer;
            } else {
                console.error('ScatterplotLayer not found in global scope');
                return;
            }
            
            // Add scatter plot layer for points
            layers.push(new ScatterplotLayer({
                id: 'points',
                data: this.pointData,
                getPosition: d => [parseFloat(d.lng), parseFloat(d.lat)],
                getRadius: 15,
                getFillColor: d => this.getBeautyColor(d.beauty),
                getLineColor: [255, 255, 255, 200],
                getLineWidth: 2,
                stroked: true,
                filled: true,
                pickable: true,
                onHover: this.onPointHover.bind(this),
                onClick: this.onPointClick.bind(this)
            }));
            
            // Add text layer to display beauty scores on points
            let TextLayer;
            if (window.deck && window.deck.TextLayer) {
                TextLayer = window.deck.TextLayer;
                
                layers.push(new TextLayer({
                    id: 'point-labels',
                    data: this.pointData,
                    getPosition: d => [parseFloat(d.lng), parseFloat(d.lat)],
                    getText: d => parseFloat(d.beauty).toFixed(1),
                    getSize: 14,
                    getColor: [255, 255, 255, 255],
                    getAngle: 0,
                    getTextAnchor: 'middle',
                    getAlignmentBaseline: 'center',
                    fontFamily: 'Arial, sans-serif',
                    fontWeight: 'bold',
                    outlineWidth: 2,
                    outlineColor: [0, 0, 0, 255],
                    pickable: false
                }));
            }
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
            if (this.showHeatmap && this.heatData.length > 0) {
                mode = 'Heatmap';
                modeColor = '#ff6b35'; // Orange for heatmap
            } else {
                mode = 'Heatmap (No Data)';
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
            <div>Zoom: ${zoom.toFixed(1)} | Threshold: &lt;${CONFIG.HEATMAP_ZOOM_THRESHOLD}</div>
            <div style="color: ${modeColor}">Mode: ${mode}</div>
            <div style="font-size: 11px; opacity: 0.8;">Heat: ${this.heatData.length} | Points: ${this.pointData.length}</div>
        `;
    }
    
    getBeautyColor(beauty) {
        const score = Math.round(Math.max(1, Math.min(10, beauty || 5)));
        return CONFIG.BEAUTY_COLORS[score] || [128, 128, 128, 180];
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