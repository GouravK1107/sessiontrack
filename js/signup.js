import { auth, db } from "../firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

/* ── Eye toggle ── */
document.getElementById("eyeBtn").addEventListener("click", function () {
  const inp = document.getElementById("password");
  const icon = document.getElementById("eyeIcon");
  if (inp.type === "password") {
    inp.type = "text";
    icon.className = "fas fa-eye-slash";
  } else {
    inp.type = "password";
    icon.className = "fas fa-eye";
  }
});

/* ── Password strength ── */
function checkStrength(val) {
  const segs = [1, 2, 3, 4].map((n) => document.getElementById("seg" + n));
  const lbl = document.getElementById("strengthLbl");
  segs.forEach((s) => (s.className = "strength-seg"));
  if (!val) {
    lbl.textContent = "Enter a password";
    return;
  }

  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^a-zA-Z0-9]/.test(val)) score++;

  const levels = ["weak", "fair", "good", "strong"];
  const labels = ["Weak", "Fair", "Good", "Strong 💪"];
  const cls = levels[score - 1] || "weak";
  for (let i = 0; i < score; i++) segs[i].classList.add(cls);
  lbl.textContent = score > 0 ? labels[score - 1] : "Enter a password";
}

/* ── Toast ── */
function showToast(msg, type) {
  const t = document.getElementById("toast");
  t.innerHTML = `<i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}"></i> ${msg}`;
  t.className = `toast show ${type}`;
  setTimeout(() => {
    t.className = "toast";
  }, 3400);
}

/* ── Clear errors on input ── */
["firstName", "email", "password"].forEach((id) => {
  const errMap = {
    firstName: "firstNameErr",
    email: "emailErr",
    password: "pwdErr",
  };
  document.getElementById(id).addEventListener("input", function () {
    this.classList.remove("error-field");
    document.getElementById(errMap[id]).classList.remove("show");
  });
});

/* ── Signup handler with Firebase ── */
async function handleSignup() {
  const firstName = document.getElementById("firstName");
  const email = document.getElementById("email");
  const pwd = document.getElementById("password");
  const terms = document.getElementById("terms");
  const btn = document.getElementById("signupBtn");
  let valid = true;

  /* reset */
  [firstName, email, pwd].forEach((el) => el.classList.remove("error-field"));
  ["firstNameErr", "emailErr", "pwdErr", "termsErr"].forEach((id) =>
    document.getElementById(id).classList.remove("show"),
  );

  if (!firstName.value.trim()) {
    firstName.classList.add("error-field");
    document.getElementById("firstNameErr").classList.add("show");
    valid = false;
  }
  if (!email.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    email.classList.add("error-field");
    document.getElementById("emailErr").classList.add("show");
    valid = false;
  }
  if (!pwd.value || pwd.value.length < 8) {
    pwd.classList.add("error-field");
    document.getElementById("pwdErr").classList.add("show");
    valid = false;
  }
  if (!terms.checked) {
    document.getElementById("termsErr").classList.add("show");
    valid = false;
  }
  if (!valid) return;

  /* animate step dots */
  document.getElementById("dot1").classList.replace("s1", "done");
  document.getElementById("dot2").classList.add("active");

  btn.classList.add("loading");

  try {
    // Create Firebase user
    const userCredential = await createUserWithEmailAndPassword(auth, email.value, pwd.value);
    const user = userCredential.user;

    // Update step dots
    setTimeout(() => {
      document.getElementById("dot2").classList.add("done");
      document.getElementById("dot3").classList.add("active");
    }, 300);

    // Create user profile in Firestore
    await setDoc(doc(db, "users", user.uid), {
      name: firstName.value.trim(),
      email: email.value,
      createdAt: new Date().toISOString(),
      role: "Member",
      color: "linear-gradient(135deg,#667eea,#764ba2)",
      avatar: firstName.value.trim().charAt(0).toUpperCase(),
    });

    // Final step animation
    setTimeout(() => {
      document.getElementById("dot3").classList.add("done");
      btn.classList.remove("loading");
      showToast("Account created! Welcome to TimelyX 🎉", "success");
      setTimeout(() => {
        window.location.href = "profile.html";
      }, 1500);
    }, 600);
  } catch (error) {
    btn.classList.remove("loading");
    
    // Handle specific Firebase errors
    let errorMsg = "Signup failed. Please try again.";
    switch (error.code) {
      case "auth/email-already-in-use":
        errorMsg = "This email is already registered. Please login instead.";
        break;
      case "auth/invalid-email":
        errorMsg = "Invalid email address.";
        break;
      case "auth/weak-password":
        errorMsg = "Password is too weak. Use at least 8 characters with letters and numbers.";
        break;
      case "auth/operation-not-allowed":
        errorMsg = "Email/password signup is not enabled. Contact support.";
        break;
    }
    showToast(errorMsg, "error");
    
    // Reset step dots on error
    document.getElementById("dot1").classList.replace("done", "s1");
    document.getElementById("dot2").classList.remove("active", "done");
    document.getElementById("dot3").classList.remove("active", "done");
  }
}

/* ── Check if already logged in ── */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (user) {
    // Already logged in, redirect to profile
    window.location.href = "profile.html";
  }
});

/* Enter key */
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSignup();
});

// Make handleSignup and checkStrength available globally
window.handleSignup = handleSignup;
window.checkStrength = checkStrength;