import { auth, db } from "../firebase.js";
import { 
    collection,
    getDocs,
    query,
    where,
    orderBy,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

let currentUser = null;
let currentUserId = null;
let allUsers = [];
let allSessionsCache = {}; // Cache sessions for each user
let lbTab = "all";
let activeU = null;

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

/* ── LOAD CURRENT USER PROFILE ── */
async function loadCurrentUserProfile() {
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

/* ── LOAD SESSIONS FOR A USER (with caching) ── */
async function loadUserSessions(userId) {
  // Return from cache if available
  if (allSessionsCache[userId]) {
    return allSessionsCache[userId];
  }
  
  try {
    const sessionsRef = collection(db, "sessions");
    const q = query(
      sessionsRef,
      where("userId", "==", userId)
    );
    const snapshot = await getDocs(q);
    const sessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    // Cache the sessions
    allSessionsCache[userId] = sessions;
    return sessions;
  } catch (error) {
    console.error(`Error loading sessions for user ${userId}:`, error);
    return [];
  }
}

/* ── LOAD ALL USERS FROM FIREBASE ── */
async function loadAllUsers() {
  try {
    const usersRef = collection(db, "users");
    const snapshot = await getDocs(usersRef);
    allUsers = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    return allUsers;
  } catch (error) {
    console.error("Error loading users:", error);
    return [];
  }
}

/* ── CALCULATE USER HOURS FOR TIME PERIOD ── */
function calculateUserHours(sessions, period = "all") {
  if (!sessions.length) return 0;
  
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  let filteredSessions = sessions;
  
  if (period === "week") {
    filteredSessions = sessions.filter(s => {
      const sessionDate = parseD(s.date);
      return sessionDate && sessionDate >= startOfWeek;
    });
  } else if (period === "month") {
    filteredSessions = sessions.filter(s => {
      const sessionDate = parseD(s.date);
      return sessionDate && sessionDate >= startOfMonth;
    });
  }
  
  const totalSeconds = filteredSessions.reduce((sum, s) => sum + s.duration, 0);
  return Math.round(totalSeconds / 3600);
}

/* ── CALCULATE STREAK ── */
/* ── CALCULATE STREAK (Robust version) ── */
function calcStreak(sessions) {
  if (!sessions.length) return 0;
  
  // Create a map of dates with sessions
  const sessionMap = new Map();
  sessions.forEach(s => {
    sessionMap.set(s.date, true);
  });
  
  // Get today's date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmtDate(today);
  
  let streak = 0;
  let checkDate = new Date(today);
  
  // Only count streak if there's a session today
  if (!sessionMap.has(todayStr)) {
    return 0;
  }
  
  // Count consecutive days
  while (true) {
    const dateStr = fmtDate(checkDate);
    if (sessionMap.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

/* ── GET MOST RECENT PROJECT ── */
function getRecentProject(sessions) {
  if (!sessions.length) return "No sessions yet";
  const sorted = [...sessions].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const recent = sorted[0];
  if (recent.project && recent.project !== "—") {
    return recent.project;
  }
  return "No project";
}

/* ── CATEGORY CLASSES ── */
const CC = {
  "Deep Work": "cp-d",
  Learning: "cp-l",
  "Normal Work": "cp-n",
  "Low Productivity": "cp-w",
};

/* ── GET RANDOM COLOR FOR USERS WITHOUT COLOR ── */
const defaultColors = [
  "linear-gradient(135deg,#2152e0,#b84a8c)",
  "linear-gradient(135deg,#20b08a,#2bd4a0)",
  "linear-gradient(135deg,#f59e0b,#fb923c)",
  "linear-gradient(135deg,#7c5cfc,#a78bfa)",
  "linear-gradient(135deg,#e0682b,#f5883c)",
  "linear-gradient(135deg,#b84a8c,#d43f6b)",
  "linear-gradient(135deg,#0ea5e9,#2152e0)",
];

function getUserColor(user) {
  return user.color || defaultColors[Math.abs((user.id?.charCodeAt(0) || 0)) % defaultColors.length];
}

/* ── LOAD ALL USER DATA WITH SESSIONS ── */
async function loadAllUserData() {
  const users = await loadAllUsers();
  const userData = [];
  
  for (const user of users) {
    const sessions = await loadUserSessions(user.id);
    const hours = calculateUserHours(sessions, lbTab);
    const streak = calcStreak(sessions);
    const totalSessions = sessions.length;
    const recentProject = getRecentProject(sessions);
    
    userData.push({
      id: user.id,
      name: user.name || user.email?.split('@')[0] || "User",
      role: user.role || "SessionTrack member",
      color: getUserColor(user),
      initials: initials(user.name || user.email?.split('@')[0] || "User"),
      hours: hours,
      streak: streak,
      totalSessions: totalSessions,
      recentProject: recentProject,
      isMe: user.id === currentUserId,
      sessions: sessions // Store sessions for later use
    });
  }
  
  // Sort by hours (descending)
  return userData.sort((a, b) => b.hours - a.hours);
}

/* ── RENDER LEADERBOARD (without project text below name) ── */
async function renderLeaderboard() {
  if (!allUsers.length && currentUserId) {
    $("lbList").innerHTML = '<div class="loading-state">Loading leaderboard...</div>';
  }
  
  const userData = await loadAllUserData();
  const maxHours = Math.max(...userData.map(u => u.hours), 1);
  const rankColors = ["r1", "r2", "r3"];
  
  if (!userData.length) {
    $("lbList").innerHTML = '<div class="empty-state">No users found. Invite friends to join!</div>';
    return;
  }
  
  $("lbList").innerHTML = userData.map((user, index) => {
    const rank = index + 1;
    const rankClass = rank <= 3 ? rankColors[rank - 1] : "rn";
    const percentage = Math.round((user.hours / maxHours) * 100);
    
    return `
      <div class="lbr${user.isMe ? " me" : ""}${activeU === user.id ? " act" : ""}" onclick="openUp('${user.id}')" style="animation-delay:${index * 0.03}s">
        <div class="lbrnk ${rankClass}">${rank}</div>
        <div class="lbava" style="background:${user.color}">${user.initials}</div>
        <div class="lbi">
          <div class="lbnr">
            <span class="lbn">${escapeHtml(user.name)}</span>
            ${user.isMe ? '<span class="ytag">YOU</span>' : ""}
          </div>
          <!-- The project/session text is removed from here -->
          <div class="lbbb">
            <div class="lbbf" style="width:${percentage}%"></div>
          </div>
        </div>
        <div class="lbright">
          <div class="lbh">${user.hours}h</div>
          <div class="lbt">${user.streak} day streak</div>
        </div>
        <i class="fas fa-chevron-right lbarw"></i>
      </div>
    `;
  }).join("");
}

/* ── OPEN USER PROFILE PANEL ── */
async function openUp(userId) {
  activeU = userId;
  
  // Get user data from cache or load
  let userData = null;
  let userSessions = [];
  
  // Find user in allUsers
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  
  const isMe = userId === currentUserId;
  userSessions = await loadUserSessions(userId);
  
  const totalHours = Math.round(userSessions.reduce((sum, s) => sum + s.duration, 0) / 3600);
  const totalSessions = userSessions.length;
  const streak = calcStreak(userSessions);
  const deepHours = Math.round(userSessions
    .filter(s => s.category === "Deep Work")
    .reduce((sum, s) => sum + s.duration, 0) / 3600);
  
  // Group projects
  const projects = {};
  userSessions.forEach(s => {
    const projectName = s.project && s.project !== "—" ? s.project : "Untitled";
    if (!projects[projectName]) {
      projects[projectName] = { hours: 0, count: 0, category: s.category };
    }
    projects[projectName].hours += s.duration;
    projects[projectName].count++;
  });
  
  const projectList = Object.entries(projects)
    .sort((a, b) => b[1].hours - a[1].hours)
    .slice(0, 5);
  
  const chips = [];
  if (streak >= 1) chips.push(`<span class="upchip"><i class="fas fa-fire"></i> ${streak}-day streak</span>`);
  if (deepHours > 0) chips.push(`<span class="upchip"><i class="fas fa-brain"></i> ${deepHours}h deep work</span>`);
  if (totalSessions > 0) chips.push(`<span class="upchip"><i class="fas fa-play-circle"></i> ${totalSessions} sessions</span>`);
  
  const userColor = getUserColor(user);
  const userInitials = initials(user.name || user.email?.split('@')[0] || "User");
  const userName = user.name || user.email?.split('@')[0] || "User";
  const userRole = user.role || "SessionTrack member";
  
  $("upHero").style.background = userColor;
  $("upHero").innerHTML = `
    <button class="upcl" onclick="closeUp()"><i class="fas fa-times"></i></button>
    <div class="upin">
      <div class="upav">${userInitials}</div>
      <div class="upnm">${escapeHtml(userName)}${isMe ? " (You)" : ""}</div>
      <div class="uprl">${escapeHtml(userRole)}</div>
      <div class="upch">${chips.join("")}</div>
    </div>
    <div class="upsb">
      <div class="ups"><div class="upsv">${totalHours}h</div><div class="upsl">Total</div></div>
      <div class="ups"><div class="upsv">${totalSessions}</div><div class="upsl">Sessions</div></div>
      <div class="ups"><div class="upsv">${streak}</div><div class="upsl">Streak</div></div>
    </div>
  `;
  
  let html = "";
  
  if (projectList.length) {
    html += `<div class="uptit">Projects worked on</div>`;
    html += projectList.map(([name, data]) => {
      const categoryClass = CC[data.category] || "cp-n";
      return `
        <div class="uppr">
          <div class="upprc"><i class="fas fa-folder" style="font-size:.7rem"></i></div>
          <div class="upprn">${escapeHtml(name)}</div>
          <div class="upprd">
            <span class="uppcat ${categoryClass}">${data.category}</span>
            <span class="upph">${fmtHM(data.hours)}</span>
            <span class="uppn2">· ${data.count}x</span>
          </div>
        </div>
      `;
    }).join("");
  } else {
    html += `<div class="upempty"><i class="fas fa-folder-open"></i>No projects yet</div>`;
  }
  
  if (userSessions.length) {
    html += `<div class="uptit">Recent sessions</div>`;
    html += userSessions.slice(0, 5).map(s => {
      const categoryClass = CC[s.category] || "cp-n";
      return `
        <div class="upss">
          <span class="upscat cp ${categoryClass}">${s.category.split(" ")[0]}</span>
          <div class="upsinfo">
            <div class="upspr">${escapeHtml(s.project && s.project !== "—" ? s.project : "Untitled")}</div>
            <div class="upstk">${escapeHtml(s.task)}</div>
          </div>
          <span class="upsdu">${fmtHM(s.duration)}</span>
        </div>
      `;
    }).join("");
  } else {
    html += `<div class="upempty"><i class="fas fa-stopwatch"></i>No sessions recorded</div>`;
  }
  
  $("upBody").innerHTML = html;
  $("upCard").style.display = "block";
  $("lbSec").classList.add("open");
  await renderLeaderboard();
}

function closeUp() {
  activeU = null;
  $("upCard").style.display = "none";
  $("lbSec").classList.remove("open");
  renderLeaderboard();
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

/* ── SWITCH LEADERBOARD TAB ── */
function switchLb(btn, tab) {
  document.querySelectorAll(".lbtab").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  lbTab = tab;
  renderLeaderboard();
}

/* ── REFRESH ALL DATA ── */
async function refreshLeaderboard() {
  await loadAllUsers();
  await renderLeaderboard();
}

/* ── AUTH LISTENER ── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  
  currentUser = user;
  currentUserId = user.uid;
  
  await loadCurrentUserProfile();
  await loadAllUsers();
  await renderLeaderboard();
  
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
window.switchLb = switchLb;
window.openUp = openUp;
window.closeUp = closeUp;
window.logout = logout;