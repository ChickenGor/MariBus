import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const root=document.querySelector('#sidebar-account');
const signedOut=document.querySelector('#sidebar-signed-out');
const signedIn=document.querySelector('#sidebar-signed-in');
const details=document.querySelector('#sidebar-profile-details');
const timestampDate=value=>value?.toDate?value.toDate():value?new Date(value):null;
const updateAdVisibility=isPlus=>{const slot=document.querySelector('#maribus-active-service-ad');if(!slot)return;const canShow=!isPlus&&window.matchMedia('(min-width:768px)').matches;slot.classList.toggle('visible',canShow);if(canShow&&!slot.dataset.loaded){slot.dataset.loaded='true';try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(error){console.warn('MariBus ad could not be loaded',error);}}};

try{
  const response=await fetch('/api/config');const config=await response.json();
  if(!config.firebase_enabled)throw new Error('Firebase is not configured');
  const app=getApps()[0]||initializeApp(config.firebase_config);const auth=getAuth(app);const db=getFirestore(app);
  onAuthStateChanged(auth,async user=>{
    if(!user){signedOut.hidden=false;signedIn.hidden=true;details.hidden=true;updateAdVisibility(false);document.querySelector('#sidebar-plus-title').textContent='Upgrade to Plus';document.querySelector('#sidebar-plus-copy').textContent='Unlock more routes, alerts and an ad-free experience';return;}
    let profile={};try{const snapshot=await getDoc(doc(db,'users',user.uid));if(snapshot.exists())profile=snapshot.data();}catch(error){console.warn('MariBus profile unavailable',error);}
    const username=profile.username||user.displayName||user.email?.split('@')[0]||'MariBus rider';
    signedOut.hidden=true;signedIn.hidden=false;
    const avatar=document.querySelector('#sidebar-profile-avatar');
    const photo=profile.photoURL||user.photoURL;
    avatar.textContent=photo?'':username.charAt(0).toUpperCase();
    avatar.style.backgroundImage=photo?`url("${String(photo).replace(/["\\]/g,'')}")`:'';
    document.querySelector('#sidebar-profile-name').textContent=username;
    document.querySelector('#sidebar-profile-email').textContent=user.email||'';
    const end=timestampDate(profile.subscriptionEnd);const remaining=end?Math.max(0,Math.ceil((end-Date.now())/86400000)):0;
    const active=profile.subscriptionPlan&&!['free','basic'].includes(profile.subscriptionPlan)&&remaining>0;
    updateAdVisibility(active);
    document.querySelector('#sidebar-plus-title').textContent=active?'Manage subscription':'Upgrade to Plus';
    document.querySelector('#sidebar-plus-copy').textContent=active?(end?`Plus active until ${end.toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'})}`:'View your Plus plan'):'Unlock more routes, alerts and an ad-free experience';
    document.querySelector('#subscription-label').textContent=active?'Plus':'Basic';
    document.querySelector('#subscription-expiry').textContent=active&&end
      ? `Active until ${end.toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'})}`
      :'Save up to 3 routes';
  });
  document.querySelector('#sidebar-profile-button').addEventListener('click',event=>{
    details.hidden=!details.hidden;
    event.currentTarget.setAttribute('aria-expanded',String(!details.hidden));
    if(!details.hidden){
      requestAnimationFrame(()=>details.scrollIntoView({behavior:'smooth',block:'nearest'}));
    }
  });
  document.querySelector('#profile-logout').addEventListener('click',async()=>{await signOut(auth);details.hidden=true;});
}catch(error){root.dataset.authUnavailable='true';signedOut.hidden=false;signedIn.hidden=true;updateAdVisibility(false);}
