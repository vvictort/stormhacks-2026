import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { auth } from './firebase'

export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password)

export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password)

export const signOut = () => firebaseSignOut(auth)

export const observeAuthState = (onChange: (user: User | null) => void) =>
  onAuthStateChanged(auth, onChange)