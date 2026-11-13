import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getFirestore, collection, doc, getDocs, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $ = selector => document.querySelector(selector);
let map, db, drawing = false, points = [], line, referenceLine, markers = [], pathId;
const networkEndpoints = [];
const networkLayers = [];

function status(message) { $('#inline-curator-status').textContent = message; }
function isPointFeature() { return ['mall_entrance', 'mall_exit'].includes($('#inline-curator-type').value); }
function minimumPoints() { return isPointFeature() ? 1 : 2; }
function clearDrawing() {
  drawing = false;
  points = [];
  line?.remove(); line = null;
  referenceLine?.remove(); referenceLine = null;
  markers.forEach(marker => marker.remove()); markers = [];
  $('#inline-curator-draw').textContent = 'Start drawing';
  $('#inline-curator-add-point').hidden = true;
  $('#inline-curator-undo').disabled = true;
  $('#inline-curator-reference').disabled = true;
  $('#inline-curator').classList.remove('drawing');
  document.body.classList.remove('drawing-walking-path');
  map?.native?.setOptions?.({ draggable:true });
}
function decodePolyline(encoded) {
  let index = 0, lat = 0, lng = 0; const coordinates = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lat / 1e5, lng / 1e5]);
  }
  return coordinates;
}
function redraw() {
  line?.remove();
  if (points.length > 1) line = L.polyline(points, { color:'#0f766e', weight:6, opacity:.9 }).addTo(map);
  markers.forEach(marker => marker.remove());
  markers = points.map((point, index) => L.circleMarker(point, { radius:index ? 4 : 7, color:'#fff', weight:2, fillColor:index === 0 ? '#2563eb' : index === points.length - 1 ? '#d81b76' : '#0f766e', fillOpacity:1 }).addTo(map));
  $('#inline-curator-undo').disabled = points.length === 0;
  $('#inline-curator-reference').disabled = points.length < 2 || isPointFeature();
}
function asPoint(value) {
  if (Array.isArray(value)) return [Number(value[0]), Number(value[1])];
  return [Number(value?.lat), Number(value?.lng)];
}
function distanceMetres(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const earth = 6371000, dLat = toRadians(b[0] - a[0]), dLng = toRadians(b[1] - a[1]);
  const part = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(part), Math.sqrt(1 - part));
}
function drawNetworkPath(data) {
  const pathPoints = (data.points || []).map(asPoint).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!pathPoints.length) return;
  if (pathPoints.length > 1) networkLayers.push(L.polyline(pathPoints, { color:'#0f766e', weight:5, opacity:.64 }).addTo(map));
  const endpoints = pathPoints.length === 1 ? pathPoints : [pathPoints[0], pathPoints.at(-1)];
  endpoints.forEach(point => {
    networkEndpoints.push(point);
    networkLayers.push(L.circleMarker(point, { radius:6, color:'#fff', weight:2, fillColor:'#7c3aed', fillOpacity:1 }).addTo(map));
  });
}
function clearWalkingPathNetwork() {
  networkLayers.forEach(layer => layer.remove?.());
  networkLayers.length = 0;
  networkEndpoints.length = 0;
}
async function loadWalkingPathNetwork(refresh = false) {
  try {
    if (refresh) clearWalkingPathNetwork();
    const snapshot = await getDocs(collection(db, 'walkingPaths'));
    snapshot.forEach(item => drawNetworkPath(item.data()));
  } catch (error) {
    console.warn('Could not load walking path network', error);
  }
}
function snapToNetwork(point) {
  let closest = null, closestDistance = 25;
  networkEndpoints.forEach(endpoint => {
    const distance = distanceMetres(point, endpoint);
    if (distance < closestDistance) { closest = endpoint; closestDistance = distance; }
  });
  return closest ? { point:[...closest], distance:Math.round(closestDistance) } : null;
}
async function showGoogleWalkingReference() {
  if (points.length < 2) return status('Add a start and end point first.');
  status('Finding Google’s available walking road…');
  try {
    const response = await fetch('/api/directions', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      origin:{lat:points[0][0],lng:points[0][1]}, destination:{lat:points.at(-1)[0],lng:points.at(-1)[1]}, travel_mode:'WALK'
    }) });
    const data = await response.json();
    const encoded = data.routes?.[0]?.polyline?.encodedPolyline;
    if (!response.ok || !encoded) throw new Error('No walking reference');
    const roadPoints = decodePolyline(encoded);
    referenceLine?.remove();
    referenceLine = L.polyline(roadPoints, { color:'#64748b', weight:5, opacity:.78, dashArray:'8 8' }).addTo(map);
    status('Dashed grey line: Google walking route. Green line: your added path.');
  } catch (error) {
    console.warn('Google walking reference unavailable', error);
    status('Google has no usable walking reference here. You can still draw the real path.');
  }
}
function setOpen(open) {
  $('#inline-curator').hidden = !open;
  document.body.classList.toggle('walking-path-editing', open);
  $('#curate-route-main').setAttribute('aria-expanded', String(open));
  $('#curate-route-main').classList.toggle('active', open);
  if (open && db) void loadWalkingPathNetwork(true);
  if (!open) { clearDrawing(); pathId = undefined; }
}
function startDrawing() {
  drawing = !drawing;
  $('#inline-curator').classList.toggle('drawing', drawing);
  document.body.classList.toggle('drawing-walking-path', drawing);
  map?.native?.setOptions?.({ draggable:true });
  if (drawing) {
    status('Move the map until the centre target is on the path, then press Add point.');
    $('#inline-curator-draw').textContent = 'Finish drawing';
    $('#inline-curator-add-point').hidden = false;
  } else if (points.length < minimumPoints()) {
    status(isPointFeature() ? 'Add the entrance or exit point first.' : 'Add at least two points to save a walking path.');
    $('#inline-curator-draw').textContent = 'Start drawing';
    $('#inline-curator-add-point').hidden = true;
  } else {
    status(`${points.length} walking points ready to save.`);
    $('#inline-curator-draw').textContent = 'Edit path';
    $('#inline-curator-add-point').hidden = true;
  }
}
function addPointAtMapCentre() {
  if (!drawing) return;
  const centre = map?.native?.getCenter?.();
  const lat = centre?.lat?.(), lng = centre?.lng?.();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return status('Map location is still loading. Try again in a moment.');
  const snapped = snapToNetwork([lat, lng]);
  points.push(snapped?.point || [lat, lng]); redraw();
  status(snapped
    ? `Connected to an existing path endpoint (${snapped.distance} m away).`
    : `${points.length} point${points.length === 1 ? '' : 's'} added. Move the map and add another point, or finish drawing.`);
}
async function save() {
  const name = $('#inline-curator-name').value.trim();
  if (points.length < minimumPoints()) return status(isPointFeature() ? 'Add the entrance or exit point first.' : 'Draw at least two points for the walking path.');
  if (!db) return status('Map contributions are still loading. Try again in a moment.');
  try {
    const id = pathId || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'walking-path'}-${Date.now().toString(36)}`;
    await setDoc(doc(db, 'walkingPaths', id), {
      name:name || 'Unnamed walking path',
      pathType:$('#inline-curator-type').value,
      status:'published',
      // Firestore does not support nested arrays, so each coordinate is stored
      // as a named object instead of [lat, lng].
      points:points.map(([lat,lng]) => ({ lat:Number(lat.toFixed(6)), lng:Number(lng.toFixed(6)) })),
      start:{ lat:points[0][0], lng:points[0][1] },
      destination:{ lat:points.at(-1)[0], lng:points.at(-1)[1] },
      updatedAt:serverTimestamp(),
      ...(pathId ? {} : { createdAt:serverTimestamp() }),
    }, { merge:true });
    // Public contributors can create paths but cannot overwrite an already
    // published path. Reset so the next contribution always gets a new ID.
    pathId = undefined;
    drawNetworkPath({ points });
    clearDrawing();
    $('#inline-curator-name').value = '';
    status('Walking path published. You can now draw another path.');
  } catch (error) {
    console.error('Could not save walking path', error);
    const reason = error?.code || error?.message || 'unknown error';
    status(`Could not save (${reason}). Please try again.`);
  }
}

async function initialize() {
  map = window.__mariBusMap;
  if (!map) return;
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!config.firebase_enabled) throw new Error('Firebase unavailable');
    const firebaseApp = getApps()[0] || initializeApp(config.firebase_config);
    db = getFirestore(firebaseApp);
    await loadWalkingPathNetwork();
  } catch (error) { console.warn('Inline curator unavailable', error); }

  $('#curate-route-main').addEventListener('click', () => {
    setOpen($('#inline-curator').hidden);
  });
  $('#inline-curator-draw').addEventListener('click', startDrawing);
  $('#inline-curator-add-point').addEventListener('click', addPointAtMapCentre);
  $('#inline-curator-reference').addEventListener('click', showGoogleWalkingReference);
  $('#inline-curator-undo').addEventListener('click', () => {
    if (!points.length) return;
    points.pop(); redraw();
    status(points.length ? `${points.length} point${points.length === 1 ? '' : 's'} remaining.` : 'All points removed.');
  });
  $('#inline-curator-save').addEventListener('click', save);
  $('#inline-curator-close').addEventListener('click', () => setOpen(false));
  $('#inline-curator-type').addEventListener('change', redraw);
}

if (window.__mariBusMap) initialize();
else window.addEventListener('maribus-map-ready', initialize, { once:true });
