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
let allSessionsCache = {};
let lbTab = "today";
let activeU = null;
let currentUserRank = 0;

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
  const sub = getEl("greetSub");
  if (sub) {
    sub.textContent = `${greetTime} · See how you stack up against other users`;
  }
}

function calculatePoints(sessions) {
  let totalPoints = 0;
  sessions.forEach(session => {
    const hours = session.duration / 3600;
    const pointsPerHour = POINTS_PER_HOUR[session.category] || 5;
    totalPoints += Math.round(hours * pointsPerHour);
  });
  return totalPoints;
}

function calculateUserPoints(sessions, period = "today") {
  if (!sessions.length) return 0;
  const now = new Date();
  const todayStr = fmtDate(now);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let filteredSessions = sessions;
  if (period === "today") {
    filteredSessions = sessions.filter(s => s.date === todayStr);
  } else if (period === "week") {
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
  return calculatePoints(filteredSessions);
}

async function loadUserSessions(userId) {
  if (allSessionsCache[userId]) {
    return allSessionsCache[userId];
  }
  try {
    const sessionsRef = collection(db, "sessions");
    const q = query(sessionsRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);
    const sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    allSessionsCache[userId] = sessions;
    return sessions;
  } catch (error) {
    console.error(`Error loading sessions for user ${userId}:`, error);
    return [];
  }
}

async function loadAllUsers() {
  try {
    const usersRef = collection(db, "users");
    const snapshot = await getDocs(usersRef);
    allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return allUsers;
  } catch (error) {
    console.error("Error loading users:", error);
    return [];
  }
}

function calcStreak(sessions) {
  if (!sessions.length) return 0;
  const sessionMap = new Map();
  sessions.forEach(s => { sessionMap.set(s.date, true); });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmtDate(today);
  let streak = 0;
  let checkDate = new Date(today);
  if (!sessionMap.has(todayStr)) {
    let tempDate = new Date(today);
    tempDate.setDate(tempDate.getDate() - 1);
    while (true) {
      const dateStr = fmtDate(tempDate);
      if (sessionMap.has(dateStr)) {
        streak++;
        tempDate.setDate(tempDate.getDate() - 1);
      } else break;
    }
    return streak;
  }
  while (true) {
    const dateStr = fmtDate(checkDate);
    if (sessionMap.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else break;
  }
  return streak;
}

function getRecentProject(sessions) {
  if (!sessions.length) return "No sessions yet";
  const sorted = [...sessions].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const recent = sorted[0];
  if (recent.project && recent.project !== "—") {
    return recent.project;
  }
  return "No project";
}

const CC = {
  "Deep Work": "cp-d",
  Learning: "cp-l",
  "Normal Work": "cp-n",
  "Low Productivity": "cp-w",
};

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

async function loadAllUserData() {
  const users = await loadAllUsers();
  const userData = [];
  for (const user of users) {
    const sessions = await loadUserSessions(user.id);
    const points = calculateUserPoints(sessions, lbTab);
    const streak = calcStreak(sessions);
    const totalSessions = sessions.length;
    const recentProject = getRecentProject(sessions);
    userData.push({
      id: user.id,
      name: user.name || user.email?.split('@')[0] || "User",
      role: user.role || "SessionTrack member",
      color: getUserColor(user),
      initials: initials(user.name || user.email?.split('@')[0] || "User"),
      points: points,
      streak: streak,
      totalSessions: totalSessions,
      recentProject: recentProject,
      isMe: user.id === currentUserId,
      sessions: sessions
    });
  }
  let filtered = userData;
  if (lbTab === "today") {
    filtered = userData.filter(u => u.points > 0);
  }
  return filtered.sort((a, b) => b.points - a.points);
}

function getRankMeta(rank) {
  if (rank === 1) return { class: "r1", medal: "🥇", glow: true };
  if (rank === 2) return { class: "r2", medal: "🥈", glow: false };
  if (rank === 3) return { class: "r3", medal: "🥉", glow: false };
  return { class: "rn", medal: rank, glow: false };
}

async function renderLeaderboard() {
  const lbList = getEl("lbList");
  if (!lbList) return;
  
  if (!allUsers.length && currentUserId) {
    lbList.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Loading leaderboard...</p></div>`;
  }
  
  const userData = await loadAllUserData();
  const maxPoints = Math.max(...userData.map(u => u.points), 1);
  const periodLabels = { today: "pts today", week: "pts this week", month: "pts this month", all: "total pts" };
  const pointsLabel = periodLabels[lbTab] || "pts";
  
  if (!userData.length) {
    const emptyMessages = {
      today: "No points earned today",
      week: "No weekly points yet",
      month: "No monthly points yet",
      all: "No users found"
    };
    lbList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fas fa-calendar-${lbTab === "today" ? "day" : lbTab === "week" ? "week" : lbTab === "month" ? "alt" : "trophy"}"></i></div>
        <h4>${emptyMessages[lbTab] || "No data available"}</h4>
        <p>${lbTab === "all" ? "Invite your friends to join SessionTrack!" : "Complete sessions to climb the leaderboard!"}</p>
        <a href="dashboard.html" class="empty-btn"><i class="fas fa-play"></i> Start a Session</a>
      </div>
    `;
    return;
  }
  
  lbList.innerHTML = userData.map((user, index) => {
    const rank = index + 1;
    const rankMeta = getRankMeta(rank);
    const percentage = Math.round((user.points / maxPoints) * 100);
    const isTopOne = rank === 1;
    
    // Fire crown for top 1
    const fireCrown = isTopOne ? `
      <div class="fire-crown" aria-hidden="true">
        <span class="flame f1"></span>
        <span class="flame f2"></span>
        <span class="flame f3"></span>
      </div>
    ` : '';
    
    const fireBadge = isTopOne ? `<span class="fire-badge"><i class="fas fa-fire"></i> On Fire</span>` : '';
    const rankDisplay = rankMeta.medal === rank ? rank : rankMeta.medal;
    
    return `
      <div class="lbr${user.isMe ? " me" : ""}${activeU === user.id ? " act" : ""}${isTopOne ? " top-one" : ""}" 
           onclick="openUp('${user.id}', ${rank})" 
           role="button" tabindex="0" 
           onkeydown="if(event.key==='Enter'||event.key===' ')openUp('${user.id}', ${rank})"
           style="animation-delay:${index * 0.03}s">
        ${fireCrown}
        <div class="lbrnk ${rankMeta.class}">${rankDisplay}</div>
        <div class="lbava" style="background:${user.color}">${user.initials}</div>
        <div class="lbi">
          <div class="lbnr">
            <span class="lbn">${escapeHtml(user.name)}</span>
            ${user.isMe ? '<span class="ytag">YOU</span>' : ''}
            ${fireBadge}
          </div>
          <div class="lbbb"><div class="lbbf" style="width:${percentage}%"></div></div>
        </div>
        <div class="lbright">
          <div class="lbh">${user.points} ${pointsLabel}</div>
          <div class="lbt">${user.streak} day streak</div>
        </div>
        <i class="fas fa-chevron-right lbarw"></i>
      </div>
    `;
  }).join("");
}

async function openUp(userId, rank) {
  activeU = userId;
  currentUserRank = rank || 0;
  
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  
  const isMe = userId === currentUserId;
  const userSessions = await loadUserSessions(userId);
  const isTopOne = currentUserRank === 1;
  
  const todayPoints = calculateUserPoints(userSessions, "today");
  const weekPoints = calculateUserPoints(userSessions, "week");
  const monthPoints = calculateUserPoints(userSessions, "month");
  const allTimePoints = calculatePoints(userSessions);
  const totalSessions = userSessions.length;
  const streak = calcStreak(userSessions);
  const deepHours = Math.round(userSessions
    .filter(s => s.category === "Deep Work")
    .reduce((sum, s) => sum + s.duration, 0) / 3600);
  
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
  
  const upHero = getEl("upHero");
  const upCard = getEl("upCard");
  const upBody = getEl("upBody");
  const lbSec = getEl("lbSec");
  
  if (upHero) {
    upHero.style.background = userColor;
    upHero.className = `uph${isTopOne ? " top-profile" : ""}`;
    upHero.innerHTML = `
      <button class="upcl" onclick="closeUp()" aria-label="Close profile"><i class="fas fa-times"></i></button>
      <div class="upin">
        <div class="upav">${userInitials}</div>
        <div class="upnm">${escapeHtml(userName)}${isMe ? " (You)" : ""}</div>
        <div class="uprl">${escapeHtml(userRole)}</div>
        ${isTopOne ? '<div class="leader-rank-badge">🔥 Rank #1 · Current Leader</div>' : ''}
        <div class="upch">${chips.join("")}</div>
      </div>
      <div class="upsb">
        <div class="ups"><div class="upsv">${todayPoints}</div><div class="upsl">Today</div></div>
        <div class="ups"><div class="upsv">${weekPoints}</div><div class="upsl">Week</div></div>
        <div class="ups"><div class="upsv">${monthPoints}</div><div class="upsl">Month</div></div>
        <div class="ups"><div class="upsv">${allTimePoints}</div><div class="upsl">All Time</div></div>
      </div>
    `;
  }
  
  let html = "";
  if (projectList.length) {
    html += `<div class="uptit">Projects worked on</div>`;
    html += projectList.map(([name, data]) => {
      const categoryClass = CC[data.category] || "cp-n";
      return `
        <div class="uppr">
          <div class="upprc"><i class="fas fa-folder"></i></div>
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
  
  if (upBody) upBody.innerHTML = html;
  if (upCard) upCard.style.display = "block";
  if (lbSec) lbSec.classList.add("open");
  await renderLeaderboard();
}

function closeUp() {
  activeU = null;
  const upCard = getEl("upCard");
  const lbSec = getEl("lbSec");
  if (upCard) upCard.style.display = "none";
  if (lbSec) lbSec.classList.remove("open");
  renderLeaderboard();
}

function switchLb(btn, tab) {
  document.querySelectorAll(".lbtab").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  lbTab = tab;
  if (activeU) closeUp();
  renderLeaderboard();
}

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
  setInterval(() => initHdr(), 60000);
});

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
window.switchLb = switchLb;
window.openUp = openUp;
window.closeUp = closeUp;
window.logout = logout;