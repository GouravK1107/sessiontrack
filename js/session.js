import { auth, db } from "../firebase.js";
import { 
    collection,
    getDocs,
    query,
    where,
    orderBy,
    deleteDoc,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

let currentUser = null;
let allSessions = [];
let activeFilter = "all";
let searchQuery = "";

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

function parseD(str) {
  try {
    const [d, mn, y] = str.split(" ");
    const mo = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    return new Date(+y, mo[mn], +d);
  } catch {
    return null;
  }
}

/* ── DARK MODE ── */
const getDk = () => localStorage.getItem("st_dark") === "1";
const putDk = (v) => localStorage.setItem("st_dark", v ? "1" : "0");
function applyDk(on) {
  document.documentElement.setAttribute("data-theme", on ? "dark" : "light");
  const i = $("dIco"), l = $("dLbl");
  if (i) i.className = on ? "fas fa-sun" : "fas fa-moon";
  if (l) l.textContent = on ? "Light" : "Dark";
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
  t.innerHTML = `<i class="fas fa-${type === "ok" ? "check-circle" : type === "warn" ? "exclamation-triangle" : "info-circle"}"></i> ${msg}`;
  t.className = `tst show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => {
    t.className = "tst";
  }, 3200);
}

/* ── SIDEBAR ── */
function toggleSb() {
  $("sb").classList.toggle("open");
  $("sbo").classList.toggle("on");
}
function closeSb() {
  $("sb").classList.remove("open");
  $("sbo").classList.remove("on");
}

/* ── LOAD USER PROFILE ── */
async function loadUserProfile() {
  if (!currentUser) return;
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      const name = data.name || currentUser.email?.split('@')[0] || "User";
      const role = data.role || "SessionTrack member";
      const color = data.color || "linear-gradient(135deg,#2152e0,#b84a8c)";
      const avatarInitials = initials(name);
      
      if ($("sbAva")) {
        $("sbAva").textContent = avatarInitials;
        $("sbAva").style.background = color;
      }
      if ($("sbName")) $("sbName").textContent = name;
      if ($("sbRole")) $("sbRole").textContent = role;
      
      initHdr(name);
    } else {
      const defaultName = currentUser.email?.split('@')[0] || "User";
      if ($("sbAva")) $("sbAva").textContent = initials(defaultName);
      if ($("sbName")) $("sbName").textContent = defaultName;
      initHdr(defaultName);
    }
  } catch (error) {
    console.error("Error loading profile:", error);
  }
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function initHdr(name = "User") {
  const n = new Date();
  const hd = $("hdrDate");
  if (hd) {
    hd.textContent = n.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  const h = n.getHours();
  const firstName = name.split(" ")[0];
  const gt = $("greetTxt");
  if (gt) {
    gt.textContent = `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${firstName} 👋`;
  }
}

/* ── LOAD SESSIONS FROM FIREBASE ── */
async function loadSessions() {
  if (!currentUser) return [];
  
  try {
    const sessionsRef = collection(db, "sessions");
    const q = query(
      sessionsRef,
      where("userId", "==", currentUser.uid),
      orderBy("ts", "desc")
    );
    const snapshot = await getDocs(q);
    allSessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    return allSessions;
  } catch (error) {
    console.error("Error loading sessions:", error);
    toast("Failed to load sessions", "warn");
    return [];
  }
}

/* ── DELETE SESSION ── */
async function deleteSession(sessionId) {
  if (!currentUser) return;
  
  try {
    await deleteDoc(doc(db, "sessions", sessionId));
    toast("Session deleted", "warn");
    await loadSessions();
    renderSessions();
  } catch (error) {
    console.error("Error deleting session:", error);
    toast("Failed to delete session", "warn");
  }
}

/* ── CATEGORY CLASSES ── */
const CC = {
  "Deep Work": "cp-d",
  Learning: "cp-l",
  "Normal Work": "cp-n",
  "Low Productivity": "cp-w",
};

/* ── RENDER SESSION ROW ── */
function mkRow(s, withProj = true) {
  return `<tr>
    <td style="color:var(--tm);font-size:.74rem">${s.date}</td>
    <td style="font-family:var(--m);font-size:.72rem">${s.start}</td>
    <td style="font-family:var(--m);font-size:.72rem">${s.end}</td>
    <td style="font-family:var(--m);font-weight:500;color:var(--th)">${fmtHM(s.duration)}</td>
    <td><span class="cp ${CC[s.category] || "cp-n"}">${s.category}</span></td>
    ${withProj ? `<td style="font-size:.74rem">${s.project && s.project !== "—" ? s.project : "—"}</td>` : ""}
    <td style="font-size:.74rem;max-width:160px;white-space:normal">${s.task}</td>
    <td><button class="delbtn" onclick="window.delRow('${s.id}')"><i class="fas fa-trash"></i></button></td>
  </tr>`;
}

/* ── FILTER AND SEARCH SESSIONS ── */
function getFilteredSessions() {
  let filtered = [...allSessions];
  
  if (activeFilter !== "all") {
    filtered = filtered.filter(s => s.category === activeFilter);
  }
  
  if (searchQuery) {
    const queryLower = searchQuery.toLowerCase();
    filtered = filtered.filter(s =>
      (s.task + s.category + (s.project || "") + s.date)
        .toLowerCase()
        .includes(queryLower)
    );
  }
  
  return filtered;
}

/* ── RENDER SESSIONS TABLE ── */
function renderSessions() {
  const filtered = getFilteredSessions();
  const totalSeconds = filtered.reduce((a, s) => a + s.duration, 0);
  
  $("sessCount").textContent = 
    `${filtered.length} session${filtered.length !== 1 ? "s" : ""} · ${fmtHM(totalSeconds)} total`;
  $("sessSub").textContent = `${allSessions.length} sessions recorded`;
  
  if (filtered.length) {
    $("sessBody").innerHTML = filtered.map(s => mkRow(s, true)).join("");
  } else {
    $("sessBody").innerHTML = `发展<td class="etd" colspan="8">
      <i class="fas fa-inbox" style="font-size:1.1rem;opacity:.22;display:block;margin-bottom:.3rem"></i>
      ${searchQuery || activeFilter !== "all" ? "No matches found" : "No sessions yet — start one from Dashboard!"}
    </td></tr>`;
  }
}

/* ── SEARCH HANDLER ── */
function onSearch(value) {
  searchQuery = value.toLowerCase().trim();
  renderSessions();
}

/* ── FILTER HANDLER ── */
function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll(".sf-btn").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  renderSessions();
}

/* ── DELETE ROW (GLOBAL) ── */
window.delRow = async (id) => {
  if (!confirm("Delete this session?")) return;
  await deleteSession(id);
};

/* ── CLEAR ALL SESSIONS ── */
async function clearAll() {
  if (!allSessions.length) return toast("No sessions to clear", "warn");
  if (!confirm("Delete ALL sessions? This cannot be undone.")) return;
  
  for (const session of allSessions) {
    await deleteDoc(doc(db, "sessions", session.id));
  }
  
  await loadSessions();
  renderSessions();
  toast("All sessions cleared", "warn");
}

/* ── AUTH LISTENER ── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  
  currentUser = user;
  await loadUserProfile();
  await loadSessions();
  renderSessions();
  
  setInterval(initHdr, 60000);
});

/* ── LOGOUT FUNCTION ── */
async function logout() {
  try {
    // Clear timer if running (for dashboard)
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    // Clear saved timer state
    localStorage.removeItem("activeTimer");
    
    // Sign out from Firebase
    await auth.signOut();
    
    // Clear any other user data from localStorage
    localStorage.removeItem("st_profile");
    
    // Redirect to login page
    window.location.href = "login.html";
  } catch (error) {
    console.error("Error during logout:", error);
    toast("Failed to logout. Please try again.", "error");
  }
}

/* ── EXPOSE GLOBAL FUNCTIONS ── */
window.toggleDark = toggleDark;
window.toggleSb = toggleSb;
window.closeSb = closeSb;
window.clearAll = clearAll;
window.onSearch = onSearch;
window.setFilter = setFilter;
window.delRow = delRow;
window.logout = logout;