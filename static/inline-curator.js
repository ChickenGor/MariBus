import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const OWNER_EMAIL = 'chickendevstu@gmail.com';
const $ = selector => document.querySelector(selector);
let map, db, user, drawing = false, points = [], line, markers = [], routeId;

function status(message) { $('#inline-curator-status').textContent = message; }
function clearDrawing() {
  drawing = false;
  points = [];
  line?.remove(); line = null;
  markers.forEach(marker => marker.remove()); markers = [];
  $('#inline-curator-draw').textContent = 'Draw walking leg';
}
function redraw() {
  line?.remove();
  if (points.length > 1) line = L.polyline(points, { color:'#0f766e', weight:6, opacity:.9 }).addTo(map);
  markers.forEach(marker => marker.remove());
  markers = points.map((point, index) => L.circleMarker(point, { radius:index ? 4 : 7, color:'#fff', weight:2, fillColor:'#0f766e', fillOpacity:1 }).addTo(map));
}
function setOpen(open) {
  $('#inline-curator').hidden = !open;
  $('#curate-route-main').setAttribute('aria-expanded', String(open));
  $('#curate-route-main').classList.toggle('active', open);
  if (!open) clearDrawing();
}
function startDrawing() {
  drawing = !drawing;
  if (drawing) {
    status('Tap the map to add points. Press Finish walking leg when done.');
    $('#inline-curator-draw').textContent = 'Finish walking leg';
  } else if (points.length < 2) {
    status('Add at least two points to save a walking leg.');
  } else {
    status(`${points.length} walking points ready to save.`);
    $('#inline-curator-draw').textContent = 'Edit walking leg';
  }
}
async function save(publish) {
  const name = $('#inline-curator-name').value.trim();
  if (!name) return status('Enter a route name first.');
  if (points.length < 2) return status('Draw at least two points for the walking leg.');
  if (!db || !user) return status('Your curator sign-in is still loading.');
  try {
    const id = routeId || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'route'}-${Date.now().toString(36)}`;
    await setDoc(doc(db, 'curatedRoutes', id), {
      title:name,
      status:publish ? 'published' : 'draft',
      ownerUid:user.uid,
      walkingLeg:{ points:points.map(([lat,lng]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]) },
      start:{ lat:points[0][0], lng:points[0][1] },
      destination:{ lat:points.at(-1)[0], lng:points.at(-1)[1] },
      updatedAt:serverTimestamp(),
      ...(routeId ? {} : { createdAt:serverTimestamp() }),
    }, { merge:true });
    routeId = id;
    $('#inline-curator-publish').hidden = false;
    status(publish ? 'Route published.' : 'Draft saved. Review it, then publish when ready.');
  } catch (error) {
    console.error('Could not save curated route', error);
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
    if (user?.email?.toLowerCase() !== OWNER_EMAIL) return status('Sign in with the owner account to curate routes.');
    setOpen($('#inline-curator').hidden);
  });
  $('#inline-curator-draw').addEventListener('click', startDrawing);
  $('#inline-curator-save').addEventListener('click', () => save(false));
  $('#inline-curator-publish').addEventListener('click', () => save(true));
  $('#inline-curator-close').addEventListener('click', () => setOpen(false));
  map.on('click', event => {
    if (!drawing) return;
    points.push([event.latlng.lat, event.latlng.lng]);
    redraw();
    status(`${points.length} point${points.length === 1 ? '' : 's'} added. Continue drawing or finish.`);
  });
}

if (window.__mariBusMap) initialize();
else window.addEventListener('maribus-map-ready', initialize, { once:true });
