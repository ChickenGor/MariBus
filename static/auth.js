import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithCredential, updateProfile, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const elements={setup:document.querySelector('#auth-setup'),authCard:document.querySelector('#auth-card'),accountCard:document.querySelector('#account-card'),googleUsernameCard:document.querySelector('#google-username-card'),googleUsernameForm:document.querySelector('#google-username-form'),googleUsername:document.querySelector('#google-username'),googleUsernameMessage:document.querySelector('#google-username-message'),form:document.querySelector('#email-auth-form'),nameField:document.querySelector('#name-field'),name:document.querySelector('#auth-name'),email:document.querySelector('#auth-email'),password:document.querySelector('#auth-password'),submit:document.querySelector('#email-auth-submit'),forgot:document.querySelector('#forgot-password'),google:document.querySelector('#google-auth'),message:document.querySelector('#auth-message')};
let mode='login';
let pendingGoogleUser=null;
const showMessage=(message,type='')=>{elements.message.textContent=message;elements.message.className=`auth-message ${type}`;};
const setBusy=busy=>{[elements.submit,elements.google,elements.forgot].forEach(button=>button.disabled=busy);elements.submit.textContent=busy?'Please wait…':mode==='login'?'Sign in':'Create account';};
const readableError=error=>({
  'auth/email-already-in-use':'An account already uses this email address.',
  'auth/invalid-credential':'The email or password is incorrect.',
  'auth/invalid-email':'Enter a valid email address.',
  'auth/weak-password':'Use a password with at least 6 characters.',
  'auth/popup-closed-by-user':'Google sign-in was cancelled.',
  'auth/popup-blocked':'Allow pop-ups to continue with Google.',
  'auth/unauthorized-domain':'Add this website to Firebase Authentication authorized domains.',
}[error?.code]||error?.message||'Something went wrong. Please try again.');

document.querySelectorAll('[data-auth-tab]').forEach(tab=>tab.addEventListener('click',()=>{mode=tab.dataset.authTab;document.querySelectorAll('[data-auth-tab]').forEach(item=>item.classList.toggle('active',item===tab));elements.nameField.hidden=mode!=='register';elements.name.required=mode==='register';elements.password.autocomplete=mode==='register'?'new-password':'current-password';elements.submit.textContent=mode==='login'?'Sign in':'Create account';elements.forgot.hidden=mode!=='login';showMessage('');}));

async function saveUser(user,provider,username=''){const reference=doc(db,'users',user.uid);const existing=await getDoc(reference);const current=existing.exists()?existing.data():{};await setDoc(reference,{uid:user.uid,email:user.email||'',username:username||current.username||user.displayName||user.email?.split('@')[0]||'MariBus rider',displayName:user.displayName||'',photoURL:user.photoURL||'',provider,subscriptionPlan:current.subscriptionPlan||'free',subscriptionEnd:current.subscriptionEnd||null,createdAt:current.createdAt||serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});}

const isNativeApp=()=>Boolean(window.Capacitor?.isNativePlatform?.());
async function signInWithNativeGoogle(){
  const nativeAuth=window.Capacitor?.Plugins?.FirebaseAuthentication||window.Capacitor?.registerPlugin?.('FirebaseAuthentication');
  if(!nativeAuth)throw new Error('Native Google sign-in is unavailable.');
  const result=await nativeAuth.signInWithGoogle({useCredentialManager:true});
  const idToken=result?.credential?.idToken;
  if(!idToken)throw new Error('Google did not return a valid sign-in token.');
  const webCredential=GoogleAuthProvider.credential(idToken,result.credential?.accessToken||null);
  return signInWithCredential(auth,webCredential);
}

