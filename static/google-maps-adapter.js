(async function () {
    const apiOrigin = location.protocol === 'file:' ? 'http://localhost:5000' : location.origin;

    function showSetupMessage(message) {
        window.googleMapsLoadError = message;
        document.addEventListener('DOMContentLoaded', () => {
            const mapElement = document.getElementById('map');
            if (mapElement) mapElement.innerHTML = `<div class="map-setup-message"><strong>Google Maps setup required</strong><span>${message}</span></div>`;
        });
    }

    let config;
    try {
        const response = await fetch(`${apiOrigin}/api/config`);
        config = await response.json();
    } catch (error) {
        showSetupMessage(`Cannot reach ${apiOrigin}. Start the MariBus backend first.`);
        return;
    }
    if (!config.google_maps_enabled) {
        showSetupMessage('Set GOOGLE_MAPS_API_KEY before starting MariBus.');
        return;
    }
    window.MARIBUS_CONFIG = config;

    await new Promise((resolve, reject) => {
        window.__mariBusGoogleReady = resolve;
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.google_maps_api_key)}&callback=__mariBusGoogleReady&loading=async&libraries=places,geometry`;
        script.async = true;
        script.onerror = () => reject(new Error('Google Maps failed to load'));
        document.head.appendChild(script);
    }).catch(error => showSetupMessage(error.message));
    if (!window.google?.maps) return;

    await new Promise(resolve => {
        if (window.markerClusterer?.MarkerClusterer) return resolve();
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js';
        script.onload = resolve;
        script.onerror = resolve; // The map still works without clustering.
        document.head.appendChild(script);
    });

    class BoundsWrapper {
        constructor(points) {
            this.native = new google.maps.LatLngBounds();
            (points || []).forEach(point => this.extend(point));
        }
        extend(point) {
            const value = Array.isArray(point)
                ? { lat:Number(point[0]), lng:Number(point[1]) }
                : point instanceof LatLngWrapper ? point.native : point?.native || point;
            if (value) this.native.extend(value);
            return this;
        }
    }

    class LatLngWrapper {
        constructor(value) {
            this.native = value;
            this.lat = typeof value.lat === 'function' ? value.lat() : value.lat;
            this.lng = typeof value.lng === 'function' ? value.lng() : value.lng;
        }
    }

    class MapWrapper {
        constructor(elementId, options) {
            this.native = new google.maps.Map(document.getElementById(elementId), {
                center: { lat: 3.139, lng: 101.6869 }, zoom: 12,
                mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
                zoomControl: options?.zoomControl !== false,
                gestureHandling: 'greedy',
            });
            this.locationHandlers = {};
        }
        setView(point, zoom) { this.native.setCenter({ lat:Number(point[0]), lng:Number(point[1]) }); if (zoom != null) this.native.setZoom(zoom); return this; }
        addLayer(layer) { layer.addTo(this); return this; }
        removeLayer(layer) { layer.remove(); return this; }
        flyTo(point, zoom) { return this.setView(point, zoom); }
        fitBounds(bounds, options) { const padding = Array.isArray(options?.padding) ? Math.max(...options.padding) : options?.padding || 40; this.native.fitBounds(bounds.native || bounds, padding); if (options?.maxZoom) google.maps.event.addListenerOnce(this.native, 'idle', () => { if (this.native.getZoom() > options.maxZoom) this.native.setZoom(options.maxZoom); }); }
        flyToBounds(bounds, options) { this.fitBounds(bounds, options); }
        on(event, handler) { this.locationHandlers[event] = handler; return this; }
        locate(options) {
            if (!navigator.geolocation) return this.locationHandlers.locationerror?.({ message:'Geolocation unavailable' });
            navigator.geolocation.getCurrentPosition(position => {
                const latlng = new LatLngWrapper({ lat:position.coords.latitude, lng:position.coords.longitude });
                if (options?.setView) this.setView([latlng.lat, latlng.lng], options.maxZoom || 15);
                this.locationHandlers.locationfound?.({ latlng, accuracy:position.coords.accuracy });
            }, error => this.locationHandlers.locationerror?.(error), { enableHighAccuracy:true, timeout:10000 });
        }
    }

    class MarkerWrapper {
        constructor(point, options = {}) {
            this.point = { lat:Number(point[0]), lng:Number(point[1]) };
            this.options = options;
            this.native = null;
            this.popupHtml = '';
            this.clickHandlers = [];
        }
        addTo(target) { if (target instanceof LayerGroup) { target.addLayer(this); return this; } this.attach(target.native || target); return this; }
        attach(nativeMap) {
            if (this.native) { this.native.setMap(nativeMap); return; }
            const text = this.options.icon?.text || '';
            const isStop = this.options.icon?.kind === 'stop';
            const markerColor = this.options.icon?.color || '#2563eb';
            const pillWidth = Math.max(46, Math.min(104, text.length * 8 + 22));
            const pillSvg = text ? `<svg xmlns="http://www.w3.org/2000/svg" width="${pillWidth}" height="34" viewBox="0 0 ${pillWidth} 34"><rect x="1" y="1" width="${pillWidth - 2}" height="32" rx="16" fill="${markerColor}" stroke="white" stroke-width="2"/><text x="50%" y="22" text-anchor="middle" font-family="Manrope,Arial,sans-serif" font-size="12" font-weight="800" fill="white">${String(text).replace(/[&<>"']/g, '')}</text></svg>` : '';
            this.native = new google.maps.Marker({
                map:nativeMap, position:this.point,
                icon: isStop ? { path:google.maps.SymbolPath.CIRCLE, scale:7, fillColor:'#ffffff', fillOpacity:1, strokeColor:this.options.icon?.color || '#2563eb', strokeWeight:4 }
                    : text ? { url:`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pillSvg)}`, scaledSize:new google.maps.Size(pillWidth, 34), anchor:new google.maps.Point(pillWidth / 2, 17) }
                    : undefined,
                title:this.options.title || '',
            });
            this.native.addListener('click', () => { this.openPopup(); this.clickHandlers.forEach(handler => handler()); });
        }
        bindPopup(html) { this.popupHtml = html; return this; }
        bindTooltip(text) { this.options.title = String(text).replace(/<[^>]*>/g, ''); if (this.native) this.native.setTitle(this.options.title); return this; }
        openPopup() { if (!this.native || !this.popupHtml) return; window.__mariBusInfoWindow.setContent(this.popupHtml); window.__mariBusInfoWindow.open({ map:this.native.getMap(), anchor:this.native }); }
        getLatLng() { return new LatLngWrapper(this.native ? this.native.getPosition() : this.point); }
        on(event, handler) { if (event === 'click') this.clickHandlers.push(handler); return this; }
        remove() { if (this.native) this.native.setMap(null); }
    }

    class CircleWrapper extends MarkerWrapper {
        constructor(point, options = {}) { super([point.lat ?? point[0], point.lng ?? point[1]], { icon:{ kind:'stop' }, title:options.title }); }
    }

    class PolylineWrapper {
        constructor(points, options) { this.points = points; this.options = options; this.native = null; }
        addTo(target) { const nativeMap = target.native || target.map?.native || target; this.native = new google.maps.Polyline({ map:nativeMap, path:this.points.map(p => ({lat:Number(p[0]),lng:Number(p[1])})), strokeColor:this.options.color, strokeWeight:this.options.weight, strokeOpacity:this.options.opacity }); if (target instanceof LayerGroup) target.items.push(this); return this; }
        getBounds() { return new BoundsWrapper(this.points.map(p => ({lat:Number(p[0]),lng:Number(p[1])}))); }
        remove() { if (this.native) this.native.setMap(null); }
    }

    class LayerGroup {
        constructor() { this.items=[]; this.map=null; }
        addTo(map) { this.map=map; this.items.forEach(item => item.attach ? item.attach(map.native) : item.addTo(map)); return this; }
        addLayer(item) { this.items.push(item); if (this.map) item.attach ? item.attach(this.map.native) : item.addTo(this.map); return this; }
        addLayers(items) { items.forEach(item => this.addLayer(item)); }
        clearLayers() { this.items.forEach(item => item.remove()); this.items=[]; }
        remove() { this.clearLayers(); }
        zoomToShowLayer(marker, callback) { if (this.map) { this.map.native.setCenter(marker.native.getPosition()); this.map.native.setZoom(16); } if (callback) callback(); }
    }

    class MarkerClusterLayer extends LayerGroup {
        constructor(options = {}) { super(); this.options = options; this.clusterer = null; }
        renderer() {
            return {
                render:({ count, position }) => {
                    const size = count > 99 ? 52 : count > 9 ? 46 : 40;
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="50%" cy="50%" r="48%" fill="#4f46e5" stroke="white" stroke-width="3"/><text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="Manrope,Arial,sans-serif" font-size="14" font-weight="800" fill="white">${count}</text></svg>`;
                    return new google.maps.Marker({
                        position,
                        icon:{ url:`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize:new google.maps.Size(size, size), anchor:new google.maps.Point(size / 2, size / 2) },
                        zIndex:Number(google.maps.Marker.MAX_ZINDEX) + count,
                        title:`${count} buses`,
                    });
                },
            };
        }
        addTo(map) {
            this.map = map;
            this.items.forEach(item => item.attach(null));
            if (window.markerClusterer?.MarkerClusterer) {
                this.clusterer = new markerClusterer.MarkerClusterer({
                    map:map.native, markers:this.items.map(item => item.native), renderer:this.renderer(),
                });
            } else {
                this.items.forEach(item => item.attach(map.native));
            }
            return this;
        }
        addLayer(item) {
            this.items.push(item);
            item.attach(null);
            if (this.clusterer) this.clusterer.addMarker(item.native);
            else if (this.map) item.attach(this.map.native);
            return this;
        }
        clearLayers() {
            if (this.clusterer) this.clusterer.clearMarkers();
            this.items.forEach(item => item.remove());
            this.items = [];
        }
    }

    function textFromIconHtml(html) {
        const holder = document.createElement('div'); holder.innerHTML = html || '';
        return holder.querySelector('.route-pill')?.textContent?.trim() || '';
    }

    window.__mariBusInfoWindow = new google.maps.InfoWindow();
    window.L = {
        map:(id, options) => new MapWrapper(id, options),
        control:{ zoom:() => ({ addTo:() => {} }) },
        tileLayer:() => ({ addTo:() => ({}) }),
        markerClusterGroup:options => new MarkerClusterLayer(options),
        layerGroup:() => new LayerGroup(),
        divIcon:options => {
            const html = options.html || '';
            const inlineColor = html.match(/(?:border-color|background-color):\s*(#[0-9a-f]{6})/i)?.[1];
            const color = inlineColor || (html.includes('mrtfeeder-pill') ? '#f60404'
                : html.includes('mybas-pill') ? '#f93999'
                : html.includes('rapid-pill') ? '#f60404'
                : undefined);
            return { text:textFromIconHtml(html), kind:html.includes('stop-marker') ? 'stop' : 'vehicle', color };
        },
        marker:(point, options) => new MarkerWrapper(point, options),
        circleMarker:(point, options) => new CircleWrapper(point, options),
        polyline:(points, options) => new PolylineWrapper(points, options),
        latLngBounds:points => new BoundsWrapper(points.map(point => point instanceof LatLngWrapper ? point.native : point)),
        featureGroup:markers => ({ getBounds:() => new BoundsWrapper(markers.map(marker => marker.getLatLng().native)) }),
        point:(x, y) => ({x, y}),
    };
    window.dispatchEvent(new Event('google-maps-ready'));
})();
