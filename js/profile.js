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

// Theme variables
let selectedColor = null;
let selectedTheme = null;
let selectedGlow = null;

// Default themes
const DEFAULT_COLOR = "linear-gradient(135deg,#2152e0,#b84a8c)";
const DEFAULT_THEME = "linear-gradient(155deg,#1a3fcc 0%,#2152e0 45%,#3b60e8 75%,#b84a8c 100%)";
const DEFAULT_GLOW = "rgba(33,82,224,0.28)";

/* ── UTILS ── */
const getEl = (id) => document.getElementById(id);
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
  const dIco = getEl("dIco");
  const dLbl = getEl("dLbl");
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
  const t = getEl("toast");
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

/* ── HEX TO RGBA HELPER ── */
function hexToRgba(hex, alpha = 0.28) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── APPLY PROFILE THEME ── */
function applyProfileTheme(color, theme, glow) {
  const heroAva = getEl("heroAva");
  const heroBanner = document.querySelector(".hero-banner");
  const bgAmbient = document.querySelector(".bg-ambient");
  
  if (heroAva && color) {
    heroAva.style.background = color;
  }
  
  if (heroBanner) {
    heroBanner.style.setProperty("--profile-theme", theme || DEFAULT_THEME);
    heroBanner.style.setProperty("--profile-glow", glow || DEFAULT_GLOW);
  }
  
  if (bgAmbient) {
    bgAmbient.style.setProperty("--profile-glow", glow || DEFAULT_GLOW);
  }
}

/* ── LOAD USER SESSIONS FROM FIRESTORE ── */
async function loadUserSessions() {
  if (!currentUser) return [];
  
  try {
    const sessionsRef = collection(db, "sessions");
    const q = query(
      sessionsRef,
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    userSessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
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
      const fName = getEl("fName");
      const fRole = getEl("fRole");
      const fCollege = getEl("fCollege");
      const fLocation = getEl("fLocation");
      const fGithub = getEl("fGithub");
      const fPortfolio = getEl("fPortfolio");
      const fBio = getEl("fBio");
      
      if (fName) fName.value = data.name || "";
      if (fRole) fRole.value = data.role || "";
      if (fCollege) fCollege.value = data.college || "";
      if (fLocation) fLocation.value = data.location || "";
      if (fGithub) fGithub.value = data.github || "";
      if (fPortfolio) fPortfolio.value = data.portfolio || "";
      if (fBio) fBio.value = data.bio || "";
      
      // Load theme data
      selectedColor = data.color || DEFAULT_COLOR;
      selectedTheme = data.theme || DEFAULT_THEME;
      selectedGlow = data.glow || DEFAULT_GLOW;
      
      // Find and select matching theme dot
      const themeDots = document.querySelectorAll(".theme-dot");
      let themeFound = false;
      themeDots.forEach(dot => {
        if (dot.dataset.theme === selectedTheme) {
          dot.classList.add("selected");
          themeFound = true;
        } else {
          dot.classList.remove("selected");
        }
      });
      
      // If no matching dot, just apply the saved theme
      applyProfileTheme(selectedColor, selectedTheme, selectedGlow);
      
      // Update hero avatar preview
      const heroAva = getEl("heroAva");
      const heroName = getEl("heroName");
      const heroRole = getEl("heroRole");
      if (heroAva) heroAva.style.background = selectedColor;
      if (heroName && data.name) heroName.textContent = data.name;
      if (heroRole && data.role) heroRole.textContent = data.role;
      
      return data;
    } else {
      // New user - set defaults
      selectedColor = DEFAULT_COLOR;
      selectedTheme = DEFAULT_THEME;
      selectedGlow = DEFAULT_GLOW;
      
      // Select first theme dot by default
      const firstDot = document.querySelector(".theme-dot");
      if (firstDot) {
        document.querySelectorAll(".theme-dot").forEach(d => d.classList.remove("selected"));
        firstDot.classList.add("selected");
      }
      
      applyProfileTheme(selectedColor, selectedTheme, selectedGlow);
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
  
  const fName = getEl("fName");
  const name = fName ? fName.value.trim() : "";
  
  if (!name) {
    if (fName) fName.focus();
    toast("Please enter your name", "error");
    return false;
  }
  
  const saveBtn = getEl("saveBtn");
  const originalText = saveBtn ? saveBtn.innerHTML : "";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }
  
  const profileData = {
    name: name,
    role: getEl("fRole")?.value.trim() || "SessionTrack member",
    college: getEl("fCollege")?.value.trim() || "",
    location: getEl("fLocation")?.value.trim() || "",
    github: getEl("fGithub")?.value.trim() || "",
    portfolio: getEl("fPortfolio")?.value.trim() || "",
    bio: getEl("fBio")?.value.trim() || "",
    color: selectedColor || DEFAULT_COLOR,
    theme: selectedTheme || DEFAULT_THEME,
    glow: selectedGlow || DEFAULT_GLOW,
    email: currentUser.email,
    updatedAt: new Date().toISOString()
  };
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await setDoc(userRef, profileData, { merge: true });
    
    toast("Profile saved successfully! ✓", "ok");
    
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 1500);
    
    await updateHero();
    await loadActivity();
    return true;
  } catch (error) {
    console.error("Error saving profile:", error);
    toast("Failed to save profile. Please try again.", "error");
    
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
    let color = DEFAULT_COLOR;
    let theme = DEFAULT_THEME;
    let glow = DEFAULT_GLOW;
    let college = "", location = "", github = "", portfolio = "";
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      name = data.name || currentUser.email?.split('@')[0] || "User";
      role = data.role || "SessionTrack member";
      color = data.color || DEFAULT_COLOR;
      theme = data.theme || DEFAULT_THEME;
      glow = data.glow || DEFAULT_GLOW;
      college = data.college || "";
      location = data.location || "";
      github = data.github || "";
      portfolio = data.portfolio || "";
    } else {
      name = currentUser.email?.split('@')[0] || "User";
    }
    
    // Apply theme
    applyProfileTheme(color, theme, glow);
    
    // Update avatar and text
    const heroAva = getEl("heroAva");
    const heroName = getEl("heroName");
    const heroRole = getEl("heroRole");
    const heroChips = getEl("heroChips");
    
    if (heroAva) {
      heroAva.textContent = initials(name);
      heroAva.style.background = color;
    }
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
    
    const hsTot = getEl("hsTot");
    const hsSess = getEl("hsSess");
    const hsStreak = getEl("hsStreak");
    
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

  const actTotal = getEl("actTotal");
  const actDeep = getEl("actDeep");
  const actSess = getEl("actSess");
  const actStreak = getEl("actStreak");
  const actLearn = getEl("actLearn");
  const actDays = getEl("actDays");
  
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
  
  const recentSub = getEl("recentSub");
  const sessListEl = getEl("sessListEl");
  
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

