// Live score sharing through Cloud Firestore (free Spark plan).
// Firebase is loaded only when a live link is used, so the rest of the app
// stays fast and works offline. The config comes from Firebase Hosting's
// reserved URL, so there is nothing to paste in by hand.
const V = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

let ready = null;

async function init() {
  if (ready) return ready;
  ready = (async () => {
    const res = await fetch('/__/firebase/init.json');
    if (!res.ok) throw new Error('Live links work once the app is deployed to Firebase Hosting');
    const config = await res.json();
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    const app = initializeApp(config);
    return { app, auth, fs, db: fs.getFirestore(app) };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

async function signedIn() {
  const { app, auth } = await init();
  const a = auth.getAuth(app);
  if (a.currentUser) return a.currentUser;
  const cred = await auth.signInAnonymously(a);
  return cred.user;
}

const newId = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
};

/** Create a live match document and return its id. */
export async function create(data) {
  const user = await signedIn();
  const { fs, db } = await init();
  const id = newId();
  await fs.setDoc(fs.doc(db, 'matches', id), {
    owner: user.uid,
    createdAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp(),
    data,
  });
  return id;
}

export async function push(id, data) {
  const user = await signedIn();
  const { fs, db } = await init();
  await fs.setDoc(fs.doc(db, 'matches', id), { owner: user.uid, updatedAt: fs.serverTimestamp(), data }, { merge: true });
}

/** Subscribe to a match. Returns a promise of an unsubscribe function. */
export async function watch(id, onData, onError) {
  try {
    const { fs, db } = await init();
    return fs.onSnapshot(
      fs.doc(db, 'matches', id),
      (snap) => onData(snap.exists() ? snap.data().data : null),
      (e) => onError?.(e),
    );
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}
