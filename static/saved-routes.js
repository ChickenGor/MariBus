import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const status=document.querySelector('#saved-status'),list=document.querySelector('#saved-route-list');
const stopStatus=document.querySelector('#saved-stop-status'),stopList=document.querySelector('#saved-stop-list');
const stopHeading=document.querySelector('#saved-stops-heading');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const reopenUrl=route=>{const params=new URLSearchParams({saved:'1',fromName:route.origin.name,fromLat:route.origin.lat,fromLng:route.origin.lng,toName:route.destination.name,toLat:route.destination.lat,toLng:route.destination.lng,agency:route.agency||''});return `/?${params}`;};
const stopUrl=stop=>{const params=new URLSearchParams({stop:stop.stopId,agency:stop.agency,lat:stop.latitude,lng:stop.longitude,name:stop.stopName});return `/?${params}`;};
const loadStopDepartures=async(item,element)=>{
  try{
    const stop=item.data(),response=await fetch(`/api/stops/${encodeURIComponent(stop.stopId)}/arrivals?agency=${encodeURIComponent(stop.agency)}&limit=3`),result=await response.json();
    if(!result.success)throw new Error(result.error||'Arrivals unavailable');
    element.innerHTML=result.data.length?result.data.map(arrival=>`<div class="saved-stop-departure"><strong>${escape(arrival.route_short_name||'Route')}</strong><span>${escape(arrival.trip_headsign||arrival.route_long_name||'Service')}</span><b>${arrival.minutes===0?'Due':`${arrival.minutes} min`}</b><small>Scheduled</small></div>`).join(''):'<p>No upcoming scheduled departures.</p>';
  }catch(_){element.innerHTML='<p>Departure information is temporarily unavailable.</p>';}
};
try{
  const config=await (await fetch('/api/config')).json();if(!config.firebase_enabled)throw new Error('Firebase is not configured');
  const app=getApps()[0]||initializeApp(config.firebase_config),auth=getAuth(app),db=getFirestore(app);
  onAuthStateChanged(auth,user=>{
    if(!user){status.innerHTML='<h2>Sign in to see saved routes</h2><p>Your saved journeys are connected to your MariBus account.</p><a class="button" href="/sign-in?next=/saved-routes">Sign in</a>';stopStatus.innerHTML='<h2>Sign in to see favourite stops</h2><p>Your favourites are connected to your MariBus account.</p>';list.innerHTML='';stopList.innerHTML='';return;}
    status.innerHTML='<p>Loading saved routes…</p>';
    stopStatus.innerHTML='<p>Loading favourite stops…</p>';
    onSnapshot(query(collection(db,'users',user.uid,'savedStops'),orderBy('createdAt','desc')),snapshot=>{
      stopHeading.hidden=false;stopStatus.hidden=snapshot.size>0;stopStatus.innerHTML=snapshot.empty?'<div class="icon" style="margin-inline:auto">☆</div><h2>No favourite stops yet</h2><p>Open a stop on the map and tap Favourite.</p><a class="button" href="/">Find nearby stops</a>':'';
      stopList.innerHTML=snapshot.docs.map(item=>{const stop=item.data();return `<article class="saved-route-card"><div class="saved-route-top"><span class="pill">Bus stop</span><button data-delete-stop="${item.id}" aria-label="Remove favourite stop">×</button></div><h2>${escape(stop.stopName)}</h2><p>${escape(stop.stopCode?`Stop ${stop.stopCode}`:'Favourite stop')}</p><div class="saved-stop-departures" data-stop-departures="${item.id}"><p>Loading departures…</p></div><a class="button" href="${escape(stopUrl(stop))}">View on map</a></article>`;}).join('');
      snapshot.docs.forEach(item=>{const element=stopList.querySelector(`[data-stop-departures="${CSS.escape(item.id)}"]`);if(element)loadStopDepartures(item,element);});
      stopList.querySelectorAll('[data-delete-stop]').forEach(button=>button.addEventListener('click',()=>deleteDoc(doc(db,'users',user.uid,'savedStops',button.dataset.deleteStop))));
    },()=>{stopStatus.hidden=true;stopList.innerHTML='';stopHeading.hidden=true;});
    onSnapshot(query(collection(db,'users',user.uid,'savedRoutes'),orderBy('createdAt','desc')),snapshot=>{
      status.hidden=snapshot.size>0;status.innerHTML=snapshot.empty?'<div class="icon" style="margin-inline:auto">☆</div><h2>No saved routes yet</h2><p>Basic accounts can save up to 3 routes.</p><a class="button" href="/">Find a route</a>':'';
      list.innerHTML=snapshot.docs.map(item=>{const route=item.data(),names=(route.routes||[]).map(value=>value.routeName).filter(Boolean).join(' › ');return `<article class="saved-route-card"><div class="saved-route-top"><span class="pill">${escape(names||'Bus')}</span><button data-delete-route="${item.id}" aria-label="Delete saved route">×</button></div><h2>${escape(route.origin?.name)} → ${escape(route.destination?.name)}</h2><p>${route.totalMinutes?`${route.totalMinutes} min · `:''}${route.transfers?`${route.transfers} change`:'Direct'}</p><a class="button" href="${escape(reopenUrl(route))}">Plan this journey</a></article>`;}).join('');
      list.querySelectorAll('[data-delete-route]').forEach(button=>button.addEventListener('click',()=>deleteDoc(doc(db,'users',user.uid,'savedRoutes',button.dataset.deleteRoute))));
    },()=>{status.hidden=false;status.innerHTML='<h2>Saved routes unavailable</h2><p>Publish the updated Firestore rules and try again.</p>';});
  });
}catch(error){status.innerHTML='<h2>Connect Firebase to use saved routes</h2><p>Complete the Firebase setup first.</p>';}
