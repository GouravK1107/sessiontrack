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
let searchDebounceTimer = null;

// Points per hour for each category
const POINTS_PER_HOUR = {
  "Deep Work": 20,
  "Learning": 15,
  "Normal Work": 10,
  "Low Productivity": 5
};

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

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── CALCULATE POINTS FOR A SESSION ── */
function getSessionPoints(session) {
  const hours = session.duration / 3600;
  const pointsPerHour = POINTS_PER_HOUR[session.category] || 5;
  return Math.round(hours * pointsPerHour);
}

/* ── HELPER FUNCTIONS FOR STATS ── */
function getTotalDuration(sessions) {
  return sessions.reduce((a, s) => a + s.duration, 0);
}

function getTotalPoints(sessions) {
  return sessions.reduce((sum, s) => sum + getSessionPoints(s), 0);
}

function getBestCategory(sessions) {
  const breakdown = {};
  sessions.forEach(s => {
    breakdown[s.category] = (breakdown[s.category] || 0) + s.duration;
  });
  let best = null;
  let max = 0;
  for (const [cat, secs] of Object.entries(breakdown)) {
    if (secs > max) {
      max = secs;
      best = cat;
    }
  }
  return best;
}

function getAverageDuration(sessions) {
  if (sessions.length === 0) return 0;
  return getTotalDuration(sessions) / sessions.length;
}

function updateSummaryStats() {
  const totalSessions = allSessions.length;
  const totalTime = getTotalDuration(allSessions);
  const totalPoints = getTotalPoints(allSessions);
  const bestCategory = getBestCategory(allSessions);
  
  const statTotalSessions = getEl("statTotalSessions");
  const statTotalTime = getEl("statTotalTime");
  const statTotalPoints = getEl("statTotalPoints");
  const statBestCategory = getEl("statBestCategory");
  
  if (statTotalSessions) statTotalSessions.textContent = totalSessions;
  if (statTotalTime) statTotalTime.textContent = fmtHM(totalTime);
  if (statTotalPoints) statTotalPoints.textContent = totalPoints;
  if (statBestCategory) statBestCategory.textContent = bestCategory ? (bestCategory === "Deep Work" ? "🧠 Deep" : bestCategory === "Learning" ? "📚 Learning" : bestCategory === "Normal Work" ? "💼 Normal" : "😴 Low") : "—";
}

/* ── DARK MODE ── */
const getDk = () => localStorage.getItem("st_dark") === "1";
const putDk = (v) => localStorage.setItem("st_dark", v ? "1" : "0");
function applyDk(on) {
  document.documentElement.setAttribute("data-theme", on ? "dark" : "light");
  const i = getEl("dIco"), l = getEl("dLbl");
  if (i) i.className = on ? "fas fa-sun" : "fas fa-moon";
  if (l) l.textContent = on ? "Light" : "Dark";
}
function toggleDark() {
  const on = document.documentElement.getAttribute("data-theme") === "light";
  applyDk(on);
  putDk(on);
}
applyDk(getDk());

