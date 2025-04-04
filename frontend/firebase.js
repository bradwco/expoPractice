import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendEmailVerification,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import axios from 'axios';
import { Audio } from 'expo-av';
// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDCafsrtsHRc8f_uCo1NBz4fpkdEQAPrPU",
  authDomain: "echo-485a9.firebaseapp.com",
  projectId: "echo-485a9",
  storageBucket: "echo-485a9.firebasestorage.app",
  messagingSenderId: "921605423315",
  appId: "1:921605423315:web:159210ab3366d280c75426",
  measurementId: "G-YVHX9QRBW7",
};

// Init Firebase services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Auth functions
export const signupUser = async (email, password) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(userCredential.user);
    await signOut(auth);
    return { success: true, message: 'Verification email sent. Please verify before logging in.' };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    if (!user.emailVerified) {
      await signOut(auth);
      return { success: false, message: 'Please verify your email before logging in.' };
    }
    return { success: true, user };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const logoutUser = async () => {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const monitorAuthState = (callback) => {
  onAuthStateChanged(auth, (user) => {
    callback(user);
  });
};

// Profile functions
export const uploadProfilePicture = async (userId, imageUri) => {
  try {
    const response = await fetch(imageUri);
    const blob = await response.blob();
    const imageRef = ref(storage, `profile_images/${userId}.jpg`);
    await uploadBytes(imageRef, blob);
    const downloadURL = await getDownloadURL(imageRef);
    return downloadURL;
  } catch (error) {
    console.error("❌ Image upload failed:", error);
    return null;
  }
};

export const saveUserProfile = async (userId, username, imageUrl) => {
  try {
    await setDoc(doc(db, "users", userId), {
      username,
      imageUrl,
    });
  } catch (error) {
    console.error("Failed to save user profile:", error);
  }
};

export const getUserProfile = async (userId) => {
  try {
    const docRef = doc(db, "users", userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data();
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return null;
  }
};

// Sessions
export const createSession = async (userId, audioUri) => {
  try {
    const response = await fetch(audioUri);
    const blob = await response.blob();

    const audioRef = ref(storage, `audio/${userId}/${Date.now()}.m4a`);
    await uploadBytes(audioRef, blob);
    const audioUrl = await getDownloadURL(audioRef);

    await addDoc(collection(db, "sessions"), {
      userId,
      audioUrl,
      transcript: "",
      feedback: [],
      speed: null,
      volume: null,
      fillerWordCount: null,
      fillerWords: [],
      duration: null,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("❌ Failed to create session:", error);
  }
};

export const getUserSessions = async (userId) => {
  try {
    const q = query(collection(db, "sessions"), where("userId", "==", userId));
    const querySnapshot = await getDocs(q);
    const sessions = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    return sessions;
  } catch (error) {
    console.error("❌ Failed to fetch sessions:", error);
    return [];
  }
};

export const deleteSession = async (sessionId, audioUrl) => {
  try {
    // Delete the audio file from storage
    const storageRef = ref(storage, decodeURIComponent(new URL(audioUrl).pathname.split("/o/")[1]));
    await deleteObject(storageRef);

    // Delete the document from Firestore
    await deleteDoc(doc(db, "sessions", sessionId));

    console.log("🗑️ Session deleted:", sessionId);
    return true;
  } catch (error) {
    console.error("❌ Failed to delete session:", error);
    return false;
  }
};

// Function to upload audio to Firebase, send it to the backend for transcription, and upload the duration
export const uploadFirebase = async (userId, audioUri) => {
  try {
    // Fetch the file from the audio URI
    const response = await fetch(audioUri);
    const blob = await response.blob();

    // Create a reference to Firebase Storage
    const audioRef = ref(storage, `audio/${userId}/${Date.now()}.m4a`);

    // Upload the audio file to Firebase Storage
    await uploadBytes(audioRef, blob);

    // Get the download URL of the uploaded audio file
    const audioUrl = await getDownloadURL(audioRef);

    // Now send the audio file to your Flask backend for transcription
    const formData = new FormData();
    formData.append('audio', {
      uri: audioUri,
      name: 'audioFile.m4a',
      type: 'audio/m4a',
    });

    // Send the audio file to Flask for transcription
    const responseBackend = await axios.post('http://192.168.4.118:5000/transcribe', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    // Assuming the backend returns the transcript in the response
    const transcript = responseBackend.data.transcript || "";

    // Create a sound object to calculate the duration
    const { sound } = await Audio.Sound.createAsync({ uri: audioUri });

    // Get the audio duration from the sound object
    const status = await sound.getStatusAsync();
    const audioDuration = status.durationMillis / 1000; // Convert milliseconds to seconds

    console.log('Audio duration:', audioDuration); // Log the duration to ensure it's correct

    // Calculate words per minute (WPM) from transcript
    const wordCount = transcript ? transcript.split(/\s+/).length : 0; // Word count based on spaces
    const minutes = audioDuration / 60; // Convert seconds to minutes
    const speed = minutes > 0 ? Math.round(wordCount / minutes) : 0; // Calculate WPM

    console.log('Calculated speed (WPM):', speed); // Log the calculated WPM

    // Create a new session in Firestore with the audio URL, transcript, speed, and duration
    await addDoc(collection(db, "sessions"), {
      userId,
      audioUrl,
      transcript,
      feedback: [],  // Placeholder, to be filled later if necessary
      speed, // Upload the calculated speed (WPM)
      volume: null,
      fillerWordCount: null,
      fillerWords: [],  // Placeholder, to be filled later
      duration: audioDuration,  // Upload the duration here
      createdAt: serverTimestamp(),
    });

    console.log("✅ Audio uploaded, transcription saved to Firestore, speed and duration uploaded.");

  } catch (error) {
    console.error("❌ Error uploading audio, transcription, speed, and duration:", error);
  }
};

export {
  auth,
  db,
  storage,
};

export default app;
