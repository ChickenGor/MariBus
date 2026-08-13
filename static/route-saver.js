import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

let auth=null,db=null;
try{const response=await fetch('/api/config');const config=await response.json();if(config.firebase_enabled){const app=getApps()[0]||initializeApp(config.firebase_config);auth=getAuth(app);db=getFirestore(app);}}catch(error){console.warn('Route saving unavailable',error);}

window.saveMariBusJourney=async function(index,button){
  if(auth?.authStateReady)await auth.authStateReady();
  const user=auth?.currentUser;if(!user){location.href='/sign-in?next=/';return;}
  const journey=window.__mariBusJourneyOptions?.[Number(index)];const endpoints=window.__mariBusJourneyEndpoints;
  if(!journey||!endpoints)return;
  if(!db)return;
  button.disabled=true;const previous=button.textContent;button.textContent='Saving...';
  try{
    const profile=(await getDoc(doc(db,'users',user.uid))).data()||{};
    const subscriptionEnd=profile.subscriptionEnd?.toDate?.();
    const isPlus=profile.subscriptionPlan&& !['free','basic'].includes(profile.subscriptionPlan) && subscriptionEnd && subscriptionEnd>Date.now();
    const savedCollection=collection(db,'users',user.uid,'savedRoutes');
    const existing=await getDocs(savedCollection);
    if(!isPlus&&existing.size>=3){
      button.textContent='3 route limit';
      setTimeout(()=>{button.textContent=previous;button.disabled=false;location.href='/ad-free';},1200);
      return;
    }
    const routes=(journey.legs?.length?journey.legs:[journey]).map(leg=>({routeId:leg.route_id||'',routeName:leg.route_short_name||leg.route_id||'',routeColor:leg.route_color||''}));
    const savedRoute={origin:endpoints.from,destination:endpoints.to,routes,agency:endpoints.agency,totalMinutes:Number(journey.total_minutes||journey.duration_minutes||0),walkMinutes:Number(journey.walk_minutes||0),transfers:Number(journey.transfers||0),createdAt:serverTimestamp()};
    if(isPlus){
      await addDoc(savedCollection,savedRoute);
    }else{
      const usedIds=new Set(existing.docs.map(item=>item.id));
      const slot=['basic-1','basic-2','basic-3'].find(id=>!usedIds.has(id));
      if(!slot)throw new Error('No basic route slot is available');
      await setDoc(doc(savedCollection,slot),savedRoute);
    }
    button.textContent='Saved';button.classList.add('saved');
  }catch(error){button.textContent='Could not save';button.disabled=false;setTimeout(()=>button.textContent=previous,1800);}
};
