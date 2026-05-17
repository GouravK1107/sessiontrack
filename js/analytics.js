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
let filteredSessions = [];
let chartMode = "week";
let calY = new Date().getFullYear();
let calM = new Date().getMonth();
let currentRange = "week";
let currentCategory = "all";
let currentProject = "all";

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

function getDateFromStr(str) {
  const parts = str.split(" ");
  if (parts.length === 3) {
    const [d, m, y] = parts;
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    return new Date(parseInt(y), months[m], parseInt(d));
  }
  return null;
}

/* ── HELPER FUNCTIONS FOR FILTERING ── */
function getDateRange(range) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch(range) {
    case "today":
      return { start: today, end: new Date(today.getTime() + 86400000) };
    case "week":
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      return { start: weekStart, end: new Date(weekStart.getTime() + 7 * 86400000) };
    case "month":
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: monthStart, end: monthEnd };
    case "all":
    default:
      return { start: null, end: null };
  }
}

function applyFilters() {
  let sessions = [...allSessions];
  
  if (currentRange !== "all") {
    const range = getDateRange(currentRange);
    if (range.start) {
      sessions = sessions.filter(s => {
        const date = getDateFromStr(s.date);
        return date && date >= range.start && date < range.end;
      });
    }
  }
  
  if (currentCategory !== "all") {
    sessions = sessions.filter(s => s.category === currentCategory);
  }
  
  if (currentProject !== "all") {
    sessions = sessions.filter(s => s.project === currentProject);
  }
  
  filteredSessions = sessions;
}

function getProjectOptions() {
  const projects = new Set();
  allSessions.forEach(s => {
    if (s.project && s.project !== "—") projects.add(s.project);
  });
  return Array.from(projects).sort();
}

function updateProjectFilter() {
  const projectSelect = getEl("projectFilter");
  if (!projectSelect) return;
  const projects = getProjectOptions();
  projectSelect.innerHTML = '<option value="all">All Projects</option>';
  projects.forEach(p => {
    const option = document.createElement("option");
    option.value = p;
    option.textContent = p;
    projectSelect.appendChild(option);
  });
  projectSelect.value = currentProject;
}

function resetFilters() {
  currentRange = "week";
  currentCategory = "all";
  currentProject = "all";
  
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.classList.remove("active");
    if (btn.dataset.range === currentRange) btn.classList.add("active");
  });
  const catFilter = getEl("categoryFilter");
  if (catFilter) catFilter.value = currentCategory;
  const projFilter = getEl("projectFilter");
  if (projFilter) projFilter.value = currentProject;
  
  applyFilters();
  refreshAllAnalytics();
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
  const sub = getEl("greetSub");
  if (sub) {
    sub.textContent = `${n.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long" })} · Your focus insights`;
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
    return allSessions;
  } catch (error) {
    console.error("Error loading sessions:", error);
    toast("Failed to load sessions", "warn");
    return [];
  }
}

