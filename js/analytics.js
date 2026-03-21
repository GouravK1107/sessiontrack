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
let allSessions = [];
let chartMode = "week";
let calY = new Date().getFullYear();
let calM = new Date().getMonth();

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

/* ── CALCULATIONS ── */
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

function calcLongestStreak(sessions) {
  if (!sessions.length) return 0;
  
  // Get sorted unique dates
  const dates = [...new Set(sessions.map((s) => s.date))]
    .map((ds) => parseD(ds))
    .filter(Boolean)
    .sort((a, b) => a - b);
  
  if (dates.length === 0) return 0;
  
  let longest = 1;
  let currentStreak = 1;
  
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      currentStreak++;
      longest = Math.max(longest, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  
  return longest;
}

function isGoalHit(ds) {
  try {
    const items = JSON.parse(localStorage.getItem("st_dmh_" + ds) || "[]");
    return items.length > 0 && items.every((i) => i.done);
  } catch {
    return false;
  }
}

/* ── STATS ── */
function renderStats() {
  const today = fmtDate(new Date());
  const todaySessions = allSessions.filter(s => s.date === today);
  const totalToday = todaySessions.reduce((a, s) => a + s.duration, 0);
  const deepToday = todaySessions
    .filter(s => s.category === "Deep Work")
    .reduce((a, s) => a + s.duration, 0);
  const streak = calcStreak(allSessions);
  
  $("aH").textContent = fmtHM(totalToday) || "0m";
  $("aS").textContent = todaySessions.length;
  $("aD").textContent = fmtHM(deepToday) || "0m";
  $("aSt").textContent = streak;
}

/* ── WEEK BAR CHART ── */
function renderBarChart() {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  const td = now.getDay();
  const data = Array(7).fill(0);
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data[(td - i + 7) % 7] = allSessions
      .filter((s) => s.date === fmtDate(d))
      .reduce((a, s) => a + s.duration, 0);
  }
  
  const mx = Math.max(...data, 1);
  const wkSecs = data.reduce((a, b) => a + b, 0);
  $("chartTitle").textContent = "Weekly Focus Hours";
  $("chartSub").textContent = `This week · ${wkSecs ? fmtHM(wkSecs) : "0h"} total`;
  
  const chart = $("barChart");
  chart.innerHTML = "";
  
  for (let i = 0; i < 7; i++) {
    const di = (td - 6 + i + 7) % 7;
    const secs = data[di];
    const hp = Math.max(4, Math.round((secs / mx) * 145));
    const isToday = di === td;
    
    const g = document.createElement("div");
    g.className = "bg2";
    
    const lbl = document.createElement("div");
    lbl.className = "bval" + (secs > 0 ? " has-data" : "");
    lbl.textContent = secs > 0 ? (secs / 3600).toFixed(1) + "h" : "";
    
    const b = document.createElement("div");
    b.className = "bf" + (isToday ? " today" : "") + (secs === 0 ? " empty" : "");
    b.style.height = hp + "px";
    b.style.animationDelay = i * 0.06 + "s";
    b.title = `${DAYS[di]}: ${secs ? fmtHM(secs) : "No sessions"}`;
    
    const dl = document.createElement("span");
    dl.className = "bl" + (isToday ? " today-lbl" : "");
    dl.textContent = DAYS[di];
    
    g.appendChild(lbl);
    g.appendChild(b);
    g.appendChild(dl);
    chart.appendChild(g);
  }
}

/* ── MONTH PIE CHART ── */
const PIE_CATS = [
  { key: "Deep Work", color: "#2152e0", label: "Deep Work" },
  { key: "Learning", color: "#20b08a", label: "Learning" },
  { key: "Normal Work", color: "#f59e0b", label: "Normal Work" },
  { key: "Low Productivity", color: "#b84a8c", label: "Low Prod." },
];

