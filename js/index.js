/* ─────────────────────────────────────────
   MOBILE MENU
───────────────────────────────────────── */
const toggle = document.getElementById("navToggle");
const menu   = document.getElementById("navMenu");

function closeMenu() {
  menu.classList.remove("active");
  toggle.setAttribute("aria-expanded", "false");
  toggle.querySelector("i").className = "fas fa-bars";
  // also close any open dropdown
  document.querySelectorAll(".has-dropdown.mob-open")
    .forEach(el => el.classList.remove("mob-open"));
}

toggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = menu.classList.toggle("active");
  toggle.setAttribute("aria-expanded", open);
  toggle.querySelector("i").className = open ? "fas fa-times" : "fas fa-bars";
  if (!open) {
    document.querySelectorAll(".has-dropdown.mob-open")
      .forEach(el => el.classList.remove("mob-open"));
  }
});

// Close when clicking outside
document.addEventListener("click", (e) => {
  if (
    !menu.contains(e.target) &&
    !toggle.contains(e.target) &&
    menu.classList.contains("active")
  ) {
    closeMenu();
  }
});

// Close menu when a normal (non-dropdown-parent) link is clicked
menu.querySelectorAll("a:not(.has-dropdown > a)").forEach((a) => {
  a.addEventListener("click", () => closeMenu());
});

// Reset menu on resize back to desktop
window.addEventListener("resize", () => {
  if (window.innerWidth > 820) {
    closeMenu();
    menu.style.transition = "none";
    requestAnimationFrame(() => { menu.style.transition = ""; });
  }
});


/* ─────────────────────────────────────────
   FEATURES DROPDOWN — mobile accordion
───────────────────────────────────────── */
document.querySelectorAll(".has-dropdown > a").forEach((link) => {
  link.addEventListener("click", function (e) {
    if (window.innerWidth <= 820) {
      e.preventDefault();
      e.stopPropagation();

      const parent  = this.closest(".has-dropdown");
      const isOpen  = parent.classList.contains("mob-open");

      // Close all other open dropdowns first
      document.querySelectorAll(".has-dropdown.mob-open")
        .forEach(el => { if (el !== parent) el.classList.remove("mob-open"); });

      // Toggle this one
      parent.classList.toggle("mob-open", !isOpen);
    }
    // On desktop — let normal hover handle it, do nothing on click
  });
});


/* ─────────────────────────────────────────
   SMOOTH SCROLL
───────────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", function (e) {
    const id = this.getAttribute("href").slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const navH = document.querySelector(".navbar").offsetHeight;
    const top  = target.getBoundingClientRect().top + window.scrollY - navH - 16;
    window.scrollTo({ top, behavior: "smooth" });
  });
});


/* ─────────────────────────────────────────
   ACTIVE NAV LINK on scroll
───────────────────────────────────────── */
const sections = [
  { id: "hero",         link: null },
  { id: "features",    link: document.querySelector('.nav-links a[href="#features"]') },
  { id: "analytics",   link: null },
  { id: "how-it-works",link: document.querySelector('.nav-links a[href="#how-it-works"]') },
];
const navH = () => document.querySelector(".navbar").offsetHeight;

function updateActiveNav() {
  const scrollY  = window.scrollY + navH() + 40;
  let current    = sections[0];
  sections.forEach((s) => {
    const el = document.getElementById(s.id);
    if (el && el.offsetTop <= scrollY) current = s;
  });
  sections.forEach((s) => s.link && s.link.classList.remove("active"));
  if (current.link) current.link.classList.add("active");
}
window.addEventListener("scroll", updateActiveNav, { passive: true });
updateActiveNav();


/* ─────────────────────────────────────────
   LOGO COLOUR CYCLE
───────────────────────────────────────── */
const badge  = document.getElementById("logoBadge");
const colors = ["c1", "c2", "c3", "c4"];
let cIdx = 0;
setInterval(() => {
  badge.classList.remove(...colors, "flip-anim");
  void badge.offsetWidth; // force reflow
  cIdx = (cIdx + 1) % colors.length;
  badge.classList.add(colors[cIdx], "flip-anim");
}, 2800);


/* ─────────────────────────────────────────
   ANALYTICS TAB SWITCHER
───────────────────────────────────────── */
const datasets = {
  week:  [90, 130, 70, 150, 110, 155, 80],
  month: [110, 95, 120, 80, 145, 60, 100],
  all:   [75, 100, 85, 140, 120, 90, 110],
};
function switchTab(el, type) {
  document.querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll("#barChart .bar").forEach((bar, i) => {
    bar.style.height    = (datasets[type][i] || 80) + "px";
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "";
  });
}


/* ─────────────────────────────────────────
   HEATMAP
───────────────────────────────────────── */
const heatLevels = [
  0,0,1,2,3,1,0,1,2,3,4,2,0,0,3,4,2,1,0,3,1,2,1,3,4,1,0,2,
];
const lvlClass = ["", "l1", "l2", "l3", "l4"];
const hg = document.getElementById("heatGrid");
heatLevels.forEach((lv) => {
  const sq = document.createElement("div");
  sq.className = "h-sq" + (lv ? " " + lvlClass[lv] : "");
  hg.appendChild(sq);
});


/* ─────────────────────────────────────────
   CALENDAR
───────────────────────────────────────── */
let calYear = 2026, calMonth = 2;
const sessions = {
  "2026-2-1":2,"2026-2-3":3,"2026-2-4":1,"2026-2-5":3,"2026-2-7":2,
  "2026-2-8":3,"2026-2-10":1,"2026-2-11":3,"2026-2-12":2,"2026-2-14":3,
  "2026-2-15":2,"2026-2-17":3,"2026-2-18":2,"2026-2-19":1,"2026-2-21":3,"2026-2-22":2,
};
const mNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function renderCal() {
  const grid  = document.getElementById("calGrid");
  const title = document.getElementById("calTitle");
  grid.innerHTML = "";
  title.textContent = mNames[calMonth] + " " + calYear;
  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const startOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevDays    = new Date(calYear, calMonth, 0).getDate();
  const today       = new Date();
  const isCurrent   = today.getFullYear() === calYear && today.getMonth() === calMonth;

  for (let i = startOffset - 1; i >= 0; i--) {
    const c = document.createElement("div");
    c.className = "cal-cell other-month";
    c.textContent = prevDays - i;
    grid.appendChild(c);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const c   = document.createElement("div");
    const key = `${calYear}-${calMonth}-${d}`;
    const lvl = sessions[key] || 0;
    c.className = "cal-cell";
    if (isCurrent && d === today.getDate()) c.classList.add("today");
    if (lvl > 0) c.classList.add("has-session");
    if (lvl === 3) c.classList.add("high-focus");
    c.textContent = d;
    grid.appendChild(c);
  }
  const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  for (let i = startOffset + daysInMonth, nd = 1; i < total; i++, nd++) {
    const c = document.createElement("div");
    c.className = "cal-cell other-month";
    c.textContent = nd;
    grid.appendChild(c);
  }
  const cnt = Object.keys(sessions)
    .filter((k) => k.startsWith(`${calYear}-${calMonth}-`)).length;
  document.getElementById("calSessions").textContent = cnt;
  document.getElementById("calHours").textContent    = cnt * 4 + "h";
}

document.getElementById("calPrev").addEventListener("click", () => {
  if (--calMonth < 0) { calMonth = 11; calYear--; }
  renderCal();
});
document.getElementById("calNext").addEventListener("click", () => {
  if (++calMonth > 11) { calMonth = 0; calYear++; }
  renderCal();
});
renderCal();