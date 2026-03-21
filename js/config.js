import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Firebase konfiguration
export const firebaseConfig = {
    apiKey: "AIzaSyAwhpoNdvc9tbc5Ee0owBApxiXW4X8-HS0",
    authDomain: "jonas-hemsida.firebaseapp.com",
    projectId: "jonas-hemsida",
    storageBucket: "jonas-hemsida.firebasestorage.app",
    messagingSenderId: "65137999270",
    appId: "1:65137999270:web:f76cc4968956cc4e7f6367",
    measurementId: "G-P68P0EXRJV"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
