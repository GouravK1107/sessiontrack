import { auth } from "../firebase.js";
import { 
    signInWithEmailAndPassword,
    sendPasswordResetEmail 
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

/* ── Heatmap ── */
(function () {
  const g = document.getElementById("hmGrid");
  if (!g) return;
  const data = [
    [0, 1, 2, 3, 2, 1, 0],
    [1, 3, 4, 2, 1, 3, 2],
    [2, 1, 0, 3, 4, 2, 1],
    [3, 4, 2, 1, 2, 4, 3],
    [1, 2, 3, 4, 1, 0, 2],
    [0, 1, 2, 3, 2, 4, 1],
    [2, 3, 1, 4, 3, 2, 0],
  ];
  const cls = ["", "l1", "l2", "l3", "l4"];
  data.forEach((col) => {
    const c = document.createElement("div");
    c.className = "hm-col";
    col.forEach((v) => {
      const cell = document.createElement("div");
      cell.className = "hm-cell" + (v ? " " + cls[v] : "");
      c.appendChild(cell);
    });
    g.appendChild(c);
  });
})();

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

/* ── Toast ── */
function showToast(msg, type) {
  const t = document.getElementById("toast");
  t.innerHTML = `<i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}"></i> ${msg}`;
  t.className = `toast show ${type}`;
  setTimeout(() => {
    t.className = "toast";
  }, 3400);
}

/* ── Clear errors on typing ── */
document.getElementById("email").addEventListener("input", function () {
  this.classList.remove("error-field");
  document.getElementById("emailErr").classList.remove("show");
});
document.getElementById("password").addEventListener("input", function () {
  this.classList.remove("error-field");
  document.getElementById("pwdErr").classList.remove("show");
});

/* ── Forgot Password Modal ── */
function showResetModal() {
    let modal = document.getElementById("resetModal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "resetModal";
        modal.className = "modal";
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Reset Password</h3>
                <p style="color:#666; margin-bottom:15px">Enter your email address and we'll send you a link to reset your password.</p>
                <input type="email" id="resetEmail" placeholder="Enter your email" autocomplete="email">
                <div class="modal-buttons">
                    <button onclick="sendResetEmail()" id="resetBtn">Send Reset Link</button>
                    <button onclick="closeResetModal()">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeResetModal();
        });
    }
    modal.style.display = "flex";
}

function closeResetModal() {
    const modal = document.getElementById("resetModal");
    if (modal) modal.style.display = "none";
    const resetEmail = document.getElementById("resetEmail");
    if (resetEmail) resetEmail.value = "";
}

async function sendResetEmail() {
    const email = document.getElementById("resetEmail").value;
    const btn = document.getElementById("resetBtn");
    
    if (!email) {
        showToast("Please enter your email address", "error");
        return;
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast("Please enter a valid email address", "error");
        return;
    }
    
    btn.textContent = "Sending...";
    btn.disabled = true;
    
    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Password reset email sent! Check your Spam section in email 📧", "success");
        closeResetModal();
    } catch (error) {
        let errorMsg = "Failed to send reset email.";
        switch (error.code) {
            case "auth/user-not-found":
                errorMsg = "No account found with this email address.";
                break;
            case "auth/invalid-email":
                errorMsg = "Invalid email address.";
                break;
            case "auth/too-many-requests":
                errorMsg = "Too many requests. Try again later.";
                break;
        }
        showToast(errorMsg, "error");
    } finally {
        btn.textContent = "Send Reset Link";
        btn.disabled = false;
    }
}

function forgotPassword() {
    showResetModal();
}

/* ── Login handler with Firebase ── */
async function handleLogin() {
  const email = document.getElementById("email");
  const pwd = document.getElementById("password");
  const btn = document.getElementById("loginBtn");
  const rememberCheckbox = document.getElementById("remember");
  let valid = true;

  // Reset errors
  email.classList.remove("error-field");
  pwd.classList.remove("error-field");
  document.getElementById("emailErr").classList.remove("show");
  document.getElementById("pwdErr").classList.remove("show");

  // Validation
  if (!email.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    email.classList.add("error-field");
    document.getElementById("emailErr").classList.add("show");
    valid = false;
  }
  if (!pwd.value.trim()) {
    pwd.classList.add("error-field");
    document.getElementById("pwdErr").classList.add("show");
    valid = false;
  }
  if (!valid) return;

  // Show loading state
  btn.classList.add("loading");

  try {
    // Firebase login
    const userCredential = await signInWithEmailAndPassword(auth, email.value, pwd.value);
    const user = userCredential.user;
    
    // Handle "Remember me" - set session persistence
    if (rememberCheckbox && rememberCheckbox.checked) {
      // Keep user logged in (default is already persistent)
      // You can also set localStorage flag if needed
      localStorage.setItem("rememberMe", "true");
    } else {
      // Session only - clear when browser closes
      localStorage.setItem("rememberMe", "false");
    }
    
    showToast("Logged in successfully! Redirecting…", "success");
    
    setTimeout(() => {
      window.location.href = "profile.html";
    }, 1400);
  } catch (error) {
    btn.classList.remove("loading");
    
    // Handle specific Firebase errors
    let errorMsg = "Login failed. Please try again.";
    switch (error.code) {
      case "auth/user-not-found":
        errorMsg = "No account found with this email.";
        break;
      case "auth/wrong-password":
        errorMsg = "Incorrect password.";
        break;
      case "auth/invalid-email":
        errorMsg = "Invalid email address.";
        break;
      case "auth/too-many-requests":
        errorMsg = "Too many failed attempts. Try again later.";
        break;
      case "auth/user-disabled":
        errorMsg = "This account has been disabled.";
        break;
    }
    showToast(errorMsg, "error");
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
  if (e.key === "Enter") handleLogin();
});

// Make functions available globally
window.handleLogin = handleLogin;
window.forgotPassword = forgotPassword;
window.sendResetEmail = sendResetEmail;
window.closeResetModal = closeResetModal;