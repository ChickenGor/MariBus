import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const root=document.querySelector('#sidebar-account');
const signedOut=document.querySelector('#sidebar-signed-out');
const signedIn=document.querySelector('#sidebar-signed-in');
const details=document.querySelector('#sidebar-profile-details');
const timestampDate=value=>value?.toDate?value.toDate():value?new Date(value):null;

try{
  const response=await fetch('/api/config');const config=await response.json();
  if(!config.firebase_enabled)throw new Error('Firebase is not configured');
  const app=getApps()[0]||initializeApp(config.firebase_config);const auth=getAuth(app);const db=getFirestore(app);
  onAuthStateChanged(auth,async user=>{
    if(!user){signedOut.hidden=false;signedIn.hidden=true;details.hidden=true;return;}
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
    document.querySelector('#subscription-days').textContent=active?String(remaining):'0';
    document.querySelector('#subscription-label').textContent=active?`${profile.subscriptionPlan} plan`:'Basic account';
  });
  document.querySelector('#sidebar-profile-button').addEventListener('click',()=>{details.hidden=!details.hidden;});
  document.querySelector('#profile-logout').addEventListener('click',async()=>{await signOut(auth);details.hidden=true;});
}catch(error){root.dataset.authUnavailable='true';signedOut.hidden=false;signedIn.hidden=true;}
