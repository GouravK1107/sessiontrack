import { auth, db } from "../firebase.js";
import { 
    doc, 
    getDoc,
    setDoc,
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
let userGoals = []; // Store goals from Firestore
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

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Points per hour for each category
const POINTS_PER_HOUR = {
  "Deep Work": 20,
  "Learning": 15,
  "Normal Work": 10,
  "Low Productivity": 5
};

/* ── CALCULATE POINTS FOR A SESSION ── */
function getSessionPoints(session) {
  const hours = session.duration / 3600;
  const pointsPerHour = POINTS_PER_HOUR[session.category] || 5;
  return Math.round(hours * pointsPerHour);
}

/* ── GOALS FUNCTIONS (Firestore Synced) ── */

// Load goals from Firestore
async function loadGoalsFromFirestore() {
  if (!currentUser) return [];
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      userGoals = data.goals || [];
      // Also update localStorage cache
      localStorage.setItem("st_goals_cache", JSON.stringify(userGoals));
      return userGoals;
    }
    return [];
  } catch (error) {
    console.error("Error loading goals:", error);
    return [];
  }
}

// Save goals to Firestore
async function saveGoalsToFirestore(goals) {
  if (!currentUser) return;
  
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await setDoc(userRef, { goals: goals }, { merge: true });
    userGoals = goals;
    localStorage.setItem("st_goals_cache", JSON.stringify(goals));
  } catch (error) {
    console.error("Error saving goals:", error);
  }
}

// Add a new goal
async function addGoalToFirestore(goalText) {
  if (!goalText.trim()) return;
  
  const newGoal = {
    id: Date.now().toString(),
    text: goalText.trim(),
    repeating: false,
    createdAt: new Date().toISOString()
  };
  
  const updatedGoals = [...userGoals, newGoal];
  await saveGoalsToFirestore(updatedGoals);
  
  // Also add to today's goals
  const todayGoals = getTodayGoals();
  todayGoals.push({ text: goalText.trim(), done: false });
  saveTodayGoals(todayGoals);
  
  await refreshDashboard();
  toast(`✓ Goal added: "${goalText}"`, "ok");
}

// Delete a goal
async function deleteGoalFromFirestore(goalId) {
  const goalToRemove = userGoals.find(g => g.id === goalId);
  if (!goalToRemove) return;
  
  const updatedGoals = userGoals.filter(g => g.id !== goalId);
  await saveGoalsToFirestore(updatedGoals);
  
  // Also remove from today's goals
  const todayGoals = getTodayGoals();
  const updatedTodayGoals = todayGoals.filter(g => g.text !== goalToRemove.text);
  saveTodayGoals(updatedTodayGoals);
  
  await refreshDashboard();
  toast(`🗑️ Goal removed`, "warn");
}

// Toggle repeating status
async function toggleRepeatingGoal(goalId) {
  const updatedGoals = userGoals.map(g => {
    if (g.id === goalId) {
      return { ...g, repeating: !g.repeating };
    }
    return g;
  });
  
  await saveGoalsToFirestore(updatedGoals);
  
  const goal = userGoals.find(g => g.id === goalId);
  const isNowRepeating = !goal?.repeating;
  
  if (isNowRepeating) {
    toast(`🔄 "${goal.text}" will repeat daily across all devices`, "ok");
  } else {
    toast(`⛔ "${goal.text}" will no longer repeat`, "info");
  }
  
  await refreshDashboard();
}

// Mark goal as completed (for today)
async function completeGoalToday(goalText) {
  const todayGoals = getTodayGoals();
  const goalIndex = todayGoals.findIndex(g => g.text === goalText);
  
  if (goalIndex !== -1 && !todayGoals[goalIndex].done) {
    todayGoals[goalIndex].done = true;
    saveTodayGoals(todayGoals);
    await refreshDashboard();
    toast(`✓ Goal completed: "${goalText}"`, "ok");
    
    // Check if all goals are done
    const allDone = todayGoals.length > 0 && todayGoals.every(g => g.done);
    if (allDone) {
      toast("🌟 All daily goals hit! Great work today 🎉", "ok");
    }
    return true;
  }
  return false;
}

// Reset daily goals (adds repeating goals for today)
async function resetDailyGoals() {
  const todayStr = fmtDate(new Date());
  const existingTodayGoals = getTodayGoals();
  const existingTexts = existingTodayGoals.map(g => g.text);
  
  // Get repeating goals that need to be added
  const repeatingGoals = userGoals.filter(g => g.repeating === true);
  const goalsToAdd = [];
  
  for (const goal of repeatingGoals) {
    if (!existingTexts.includes(goal.text)) {
      goalsToAdd.push({ text: goal.text, done: false });
    }
  }
  
  // Also add all non-repeating goals that are not in today's goals
  const nonRepeatingGoals = userGoals.filter(g => g.repeating !== true);
  for (const goal of nonRepeatingGoals) {
    if (!existingTexts.includes(goal.text)) {
      goalsToAdd.push({ text: goal.text, done: false });
    }
  }
  
  if (goalsToAdd.length > 0) {
    const updatedTodayGoals = [...existingTodayGoals, ...goalsToAdd];
    saveTodayGoals(updatedTodayGoals);
    await refreshDashboard();
  }
}

// Check and reset daily goals for new day
async function checkAndResetDailyGoals() {
  const lastDate = localStorage.getItem("lastGoalResetDate");
  const todayStr = fmtDate(new Date());
  
  if (lastDate !== todayStr) {
    await resetDailyGoals();
    localStorage.setItem("lastGoalResetDate", todayStr);
  }
}

// Get today's goals from localStorage
function getTodayGoals() {
  try {
    return JSON.parse(localStorage.getItem(`st_dmh_${fmtDate(new Date())}`) || "[]");
  } catch {
    return [];
  }
}

function saveTodayGoals(arr) {
  localStorage.setItem(`st_dmh_${fmtDate(new Date())}`, JSON.stringify(arr));
}

function isGoalHit(ds) {
  const items = getTodayGoals();
  return items.length > 0 && items.every((i) => i.done);
}

