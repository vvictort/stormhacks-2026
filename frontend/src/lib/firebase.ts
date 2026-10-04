import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const env = import.meta.env

const requiredEnv = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
]
const missingEnv = requiredEnv.filter((name) => !env[name])
if (missingEnv.length > 0) {
    throw new Error(
        `Missing Firebase config: ${missingEnv.join(', ')}. Copy frontend/.env.example to frontend/.env and fill in the values.`,
    )
}

const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)

// Loaded on demand so the analytics SDK stays out of the sign-in bundle. Skipped without a measurement ID.
export const analytics = firebaseConfig.measurementId
    ? import('firebase/analytics').then(({ getAnalytics, isSupported }) =>
          isSupported().then((supported) => (supported ? getAnalytics(firebaseApp) : null)),
      )
    : Promise.resolve(null)