function renderPieChart() {
  const now = new Date();
  const thisMonth = allSessions.filter((s) => {
    const d = parseD(s.date);
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  
  const totSecs = thisMonth.reduce((a, s) => a + s.duration, 0);
  $("chartTitle").textContent = "Monthly Breakdown";
  $("chartSub").textContent = `${now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} · ${totSecs ? fmtHM(totSecs) : "0h"} total`;
  $("pieTotal").textContent = Math.round(totSecs / 3600) + "h";

  const catSecs = {};
  PIE_CATS.forEach((c) => {
    catSecs[c.key] = thisMonth
      .filter((s) => s.category === c.key)
      .reduce((a, s) => a + s.duration, 0);
  });

  const svg = $("pieSvg");
  svg.innerHTML = "";
  const cx = 100, cy = 100, R = 80, Ri = 52;

  if (totSecs === 0) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", R);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "var(--brd)");
    circle.setAttribute("stroke-width", "28");
    svg.appendChild(circle);
    $("pieLegend").innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--tm);font-size:.78rem;padding:.5rem">No sessions this month yet</div>';
    return;
  }

  let startAngle = -Math.PI / 2;
  const segs = PIE_CATS.map((c) => ({
    ...c,
    secs: catSecs[c.key] || 0,
    pct: (catSecs[c.key] || 0) / totSecs,
  })).filter((c) => c.secs > 0);

  segs.forEach((c, idx) => {
    const angle = c.pct * 2 * Math.PI;
    const endAngle = startAngle + angle;
    
    const sa = startAngle + 0.01;
    const ea = endAngle - 0.01;
    
    const px1 = cx + R * Math.cos(sa), py1 = cy + R * Math.sin(sa);
    const px2 = cx + R * Math.cos(ea), py2 = cy + R * Math.sin(ea);
    const ipx1 = cx + Ri * Math.cos(sa), ipy1 = cy + Ri * Math.sin(sa);
    const ipx2 = cx + Ri * Math.cos(ea), ipy2 = cy + Ri * Math.sin(ea);
    
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M ${px1} ${py1} A ${R} ${R} 0 ${largeArc} 1 ${px2} ${py2} L ${ipx2} ${ipy2} A ${Ri} ${Ri} 0 ${largeArc} 0 ${ipx1} ${ipy1} Z`;
    
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", c.color);
    path.setAttribute("class", "pie-seg");
    path.setAttribute("title", `${c.label}: ${fmtHM(c.secs)} (${Math.round(c.pct * 100)}%)`);
    path.style.animation = `pieIn .6s cubic-bezier(.34,1.1,.64,1) ${idx * 0.1}s both`;
    svg.appendChild(path);
    
    startAngle = endAngle;
  });

  if (!document.getElementById("pieStyle")) {
    const st = document.createElement("style");
    st.id = "pieStyle";
    st.textContent = "@keyframes pieIn{from{transform:scale(.5);opacity:0}to{transform:scale(1);opacity:1}}";
    document.head.appendChild(st);
  }

  $("pieLegend").innerHTML = segs.map((c) => `
    <div class="pl-row">
      <span class="pl-dot" style="background:${c.color}"></span>
      <span class="pl-name">${c.label}</span>
      <span class="pl-val">${fmtHM(c.secs)}</span>
      <span class="pl-pct">${Math.round(c.pct * 100)}%</span>
    </div>
  `).join("");
}

/* ── CHART TAB SWITCH ── */
function switchChart(btn, mode) {
  document.querySelectorAll(".ctab").forEach((b) => b.classList.remove("on"));
  btn.classList.add("on");
  chartMode = mode;
  $("chartWeek").style.display = mode === "week" ? "flex" : "none";
  $("chartMonth").style.display = mode === "month" ? "flex" : "none";
  if (mode === "week") renderBarChart();
  else renderPieChart();
}

/* ── CALENDAR ── */
const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function renderCalendar() {
  const map = {};
  allSessions.forEach((s) => {
    map[s.date] = (map[s.date] || 0) + s.duration;
  });

  const streakSet = new Set();
  let d = new Date();
  d.setHours(0, 0, 0, 0);
  while (map[fmtDate(d)]) {
    streakSet.add(fmtDate(d));
    d.setDate(d.getDate() - 1);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tStr = fmtDate(today);
  
  $("calMon").textContent = `${MN[calM].slice(0, 3)} ${calY}`;
  $("calSub").textContent = `${MN[calM]} ${calY}`;

  const fd = new Date(calY, calM, 1).getDay();
  const off = (fd + 6) % 7;
  const dim = new Date(calY, calM + 1, 0).getDate();
  const prevDim = new Date(calY, calM, 0).getDate();

  let mSess = 0, mSecs = 0;
  for (let d = 1; d <= dim; d++) {
    const ds = fmtDate(new Date(calY, calM, d));
    if (map[ds]) {
      mSess += allSessions.filter((s) => s.date === ds).length;
      mSecs += map[ds];
    }
  }
  $("calSC").textContent = mSess;
  $("calHC").textContent = Math.round(mSecs / 3600) + "h";

  const grid = $("calGrid");
  grid.innerHTML = "";

  for (let i = off - 1; i >= 0; i--) {
    const c = document.createElement("div");
    c.className = "calcel oth";
    c.textContent = prevDim - i;
    grid.appendChild(c);
  }

  for (let d = 1; d <= dim; d++) {
    const ds = fmtDate(new Date(calY, calM, d));
    const secs = map[ds] || 0;
    const onSk = streakSet.has(ds);
    const goalHit = isGoalHit(ds);
    const isToday = ds === tStr;
    
    const cls = ["calcel"];
    
    if (secs > 0) {
      if (secs >= 7200) cls.push("i4");
      else if (secs >= 3600) cls.push("i3");
      else if (secs >= 1800) cls.push("i2");
      else cls.push("i1");
    }
    
    if (onSk) cls.push("sk");
    
    if (onSk) {
      const prev = fmtDate(new Date(calY, calM, d - 1));
      const next = fmtDate(new Date(calY, calM, d + 1));
      const hasPrev = streakSet.has(prev) && d > 1;
      const hasNext = streakSet.has(next) && d < dim;
      if (hasPrev && hasNext) cls.push("sk-mid");
      else if (!hasPrev && hasNext) cls.push("sk-start");
      else if (hasPrev && !hasNext) cls.push("sk-end");
    }
    
    if (isToday) cls.push("ct2");
    if (goalHit) cls.push("goal-hit");
    
    const c = document.createElement("div");
    c.className = cls.join(" ");
    c.textContent = d;
    
    if (goalHit) {
      const star = document.createElement("span");
      star.className = "cal-star";
      star.textContent = "★";
      c.appendChild(star);
    }
    
    const cnt = allSessions.filter((s) => s.date === ds).length;
    c.title = `${ds}${secs ? `: ${fmtHM(secs)} · ${cnt} session${cnt !== 1 ? "s" : ""}${onSk ? " 🔥 streak" : ""}${goalHit ? " ★ goals hit" : ""}` : ""}`;
    grid.appendChild(c);
  }

  const total = Math.ceil((off + dim) / 7) * 7;
  for (let nd = 1; nd <= total - (off + dim); nd++) {
    const c = document.createElement("div");
    c.className = "calcel oth";
    c.textContent = nd;
    grid.appendChild(c);
  }
}

function calPrev() {
  calM--;
  if (calM < 0) {
    calM = 11;
    calY--;
  }
  renderCalendar();
}

function calNext() {
  calM++;
  if (calM > 11) {
    calM = 0;
    calY++;
  }
  renderCalendar();
}

/* ── INSIGHTS ── */
function renderInsights() {
  const streak = calcStreak(allSessions);
  $("insA").textContent = `${streak}-day streak`;
  $("insAp").textContent = streak > 0
    ? `${streak} consecutive day${streak > 1 ? "s" : ""} in a row. Keep going!`
    : "Start your first session to begin a streak!";

  const dayT = Array(7).fill(0), dayC = Array(7).fill(0);
  allSessions.forEach((s) => {
    const d = parseD(s.date);
    if (d) {
      dayT[d.getDay()] += s.duration;
      dayC[d.getDay()]++;
    }
  });
  
  const pk = dayT.indexOf(Math.max(...dayT));
  const DN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  
  if (dayT[pk] > 0) {
    $("insB").textContent = `Peak: ${DN[pk]}`;
    $("insBp").textContent = `${DN[pk]}s are your most productive — avg ${fmtHM(Math.round(dayT[pk] / (dayC[pk] || 1)))} focus.`;
  }

  const dm = {};
  allSessions.forEach((s) => {
    dm[s.date] = (dm[s.date] || 0) + s.duration;
  });
  const best = Object.entries(dm).sort((a, b) => b[1] - a[1])[0];
  
  if (best) {
    $("insC").textContent = `Best: ${fmtHM(best[1])}`;
    $("insCp").textContent = `Your record was ${fmtHM(best[1])} on ${best[0]}. Beat it!`;
  }
}

/* ── SCORE CARD ── */
const RANKS = [
  { name: "No Session", icon: "💤", min: 0, max: 0, color: "#94a3b8" },
  { name: "Beginner", icon: "🌱", min: 1, max: 29, color: "#64748b" },
  { name: "Focused", icon: "👀", min: 30, max: 59, color: "#3b82f6" },
  { name: "Productive", icon: "⚡", min: 60, max: 99, color: "#8b5cf6" },
  { name: "Deep Worker", icon: "🧠", min: 100, max: 149, color: "#2152e0" },
  { name: "Flow State", icon: "🔥", min: 150, max: 199, color: "#e0682b" },
  { name: "Elite", icon: "👑", min: 200, max: Infinity, color: "#f59e0b" },
];

const PH = {
  "Deep Work": 20,
  Learning: 15,
  "Normal Work": 10,
  "Low Productivity": 5,
};

function renderScore() {
  const today = fmtDate(new Date());
  const todaySessions = allSessions.filter((s) => s.date === today);
  
  const catSecs = {};
  todaySessions.forEach((s) => {
    catSecs[s.category] = (catSecs[s.category] || 0) + s.duration;
  });
  
  let pts = 0;
  [["Deep Work", "scD"], ["Learning", "scL"], ["Normal Work", "scN"], ["Low Productivity", "scP"]].forEach(([cat, id]) => {
    const p = Math.round(((catSecs[cat] || 0) / 3600) * PH[cat]);
    pts += p;
    $(id).textContent = p > 0 ? `+${p} pts` : "—";
  });
  
  $("scPts").textContent = pts;
  const circ = 2 * Math.PI * 52;
  $("scArc").setAttribute("stroke-dasharray", `${Math.min(pts / 200, 1) * circ} ${circ}`);
  
  const rank = RANKS.find((r) => pts >= r.min && pts <= r.max) || RANKS[0];
  $("scArc").style.stroke = rank.color;
  $("scBadgeIcon").textContent = rank.icon;
  $("scBadgeName").textContent = rank.name;
  $("scBadge").style.cssText = `border-color:${rank.color};color:${rank.color};background:${rank.color}18`;
  
  const next = RANKS.find((r) => r.min > pts);
  $("scNext").innerHTML = next && pts > 0
    ? `${next.min - pts} more pts to reach <span>${next.icon} ${next.name}</span>`
    : pts === 0
      ? "Start a session to earn your first points!"
      : "<span>👑 Elite level achieved!</span>";
  
  $("scSub").textContent = todaySessions.length
    ? `${todaySessions.length} session${todaySessions.length !== 1 ? "s" : ""} · ${fmtHM(todaySessions.reduce((a, s) => a + s.duration, 0))} today`
    : "Earn points by logging sessions";
  
  $("scLadder").innerHTML = RANKS.slice(1).map((r, i) => {
    const earned = pts >= r.min;
    const current = rank.name === r.name && pts > 0;
    return `<div class="sc-lrung${earned ? " earned" : ""}${current ? " current" : ""}">
      <div class="sc-lnub" style="${earned || current ? `background:${r.color};border-color:${r.color}` : ""}">${earned || current ? r.icon : ""}</div>
      <div class="sc-lname">${r.name}</div>
      <div class="sc-lpts">${r.min}+</div>
    </div>`;
  }).join("");
}

/* ── REFRESH ALL ── */
async function refreshAnalytics() {
  await loadSessions();
  renderStats();
  if (chartMode === "week") renderBarChart();
  else renderPieChart();
  renderCalendar();
  renderInsights();
  renderScore();
}

/* ── AUTH LISTENER ── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  
  currentUser = user;
  await loadUserProfile();
  await refreshAnalytics();
  
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
window.switchChart = switchChart;
window.calPrev = calPrev;
window.calNext = calNext;
window.logout = logout;