/* ── TIMER PERSISTENCE FUNCTIONS ── */
function saveTimerState() {
  if (isTimerRunning && sessionStartTime) {
    const timerState = {
      isRunning: true,
      startTime: sessionStartTime.getTime(),
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
        
        sessionStartTime = new Date(startTimeMs);
        elapsedSeconds = elapsed;
        isTimerRunning = true;

        if (state.category && $("catSel")) $("catSel").value = state.category;
        if (state.project) {
          const projInp = $("projInp");
          if (projInp) projInp.value = state.project;
        }
        if (state.task && $("taskInp")) $("taskInp").value = state.task;

        startTimerUI();
        return true;
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
  
  const timerCard = $("tc2");
  if (timerCard) timerCard.classList.add("running");
  
  updateTimerStage(0);
  
  $("sDot").className = "sdot run";
  $("sTxtEl").textContent = "Running";
  $("btnStart").disabled = true;
  $("btnStop").disabled = false;
  $("catSel").disabled = true;
  $("taskInp").disabled = true;

  const pw = $("projWrap");
  if (pw) pw.querySelectorAll("input,select").forEach((el) => (el.disabled = true));

  updateTimerDisplay();

  timerInterval = setInterval(() => {
    updateTimerDisplay();
    saveTimerState();
  }, 1000);
}

function updateTimerDisplay() {
  if (!sessionStartTime) return;

  const now = Date.now();
  elapsedSeconds = Math.floor((now - sessionStartTime.getTime()) / 1000);

  $("tClk").textContent = formatTime(elapsedSeconds);
  updateTimerStage(elapsedSeconds);
}

function updateTimerStage(seconds) {
  const tclk = $("tClk");
  if (!tclk) return;
  
  tclk.classList.remove("stage-1", "stage-2", "stage-3", "stage-4");
  
  if (seconds < 600) {
    tclk.classList.add("stage-1");
  } else if (seconds < 1800) {
    tclk.classList.add("stage-2");
  } else if (seconds < 3600) {
    tclk.classList.add("stage-3");
  } else {
    tclk.classList.add("stage-4");
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
      
      const sbAva = $("sbAva");
      if (sbAva) {
        sbAva.textContent = avatarInitials;
        sbAva.style.background = color;
        sbAva.style.backgroundSize = "cover";
      }
      
      if ($("sbName")) $("sbName").textContent = name;
      if ($("sbRole")) $("sbRole").textContent = role;
      
      initHdr(name);
      
      localStorage.setItem("st_profile", JSON.stringify({
        name: name,
        role: role,
        color: color,
        avatar: avatarInitials
      }));
      
      return data;
    } else {
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
      .map((g) => `<option value="${escapeHtml(g.text)}">${g.text}</option>`)
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

/* ── TIMER CONTROL FUNCTIONS ── */
function startSess() {
  if (timerInterval || isTimerRunning) {
    toast("Timer already running!", "info");
    return;
  }
  
  sessionStartTime = new Date();
  elapsedSeconds = 0;
  isTimerRunning = true;
  
  startTimerUI();
  saveTimerState();
  
  toast("Session started! Stay focused 🚀", "info");
}

async function stopSess() {
  if (!timerInterval && !isTimerRunning) {
    toast("No active session to stop", "warn");
    return;
  }

  const timerCard = $("tc2");
  if (timerCard) timerCard.classList.remove("running");

  const endTime = new Date();
  const startTime = sessionStartTime;

  const finalDuration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const category = $("catSel").value;
  let project = getProjVal();
  const task = $("taskInp").value.trim() || "No description";

  // Handle "OTHER" project - auto-complete matching goal
  if (project === "other") {
    const otherInput = document.querySelector("#projOther");
    if (otherInput && otherInput.value.trim()) {
      const typedValue = otherInput.value.trim();
      await completeGoalToday(typedValue);
      project = typedValue;
    } else {
      project = "—";
    }
  } else if (project && project !== "—") {
    // Auto-complete goal if project matches a today's goal
    await completeGoalToday(project);
  }

  const sessionData = {
    date: fmtDate(startTime),
    start: fmt12(startTime),
    end: fmt12(endTime),
    duration: finalDuration,
    category: category,
    project: project,
    task: task,
    ts: startTime.getTime()
  };

  await saveSession(sessionData);

  // Reset UI
  $("tClk").textContent = "00:00:00";
  $("tClk").classList.remove("run", "stage-1", "stage-2", "stage-3", "stage-4");
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

  toast(`Session saved! ${fmtHM(finalDuration)} logged ✓`, "ok");
}

/* ── CATEGORY CLASSES ── */
const CC = {
  "Deep Work": "cp-d",
  Learning: "cp-l",
  "Normal Work": "cp-n",
  "Low Productivity": "cp-w",
};

function mkRow(s) {
  const points = getSessionPoints(s);
  return `
    <tr>
      <td style="color:var(--tm);font-size:.74rem">${escapeHtml(s.date)}发展
      <td style="font-family:var(--m);font-size:.72rem">${escapeHtml(s.start)}发展
      <td style="font-family:var(--m);font-size:.72rem">${escapeHtml(s.end)}发展
      <td style="font-family:var(--m);font-weight:500;color:var(--th)">${fmtHM(s.duration)}发展
      <td style="font-family:var(--m);font-weight:600;color:var(--p)">${points} pts发展
      <td><span class="cp ${CC[s.category] || "cp-n"}">${escapeHtml(s.category)}</span>发展
      <td style="font-size:.74rem;max-width:160px;white-space:normal">${escapeHtml(s.task)}发展
      <td><button class="delbtn" onclick="delS('${s.id}')"><i class="fas fa-trash"></i></button>发展
    </tr>
  `;
}

/* ── RENDER RECENT SESSIONS (last 6) ── */
function renderRecentSessions() {
  const recent = userSessions.slice(0, 6);
  const histCnt = $("histCnt");
  const histBody = $("histBody");
  
  if (histCnt) {
    histCnt.textContent = `${userSessions.length} session${userSessions.length !== 1 ? "s" : ""}`;
  }
  
  if (histBody) {
    if (recent.length) {
      histBody.innerHTML = recent.map(s => mkRow(s)).join("");
    } else {
      histBody.innerHTML = `
        <tr>
          <td class="etd" colspan="7">
            <i class="fas fa-inbox" style="font-size:1.1rem;opacity:.22;display:block;margin-bottom:.3rem"></i>
            No sessions yet. Start your first!
          发展
        </tr>
      `;
    }
  }
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

/* ── STREAK CARD (Modern Design) ── */
function renderStreakCard() {
  const cur = calcStreak(userSessions);
  const best = calcLongestStreak(userSessions);
  const today = new Date();
  const nowM = today.getMonth(), nowY = today.getFullYear();
  const dim = new Date(nowY, nowM + 1, 0).getDate();
  let monthDays = 0;
  
  for (let d = 1; d <= dim; d++) {
    const ds = fmtDate(new Date(nowY, nowM, d));
    if (userSessions.some(s => s.date === ds)) monthDays++;
  }
  
  const daysWithSess = [...new Set(userSessions.map(s => s.date))];
  const goalDays = daysWithSess.filter(ds => isGoalHit(ds)).length;
  
  const maxStreak = 30;
  const ringProgress = Math.min(cur / maxStreak, 1);
  const circumference = 2 * Math.PI * 38;
  const dashArray = ringProgress * circumference;
  
  let streakMessage = "";
  let streakSubMessage = "";
  
  if (cur === 0) {
    streakMessage = "Start your first session today! 🌱";
    streakSubMessage = "Complete a session to begin your streak";
  } else if (cur < 3) {
    streakMessage = `🔥 ${cur} day streak - Great start!`;
    streakSubMessage = "Keep the momentum going";
  } else if (cur < 7) {
    streakMessage = `⚡ ${cur} day streak - You're on fire!`;
    streakSubMessage = "One week is just around the corner";
  } else if (cur < 14) {
    streakMessage = `🎯 ${cur} day streak - Incredible consistency!`;
    streakSubMessage = "You're building an amazing habit";
  } else if (cur < 21) {
    streakMessage = `🏆 ${cur} day streak - Elite focus!`;
    streakSubMessage = "You're in the top tier of focus";
  } else {
    streakMessage = `👑 ${cur} day streak - LEGENDARY!`;
    streakSubMessage = "Absolute focus mastery";
  }
  
  let fireIcon = "🔥";
  if (cur === 0) fireIcon = "💤";
  else if (cur < 3) fireIcon = "🌱";
  else if (cur < 7) fireIcon = "🔥";
  else if (cur < 14) fireIcon = "⚡";
  else if (cur < 21) fireIcon = "🏆";
  else fireIcon = "👑";
  
  const streakCard = $("streakCard");
  if (streakCard) {
    streakCard.innerHTML = `
      <div class="modern-streak">
        <div class="streak-ring">
          <svg class="streak-ring-svg" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="streakGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#2152e0" />
                <stop offset="50%" style="stop-color:#e0682b" />
                <stop offset="100%" style="stop-color:#f59e0b" />
              </linearGradient>
            </defs>
            <circle class="streak-ring-bg" cx="50" cy="50" r="38"></circle>
            <circle class="streak-ring-progress" cx="50" cy="50" r="38" 
              stroke-dasharray="${dashArray} ${circumference}" 
              stroke-dashoffset="0"></circle>
          </svg>
          <div class="streak-ring-inner">
            <span class="streak-ring-value">${cur}</span>
            <span class="streak-ring-label">days</span>
          </div>
        </div>
        
        <div class="streak-info">
          <div class="streak-message">${streakMessage}</div>
          <div class="streak-sub">${streakSubMessage}</div>
        </div>
        
        <div class="streak-stats-grid">
          <div class="streak-stat-item">
            <div class="streak-stat-value">${best}</div>
            <div class="streak-stat-label">Longest</div>
          </div>
          <div class="streak-stat-item">
            <div class="streak-stat-value">${monthDays}</div>
            <div class="streak-stat-label">This Month</div>
          </div>
          <div class="streak-stat-item">
            <div class="streak-stat-value">${goalDays}</div>
            <div class="streak-stat-label">Goal Days</div>
          </div>
        </div>
        
        <div class="streak-fire">
          <span class="streak-fire-icon">${fireIcon}</span>
          <span class="streak-fire-text">${cur > 0 ? `${cur} Day Streak` : "Start Today"}</span>
        </div>
      </div>
      <div class="streak-strip" id="strkStrip"></div>
    `;
  }
  
  const map = {};
  userSessions.forEach(s => { map[s.date] = (map[s.date] || 0) + s.duration; });
  const strip = $("strkStrip");
  if (strip) {
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
}

/* ── DAILY GOALS (Firestore Synced with Repeat Button) ── */
async function renderGoals() {
  // First, ensure today's goals are properly synced with master goals
  await syncTodayGoalsWithMaster();
  
  const todayGoals = getTodayGoals();
  const total = todayGoals.length, done = todayGoals.filter(i => i.done).length;
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
  
  if (todayGoals.length === 0) {
    $("dmhList").innerHTML = `<div style="text-align:center;padding:.9rem;color:var(--tm);font-size:.8rem;font-family:var(--m)">No goals for today — add one below 👆</div>`;
    return;
  }
  
  let html = "";
  for (let idx = 0; idx < todayGoals.length; idx++) {
    const goal = todayGoals[idx];
    const isRepeating = userGoals.some(g => g.text === goal.text && g.repeating === true);
    const escapedText = escapeHtml(goal.text);
    
    html += `
      <div class="dmh-item${goal.done ? " done" : ""}" data-goal-text="${escapedText}">
        <div class="dmh-cb" onclick="toggleGoalCompletion(${idx})">${goal.done ? '<i class="fas fa-check" style="font-size:.6rem"></i>' : ""}</div>
        <span class="dmh-item-text">${escapedText}</span>
        <button class="dmh-repeat-btn ${isRepeating ? "active" : ""}" onclick="toggleRepeatingForGoalText('${escapedText.replace(/'/g, "\\'")}')" title="${isRepeating ? 'Disable daily repeat (syncs across devices)' : 'Repeat daily (syncs across devices)'}">
          <i class="fas fa-sync-alt"></i>
        </button>
        <button class="dmh-del" onclick="deleteGoalByText('${escapedText.replace(/'/g, "\\'")}')" title="Remove goal">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
  }
  
  $("dmhList").innerHTML = html;
}

// Sync today's goals with master goals (add any missing master goals)
async function syncTodayGoalsWithMaster() {
  let todayGoals = getTodayGoals();
  const todayGoalTexts = todayGoals.map(g => g.text);
  
  // Add any master goals that are not in today's goals
  for (const masterGoal of userGoals) {
    if (!todayGoalTexts.includes(masterGoal.text)) {
      todayGoals.push({ text: masterGoal.text, done: false });
    }
  }
  
  // Remove any goals that are no longer in master goals (deleted goals)
  const masterTexts = userGoals.map(g => g.text);
  todayGoals = todayGoals.filter(g => masterTexts.includes(g.text));
  
  saveTodayGoals(todayGoals);
}

// Toggle goal completion for today (by index)
async function toggleGoalCompletion(goalIndex) {
  const todayGoals = getTodayGoals();
  if (goalIndex >= todayGoals.length) return;
  
  todayGoals[goalIndex].done = !todayGoals[goalIndex].done;
  saveTodayGoals(todayGoals);
  
  if (todayGoals[goalIndex].done) {
    toast(`✓ Goal completed: "${todayGoals[goalIndex].text}"`, "ok");
  }
  
  await refreshDashboard();
  
  // Check if all goals are done
  const updatedTodayGoals = getTodayGoals();
  const allDone = updatedTodayGoals.length > 0 && updatedTodayGoals.every(g => g.done);
  if (allDone) {
    toast("🌟 All daily goals hit! Great work today 🎉", "ok");
  }
}

// Toggle repeating for a goal by its text
async function toggleRepeatingForGoalText(goalText) {
  const goal = userGoals.find(g => g.text === goalText);
  if (!goal) {
    // If goal doesn't exist in master list, add it first
    await addGoalToFirestore(goalText);
    const newGoal = userGoals.find(g => g.text === goalText);
    if (newGoal) {
      await toggleRepeatingGoal(newGoal.id);
    }
    return;
  }
  await toggleRepeatingGoal(goal.id);
}

// Delete goal by its text
async function deleteGoalByText(goalText) {
  const goal = userGoals.find(g => g.text === goalText);
  if (goal) {
    await deleteGoalFromFirestore(goal.id);
  } else {
    // Just remove from today's goals if it's only a today goal
    const todayGoals = getTodayGoals();
    const updatedTodayGoals = todayGoals.filter(g => g.text !== goalText);
    saveTodayGoals(updatedTodayGoals);
    await refreshDashboard();
    toast(`🗑️ Goal removed from today`, "warn");
  }
}

// Add new goal
async function addGoalItem() {
  const inp = $("dmhInp");
  const text = inp.value.trim();
  if (!text) return;
  
  await addGoalToFirestore(text);
  inp.value = "";
  await refreshDashboard();
  updateProjField();
}

/* ── REFRESH DASHBOARD ── */
async function refreshDashboard() {
  await loadSessions();
  await loadGoalsFromFirestore();
  await syncTodayGoalsWithMaster();
  renderStats();
  renderRecentSessions();
  await renderGoals();
  renderStreakCard();
  updateProjField();
}

/* ── LOGOUT FUNCTION ── */
async function logout() {
  try {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    localStorage.removeItem("activeTimer");
    await auth.signOut();
    localStorage.removeItem("st_profile");
    window.location.href = "login.html";
  } catch (error) {
    console.error("Error during logout:", error);
    toast("Failed to logout. Please try again.", "error");
  }
}

/* ── AUTH LISTENER ── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  
  currentUser = user;
  await loadUserProfile();
  await loadGoalsFromFirestore();
  await refreshDashboard();
  updateProjField();
  await checkAndResetDailyGoals();
  
  const timerRestored = loadTimerState();
  if (!timerRestored) {
    $("tClk").textContent = "00:00:00";
    $("tSt").textContent = "--:--";
    $("tDt").textContent = "--";
  }
  
  setInterval(initHdr, 60000);
});

/* ── EXPOSE GLOBAL FUNCTIONS ── */
window.startSess = startSess;
window.stopSess = stopSess;
window.delS = delS;
window.toggleDark = toggleDark;
window.toggleSb = toggleSb;
window.closeSb = closeSb;
window.clearAll = clearAll;
window.addGoalItem = addGoalItem;
window.toggleGoalCompletion = toggleGoalCompletion;
window.deleteGoalByText = deleteGoalByText;
window.toggleRepeatingForGoalText = toggleRepeatingForGoalText;
window.toggleRepeatingGoal = toggleRepeatingGoal;
window.logout = logout;
window.updateTimerDisplay = updateTimerDisplay;