function toast(msg, type = "info") {
  const t = getEl("toast");
  t.innerHTML = `<i class="fas fa-${type === "ok" ? "check-circle" : type === "warn" ? "exclamation-triangle" : "info-circle"}"></i> ${msg}`;
  t.className = `tst show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => {
    t.className = "tst";
  }, 3200);
}

function toggleSb() {
  const sb = getEl("sb");
  const sbo = getEl("sbo");
  if (sb) sb.classList.toggle("open");
  if (sbo) sbo.classList.toggle("on");
}
function closeSb() {
  const sb = getEl("sb");
  const sbo = getEl("sbo");
  if (sb) sb.classList.remove("open");
  if (sbo) sbo.classList.remove("on");
}

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
      
      const sbAva = getEl("sbAva");
      if (sbAva) {
        sbAva.textContent = avatarInitials;
        sbAva.style.background = color;
      }
      const sbName = getEl("sbName");
      if (sbName) sbName.textContent = name;
      const sbRole = getEl("sbRole");
      if (sbRole) sbRole.textContent = role;
      
      initHdr(name);
    } else {
      const defaultName = currentUser.email?.split('@')[0] || "User";
      const sbAva = getEl("sbAva");
      if (sbAva) sbAva.textContent = initials(defaultName);
      const sbName = getEl("sbName");
      if (sbName) sbName.textContent = defaultName;
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
  const hd = getEl("hdrDate");
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
  const greetTime = `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${firstName}`;
  
  // Update subtitle only, keep page title as "Sessions 📋"
  const sub = getEl("greetSub");
  if (sub) {
    sub.textContent = `${greetTime} · Browse, filter and manage your logged sessions`;
  }
}

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
    updateSummaryStats();
    return allSessions;
  } catch (error) {
    console.error("Error loading sessions:", error);
    toast("Failed to load sessions", "warn");
    return [];
  }
}

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
  const points = getSessionPoints(s);
  return `<tr>
    <td style="color:var(--tm);font-size:.74rem">${escapeHtml(s.date)}
    <td style="font-family:var(--m);font-size:.72rem">${escapeHtml(s.start)}
    <td style="font-family:var(--m);font-size:.72rem">${escapeHtml(s.end)}
    <td style="font-family:var(--m);font-weight:500;color:var(--th)">${fmtHM(s.duration)}
    <td><span class="points-badge">${points} pts</span>
    <td><span class="cp ${CC[s.category] || "cp-n"}">${escapeHtml(s.category)}</span>
    ${withProj ? `<td style="font-size:.74rem;color:var(--tm)">${escapeHtml(s.project && s.project !== "—" ? s.project : "—")}` : ""}
    <td style="font-size:.74rem;max-width:160px;white-space:normal;color:var(--tm)" title="${escapeHtml(s.task)}">${escapeHtml(s.task.length > 40 ? s.task.substring(0, 40) + "..." : s.task)}
    <td><button class="delbtn" onclick="window.delRow('${s.id}')" aria-label="Delete session"><i class="fas fa-trash"></i></button>
  </td>`;
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
      (s.task + s.category + (s.project || "") + s.date + fmtHM(s.duration))
        .toLowerCase()
        .includes(queryLower)
    );
  }
  
  return filtered;
}

/* ── RENDER EMPTY STATE ── */
function renderEmptyState(type) {
  const sessBody = getEl("sessBody");
  if (!sessBody) return;
  
  if (type === "no-sessions") {
    sessBody.innerHTML = `<tr><td class="etd" colspan="9">
      <i class="fas fa-inbox"></i>
      <p>No sessions logged yet</p>
      <small>Start a focus session from the Dashboard to build your history.</small>
      <button class="cbtn" style="margin-top:0.75rem;" onclick="window.location.href='dashboard.html'">Go to Dashboard →</button>
    </td></tr>`;
  } else {
    sessBody.innerHTML = `<tr><td class="etd" colspan="9">
      <i class="fas fa-filter"></i>
      <p>No matching sessions</p>
      <small>Try clearing the search or changing the filter.</small>
      <button class="cbtn" style="margin-top:0.75rem;" onclick="clearSearch(); setFilter('all', document.querySelector('.sf-btn.on'));">Clear Filters →</button>
    </td></tr>`;
  }
}

/* ── RENDER SESSIONS TABLE ── */
function renderSessions() {
  const filtered = getFilteredSessions();
  const totalSeconds = getTotalDuration(filtered);
  const totalPoints = getTotalPoints(filtered);
  
  const sessCount = getEl("sessCount");
  if (sessCount) {
    sessCount.textContent = `${filtered.length} session${filtered.length !== 1 ? "s" : ""} · ${totalPoints} pts · ${fmtHM(totalSeconds)}`;
  }
  
  const sessSub = getEl("sessSub");
  if (sessSub) {
    sessSub.textContent = `${allSessions.length} total session${allSessions.length !== 1 ? "s" : ""} recorded`;
  }
  
  const sessBody = getEl("sessBody");
  if (!sessBody) return;
  
  if (filtered.length) {
    sessBody.innerHTML = filtered.map(s => mkRow(s, true)).join("");
    // Add entrance animation to rows
    const rows = sessBody.querySelectorAll("tr");
    rows.forEach((row, idx) => {
      row.style.animation = `fadeUp 0.3s var(--ease-spring) ${idx * 0.02}s both`;
    });
  } else if (allSessions.length === 0) {
    renderEmptyState("no-sessions");
  } else {
    renderEmptyState("no-matches");
  }
}

/* ── SEARCH HANDLER (Debounced) ── */
function onSearch(value) {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = value.toLowerCase().trim();
    renderSessions();
  }, 200);
}

/* ── CLEAR SEARCH ── */
function clearSearch() {
  const searchInput = getEl("srchInp");
  if (searchInput) {
    searchInput.value = "";
    searchQuery = "";
    renderSessions();
    searchInput.focus();
  }
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
  
  // Add fade-out animation
  const row = document.querySelector(`button[onclick="window.delRow('${id}')"]`)?.closest("tr");
  if (row) {
    row.style.transition = "opacity var(--dur-med) var(--ease-out)";
    row.style.opacity = "0";
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await deleteSession(id);
};

/* ── CLEAR ALL SESSIONS ── */
async function clearAll() {
  if (!allSessions.length) return toast("No sessions to clear", "warn");
  if (!confirm("⚠️ Delete ALL sessions? This cannot be undone.")) return;
  
  for (const session of allSessions) {
    await deleteDoc(doc(db, "sessions", session.id));
  }
  
  await loadSessions();
  renderSessions();
  toast("All sessions cleared", "warn");
}

/* ── ESCAPE KEY HANDLER ── */
function setupEscapeHandler() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const searchInput = getEl("srchInp");
      if (searchInput && searchInput.value) {
        clearSearch();
      }
    }
  });
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
  setupEscapeHandler();
  
  setInterval(() => initHdr(), 60000);
});

/* ── LOGOUT FUNCTION ── */
async function logout() {
  try {   
    localStorage.removeItem("activeTimer");
    await auth.signOut();
    localStorage.removeItem("st_profile");
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
window.clearSearch = clearSearch;
window.setFilter = setFilter;
window.delRow = window.delRow;
window.logout = logout;