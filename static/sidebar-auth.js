import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const root=document.querySelector('#sidebar-account');
const curatorLink=document.querySelector('#curate-route-main');
const contributeButton=document.querySelector('#sidebar-contribute-path');
const signedOut=document.querySelector('#sidebar-signed-out');
const signedIn=document.querySelector('#sidebar-signed-in');
const details=document.querySelector('#sidebar-profile-details');
const updateAdVisibility=isPlus=>{const slot=document.querySelector('#maribus-active-service-ad');if(!slot)return;const canShow=!isPlus&&window.matchMedia('(min-width:768px)').matches;slot.classList.toggle('visible',canShow);if(canShow&&!slot.dataset.loaded){slot.dataset.loaded='true';try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(error){console.warn('MariBus ad could not be loaded',error);}}};

try{
  const response=await fetch('/api/config');const config=await response.json();
  if(!config.firebase_enabled)throw new Error('Firebase is not configured');
  const app=getApps()[0]||initializeApp(config.firebase_config);const auth=getAuth(app);const db=getFirestore(app);
  onAuthStateChanged(auth,async user=>{
    if(!user){signedOut.hidden=false;signedIn.hidden=true;details.hidden=true;curatorLink.hidden=true;updateAdVisibility(false);return;}
    let profile={};try{const snapshot=await getDoc(doc(db,'users',user.uid));if(snapshot.exists())profile=snapshot.data();}catch(error){console.warn('MariBus profile unavailable',error);}
    const username=profile.username||user.displayName||user.email?.split('@')[0]||'MariBus rider';
    curatorLink.hidden=true;
    signedOut.hidden=true;signedIn.hidden=false;
    const avatar=document.querySelector('#sidebar-profile-avatar');
    const photo=profile.photoURL||user.photoURL;
    avatar.textContent=photo?'':username.charAt(0).toUpperCase();
    avatar.style.backgroundImage=photo?`url("${String(photo).replace(/["\\]/g,'')}")`:'';
    document.querySelector('#sidebar-profile-name').textContent=username;
    document.querySelector('#sidebar-profile-email').textContent=user.email||'';
    updateAdVisibility(false);
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

contributeButton?.addEventListener('click',()=>{
  window.toggleSidebar?.(false);
  if(typeof window.openMariBusContributorMode==='function') window.openMariBusContributorMode();
  else window.addEventListener('maribus-contributor-ready',()=>window.openMariBusContributorMode?.(),{once:true});
});
