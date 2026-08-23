import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

let auth = null;
let db = null;
let setupError = null;

const notify = message => {
  if (typeof window.showMenuNotice === 'function') window.showMenuNotice(message);
};

try {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error(`Configuration request failed (${response.status})`);
  const config = await response.json();
  if (!config.firebase_enabled) throw new Error('Firebase is not enabled');
  const app = getApps()[0] || initializeApp(config.firebase_config);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  setupError = error;
  console.warn('Route saving unavailable', error);
}

window.saveMariBusJourney = async function(index, button) {
  if (!button || button.disabled) return;
  if (setupError || !auth || !db) {
    notify('Route saving is temporarily unavailable');
    console.warn('Save route was requested before Firebase became available', setupError);
    return;
  }

  if (auth.authStateReady) await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    notify('Sign in to save this route');
    setTimeout(() => { location.href = '/sign-in?next=/'; }, 450);
    return;
  }

  const journey = window.__mariBusJourneyOptions?.[Number(index)];
  const endpoints = window.__mariBusJourneyEndpoints;
  if (!journey || !endpoints) {
    notify('Choose a journey before saving');
    return;
  }

  const iconOnly = button.classList.contains('map-tool-button') || button.classList.contains('icon-only');
  const previousText = button.textContent;
  const previousTitle = button.title || 'Save route';
  const setButtonLabel = label => {
    if (iconOnly) {
      button.title = label;
      button.setAttribute('aria-label', label);
    } else {
      button.textContent = label;
    }
  };

  button.disabled = true;
  setButtonLabel('Saving route');
  notify('Saving route…');

  try {
    const profile = (await getDoc(doc(db, 'users', user.uid))).data() || {};
    const subscriptionEnd = profile.subscriptionEnd?.toDate?.();
    const isPlus = profile.subscriptionPlan
      && !['free', 'basic'].includes(profile.subscriptionPlan)
      && subscriptionEnd
      && subscriptionEnd.getTime() > Date.now();
    const savedCollection = collection(db, 'users', user.uid, 'savedRoutes');
    const existing = await getDocs(savedCollection);

    if (!isPlus && existing.size >= 3) {
      setButtonLabel('3 route limit');
      notify('Basic accounts can save up to 3 routes');
      setTimeout(() => {
        if (iconOnly) setButtonLabel(previousTitle);
        else button.textContent = previousText;
        button.disabled = false;
        location.href = '/ad-free';
      }, 1400);
      return;
    }

    const routes = (journey.legs?.length ? journey.legs : [journey]).map(leg => ({
      routeId: leg.route_id || '',
      routeName: leg.route_short_name || leg.route_id || '',
      routeColor: leg.route_color || '',
    }));
    const savedRoute = {
      origin: endpoints.from,
      destination: endpoints.to,
      routes,
      agency: endpoints.agency,
      totalMinutes: Number(journey.total_minutes || journey.duration_minutes || 0),
      walkMinutes: Number(journey.walk_minutes || 0),
      transfers: Number(journey.transfers || 0),
      createdAt: serverTimestamp(),
    };

    if (isPlus) {
      await addDoc(savedCollection, savedRoute);
    } else {
      const usedIds = new Set(existing.docs.map(item => item.id));
      const slot = ['basic-1', 'basic-2', 'basic-3'].find(id => !usedIds.has(id));
      if (!slot) throw new Error('No basic route slot is available');
      await setDoc(doc(savedCollection, slot), savedRoute);
    }

    setButtonLabel('Route saved');
    button.classList.add('saved');
    button.setAttribute('aria-pressed', 'true');
    notify('Route saved');
  } catch (error) {
    console.error('Could not save route', error);
    setButtonLabel('Could not save');
    notify(error?.code === 'permission-denied'
      ? 'Saving was blocked by account permissions'
      : 'Could not save this route. Please try again.');
    setTimeout(() => {
      if (iconOnly) setButtonLabel(previousTitle);
      else button.textContent = previousText;
      button.disabled = false;
    }, 1800);
  }
};

window.saveCurrentMariBusStop = async function(button) {
  if (!button || button.disabled) return;
  if (setupError || !auth || !db) return notify('Stop saving is temporarily unavailable');
  if (auth.authStateReady) await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    notify('Sign in to favourite this stop');
    setTimeout(() => { location.href = '/sign-in?next=/'; }, 450);
    return;
  }
  const context = window.__mariBusSmartStop;
  if (!context?.stop?.stop_id || !context.agency) return notify('Open a bus stop before saving it');
  const stableId = `${context.agency}:${context.stop.stop_id}`.split('').reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261).toString(36);
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await setDoc(doc(db, 'users', user.uid, 'savedStops', stableId), {
      agency: context.agency,
      stopId: String(context.stop.stop_id),
      stopCode: String(context.stop.stop_code || ''),
      stopName: String(context.stop.stop_name || 'Bus stop'),
      latitude: Number(context.stop.stop_lat),
      longitude: Number(context.stop.stop_lon),
      createdAt: serverTimestamp(),
    });
    button.textContent = 'Favourited';
    button.classList.add('saved');
    button.setAttribute('aria-pressed', 'true');
    notify('Stop added to favourites');
  } catch (error) {
    console.error('Could not save stop', error);
    button.textContent = 'Could not save';
    notify(error?.code === 'permission-denied' ? 'Publish the updated Firestore rules to save stops' : 'Could not favourite this stop');
    setTimeout(() => { button.textContent = previousText; button.disabled = false; }, 1800);
  }
};

window.dispatchEvent(new CustomEvent('maribus-route-saver-ready'));
