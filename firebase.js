// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCT30Qf5fBfW05ebkIvf2JR29lLa5LzDdw",
  authDomain: "timelyx-e0e71.firebaseapp.com",
  projectId: "timelyx-e0e71",
  storageBucket: "timelyx-e0e71.firebasestorage.app",
  messagingSenderId: "999791656645",
  appId: "1:999791656645:web:a450ecba39b00f88bfbaac",
  measurementId: "G-6NWV4Y9250",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };