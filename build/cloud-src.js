// Thin wrapper around Firebase so the app only sees a few simple functions.
// The app talks to window.CloudSDK; tests swap in a fake with the same shape.
import { initializeApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, where, serverTimestamp, Timestamp
} from "firebase/firestore/lite";

function ms(t) { return t && typeof t.toMillis === "function" ? t.toMillis() : 0; }
function plain(x) { return JSON.parse(JSON.stringify(x)); } // Firestore rejects undefined values

window.CloudSDK = {
  start: function (config) {
    var app = initializeApp(config);
    var auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    var db = getFirestore(app);
    return {
      onUser: function (cb) {
        return onAuthStateChanged(auth, function (u) { cb(u ? { uid: u.uid, email: u.email || "" } : null); });
      },
      signIn: function (email, pw) { return signInWithEmailAndPassword(auth, email, pw).then(function () {}); },
      createAccount: function (email, pw) { return createUserWithEmailAndPassword(auth, email, pw).then(function () {}); },
      signOut: function () { return signOut(auth); },
      resetPassword: function (email) { return sendPasswordResetEmail(auth, email); },
      getMain: function (uid) {
        return getDoc(doc(db, "users", uid)).then(function (s) {
          if (!s.exists()) return { exists: false };
          var d = s.data();
          return { exists: true, data: { settings: d.settings || null, weights: d.weights || [] }, updatedAt: ms(d.updatedAt) };
        });
      },
      getDays: function (uid, sinceMs) {
        var col = collection(db, "users", uid, "days");
        var q = sinceMs ? query(col, where("updatedAt", ">", Timestamp.fromMillis(sinceMs))) : col;
        return getDocs(q).then(function (snap) {
          return snap.docs.map(function (s) {
            var d = s.data();
            return { date: s.id, entries: d.entries || [], day: d.day || null, updatedAt: ms(d.updatedAt) };
          });
        });
      },
      putMain: function (uid, data) {
        return setDoc(doc(db, "users", uid), Object.assign(plain(data), { updatedAt: serverTimestamp() }));
      },
      putDay: function (uid, date, data) {
        return setDoc(doc(db, "users", uid, "days", date), Object.assign(plain(data), { updatedAt: serverTimestamp() }));
      }
    };
  }
};
