import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const CURATOR_EMAIL = 'chickendevstu@gmail.com';
const $ = selector => document.querySelector(selector);
const status = $('#curator-status');
const legs = [];
let map;
let walkingPoints = [];
let walkingLine;
let drawingWalk = false;
let db;
let user;

function showStatus(message, kind = '') {
  status.textContent = message;
  status.className = `auth-message ${kind}`;
}

function routeId() {
  const title = $('#route-name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${title || 'curated-route'}-${Date.now().toString(36)}`;
}

function renderLegs() {
  const target = $('#route-legs');
  if (!legs.length) {
    target.innerHTML = '<li class="empty">No legs yet.</li>';
    return;
  }
  target.innerHTML = legs.map((leg, index) => {
    const copy = leg.type === 'walk'
      ? `Walk · ${leg.points.length} drawn points`
      : `${leg.line} · ${leg.from || 'boarding stop'} → ${leg.to || 'alighting stop'} · ${leg.minutes} min`;
    return `<li><span><strong>${leg.type === 'walk' ? 'Walk' : 'Transit'}</strong><small>${copy}</small></span><button type="button" data-remove-leg="${index}" aria-label="Remove leg">×</button></li>`;
  }).join('');
  target.querySelectorAll('[data-remove-leg]').forEach(button => button.addEventListener('click', () => {
    legs.splice(Number(button.dataset.removeLeg), 1);
    renderLegs();
  }));
}

function resetWalkingLine() {
  walkingPoints = [];
  if (walkingLine) map.removeLayer(walkingLine);
  walkingLine = null;
}

function startWalkingLeg() {
  resetWalkingLine();
  drawingWalk = true;
  $('#start-walk').disabled = true;
  $('#finish-walk').disabled = false;
  $('#draw-help').textContent = 'Tap every turn of the real pedestrian path. Use Finish walking leg when complete.';
}

function finishWalkingLeg() {
  if (walkingPoints.length < 2) {
    showStatus('Draw at least two points for a walking leg.', 'error');
    return;
  }
  legs.push({ type:'walk', points:walkingPoints, minutes:null });
  drawingWalk = false;
  walkingLine = null;
  walkingPoints = [];
  $('#start-walk').disabled = false;
  $('#finish-walk').disabled = true;
  $('#draw-help').textContent = 'Walking leg added. Draw another one or add a transport leg.';
  renderLegs();
}

function addTransitLeg() {
  const line = $('#transit-line').value.trim();
  const minutes = Number($('#transit-minutes').value);
  if (!line || !Number.isFinite(minutes) || minutes < 1) {
    showStatus('Enter a transport line and journey time.', 'error');
    return;
  }
  legs.push({ type:'transit', line, minutes, from:$('#transit-from').value.trim(), to:$('#transit-to').value.trim() });
  ['#transit-line', '#transit-minutes', '#transit-from', '#transit-to'].forEach(selector => { $(selector).value = ''; });
  renderLegs();
}

async function save(statusValue) {
  const name = $('#route-name').value.trim();
  if (!name || !$('#route-from').value.trim() || !$('#route-to').value.trim() || !legs.length) {
    showStatus('Add a route name, start, destination, and at least one leg.', 'error');
    return;
  }
  const route = {
    name,
    from:$('#route-from').value.trim(),
    to:$('#route-to').value.trim(),
    legs,
    status:statusValue,
    updatedAt:serverTimestamp(),
    updatedBy:user.uid,
  };
  const id = routeId();
  try {
    await setDoc(doc(db, 'curatedRoutes', id), { ...route, createdAt:serverTimestamp() });
    showStatus(statusValue === 'published' ? 'Route published for MariBus riders.' : 'Draft saved.', 'success');
  } catch (error) {
    showStatus(`Could not save route: ${error.message || 'check Firebase rules'}`, 'error');
  }
}

async function initialize() {
  const response = await fetch('/api/config');
  const config = await response.json();
  if (!config.firebase_enabled) throw new Error('Firebase is not configured.');
  const firebaseApp = getApps()[0] || initializeApp(config.firebase_config);
  db = getFirestore(firebaseApp);
  const auth = getAuth(firebaseApp);
  onAuthStateChanged(auth, signedInUser => {
    user = signedInUser;
    $('#curator-loading').hidden = true;
    const allowed = user?.email?.toLowerCase() === CURATOR_EMAIL;
    $('#curator-denied').hidden = allowed;
    $('#curator-editor').hidden = !allowed;
    if (!allowed) return;
    map = L.map('curation-map').setView([3.0738, 101.5183], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap contributors' }).addTo(map);
    map.on('click', event => {
      if (!drawingWalk) return;
      walkingPoints.push([event.latlng.lat, event.latlng.lng]);
      if (walkingLine) walkingLine.setLatLngs(walkingPoints);
      else walkingLine = L.polyline(walkingPoints, { color:'#2563eb', weight:6 }).addTo(map);
    });
  });
}

$('#start-walk').addEventListener('click', startWalkingLeg);
$('#finish-walk').addEventListener('click', finishWalkingLeg);
$('#add-transit').addEventListener('click', addTransitLeg);
$('#save-draft').addEventListener('click', () => save('draft'));
$('#publish-route').addEventListener('click', () => save('published'));
initialize().catch(error => { $('#curator-loading').hidden = true; $('#curator-denied').hidden = false; showStatus(error.message, 'error'); });
