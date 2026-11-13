import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const OWNER_EMAIL = 'chickendevstu@gmail.com';
const $ = selector => document.querySelector(selector);
let map, db, user, drawing = false, points = [], line, referenceLine, markers = [], pathId;

function status(message) { $('#inline-curator-status').textContent = message; }
function clearDrawing() {
  drawing = false;
  points = [];
  line?.remove(); line = null;
  referenceLine?.remove(); referenceLine = null;
  markers.forEach(marker => marker.remove()); markers = [];
  $('#inline-curator-draw').textContent = 'Start drawing';
  $('#inline-curator-undo').disabled = true;
  $('#inline-curator-reference').disabled = true;
  $('#inline-curator').classList.remove('drawing');
  map?.native?.setOptions?.({ draggable:true });
}
function redraw() {
  line?.remove();
  if (points.length > 1) line = L.polyline(points, { color:'#0f766e', weight:6, opacity:.9 }).addTo(map);
  markers.forEach(marker => marker.remove());
  markers = points.map((point, index) => L.circleMarker(point, { radius:index ? 4 : 7, color:'#fff', weight:2, fillColor:index === 0 ? '#2563eb' : index === points.length - 1 ? '#d81b76' : '#0f766e', fillOpacity:1 }).addTo(map));
  $('#inline-curator-undo').disabled = points.length === 0;
  $('#inline-curator-reference').disabled = points.length < 2;
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
    if (!response.ok || !encoded || !window.google?.maps?.geometry) throw new Error('No walking reference');
    const roadPoints = google.maps.geometry.encoding.decodePath(encoded).map(point => [point.lat(), point.lng()]);
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
  $('#curate-route-main').setAttribute('aria-expanded', String(open));
  $('#curate-route-main').classList.toggle('active', open);
  if (!open) { clearDrawing(); pathId = undefined; }
}
function startDrawing() {
  drawing = !drawing;
  $('#inline-curator').classList.toggle('drawing', drawing);
  map?.native?.setOptions?.({ draggable:!drawing });
  if (drawing) {
    status('Tap start, each turn, then the end. Press Finish drawing when done.');
    $('#inline-curator-draw').textContent = 'Finish drawing';
  } else if (points.length < 2) {
    status('Add at least two points to save a walking path.');
    $('#inline-curator-draw').textContent = 'Start drawing';
  } else {
    status(`${points.length} walking points ready to save.`);
    $('#inline-curator-draw').textContent = 'Edit path';
  }
}
async function save(publish) {
  const name = $('#inline-curator-name').value.trim();
  if (points.length < 2) return status('Draw at least two points for the walking path.');
  if (!db || !user) return status('Your curator sign-in is still loading.');
  try {
    const id = pathId || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'walking-path'}-${Date.now().toString(36)}`;
    await setDoc(doc(db, 'walkingPaths', id), {
      name:name || 'Unnamed walking path',
      pathType:$('#inline-curator-type').value,
      status:publish ? 'published' : 'draft',
      ownerUid:user.uid,
      points:points.map(([lat,lng]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]),
      start:{ lat:points[0][0], lng:points[0][1] },
      destination:{ lat:points.at(-1)[0], lng:points.at(-1)[1] },
      updatedAt:serverTimestamp(),
      ...(pathId ? {} : { createdAt:serverTimestamp() }),
    }, { merge:true });
    pathId = id;
    $('#inline-curator-publish').hidden = false;
    status(publish ? 'Walking path published.' : 'Draft saved. Review it, then publish when ready.');
  } catch (error) {
    console.error('Could not save walking path', error);
    status('Could not save. Check your curator sign-in and try again.');
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
    const auth = getAuth(firebaseApp); db = getFirestore(firebaseApp);
    onAuthStateChanged(auth, currentUser => {
      user = currentUser;
      const allowed = currentUser?.email?.toLowerCase() === OWNER_EMAIL;
      if (!allowed) setOpen(false);
    });
  } catch (error) { console.warn('Inline curator unavailable', error); }

  $('#curate-route-main').addEventListener('click', () => {
    if (user?.email?.toLowerCase() !== OWNER_EMAIL) return status('Sign in with the owner account to add walking paths.');
    setOpen($('#inline-curator').hidden);
  });
  $('#inline-curator-draw').addEventListener('click', startDrawing);
  $('#inline-curator-reference').addEventListener('click', showGoogleWalkingReference);
  $('#inline-curator-undo').addEventListener('click', () => {
    if (!points.length) return;
    points.pop(); redraw();
    status(points.length ? `${points.length} point${points.length === 1 ? '' : 's'} remaining.` : 'All points removed.');
  });
  $('#inline-curator-save').addEventListener('click', () => save(false));
  $('#inline-curator-publish').addEventListener('click', () => save(true));
  $('#inline-curator-close').addEventListener('click', () => setOpen(false));
  map.on('click', event => {
    if (!drawing) return;
    const lat = event.latlng?.lat ?? event.latLng?.lat?.();
    const lng = event.latlng?.lng ?? event.latLng?.lng?.();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    points.push([lat, lng]);
    redraw();
    status(`${points.length} point${points.length === 1 ? '' : 's'} added. Continue drawing or finish.`);
  });
}

if (window.__mariBusMap) initialize();
else window.addEventListener('maribus-map-ready', initialize, { once:true });