/* ── PICK COLOR / THEME ── */
window.pickColor = (dot) => {
  document.querySelectorAll(".theme-dot, .color-dot").forEach(d => d.classList.remove("selected"));
  dot.classList.add("selected");
  
  selectedColor = dot.dataset.color || DEFAULT_COLOR;
  selectedTheme = dot.dataset.theme || dot.dataset.color || DEFAULT_THEME;
  selectedGlow = dot.dataset.glow || DEFAULT_GLOW;
  
  applyProfileTheme(selectedColor, selectedTheme, selectedGlow);
};

/* ── APPLY CUSTOM THEME ── */
window.applyCustomTheme = () => {
  const input = getEl("customThemeColor");
  const hex = input?.value || "#2152e0";
  
  selectedColor = `linear-gradient(135deg,${hex},#111827)`;
  selectedTheme = `linear-gradient(155deg,${hex} 0%,#1a1a2e 45%,#0d0d1a 100%)`;
  selectedGlow = hexToRgba(hex, 0.28);
  
  // Remove selection from preset dots
  document.querySelectorAll(".theme-dot, .color-dot").forEach(d => d.classList.remove("selected"));
  
  applyProfileTheme(selectedColor, selectedTheme, selectedGlow);
  toast("Custom theme applied! Save to keep it.", "info");
};

/* ── LIVE PREVIEW ── */
const fName = getEl("fName");
const fRole = getEl("fRole");
const heroAva = getEl("heroAva");
const heroName = getEl("heroName");
const heroRole = getEl("heroRole");

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

/* ── SAVE PROFILE WRAPPER ── */
window.saveProfile = async () => {
  await saveProfileToFirestore();
};

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

window.toggleDark = toggleDark;