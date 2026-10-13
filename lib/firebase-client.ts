import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import {
  getAnalytics,
  isSupported,
  logEvent,
  setUserId,
  setUserProperties,
  type Analytics,
} from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const firebaseIsConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
);
/** Local tests only (NEXT_PUBLIC_FIREBASE_EMULATORS=1 with a demo- project): the Auth and Firestore emulators. */
const useEmulators = process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1";

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestorePromise: Promise<Firestore | null> | null = null;
let analyticsPromise: Promise<Analytics | null> | null = null;

function getFirebaseApp() {
  if (!firebaseIsConfigured) return null;
  if (!firebaseApp) firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return firebaseApp;
}

export function getFirebaseAuth() {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!firebaseAuth) {
    firebaseAuth = getAuth(app);
    if (useEmulators) connectAuthEmulator(firebaseAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return firebaseAuth;
}

/** Firestore, loaded on first use (feedback files): pages that never need it never download it. */
export function getFirebaseFirestore() {
  return firestorePromise ??= (async () => {
    const app = getFirebaseApp();
    if (!app) return null;
    const { connectFirestoreEmulator, getFirestore } = await import("firebase/firestore");
    const db = getFirestore(app);
    if (useEmulators) connectFirestoreEmulator(db, "127.0.0.1", 8085);
    return db;
  })();
}

async function getFirebaseAnalytics() {
  if (!firebaseConfig.measurementId) return null;
  if (!analyticsPromise) {
    analyticsPromise = (async () => {
      const app = getFirebaseApp();
      if (!app || !(await isSupported())) return null;
      return getAnalytics(app);
    })();
  }
  return analyticsPromise;
}

type AnalyticsParameters = Record<string, string | number | boolean | undefined>;

export async function trackAnalyticsEvent(name: string, parameters: AnalyticsParameters = {}) {
  const analytics = await getFirebaseAnalytics();
  if (!analytics) return;
  const safeParameters = Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined));
  // GA4 accepts only letters, digits and underscores in event names and silently drops the rest.
  logEvent(analytics, name.replace(/[^A-Za-z0-9_]/g, "_"), safeParameters);
}

export async function identifyAnalyticsUser(uid: string | null) {
  const analytics = await getFirebaseAnalytics();
  if (!analytics) return;
  setUserId(analytics, uid);
  if (uid) setUserProperties(analytics, { account_type: "registered" });
}
