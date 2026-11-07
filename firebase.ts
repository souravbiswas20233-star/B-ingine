import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type User } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, writeBatch, setDoc, serverTimestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyC-9rNObRxRJezgvZK6JcYylfzu9tW3Ggk',
  authDomain: 'bishwo-45430.firebaseapp.com',
  projectId: 'bishwo-45430',
  storageBucket: 'bishwo-45430.firebasestorage.app',
  messagingSenderId: '140669463257',
  appId: '1:140669463257:web:e37e76d59133159183ecc8',
  measurementId: 'G-94X7WV94VN',
  databaseURL: 'https://bishwo-45430-default-rtdb.asia-southeast1.firebasedatabase.app/',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const rtdb = getDatabase(firebaseApp);

export async function saveUserProfile(user: User) {
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Bishwa user'),
    photoURL: user.photoURL || '',
    email: user.email || '',
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getUserItems<T>(uid: string, area: 'history' | 'bookmarks') {
  const snapshot = await getDocs(collection(db, 'users', uid, area));
  return snapshot.docs.map(item => ({ ...item.data(), id: item.id })) as T[];
}

export async function replaceUserItems<T extends { id: string }>(
  uid: string,
  area: 'history' | 'bookmarks',
  items: T[],
) {
  const target = collection(db, 'users', uid, area);
  const existing = await getDocs(target);
  const batch = writeBatch(db);
  existing.docs.forEach(item => batch.delete(item.ref));
  items.forEach(item => {
    const { id, ...data } = item;
    batch.set(doc(target, id), data);
  });
  await batch.commit();
}
