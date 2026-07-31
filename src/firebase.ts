import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCe_p1u7H7ZJ4qDs7mzTLKfHjyhjaEgcCI",
  authDomain: "tsu-ainet-fussball.firebaseapp.com",
  projectId: "tsu-ainet-fussball",
  storageBucket: "tsu-ainet-fussball.firebasestorage.app",
  messagingSenderId: "643610865816",
  appId: "1:643610865816:web:41938883ad04b8280860ed",
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);