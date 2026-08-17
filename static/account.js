import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { deleteUser, getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { collection, deleteDoc, doc, getDocs, getFirestore, limit, query } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const loading=document.querySelector('#account-loading'),signedOut=document.querySelector('#account-signed-out'),controls=document.querySelector('#account-controls');
const confirmation=document.querySelector('#delete-confirmation'),deleteButton=document.querySelector('#delete-account'),message=document.querySelector('#delete-message');
const setMessage=(text,type='')=>{message.textContent=text;message.className=`auth-message ${type}`;};
let auth,db,currentUser;

async function deleteCollection(path){
  while(true){
    const snapshot=await getDocs(query(collection(db,...path),limit(100)));
    if(snapshot.empty)return;
    await Promise.all(snapshot.docs.map(item=>deleteDoc(item.ref)));
  }
}

try{
  const config=await(await fetch('/api/config')).json();
  if(!config.firebase_enabled)throw new Error('Firebase is not configured.');
  const firebase=initializeApp(config.firebase_config);auth=getAuth(firebase);db=getFirestore(firebase);
  onAuthStateChanged(auth,user=>{
    currentUser=user;loading.hidden=true;signedOut.hidden=Boolean(user);controls.hidden=!user;
    if(!user)return;
    document.querySelector('#manage-name').textContent=user.displayName||'MariBus rider';
    document.querySelector('#manage-email').textContent=user.email||'';
    const avatar=document.querySelector('#manage-avatar');
    avatar.textContent=user.photoURL?'':(user.displayName||user.email||'M').charAt(0).toUpperCase();
    if(user.photoURL)avatar.style.backgroundImage=`url("${String(user.photoURL).replace(/["\\]/g,'')}")`;
  });
}catch(error){loading.innerHTML=`<h2>Account controls unavailable</h2><p>${String(error.message||error)}</p>`;}

confirmation.addEventListener('input',()=>{deleteButton.disabled=confirmation.value.trim()!=='DELETE';});
document.querySelector('#manage-sign-out').addEventListener('click',()=>signOut(auth));
deleteButton.addEventListener('click',async()=>{
  if(!currentUser||confirmation.value.trim()!=='DELETE')return;
  const confirmed=window.confirm('Permanently delete your MariBus account and saved routes?');
  if(!confirmed)return;
  deleteButton.disabled=true;confirmation.disabled=true;setMessage('Deleting your saved routes and account…');
  try{
    const uid=currentUser.uid;
    await deleteCollection(['users',uid,'savedRoutes']);
    await deleteCollection(['users',uid,'notificationDevices']);
    await deleteDoc(doc(db,'users',uid));
    await deleteUser(currentUser);
    location.replace('/?accountDeleted=1');
  }catch(error){
    confirmation.disabled=false;
    if(error?.code==='auth/requires-recent-login'){
      setMessage('For security, sign out, sign in again, then return here to complete deletion.','error');
      deleteButton.disabled=false;
    }else{
      setMessage(error?.message||'Account deletion could not be completed. Please contact support.','error');
      deleteButton.disabled=false;
    }
  }
});
