import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
    apiKey: 'AIzaSyDave9aD_f2cemoEbE4pQI52doKpTZlIZA',
    authDomain: 'stormhacks-2026.firebaseapp.com',
    projectId: 'stormhacks-2026',
    storageBucket: 'stormhacks-2026.firebasestorage.app',
    messagingSenderId: '304609760645',
    appId: '1:304609760645:web:08fd535d0b454233b360ec',
    measurementId: 'G-5N0K9Z9DKW',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)

// Loaded on demand so the analytics SDK stays out of the sign-in bundle.
export const analytics = import('firebase/analytics').then(({ getAnalytics, isSupported }) =>
    isSupported().then((supported) => (supported ? getAnalytics(firebaseApp) : null)),
)