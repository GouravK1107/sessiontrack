import { auth, db } from "../firebase.js";
import { 
    doc, 
    getDoc,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    deleteDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

let currentUser = null;
let userSessions = [];
let timerInterval = null;
let sessionStartTime = null;
let elapsedSeconds = 0;
let isTimerRunning = false;

/* ── UTILS ── */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

function fmt12(d) {
  let h = d.getHours(),
    m = d.getMinutes(),
    ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${pad(m)} ${ap}`;
}

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

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function parseD(str) {
  try {
    const [d, mn, y] = str.split(" ");
    const mo = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    return new Date(+y, mo[mn], +d);
  } catch (e) {
    return null;
  }
}

/* ── TIMER PERSISTENCE FUNCTIONS ── */
function saveTimerState() {
  if (isTimerRunning && sessionStartTime) {
    const timerState = {
      isRunning: true,
      startTime: sessionStartTime.getTime(),
      elapsedSeconds: elapsedSeconds,
      category: $("catSel")?.value,
      project: getProjVal(),
      task: $("taskInp")?.value
    };
    localStorage.setItem("activeTimer", JSON.stringify(timerState));
  } else {
    localStorage.removeItem("activeTimer");
  }
}

function loadTimerState() {
  const savedTimer = localStorage.getItem("activeTimer");
  if (savedTimer) {
    try {
      const state = JSON.parse(savedTimer);
      if (state.isRunning && state.startTime) {
        const startTimeMs = state.startTime;
        const now = Date.now();
        const elapsed = Math.floor((now - startTimeMs) / 1000);
        
        if (elapsed >= 0) {
          sessionStartTime = new Date(startTimeMs);
          elapsedSeconds = elapsed;
          isTimerRunning = true;
          
          // Restore form values
          if (state.category && $("catSel")) $("catSel").value = state.category;
          if (state.project && $("projInp")) {
            // Handle project restoration
            const projInp = $("projInp");
            if (projInp.tagName === "SELECT") {
              projInp.value = state.project;
            } else if (projInp.tagName === "INPUT") {
              projInp.value = state.project;
            }
          }
          if (state.task && $("taskInp")) $("taskInp").value = state.task;
          
          // Start the timer UI
          startTimerUI();
          return true;
        }
      }
    } catch (e) {
      console.error("Error loading timer state:", e);
    }
  }
  return false;
}

function startTimerUI() {
  if (timerInterval) return;
  
  $("tSt").textContent = fmt12(sessionStartTime);
  $("tDt").textContent = fmtDate(sessionStartTime);
  $("tClk").classList.add("run");
  $("sDot").className = "sdot run";
  $("sTxtEl").textContent = "Running";
  $("btnStart").disabled = true;
  $("btnStop").disabled = false;
  $("catSel").disabled = true;
  $("taskInp").disabled = true;
  
  const pw = $("projWrap");
  if (pw) pw.querySelectorAll("input,select").forEach((el) => (el.disabled = true));
  
  $("tClk").textContent = formatTime(elapsedSeconds);
  
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    $("tClk").textContent = formatTime(elapsedSeconds);
    saveTimerState(); // Save state every second
  }, 1000);
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

/* ── LOAD USER PROFILE FROM FIREBASE ── */
/* ── LOAD USER PROFILE FROM FIREBASE ── */
async function loadUserProfile() {
  if (!currentUser) return null;
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      const name = data.name || currentUser.email?.split('@')[0] || "User";
      const role = data.role || "SessionTrack member";
      const color = data.color || "linear-gradient(135deg,#2152e0,#b84a8c)";
      const avatarInitials = initials(name);
      
      // Update sidebar avatar with color and initials
      const sbAva = $("sbAva");
      if (sbAva) {
        sbAva.textContent = avatarInitials;
        sbAva.style.background = color;
        sbAva.style.backgroundSize = "cover";
      }
      
      // Update sidebar name and role
      if ($("sbName")) $("sbName").textContent = name;
      if ($("sbRole")) $("sbRole").textContent = role;
      
      // Update header greeting
      initHdr(name);
      
      // Also store in localStorage for quick access
      localStorage.setItem("st_profile", JSON.stringify({
        name: name,
        role: role,
        color: color,
        avatar: avatarInitials
      }));
      
      return data;
    } else {
      // No profile exists yet, use default with email initial
      const defaultName = currentUser.email?.split('@')[0] || "User";
      const defaultInitials = initials(defaultName);
      const defaultColor = "linear-gradient(135deg,#2152e0,#b84a8c)";
      
      const sbAva = $("sbAva");
      if (sbAva) {
        sbAva.textContent = defaultInitials;
        sbAva.style.background = defaultColor;
        sbAva.style.backgroundSize = "cover";
      }
      if ($("sbName")) $("sbName").textContent = defaultName;
      if ($("sbRole")) $("sbRole").textContent = "SessionTrack member";
      
      initHdr(defaultName);
      return null;
    }
  } catch (error) {
    console.error("Error loading profile:", error);
    return null;
  }
}

/* ── INITIALS FUNCTION (ensure it's there) ── */
function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
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
  const sub = $("greetSub");
  if (sub) {
    sub.textContent = `${n.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long" })} · Ready for deep work?`;
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
    userSessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    return userSessions;
  } catch (error) {
    console.error("Error loading sessions:", error);
    return [];
  }
}

/* ── SAVE SESSION TO FIREBASE ── */
async function saveSession(sessionData) {
  if (!currentUser) return null;
  
  try {
    const docRef = await addDoc(collection(db, "sessions"), {
      ...sessionData,
      userId: currentUser.uid
    });
    return docRef.id;
  } catch (error) {
    console.error("Error saving session:", error);
    toast("Failed to save session", "warn");
    return null;
  }
}

/* ── DELETE SESSION ── */
async function deleteSession(sessionId) {
  if (!currentUser) return;
  
  try {
    await deleteDoc(doc(db, "sessions", sessionId));
    toast("Session deleted", "warn");
    await refreshDashboard();
  } catch (error) {
    console.error("Error deleting session:", error);
    toast("Failed to delete session", "warn");
  }
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

/* ── DAILY MINIMUM HIT (localStorage) ── */
function dmhKey(ds) {
  return "st_dmh_" + ds;
}

function getGoalsForDate(ds) {
  try {
    return JSON.parse(localStorage.getItem(dmhKey(ds)) || "[]");
  } catch {
    return [];
  }
}

function getTodayGoals() {
  try {
    return JSON.parse(localStorage.getItem(dmhKey(fmtDate(new Date()))) || "[]");
  } catch {
    return [];
  }
}

function saveTodayGoals(arr) {
  localStorage.setItem(dmhKey(fmtDate(new Date())), JSON.stringify(arr));
}

function isGoalHit(ds) {
  const items = getGoalsForDate(ds);
  return items.length > 0 && items.every((i) => i.done);
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/* ── PROJECT FIELD ── */
function updateProjField() {
  const wrap = $("projWrap");
  if (!wrap) return;
  const goals = getTodayGoals();
  const existingSelect = wrap.querySelector("select");
  const existingInput = wrap.querySelector("input");
  const wasVal = existingSelect ? existingSelect.value : (existingInput ? existingInput.value : "");
  
  if (goals.length > 0) {
    const opts = goals
      .map((g) => `<option value="${escHtml(g.text)}">${g.text}</option>`)
      .join("");
    wrap.innerHTML = `<select id="projInp"><option value="—">— Pick a goal —</option>${opts}<option value="other">✏️ Other</option></select>
    <input id="projOther" placeholder="Enter project name…" style="margin-top:.4rem;display:none">`;
    wrap.querySelector("select").addEventListener("change", function () {
      const otherInp = wrap.querySelector("#projOther");
      if (otherInp) otherInp.style.display = this.value === "other" ? "block" : "none";
    });
  } else {
    wrap.innerHTML = `<input id="projInp" placeholder="e.g. Todo API" value="${wasVal}">`;
  }
}

function getProjVal() {
  const sel = document.querySelector("#projWrap select");
  if (sel) {
    return sel.value === "other"
      ? document.querySelector("#projOther")?.value.trim() || "—"
      : sel.value || "—";
  }
  return document.querySelector("#projInp")?.value.trim() || "—";
}

/* ── TIMER ── */
function startSess() {
  if (timerInterval || isTimerRunning) return;
  
  sessionStartTime = new Date();
  elapsedSeconds = 0;
  isTimerRunning = true;
  
  startTimerUI();
  saveTimerState();
  
  toast("Session started! Stay focused 🚀", "info");
}

async function stopSess() {
  if (!timerInterval && !isTimerRunning) return;
  
  clearInterval(timerInterval);
  timerInterval = null;
  
  const endTime = new Date();
  const category = $("catSel").value;
  let project = getProjVal();
  const task = $("taskInp").value.trim() || "No description";
  
  // 🔥 NEW: Check if project is "other" and user typed a goal name
  if (project === "other") {
    const otherInput = document.querySelector("#projOther");
    if (otherInput && otherInput.value.trim()) {
      const typedValue = otherInput.value.trim();
      const goals = getTodayGoals();
      
      // Check if typed value matches any incomplete goal
      for (let i = 0; i < goals.length; i++) {
        if (goals[i].text === typedValue && !goals[i].done) {
          goals[i].done = true;
          saveTodayGoals(goals);
          renderGoals();
          renderStreakCard();
          toast(`🎯 Goal completed: "${typedValue}"!`, "ok");
          break;
        }
      }
      project = typedValue; // Use typed value as project name
    } else {
      project = "—";
    }
  }
  
  const sessionData = {
    date: fmtDate(sessionStartTime),
    start: fmt12(sessionStartTime),
    end: fmt12(endTime),
    duration: elapsedSeconds,
    category: category,
    project: project,
    task: task,
    ts: sessionStartTime.getTime()
  };
  
  await saveSession(sessionData);
  
  // 🔥 Auto-mark goal if project matches a goal (for dropdown selection)
  if (project && project !== "—") {
    const goals = getTodayGoals();
    let goalFound = false;
    
    for (let i = 0; i < goals.length; i++) {
      if (goals[i].text === project && !goals[i].done) {
        goals[i].done = true;
        goalFound = true;
        break;
      }
    }
    
    if (goalFound) {
      saveTodayGoals(goals);
      renderGoals();
      renderStreakCard();
      toast(`🎯 Goal completed: "${project}"!`, "ok");
      
      const allDone = goals.length > 0 && goals.every(g => g.done);
      if (allDone) {
        toast("🌟 All daily goals hit! Amazing work today!", "ok");
      }
    }
  }
  
  // Reset timer UI
  $("tClk").textContent = "00:00:00";
  $("tClk").classList.remove("run");
  $("sDot").className = "sdot idle";
  $("sTxtEl").textContent = "Idle";
  $("tSt").textContent = "--:--";
  $("tDt").textContent = "--";
  $("btnStart").disabled = false;
  $("btnStop").disabled = true;
  $("catSel").disabled = false;
  $("taskInp").disabled = false;
  $("taskInp").value = "";
  
  const pw = $("projWrap");
  if (pw) pw.querySelectorAll("input,select").forEach((el) => (el.disabled = false));
  
  elapsedSeconds = 0;
  sessionStartTime = null;
  isTimerRunning = false;
  updateProjField();
  
  localStorage.removeItem("activeTimer");
  
  await refreshDashboard();
  
  toast(`Session saved! ${fmtHM(sessionData.duration)} logged ✓`, "ok");
}

/* ── CATEGORY CLASSES ── */
const CC = {
  "Deep Work": "cp-d",
  Learning: "cp-l",
  "Normal Work": "cp-n",
  "Low Productivity": "cp-w",
};

function mkRow(s) {
  return `<tr>
    <td style="color:var(--tm);font-size:.74rem">${s.date}</td>
    <td style="font-family:var(--m);font-size:.72rem">${s.start}</td>
    <td style="font-family:var(--m);font-size:.72rem">${s.end}</td>
    <td style="font-family:var(--m);font-weight:500;color:var(--th)">${fmtHM(s.duration)}</td>
    <td><span class="cp ${CC[s.category] || "cp-n"}">${s.category}</span></td>
    <td style="font-size:.74rem;max-width:160px;white-space:normal">${s.task}</td>
    <td><button class="delbtn" onclick="delS('${s.id}')"><i class="fas fa-trash"></i></button></td>
  </tr>`;
}

/* ── RENDER RECENT SESSIONS (last 6) ── */
function renderRecentSessions() {
  const recent = userSessions.slice(0, 6);
  $("histCnt").textContent = `${userSessions.length} session${userSessions.length !== 1 ? "s" : ""}`;
  $("histBody").innerHTML = recent.length
    ? recent.map(mkRow).join("")
    : `<td class="etd" colspan="7"><i class="fas fa-inbox" style="font-size:1.1rem;opacity:.22;display:block;margin-bottom:.3rem"></i>No sessions yet. Start your first!</td>`;
}

/* ── DELETE SESSION (global) ── */
window.delS = async (id) => {
  await deleteSession(id);
};

/* ── CLEAR ALL ── */
async function clearAll() {
  if (!userSessions.length) return toast("No sessions to clear", "warn");
  if (!confirm("Clear all sessions?")) return;
  
  for (const session of userSessions) {
    await deleteDoc(doc(db, "sessions", session.id));
  }
  await refreshDashboard();
  toast("All sessions cleared", "warn");
}

/* ── STATS ── */
function renderStats() {
  const today = fmtDate(new Date());
  const todaySessions = userSessions.filter(s => s.date === today);
  const totalToday = todaySessions.reduce((a, s) => a + s.duration, 0);
  const deepToday = todaySessions
    .filter(s => s.category === "Deep Work")
    .reduce((a, s) => a + s.duration, 0);
  const streak = calcStreak(userSessions);
  
  $("sH").textContent = fmtHM(totalToday) || "0m";
  $("sS").textContent = todaySessions.length;
  $("sD").textContent = fmtHM(deepToday) || "0m";
  $("sSt").textContent = streak;
}

/* ── STREAK CARD ── */
function renderStreakCard() {
  const cur = calcStreak(userSessions);
  const best = calcLongestStreak(userSessions);
  const today = new Date();
  const nowM = today.getMonth(), nowY = today.getFullYear();
  const dim = new Date(nowY, nowM + 1, 0).getDate();
  let monthDays = 0;
  
  // Count days this month with sessions
  for (let d = 1; d <= dim; d++) {
    const ds = fmtDate(new Date(nowY, nowM, d));
    if (userSessions.some(s => s.date === ds)) monthDays++;
  }
  
  const daysWithSess = [...new Set(userSessions.map(s => s.date))];
  const goalDays = daysWithSess.filter(ds => isGoalHit(ds)).length;
  
  $("strkCur").textContent = cur;
  $("strkLbl").textContent = cur > 1 ? "day streak 🔥" : "day streak";
  $("strkBest").textContent = best;
  $("strkMon").textContent = monthDays;
  $("strkGoalDays").textContent = goalDays;
  
  // Flame animation based on streak
  const flame = $("strkFlame");
  if (cur === 0) {
    flame.className = "streak-flame zero";
    flame.textContent = "💤";
  } else if (cur < 3) {
    flame.className = "streak-flame";
    flame.textContent = "🔥";
  } else {
    flame.className = "streak-flame";
    flame.textContent = "🔥";
  }
  
  // 30-day strip (keep existing code)
  const map = {};
  userSessions.forEach(s => { map[s.date] = (map[s.date] || 0) + s.duration; });
  const strip = $("strkStrip");
  strip.innerHTML = "";
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = fmtDate(d);
    const secs = map[ds] || 0;
    const cell = document.createElement("div");
    const lv = secs === 0 ? 0 : secs < 1800 ? 1 : secs < 3600 ? 2 : secs < 7200 ? 3 : 4;
    cell.className = "ss-cell" + (lv ? ` s${lv}` : "") + (ds === fmtDate(today) ? " today-c" : "");
    cell.title = `${ds}: ${secs ? fmtHM(secs) : "No session"}`;
    strip.appendChild(cell);
  }
}

/* ── DAILY GOALS ── */
function renderGoals() {
  const items = getTodayGoals();
  const total = items.length, done = items.filter(i => i.done).length;
  const badge = $("dmhBadge");
  
  if (total === 0) {
    badge.className = "dmh-badge none";
    badge.textContent = "⏳ Add your goals";
  } else if (done === total) {
    badge.className = "dmh-badge all";
    badge.textContent = `★ All ${done}/${total} done!`;
  } else if (done > 0) {
    badge.className = "dmh-badge some";
    badge.textContent = `⚡ ${done}/${total} done`;
  } else {
    badge.className = "dmh-badge none";
    badge.textContent = `0/${total} done`;
  }
  
  $("dmhList").innerHTML = items.length
    ? items.map((item, idx) => `
      <div class="dmh-item${item.done ? " done" : ""}" onclick="toggleGoal(${idx})">
        <div class="dmh-cb">${item.done ? '<i class="fas fa-check" style="font-size:.6rem"></i>' : ""}</div>
        <span class="dmh-item-text">${item.text}</span>
        <button class="dmh-del" onclick="delGoal(event,${idx})"><i class="fas fa-times"></i></button>
      </div>`).join("")
    : `<div style="text-align:center;padding:.9rem;color:var(--tm);font-size:.8rem;font-family:var(--m)">No goals yet — type one below 👆</div>`;
}

function addGoalItem() {
  const inp = $("dmhInp");
  const text = inp.value.trim();
  if (!text) return;
  const items = getTodayGoals();
  items.push({ text, done: false });
  saveTodayGoals(items);
  inp.value = "";
  renderGoals();
  updateProjField();
  if (items.length > 0 && items.every(i => i.done)) {
    toast("★ All daily goals hit! Great work today 🎉", "ok");
  }
}

function toggleGoal(idx) {
  const items = getTodayGoals();
  items[idx].done = !items[idx].done;
  saveTodayGoals(items);
  renderGoals();
  renderStreakCard();
  
  // Update project field if the goal is being marked (optional)
  updateProjField();
  
  if (items.length > 0 && items.every(i => i.done)) {
    toast("★ All daily goals hit! Great work today 🎉", "ok");
  } else if (items[idx].done) {
    toast(`✓ Goal completed: "${items[idx].text}"`, "ok");
  }
}

function delGoal(e, idx) {
  e.stopPropagation();
  const items = getTodayGoals();
  items.splice(idx, 1);
  saveTodayGoals(items);
  renderGoals();
  updateProjField();
}

/* ── REFRESH DASHBOARD ── */
async function refreshDashboard() {
  await loadSessions();
  renderStats();
  renderRecentSessions();
  renderGoals();
  renderStreakCard();
}

/* ── AUTH LISTENER ── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  
  currentUser = user;
  await loadUserProfile();
  await refreshDashboard();
  updateProjField();
  
  // Check for existing timer on page load
  const timerRestored = loadTimerState();
  if (!timerRestored) {
    // If no active timer, ensure UI is in idle state
    $("tClk").textContent = "00:00:00";
    $("tSt").textContent = "--:--";
    $("tDt").textContent = "--";
  }
  
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
window.startSess = startSess;
window.stopSess = stopSess;
window.delS = delS;
window.toggleDark = toggleDark;
window.toggleSb = toggleSb;
window.closeSb = closeSb;
window.clearAll = clearAll;
window.addGoalItem = addGoalItem;
window.toggleGoal = toggleGoal;
window.delGoal = delGoal;
window.logout = logout;
