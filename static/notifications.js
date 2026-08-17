import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { deleteDoc, doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-messaging.js';

const setup=document.querySelector('#notification-setup'),controls=document.querySelector('#notification-controls');
const enableButton=document.querySelector('#enable-notifications'),disableButton=document.querySelector('#disable-notifications');
const arrival=document.querySelector('#arrival-reminders'),disruptions=document.querySelector('#disruption-alerts'),message=document.querySelector('#notification-message');
const isNative=()=>Boolean(window.Capacitor?.isNativePlatform?.());
const deviceStorageKey='maribus-notification-device-id';
const setMessage=(text,type='')=>{message.textContent=text;message.className=`auth-message ${type}`;};
const setToggle=(button,enabled)=>{button.classList.toggle('enabled',enabled);button.setAttribute('aria-checked',String(enabled));};
const newDeviceId=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
let config,auth,db,user,profile={},deviceId=localStorage.getItem(deviceStorageKey)||newDeviceId();
localStorage.setItem(deviceStorageKey,deviceId);

async function savePreferences(){
  if(!user)return;
  await setDoc(doc(db,'users',user.uid),{notificationPreferences:{arrivalReminders:arrival.getAttribute('aria-checked')==='true',serviceAlerts:disruptions.getAttribute('aria-checked')==='true',updatedAt:serverTimestamp()}},{merge:true});
}

async function saveToken(token,platform){
  if(!token)throw new Error('The device did not return a notification token.');
  await setDoc(doc(db,'users',user.uid,'notificationDevices',deviceId),{token,platform,enabled:true,updatedAt:serverTimestamp()});
  setToggle(arrival,true);setToggle(disruptions,true);await savePreferences();
  enableButton.hidden=true;disableButton.hidden=false;setMessage('Notifications are enabled on this device.','success');
}

async function enableNative(){
  const plugin=window.Capacitor?.Plugins?.PushNotifications||window.Capacitor?.registerPlugin?.('PushNotifications');
  if(!plugin)throw new Error('Native notification support is unavailable. Sync and rebuild the Android app.');
  let permission=await plugin.checkPermissions();
  if(permission.receive==='prompt')permission=await plugin.requestPermissions();
  if(permission.receive!=='granted')throw new Error('Notification permission was not granted.');
  await plugin.addListener('registration',event=>saveToken(event.value,'android').catch(error=>setMessage(error.message,'error')));
  await plugin.addListener('registrationError',error=>setMessage(error.error||'Notification registration failed.','error'));
  await plugin.register();
}

async function enableWeb(){
  if(!(await isSupported()))throw new Error('This browser does not support Firebase notifications.');
  if(!config.firebase_vapid_key)throw new Error('Add FIREBASE_VAPID_KEY to Vercel before enabling web notifications.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Notification permission was not granted.');
  const registration=await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const messaging=getMessaging(getApps()[0]);
  const token=await getToken(messaging,{vapidKey:config.firebase_vapid_key,serviceWorkerRegistration:registration});
  onMessage(messaging,payload=>setMessage(payload.notification?.title||payload.data?.title||'New MariBus update','success'));
  await saveToken(token,'web');
}

enableButton.addEventListener('click',async()=>{enableButton.disabled=true;setMessage('Requesting notification permission…');try{await(isNative()?enableNative():enableWeb());}catch(error){setMessage(error.message||'Notifications could not be enabled.','error');enableButton.disabled=false;}});
disableButton.addEventListener('click',async()=>{if(!user)return;disableButton.disabled=true;try{await deleteDoc(doc(db,'users',user.uid,'notificationDevices',deviceId));enableButton.hidden=false;enableButton.disabled=false;disableButton.hidden=true;setToggle(arrival,false);setToggle(disruptions,false);await savePreferences();setMessage('Notifications are disabled on this device.');}catch(error){setMessage(error.message||'Notifications could not be disabled.','error');}finally{disableButton.disabled=false;}});
[arrival,disruptions].forEach(button=>button.addEventListener('click',async()=>{setToggle(button,button.getAttribute('aria-checked')!=='true');try{await savePreferences();}catch(error){setMessage('Your preference could not be saved.','error');}}));

try{
  config=await(await fetch('/api/config')).json();if(!config.firebase_enabled)throw new Error('Firebase is not configured.');
  const firebase=getApps()[0]||initializeApp(config.firebase_config);auth=getAuth(firebase);db=getFirestore(firebase);
  onAuthStateChanged(auth,async current=>{
    user=current;setup.hidden=false;controls.hidden=true;
    if(!user){setup.innerHTML='<h2>Sign in to enable notifications</h2><p>Your notification choices are connected to your MariBus account.</p><a class="button" href="/sign-in?next=/notifications">Sign in</a>';return;}
    const snapshot=await getDoc(doc(db,'users',user.uid));profile=snapshot.exists()?snapshot.data():{};
    const end=profile.subscriptionEnd?.toDate?.();const plus=profile.subscriptionPlan&&!['free','basic'].includes(profile.subscriptionPlan)&&end&&end>Date.now();
    if(!plus){setup.classList.add('plus-required');setup.innerHTML='<h2>Notifications are a Plus feature</h2><p>Upgrade to receive approaching-bus and disruption alerts.</p><a class="button" href="/ad-free">View Plus</a>';return;}
    setup.hidden=true;controls.hidden=false;
    setToggle(arrival,profile.notificationPreferences?.arrivalReminders!==false);
    setToggle(disruptions,profile.notificationPreferences?.serviceAlerts!==false);
    const device=await getDoc(doc(db,'users',user.uid,'notificationDevices',deviceId));
    enableButton.hidden=device.exists();disableButton.hidden=!device.exists();
    if(device.exists())setMessage('Notifications are enabled on this device.','success');
  });
}catch(error){setup.classList.add('error');setup.innerHTML=`<h2>Notifications unavailable</h2><p>${String(error.message||error)}</p>`;}
