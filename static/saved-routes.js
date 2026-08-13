import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const status=document.querySelector('#saved-status'),list=document.querySelector('#saved-route-list');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const reopenUrl=route=>{const params=new URLSearchParams({saved:'1',fromName:route.origin.name,fromLat:route.origin.lat,fromLng:route.origin.lng,toName:route.destination.name,toLat:route.destination.lat,toLng:route.destination.lng,agency:route.agency||''});return `/?${params}`;};
try{
  const config=await (await fetch('/api/config')).json();if(!config.firebase_enabled)throw new Error('Firebase is not configured');
  const app=getApps()[0]||initializeApp(config.firebase_config),auth=getAuth(app),db=getFirestore(app);
  onAuthStateChanged(auth,user=>{
    if(!user){status.innerHTML='<h2>Sign in to see saved routes</h2><p>Your saved journeys are connected to your MariBus account.</p><a class="button" href="/sign-in?next=/saved-routes">Sign in</a>';list.innerHTML='';return;}
    status.innerHTML='<p>Loading saved routes…</p>';
    onSnapshot(query(collection(db,'users',user.uid,'savedRoutes'),orderBy('createdAt','desc')),snapshot=>{
      status.hidden=snapshot.size>0;status.innerHTML=snapshot.empty?'<div class="icon" style="margin-inline:auto">☆</div><h2>No saved routes yet</h2><p>Basic accounts can save up to 3 routes.</p><a class="button" href="/">Find a route</a>':'';
      list.innerHTML=snapshot.docs.map(item=>{const route=item.data(),names=(route.routes||[]).map(value=>value.routeName).filter(Boolean).join(' › ');return `<article class="saved-route-card"><div class="saved-route-top"><span class="pill">${escape(names||'Bus')}</span><button data-delete-route="${item.id}" aria-label="Delete saved route">×</button></div><h2>${escape(route.origin?.name)} → ${escape(route.destination?.name)}</h2><p>${route.totalMinutes?`${route.totalMinutes} min · `:''}${route.transfers?`${route.transfers} change`:'Direct'}</p><a class="button" href="${escape(reopenUrl(route))}">Plan this journey</a></article>`;}).join('');
      list.querySelectorAll('[data-delete-route]').forEach(button=>button.addEventListener('click',()=>deleteDoc(doc(db,'users',user.uid,'savedRoutes',button.dataset.deleteRoute))));
    },()=>{status.hidden=false;status.innerHTML='<h2>Saved routes unavailable</h2><p>Publish the updated Firestore rules and try again.</p>';});
  });
}catch(error){status.innerHTML='<h2>Connect Firebase to use saved routes</h2><p>Complete the Firebase setup first.</p>';}