let auth,db;
try{
  const response=await fetch('/api/config');const config=await response.json();
  if(!config.firebase_enabled)throw new Error('firebase-not-configured');
  const app=initializeApp(config.firebase_config);auth=getAuth(app);db=getFirestore(app);await setPersistence(auth,browserLocalPersistence);
  onAuthStateChanged(auth,async user=>{if(user){const snapshot=await getDoc(doc(db,'users',user.uid));const profile=snapshot.exists()?snapshot.data():{};if(!profile.username){pendingGoogleUser=user;elements.authCard.hidden=true;elements.accountCard.hidden=true;elements.googleUsernameCard.hidden=false;return;}elements.googleUsernameCard.hidden=true;elements.authCard.hidden=true;elements.accountCard.hidden=false;const username=profile.username;document.querySelector('#account-name').textContent=username||'MariBus rider';document.querySelector('#account-email').textContent=user.email||'';const avatar=document.querySelector('#account-avatar');const photo=profile.photoURL||user.photoURL;avatar.textContent=photo?'':(username||user.email||'M').charAt(0).toUpperCase();if(photo)avatar.style.backgroundImage=`url("${String(photo).replace(/["\\]/g,'')}")`;}else{pendingGoogleUser=null;elements.googleUsernameCard.hidden=true;elements.authCard.hidden=false;elements.accountCard.hidden=true;}});
}catch(error){elements.setup.hidden=false;elements.authCard.hidden=true;if(error.message!=='firebase-not-configured')elements.setup.querySelector('p').textContent='Firebase could not be loaded. Check the configuration and try again.';}

elements.form.addEventListener('submit',async event=>{event.preventDefault();if(!auth)return;setBusy(true);showMessage('');try{if(mode==='register'){const username=elements.name.value.trim();if(!/^[A-Za-z0-9_]{3,24}$/.test(username))throw new Error('Username must be 3–24 letters, numbers or underscores.');const credential=await createUserWithEmailAndPassword(auth,elements.email.value.trim(),elements.password.value);await updateProfile(credential.user,{displayName:username});await saveUser(credential.user,'password',username);}else{const credential=await signInWithEmailAndPassword(auth,elements.email.value.trim(),elements.password.value);await saveUser(credential.user,'password');}}catch(error){showMessage(readableError(error),'error');}finally{setBusy(false);}});
elements.google.addEventListener('click',async()=>{if(!auth)return;setBusy(true);showMessage('');try{let credential;if(isNativeApp()){credential=await signInWithNativeGoogle();}else{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});credential=await signInWithPopup(auth,provider);}const existing=await getDoc(doc(db,'users',credential.user.uid));if(existing.exists()&&existing.data().username){await saveUser(credential.user,'google',existing.data().username);}else{pendingGoogleUser=credential.user;elements.authCard.hidden=true;elements.accountCard.hidden=true;elements.googleUsernameCard.hidden=false;}}catch(error){showMessage(readableError(error),'error');}finally{setBusy(false);}});
elements.googleUsernameForm.addEventListener('submit',async event=>{event.preventDefault();if(!pendingGoogleUser)return;const username=elements.googleUsername.value.trim();elements.googleUsernameMessage.textContent='';if(!/^[A-Za-z0-9_]{3,24}$/.test(username)){elements.googleUsernameMessage.textContent='Username must be 3-24 letters, numbers or underscores.';elements.googleUsernameMessage.className='auth-message error';return;}const button=elements.googleUsernameForm.querySelector('button');button.disabled=true;try{await updateProfile(pendingGoogleUser,{displayName:username});await saveUser(pendingGoogleUser,'google',username);pendingGoogleUser=null;location.reload();}catch(error){elements.googleUsernameMessage.textContent=readableError(error);elements.googleUsernameMessage.className='auth-message error';button.disabled=false;}});
elements.forgot.addEventListener('click',async()=>{const email=elements.email.value.trim();if(!email)return showMessage('Enter your email address first.','error');setBusy(true);try{await sendPasswordResetEmail(auth,email);showMessage('Password reset email sent.','success');}catch(error){showMessage(readableError(error),'error');}finally{setBusy(false);}});
document.querySelector('#sign-out').addEventListener('click',()=>signOut(auth));
