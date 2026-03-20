import { auth, db } from "../firebase.js";
import { 
    doc, 
    getDoc, 
    setDoc,
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

let currentUser = null;
let userSessions = [];

/* ── UTILS ── */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
function fmtDate(d) {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtHM(s) {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}

/* ── DARK MODE ── */
const getDk = () => localStorage.getItem("st_dark") === "1";
const putDk = (v) => localStorage.setItem("st_dark", v ? "1" : "0");
function applyDk(on) {
  document.documentElement.setAttribute("data-theme", on ? "dark" : "light");
  const dIco = $("dIco");
  const dLbl = $("dLbl");
  if (dIco) dIco.className = on ? "fas fa-sun" : "fas fa-moon";
  if (dLbl) dLbl.textContent = on ? "Light" : "Dark";
}
function toggleDark() {
  const on = document.documentElement.getAttribute("data-theme") === "light";
  applyDk(on);
  putDk(on);
}
applyDk(getDk());

/* ── TOAST ── */
function toast(msg, type = "info") {
  const t = $("toast");
  if (!t) return;
  t.innerHTML = `<i class="fas fa-${type === "ok" ? "check-circle" : type === "error" ? "exclamation-circle" : "info-circle"}"></i> ${msg}`;
  t.className = `tst show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => {
    t.className = "tst";
  }, 3000);
}

/* ── INITIALS ── */
function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

/* ── STREAK ── */
function calcStreak(all) {
  const days = new Set(all.map((s) => s.date));
  let n = 0,
    d = new Date();
  d.setHours(0, 0, 0, 0);
  while (days.has(fmtDate(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/* ── SELECTED COLOR ── */
let selectedColor = null;

/* ── LOAD USER SESSIONS FROM FIRESTORE ── */
async function loadUserSessions() {
  if (!currentUser) return [];
  
  try {
    const sessionsRef = collection(db, "sessions");
    const q = query(
      sessionsRef,
      where("userId", "==", currentUser.uid)
      // Note: orderBy removed temporarily - will add back after index is created
    );
    const snapshot = await getDocs(q);
    userSessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    // Sort manually by timestamp (newest first)
    userSessions.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return userSessions;
  } catch (error) {
    console.error("Error loading sessions:", error);
    return [];
  }
}

/* ── LOAD PROFILE FROM FIRESTORE ── */
async function loadProfileFromFirestore() {
  if (!currentUser) return null;
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      // Load into form
      const fName = $("fName");
      const fRole = $("fRole");
      const fCollege = $("fCollege");
      const fLocation = $("fLocation");
      const fGithub = $("fGithub");
      const fPortfolio = $("fPortfolio");
      const fBio = $("fBio");
      
      if (fName) fName.value = data.name || "";
      if (fRole) fRole.value = data.role || "";
      if (fCollege) fCollege.value = data.college || "";
      if (fLocation) fLocation.value = data.location || "";
      if (fGithub) fGithub.value = data.github || "";
      if (fPortfolio) fPortfolio.value = data.portfolio || "";
      if (fBio) fBio.value = data.bio || "";
      
      // Select color
      if (data.color) {
        const dot = document.querySelector(`.color-dot[data-color="${data.color}"]`);
        if (dot) {
          document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("selected"));
          dot.classList.add("selected");
          selectedColor = data.color;
        }
      } else {
        const first = document.querySelector(".color-dot");
        if (first) {
          first.classList.add("selected");
          selectedColor = first.dataset.color;
        }
      }
      
      return data;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error loading profile:", error);
    return null;
  }
}

/* ── SAVE PROFILE TO FIRESTORE WITH REDIRECT ── */
async function saveProfileToFirestore() {
  if (!currentUser) {
    toast("Please log in first", "error");
    return false;
  }
  
  const fName = $("fName");
  const name = fName ? fName.value.trim() : "";
  
  if (!name) {
    if (fName) fName.focus();
    toast("Please enter your name", "error");
    return false;
  }
  
  // Show saving state
  const saveBtn = $("saveBtn");
  const originalText = saveBtn ? saveBtn.innerHTML : "";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }
  
  const profileData = {
    name: name,
    role: $("fRole")?.value.trim() || "SessionTrack member",
    college: $("fCollege")?.value.trim() || "",
    location: $("fLocation")?.value.trim() || "",
    github: $("fGithub")?.value.trim() || "",
    portfolio: $("fPortfolio")?.value.trim() || "",
    bio: $("fBio")?.value.trim() || "",
    color: selectedColor || "linear-gradient(135deg,#2152e0,#b84a8c)",
    email: currentUser.email,
    updatedAt: new Date().toISOString()
  };
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await setDoc(userRef, profileData, { merge: true });
    
    // Show success toast
    toast("Profile saved successfully! ✓", "ok");
    
    // Wait a moment for user to see the success message
    setTimeout(() => {
      // Redirect to dashboard
      window.location.href = "dashboard.html";
    }, 1500);
    
    await updateHero();
    await loadActivity();
    return true;
  } catch (error) {
    console.error("Error saving profile:", error);
    toast("Failed to save profile. Please try again.", "error");
    
    // Restore button
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
    }
    return false;
  }
}

/* ── UPDATE HERO BANNER ── */
async function updateHero() {
  if (!currentUser) return;
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    
    let name = "User";
    let role = "SessionTrack member";
    let color = "linear-gradient(135deg,#2152e0,#b84a8c)";
    let college = "", location = "", github = "", portfolio = "";
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      name = data.name || currentUser.email?.split('@')[0] || "User";
      role = data.role || "SessionTrack member";
      color = data.color || "linear-gradient(135deg,#2152e0,#b84a8c)";
      college = data.college || "";
      location = data.location || "";
      github = data.github || "";
      portfolio = data.portfolio || "";
    } else {
      name = currentUser.email?.split('@')[0] || "User";
    }
    
    const ava = initials(name);
    
    const heroAva = $("heroAva");
    const heroName = $("heroName");
    const heroRole = $("heroRole");
    const heroChips = $("heroChips");
    
    if (heroAva) heroAva.textContent = ava;
    if (heroAva) heroAva.style.background = color;
    if (heroName) heroName.textContent = name;
    if (heroRole) heroRole.textContent = role;
    
    // Chips
    const chips = [];
    if (college) chips.push(`<span class="hero-chip"><i class="fas fa-graduation-cap"></i>${college}</span>`);
    if (location) chips.push(`<span class="hero-chip"><i class="fas fa-map-marker-alt"></i>${location}</span>`);
    if (github) chips.push(`<span class="hero-chip"><i class="fab fa-github"></i>${github}</span>`);
    if (portfolio) chips.push(`<span class="hero-chip"><i class="fas fa-globe"></i>${portfolio}</span>`);
    if (heroChips) heroChips.innerHTML = chips.join("");
    
    // Hero stats
    await loadUserSessions();
    const totSecs = userSessions.reduce((a, s) => a + s.duration, 0);
    const streak = calcStreak(userSessions);
    
    const hsTot = $("hsTot");
    const hsSess = $("hsSess");
    const hsStreak = $("hsStreak");
    
    if (hsTot) hsTot.textContent = Math.round(totSecs / 3600) + "h";
    if (hsSess) hsSess.textContent = userSessions.length;
    if (hsStreak) hsStreak.textContent = streak;
    
  } catch (error) {
    console.error("Error updating hero:", error);
  }
}

/* ── ACTIVITY STATS ── */
async function loadActivity() {
  await loadUserSessions();
  const totSecs = userSessions.reduce((a, s) => a + s.duration, 0);
  const deepSecs = userSessions
    .filter((s) => s.category === "Deep Work")
    .reduce((a, s) => a + s.duration, 0);
  const learnSecs = userSessions
    .filter((s) => s.category === "Learning")
    .reduce((a, s) => a + s.duration, 0);
  const streak = calcStreak(userSessions);
  const days = new Set(userSessions.map((s) => s.date)).size;

  const actTotal = $("actTotal");
  const actDeep = $("actDeep");
  const actSess = $("actSess");
  const actStreak = $("actStreak");
  const actLearn = $("actLearn");
  const actDays = $("actDays");
  
  if (actTotal) actTotal.textContent = Math.round(totSecs / 3600) + "h";
  if (actDeep) actDeep.textContent = Math.round(deepSecs / 3600) + "h";
  if (actSess) actSess.textContent = userSessions.length;
  if (actStreak) actStreak.textContent = streak;
  if (actLearn) actLearn.textContent = Math.round(learnSecs / 3600) + "h";
  if (actDays) actDays.textContent = days;
}

/* ── RECENT SESSIONS ── */
const CC = {
  "Deep Work": "cp-d",
  Learning: "cp-l",
  "Normal Work": "cp-n",
  "Low Productivity": "cp-w",
};

async function loadRecentSess() {
  await loadUserSessions();
  const recentSessions = userSessions.slice(0, 6);
  
  const recentSub = $("recentSub");
  const sessListEl = $("sessListEl");
  
  if (recentSub) recentSub.textContent = `${recentSessions.length} of ${userSessions.length} sessions`;
  
  if (!sessListEl) return;
  
  if (!recentSessions.length) {
    sessListEl.innerHTML = `
      <div class="empty-act">
        <i class="fas fa-stopwatch"></i>
        No sessions logged yet.<br>Head to the dashboard to start one!
      </div>`;
    return;
  }
  
  sessListEl.innerHTML = recentSessions
    .map(
      (s) => `
    <div class="sess-item">
      <span class="sess-cat ${CC[s.category] || "cp-n"}">${s.category}</span>
      <span class="sess-proj">${s.project && s.project !== "—" ? s.project : "Untitled"}</span>
      <span class="sess-task">${s.task}</span>
      <span class="sess-dur">${fmtHM(s.duration)}</span>
    </div>`
    )
    .join("");
}

/* ── EXPOSE FUNCTIONS TO GLOBAL SCOPE ── */
window.saveProfile = async () => {
  await saveProfileToFirestore();
};

window.pickColor = (dot) => {
  document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("selected"));
  dot.classList.add("selected");
  selectedColor = dot.dataset.color;
  const heroAva = $("heroAva");
  if (heroAva) heroAva.style.background = selectedColor;
};

window.toggleDark = toggleDark;

/* ── LIVE PREVIEW ── */
const fName = $("fName");
const fRole = $("fRole");
const heroAva = $("heroAva");
const heroName = $("heroName");
const heroRole = $("heroRole");

if (fName) {
  fName.addEventListener("input", function () {
    const n = this.value.trim() || "?";
    if (heroAva) heroAva.textContent = initials(n);
    if (heroName) heroName.textContent = n || "Your Name";
  });
}

if (fRole) {
  fRole.addEventListener("input", function () {
    if (heroRole) heroRole.textContent = this.value.trim() || "Your role";
  });
}

/* ── AUTH LISTENER ── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  
  currentUser = user;
  
  await loadProfileFromFirestore();
  await updateHero();
  await loadActivity();
  await loadRecentSess();
});