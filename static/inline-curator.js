import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getFirestore, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $ = selector => document.querySelector(selector);
let map, db, drawing = false, points = [], line, referenceLine, markers = [], pathId;
const networkEndpoints = [];
const networkSegments = [];
const networkLayers = [];

function status(message) { $('#inline-curator-status').textContent = message; }
function isPointFeature() { return ['mall_entrance', 'mall_exit'].includes($('#inline-curator-type').value); }
function minimumPoints() { return isPointFeature() ? 1 : 2; }
function pathStyle(type) {
  const styles = {
    footpath:{ color:'#67bfc4', weight:8 },
    covered_walkway:{ color:'#187d86', weight:9 },
    pedestrian_bridge:{ color:'#2563eb', weight:10 },
    stairs:{ color:'#f59e0b', weight:9 },
    escalator:{ color:'#8b5cf6', weight:9 },
    mall_entrance:{ color:'#d81b76', weight:8 },
    mall_exit:{ color:'#d81b76', weight:8 },
    mall:{ color:'#0f766e', weight:9 }, station:{ color:'#475569', weight:9 }, shortcut:{ color:'#22c55e', weight:8 },
  };
  return styles[type] || styles.footpath;
}
function clearDrawing() {
  drawing = false;
  points = [];
  line?.remove(); line = null;
  referenceLine?.remove(); referenceLine = null;
  markers.forEach(marker => marker.remove()); markers = [];
  $('#inline-curator-draw').textContent = 'Start drawing';
  $('#inline-curator-add-point').hidden = true;
  $('#inline-curator-delete').hidden = true;
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
  const style = pathStyle($('#inline-curator-type').value);
  if (points.length > 1) line = L.polyline(points, { ...style, opacity:.95 }).addTo(map);
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
function selectNetworkPath(id, data) {
  points = (data.points || []).map(asPoint).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!points.length) return;
  pathId = id;
  $('#inline-curator-delete').hidden = false;
  $('#inline-curator-name').value = data.name || '';
  $('#inline-curator-type').value = data.pathType || 'footpath';
  drawing = false;
  redraw();
  status('Path selected. Adjust points or type, then Publish path to save your changes.');
}
function drawNetworkPath(data, id = '') {
  const pathPoints = (data.points || []).map(asPoint).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!pathPoints.length) return;
  const style = pathStyle(data.pathType);
  if (pathPoints.length > 1) {
    const pathLine = L.polyline(pathPoints, { ...style, opacity:.78 }).addTo(map);
    pathLine.native?.addListener?.('click', () => selectNetworkPath(id, data));
    networkLayers.push(pathLine);
    for (let index = 1; index < pathPoints.length; index += 1) networkSegments.push([pathPoints[index - 1], pathPoints[index]]);
  }
  const endpoints = pathPoints.length === 1 ? pathPoints : [pathPoints[0], pathPoints.at(-1)];
  endpoints.forEach(point => {
    networkEndpoints.push(point);
    const endpoint = L.circleMarker(point, { radius:7, color:'#fff', weight:2, fillColor:style.color, fillOpacity:1 }).addTo(map);
    endpoint.native?.addListener?.('click', () => selectNetworkPath(id, data));
    networkLayers.push(endpoint);
  });
}
function clearWalkingPathNetwork() {
  networkLayers.forEach(layer => layer.remove?.());
  networkLayers.length = 0;
  networkEndpoints.length = 0;
  networkSegments.length = 0;
}
async function loadWalkingPathNetwork(refresh = false) {
  try {
    if (refresh) clearWalkingPathNetwork();
    const snapshot = await getDocs(collection(db, 'walkingPaths'));
    window.__mariBusWalkingPaths = snapshot.docs.map(item => ({ id:item.id, ...item.data() }));
    window.dispatchEvent(new Event('maribus-walking-paths-ready'));
    snapshot.forEach(item => drawNetworkPath(item.data(), item.id));
    if (refresh && !drawing) status(snapshot.size ? `${snapshot.size} saved path${snapshot.size === 1 ? '' : 's'} ready to connect.` : 'No saved paths found yet.');
  } catch (error) {
    console.warn('Could not load walking path network', error);
    if (refresh && !drawing) status(`Could not load saved paths (${error?.code || 'unknown error'}).`);
  }
}
function snapToNetwork(point) {
  let closest = null, closestDistance = 80;
  networkEndpoints.forEach(endpoint => {
    const distance = distanceMetres(point, endpoint);
    if (distance < closestDistance) { closest = endpoint; closestDistance = distance; }
  });
  networkSegments.forEach(([start, end]) => {
    const latitudeScale = 111320;
    const longitudeScale = latitudeScale * Math.cos(((start[0] + end[0] + point[0]) / 3) * Math.PI / 180);
    const ax = start[1] * longitudeScale, ay = start[0] * latitudeScale;
    const bx = end[1] * longitudeScale, by = end[0] * latitudeScale;
    const px = point[1] * longitudeScale, py = point[0] * latitudeScale;
    const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
    const ratio = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSquared)) : 0;
    const candidate = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
    const distance = distanceMetres(point, candidate);
    if (distance < closestDistance) { closest = candidate; closestDistance = distance; }
  });
  return closest ? { point:[...closest], distance:Math.round(closestDistance) } : null;
}
function previewConnection() {
  // Keep the centre target static. The confirmed point snaps when Add point is pressed.
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
    previewConnection();
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
    ? `Connected to the existing path (${snapped.distance} m away).`
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
    clearDrawing();
    $('#inline-curator-name').value = '';
    // The route planner reads this shared in-memory list. Reload after every
    // save so a contribution is immediately eligible for a new journey search,
    // not merely visible as a line on the editor map.
    await loadWalkingPathNetwork(true);
    status('Walking path published and ready for route searches. You can now draw another path.');
  } catch (error) {
    console.error('Could not save walking path', error);
    const reason = error?.code || error?.message || 'unknown error';
    status(`Could not save (${reason}). Please try again.`);
  }
}
async function deleteSelectedPath() {
  if (!pathId) return status('Select a saved path first.');
  if (!confirm('Delete this walking path? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'walkingPaths', pathId));
    clearDrawing();
    pathId = undefined;
    $('#inline-curator-name').value = '';
    await loadWalkingPathNetwork(true);
    status('Walking path deleted.');
  } catch (error) {
    console.error('Could not delete walking path', error);
    status(`Could not delete (${error?.code || error?.message || 'unknown error'}).`);
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
  $('#inline-curator-delete').addEventListener('click', deleteSelectedPath);
  $('#inline-curator-close').addEventListener('click', () => setOpen(false));
  $('#inline-curator-type').addEventListener('change', redraw);
  map.native?.addListener?.('idle', previewConnection);
}

if (window.__mariBusMap) initialize();
else window.addEventListener('maribus-map-ready', initialize, { once:true });
