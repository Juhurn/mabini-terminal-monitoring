
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyC3-Fqxye7eXcXbU0uD8KVDGPG0YiQGFvA',
  authDomain: 'mabini-terminal-monitoring.firebaseapp.com',
  projectId: 'mabini-terminal-monitoring',
  storageBucket: 'mabini-terminal-monitoring.firebasestorage.app',
  messagingSenderId: '1001873590635',
  appId: '1:1001873590635:web:6e19b70b6099b4fc1c642e'
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({
  hd: 'seaoil.com.ph',
  prompt: 'select_account'
})