/* ── STREAK CALCULATION (SAME AS DASHBOARD) ── */
function calcStreak(sessions) {
  if (!sessions.length) return 0;
  
  const sessionMap = new Map();
  sessions.forEach(s => {
    sessionMap.set(s.date, true);
  });
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmtDate(today);
  
  let streak = 0;
  let checkDate = new Date(today);
  
  if (sessionMap.has(todayStr)) {
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
  
  let tempDate = new Date(today);
  tempDate.setDate(tempDate.getDate() - 1);
  
  while (true) {
    const dateStr = fmtDate(tempDate);
    if (sessionMap.has(dateStr)) {
      streak++;
      tempDate.setDate(tempDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

function calcLongestStreak(sessions) {
  if (!sessions.length) return 0;
  
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

function getTotalDuration(sessions) {
  return sessions.reduce((a, s) => a + s.duration, 0);
}

function getCategoryBreakdown(sessions) {
  const breakdown = {};
  sessions.forEach(s => {
    breakdown[s.category] = (breakdown[s.category] || 0) + s.duration;
  });
  return breakdown;
}

function getBestCategory(sessions) {
  const breakdown = getCategoryBreakdown(sessions);
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

function getDeepWorkRatio(sessions) {
  const total = getTotalDuration(sessions);
  if (total === 0) return 0;
  const deep = sessions.filter(s => s.category === "Deep Work").reduce((a, s) => a + s.duration, 0);
  return (deep / total) * 100;
}

function getAverageSessionLength(sessions) {
  if (sessions.length === 0) return 0;
  return getTotalDuration(sessions) / sessions.length;
}

function getBestFocusHour(sessions) {
  const hourCount = Array(24).fill(0);
  sessions.forEach(s => {
    if (s.start) {
      let hour = parseInt(s.start.split(":")[0]);
      if (s.start.includes("PM") && hour !== 12) hour += 12;
      if (s.start.includes("AM") && hour === 12) hour = 0;
      if (!isNaN(hour) && hour >= 0 && hour < 24) {
        hourCount[hour]++;
      }
    }
  });
  let bestHour = -1;
  let maxCount = 0;
  for (let i = 0; i < 24; i++) {
    if (hourCount[i] > maxCount) {
      maxCount = hourCount[i];
      bestHour = i;
    }
  }
  return bestHour !== -1 ? bestHour : null;
}

/* ── RENDER FUNCTIONS ── */
function renderHero() {
  const totalSessions = filteredSessions.length;
  const totalHours = Math.round(getTotalDuration(filteredSessions) / 3600);
  const today = fmtDate(new Date());
  const todaySessions = filteredSessions.filter(s => s.date === today);
  const todayTotal = getTotalDuration(todaySessions);
  
  const heroTotalSessions = getEl("heroTotalSessions");
  const heroTotalHours = getEl("heroTotalHours");
  const heroTitle = getEl("heroTitle");
  const heroSubtitle = getEl("heroSubtitle");
  const heroWeeklyPill = getEl("heroWeeklyPill");
  const heroBestPill = getEl("heroBestPill");
  
  if (heroTotalSessions) heroTotalSessions.textContent = totalSessions;
  if (heroTotalHours) heroTotalHours.textContent = totalHours;
  
  if (heroTitle && heroSubtitle) {
    if (todaySessions.length > 0) {
      heroTitle.textContent = "✨ Focus Intelligence";
      heroSubtitle.textContent = `You logged ${todaySessions.length} session${todaySessions.length !== 1 ? "s" : ""} and ${fmtHM(todayTotal)} today.`;
    } else {
      heroTitle.textContent = "Unlock Your Productivity";
      heroSubtitle.textContent = "Start a session to unlock your focus insights.";
    }
  }
  
  const weekRange = getDateRange("week");
  const weekSessions = filteredSessions.filter(s => {
    const date = getDateFromStr(s.date);
    return date && date >= weekRange.start && date < weekRange.end;
  });
  const weekTotal = getTotalDuration(weekSessions);
  if (heroWeeklyPill) heroWeeklyPill.textContent = `📅 This week · ${fmtHM(weekTotal)}`;
  
  const bestCat = getBestCategory(weekSessions);
  const catIcons = { "Deep Work": "🧠", "Learning": "📚", "Normal Work": "💼", "Low Productivity": "😴" };
  if (heroBestPill) heroBestPill.textContent = bestCat ? `🏆 Best category · ${catIcons[bestCat] || "📊"} ${bestCat}` : "🏆 Best category · —";
}

function renderStats() {
  const today = fmtDate(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = fmtDate(yesterday);
  
  const todaySessions = filteredSessions.filter(s => s.date === today);
  const yesterdaySessions = filteredSessions.filter(s => s.date === yesterdayStr);
  
  const totalToday = getTotalDuration(todaySessions);
  const totalYesterday = getTotalDuration(yesterdaySessions);
  const deepToday = todaySessions.filter(s => s.category === "Deep Work").reduce((a, s) => a + s.duration, 0);
  
  // IMPORTANT: Use ALL sessions for streak calculation, not filtered
  const currentStreak = calcStreak(allSessions);
  const longestStreak = calcLongestStreak(allSessions);
  
  const aH = getEl("aH");
  const aS = getEl("aS");
  const aD = getEl("aD");
  const aSt = getEl("aSt");
  const aHTrend = getEl("aHTrend");
  const aSTrend = getEl("aSTrend");
  const aDTrend = getEl("aDTrend");
  const aStTrend = getEl("aStTrend");
  const aHProgress = getEl("aHProgress");
  const aSProgress = getEl("aSProgress");
  const aDProgress = getEl("aDProgress");
  const aStProgress = getEl("aStProgress");
  
  if (aH) aH.textContent = fmtHM(totalToday) || "0m";
  if (aS) aS.textContent = todaySessions.length;
  if (aD) aD.textContent = fmtHM(deepToday) || "0m";
  if (aSt) aSt.textContent = currentStreak;
  
  const todayVsYesterday = totalToday - totalYesterday;
  if (aHTrend) aHTrend.innerHTML = todayVsYesterday > 0 ? `↑${fmtHM(todayVsYesterday)}` : todayVsYesterday < 0 ? `↓${fmtHM(Math.abs(todayVsYesterday))}` : "—";
  
  const sessionTrend = todaySessions.length - yesterdaySessions.length;
  if (aSTrend) aSTrend.innerHTML = sessionTrend > 0 ? `+${sessionTrend}` : sessionTrend < 0 ? `${sessionTrend}` : "—";
  
  const deepRatio = totalToday > 0 ? Math.round((deepToday / totalToday) * 100) : 0;
  if (aDTrend) aDTrend.innerHTML = `${deepRatio}%`;
  
  if (aStTrend) {
    if (currentStreak > 0) {
      aStTrend.innerHTML = `Active 🔥`;
    } else if (longestStreak > 0) {
      aStTrend.innerHTML = `Best: ${longestStreak}`;
    } else {
      aStTrend.innerHTML = `Start today`;
    }
  }
  
  const target = 4 * 3600;
  if (aHProgress) aHProgress.style.width = `${Math.min((totalToday / target) * 100, 100)}%`;
  if (aSProgress) aSProgress.style.width = `${Math.min((todaySessions.length / 8) * 100, 100)}%`;
  if (aDProgress) aDProgress.style.width = `${Math.min((deepToday / (target * 0.6)) * 100, 100)}%`;
  if (aStProgress) aStProgress.style.width = `${Math.min((currentStreak / 30) * 100, 100)}%`;
}

function renderScore() {
  const today = fmtDate(new Date());
  const todaySessions = filteredSessions.filter((s) => s.date === today);
  
  const catSecs = {};
  todaySessions.forEach((s) => {
    catSecs[s.category] = (catSecs[s.category] || 0) + s.duration;
  });
  
  let pts = 0;
  const categories = [["Deep Work", "scD", 20], ["Learning", "scL", 15], ["Normal Work", "scN", 10], ["Low Productivity", "scP", 5]];
  categories.forEach(([cat, id, rate]) => {
    const p = Math.round(((catSecs[cat] || 0) / 3600) * rate);
    pts += p;
    const el = getEl(id);
    if (el) el.textContent = p > 0 ? `+${p} pts` : "—";
  });
  
  const scPts = getEl("scPts");
  const scArc = getEl("scArc");
  if (scPts) scPts.textContent = pts;
  const circ = 2 * Math.PI * 52;
  if (scArc) scArc.setAttribute("stroke-dasharray", `${Math.min(pts / 200, 1) * circ} ${circ}`);
  
  const RANKS = [
    { name: "No Session", icon: "💤", min: 0, max: 0, points: 0 },
    { name: "Beginner", icon: "🌱", min: 1, max: 29, points: 30 },
    { name: "Focused", icon: "👀", min: 30, max: 59, points: 60 },
    { name: "Productive", icon: "⚡", min: 60, max: 99, points: 100 },
    { name: "Deep Worker", icon: "🧠", min: 100, max: 149, points: 150 },
    { name: "Flow State", icon: "🔥", min: 150, max: 199, points: 200 },
    { name: "Elite", icon: "👑", min: 200, max: Infinity, points: Infinity },
  ];
  
  const rank = RANKS.find((r) => pts >= r.min && pts <= r.max) || RANKS[0];
  if (scArc) {
    const rankColors = { "No Session": "#94a3b8", "Beginner": "#64748b", "Focused": "#3b82f6", "Productive": "#8b5cf6", "Deep Worker": "#2152e0", "Flow State": "#e0682b", "Elite": "#f59e0b" };
    scArc.style.stroke = rankColors[rank.name] || "#94a3b8";
  }
  
  const scBadgeIcon = getEl("scBadgeIcon");
  const scBadgeName = getEl("scBadgeName");
  const scBadge = getEl("scBadge");
  if (scBadgeIcon) scBadgeIcon.textContent = rank.icon;
  if (scBadgeName) scBadgeName.textContent = rank.name;
  if (scBadge) {
    const rankColor = rank === RANKS[0] ? "#94a3b8" : rank === RANKS[1] ? "#64748b" : rank === RANKS[2] ? "#3b82f6" : rank === RANKS[3] ? "#8b5cf6" : rank === RANKS[4] ? "#2152e0" : rank === RANKS[5] ? "#e0682b" : "#f59e0b";
    scBadge.style.cssText = `border-color:${rankColor};color:${rankColor};background:${rankColor}18`;
  }
  
  const scSub = getEl("scSub");
  if (scSub) {
    scSub.textContent = todaySessions.length
      ? `${todaySessions.length} session${todaySessions.length !== 1 ? "s" : ""} · ${fmtHM(getTotalDuration(todaySessions))} today`
      : "Earn points by logging sessions";
  }
  
  const scNext = getEl("scNext");
  const nextRank = RANKS.find(r => r.min > pts);
  if (scNext) {
    if (nextRank) {
      const needed = nextRank.min - pts;
      scNext.innerHTML = needed > 0
        ? `✨ Only ${needed} more points to reach ${nextRank.icon} ${nextRank.name}`
        : "Keep going! You're making progress.";
    } else {
      scNext.innerHTML = "👑 Elite level achieved! Maintain consistency.";
    }
  }
  
  const scLadder = getEl("scLadder");
  if (scLadder) {
    scLadder.innerHTML = RANKS.slice(1).map((r, i) => {
      const earned = pts >= r.min;
      const current = rank.name === r.name && pts > 0;
      const rankColor = r === RANKS[1] ? "#64748b" : r === RANKS[2] ? "#3b82f6" : r === RANKS[3] ? "#8b5cf6" : r === RANKS[4] ? "#2152e0" : r === RANKS[5] ? "#e0682b" : "#f59e0b";
      return `<div class="sc-lrung${earned ? " earned" : ""}${current ? " current" : ""}">
        <div class="sc-lnub" style="${earned || current ? `background:${rankColor};border-color:${rankColor}` : ""}">${earned || current ? r.icon : ""}</div>
        <div class="sc-lname">${r.name}</div>
        <div class="sc-lpts">${r.min}+</div>
      </div>`;
    }).join("");
  }
}

function renderInsights() {
  // IMPORTANT: Use ALL sessions for streak calculation, not filtered
  const currentStreak = calcStreak(allSessions);
  const longestStreak = calcLongestStreak(allSessions);
  const monthDays = calculateMonthDays(allSessions); // Add this if you want month days
  
  const insA = getEl("insA");
  const insAp = getEl("insAp");
  
  if (insA) {
    if (currentStreak > 0) {
      insA.textContent = `${currentStreak}-day streak`;
    } else if (longestStreak > 0) {
      insA.textContent = `Best: ${longestStreak}-day`;
    } else {
      insA.textContent = `0-day streak`;
    }
  }
  
  if (insAp) {
    if (currentStreak >= 14) {
      insAp.textContent = `${currentStreak} day streak - Elite focus! You're in the top tier of focus 👑`;
    } else if (currentStreak >= 7) {
      insAp.textContent = `${currentStreak} day streak - You're on fire! One week is just around the corner ⚡`;
    } else if (currentStreak >= 3) {
      insAp.textContent = `${currentStreak} day streak - Great start! Keep the momentum going 🔥`;
    } else if (currentStreak > 0) {
      insAp.textContent = `${currentStreak} consecutive day${currentStreak > 1 ? "s" : ""} in a row. Keep going!`;
    } else if (longestStreak > 0) {
      insAp.textContent = `Your longest streak was ${longestStreak} days. Start a session today to begin a new streak! 🎯`;
    } else {
      insAp.textContent = "Start your first session to begin a streak!";
    }
  }
  
  // ... rest of the function remains the same for other insights
  const dayT = Array(7).fill(0), dayC = Array(7).fill(0);
  filteredSessions.forEach((s) => {
    const d = parseD(s.date);
    if (d) {
      dayT[d.getDay()] += s.duration;
      dayC[d.getDay()]++;
    }
  });
  const pk = dayT.indexOf(Math.max(...dayT));
  const DN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const insB = getEl("insB");
  const insBp = getEl("insBp");
  if (dayT[pk] > 0) {
    if (insB) insB.textContent = `Peak: ${DN[pk]}`;
    if (insBp) insBp.textContent = `${DN[pk]}s are your most productive — avg ${fmtHM(Math.round(dayT[pk] / (dayC[pk] || 1)))} focus.`;
  } else {
    if (insBp) insBp.textContent = "Log sessions to discover your peak day.";
  }
  
  const dm = {};
  allSessions.forEach((s) => {
    dm[s.date] = (dm[s.date] || 0) + s.duration;
  });
  const best = Object.entries(dm).sort((a, b) => b[1] - a[1])[0];
  const insC = getEl("insC");
  const insCp = getEl("insCp");
  if (best) {
    if (insC) insC.textContent = `Best: ${fmtHM(best[1])}`;
    if (insCp) insCp.textContent = `Your record was ${fmtHM(best[1])} on ${best[0]}. Beat it!`;
  }
  
  const bestHour = getBestFocusHour(allSessions);
  const insD = getEl("insD");
  const insDp = getEl("insDp");
  if (bestHour !== null && bestHour !== -1) {
    const hour12 = bestHour % 12 || 12;
    const ampm = bestHour < 12 ? "AM" : "PM";
    if (insD) insD.textContent = `Best hour: ${hour12}:00 ${ampm}`;
    if (insDp) insDp.textContent = `Most sessions start around this time.`;
  } else {
    if (insDp) insDp.textContent = "Not enough data yet.";
  }
  
  const avgLen = getAverageSessionLength(allSessions);
  const insE = getEl("insE");
  const insEp = getEl("insEp");
  if (insE) insE.textContent = `Avg: ${fmtHM(avgLen)}`;
  if (insEp) insEp.textContent = avgLen > 0 ? `Average focus per session.` : "No sessions yet.";
  
  const deepRatio = getDeepWorkRatio(allSessions);
  const insF = getEl("insF");
  const insFp = getEl("insFp");
  if (insF) insF.textContent = `Deep work: ${Math.round(deepRatio)}%`;
  if (insFp) insFp.textContent = deepRatio > 0 ? `${Math.round(deepRatio)}% of your focus is deep work.` : "Start deep work sessions to improve.";
}

// Helper function to calculate days with sessions in current month
function calculateMonthDays(sessions) {
  const today = new Date();
  const nowM = today.getMonth(), nowY = today.getFullYear();
  const dim = new Date(nowY, nowM + 1, 0).getDate();
  let monthDays = 0;
  for (let d = 1; d <= dim; d++) {
    const ds = fmtDate(new Date(nowY, nowM, d));
    if (sessions.some(s => s.date === ds)) monthDays++;
  }
  return monthDays;
}

function renderBarChart() {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  const td = now.getDay();
  const data = Array(7).fill(0);
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data[(td - i + 7) % 7] = filteredSessions
      .filter((s) => s.date === fmtDate(d))
      .reduce((a, s) => a + s.duration, 0);
  }
  
  const mx = Math.max(...data, 1);
  const wkSecs = data.reduce((a, b) => a + b, 0);
  const chartTitle = getEl("chartTitle");
  const chartSub = getEl("chartSub");
  if (chartTitle) chartTitle.textContent = "Weekly Focus Hours";
  if (chartSub) chartSub.textContent = `This week · ${wkSecs ? fmtHM(wkSecs) : "0h"} total`;
  
  const chart = getEl("barChart");
  if (!chart) return;
  
  if (wkSecs === 0) {
    chart.innerHTML = `<div class="empty-chart"><i class="fas fa-chart-bar"></i><p>No sessions this week</p><small>Start a session to see your weekly focus</small></div>`;
    return;
  }
  
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

function renderPieChart() {
  const now = new Date();
  const thisMonth = filteredSessions.filter((s) => {
    const d = parseD(s.date);
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  
  const totSecs = thisMonth.reduce((a, s) => a + s.duration, 0);
  const chartTitle = getEl("chartTitle");
  const chartSub = getEl("chartSub");
  const pieTotal = getEl("pieTotal");
  if (chartTitle) chartTitle.textContent = "Monthly Breakdown";
  if (chartSub) chartSub.textContent = `${now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} · ${totSecs ? fmtHM(totSecs) : "0h"} total`;
  if (pieTotal) pieTotal.textContent = Math.round(totSecs / 3600) + "h";
  
  const PIE_CATS = [
    { key: "Deep Work", color: "#0078ff", label: "Deep Work" },
    { key: "Learning", color: "#00d68f", label: "Learning" },
    { key: "Normal Work", color: "#ffd166", label: "Normal Work" },
    { key: "Low Productivity", color: "#e94f6f", label: "Low Prod." },
  ];
  
  const catSecs = {};
  PIE_CATS.forEach((c) => {
    catSecs[c.key] = thisMonth
      .filter((s) => s.category === c.key)
      .reduce((a, s) => a + s.duration, 0);
  });
  
  const svg = getEl("pieSvg");
  if (!svg) return;
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
    const pieLegend = getEl("pieLegend");
    if (pieLegend) pieLegend.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--tm);font-size:.78rem;padding:.5rem">No sessions this month yet</div>';
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
  
  const pieLegend = getEl("pieLegend");
  if (pieLegend) {
    pieLegend.innerHTML = segs.map((c) => `
      <div class="pl-row">
        <span class="pl-dot" style="background:${c.color}"></span>
        <span class="pl-name">${c.label}</span>
        <span class="pl-val">${fmtHM(c.secs)}</span>
        <span class="pl-pct">${Math.round(c.pct * 100)}%</span>
      </div>
    `).join("");
  }
}

function switchChart(btn, mode) {
  document.querySelectorAll(".ctab").forEach((b) => b.classList.remove("on"));
  btn.classList.add("on");
  chartMode = mode;
  const chartWeek = getEl("chartWeek");
  const chartMonth = getEl("chartMonth");
  if (chartWeek) chartWeek.style.display = mode === "week" ? "flex" : "none";
  if (chartMonth) chartMonth.style.display = mode === "month" ? "flex" : "none";
  if (mode === "week") renderBarChart();
  else renderPieChart();
}

/* ── CALENDAR ── */
const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function renderCalendar() {
  const map = {};
  filteredSessions.forEach((s) => {
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
  
  const calMon = getEl("calMon");
  const calSub = getEl("calSub");
  if (calMon) calMon.textContent = `${MN[calM].slice(0, 3)} ${calY}`;
  if (calSub) calSub.textContent = `${MN[calM]} ${calY}`;
  
  const fd = new Date(calY, calM, 1).getDay();
  const off = (fd + 6) % 7;
  const dim = new Date(calY, calM + 1, 0).getDate();
  const prevDim = new Date(calY, calM, 0).getDate();
  
  let mSess = 0, mSecs = 0;
  for (let day = 1; day <= dim; day++) {
    const ds = fmtDate(new Date(calY, calM, day));
    if (map[ds]) {
      mSess += filteredSessions.filter((s) => s.date === ds).length;
      mSecs += map[ds];
    }
  }
  const calSC = getEl("calSC");
  const calHC = getEl("calHC");
  if (calSC) calSC.textContent = mSess;
  if (calHC) calHC.textContent = Math.round(mSecs / 3600) + "h";
  
  const grid = getEl("calGrid");
  if (!grid) return;
  grid.innerHTML = "";
  
  for (let i = off - 1; i >= 0; i--) {
    const c = document.createElement("div");
    c.className = "calcel oth";
    c.textContent = prevDim - i;
    grid.appendChild(c);
  }
  
  for (let day = 1; day <= dim; day++) {
    const ds = fmtDate(new Date(calY, calM, day));
    const secs = map[ds] || 0;
    const onSk = streakSet.has(ds);
    const goalHit = isGoalHit(ds);
    const isToday = ds === tStr;
    const sessionCount = filteredSessions.filter((s) => s.date === ds).length;
    
    const cls = ["calcel"];
    if (secs > 0) {
      if (secs >= 7200) cls.push("i4");
      else if (secs >= 3600) cls.push("i3");
      else if (secs >= 1800) cls.push("i2");
      else cls.push("i1");
    }
    if (onSk) cls.push("sk");
    if (onSk) {
      const prev = fmtDate(new Date(calY, calM, day - 1));
      const next = fmtDate(new Date(calY, calM, day + 1));
      const hasPrev = streakSet.has(prev) && day > 1;
      const hasNext = streakSet.has(next) && day < dim;
      if (hasPrev && hasNext) cls.push("sk-mid");
      else if (!hasPrev && hasNext) cls.push("sk-start");
      else if (hasPrev && !hasNext) cls.push("sk-end");
    }
    if (isToday) cls.push("ct2");
    if (goalHit) cls.push("goal-hit");
    
    const c = document.createElement("div");
    c.className = cls.join(" ");
    c.textContent = day;
    c.title = `${ds}\n${secs ? fmtHM(secs) : "No sessions"} · ${sessionCount} session${sessionCount !== 1 ? "s" : ""}${onSk ? "\n🔥 Streak day" : ""}${goalHit ? "\n★ Goals completed" : ""}`;
    
    if (goalHit) {
      const star = document.createElement("span");
      star.className = "cal-star";
      star.textContent = "★";
      c.appendChild(star);
    }
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

/* ── REFRESH ALL ── */
function refreshAllAnalytics() {
  renderHero();
  renderStats();
  if (chartMode === "week") renderBarChart();
  else renderPieChart();
  renderCalendar();
  renderInsights();
  renderScore();
}

/* ── FILTER EVENT HANDLERS ── */
function setupFilters() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentRange = btn.dataset.range;
      applyFilters();
      refreshAllAnalytics();
    });
  });
  
  const categoryFilter = getEl("categoryFilter");
  if (categoryFilter) {
    categoryFilter.addEventListener("change", () => {
      currentCategory = categoryFilter.value;
      applyFilters();
      refreshAllAnalytics();
    });
  }
  
  const projectFilter = getEl("projectFilter");
  if (projectFilter) {
    projectFilter.addEventListener("change", () => {
      currentProject = projectFilter.value;
      applyFilters();
      refreshAllAnalytics();
    });
  }
}

window.resetFilters = resetFilters;

/* ── AUTH LISTENER ── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  currentUser = user;
  await loadUserProfile();
  await loadSessions();
  updateProjectFilter();
  applyFilters();
  setupFilters();
  await refreshAllAnalytics();
  setInterval(() => initHdr(), 60000);
});

/* ── LOGOUT ── */
async function logout() {
  try {
    localStorage.removeItem("activeTimer");
    localStorage.removeItem("st_profile");
    await auth.signOut();
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
window.resetFilters = resetFilters;