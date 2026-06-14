// Base URL for the FastAPI backend
const API_BASE = (window.location.protocol === 'file:') ? "http://127.0.0.1:8000" : window.location.origin;

// ─── Server Status Banner ────────────────────────────────────────────────────
function injectStatusBanner() {
    const banner = document.createElement('div');
    banner.id = 'server-status-banner';
    banner.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 9999;
        padding: 10px 20px;
        font-size: 0.78rem;
        font-weight: bold;
        text-align: center;
        letter-spacing: 1px;
        text-transform: uppercase;
        transition: background 0.4s, opacity 0.4s;
        opacity: 0;
    `;
    document.body.prepend(banner);
    return banner;
}

async function checkServerStatus() {
    const banner = document.getElementById('server-status-banner') || injectStatusBanner();
    try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            banner.style.background = '#1a6b3a';
            banner.style.color = '#d4f7e2';
            banner.textContent = '✅ Server connected — http://127.0.0.1:8000';
            banner.style.opacity = '1';
            // Fade out after 3 seconds when ok
            setTimeout(() => { banner.style.opacity = '0'; }, 3000);
            return true;
        }
    } catch {
        // server offline
    }
    banner.style.background = '#7a1c1c';
    banner.style.color = '#ffd6d6';
    banner.textContent = '⚠️ Server offline — run start_server.bat then refresh this page';
    banner.style.opacity = '1';
    return false;
}

// Inject banner element on every page load
injectStatusBanner();
checkServerStatus();
// Re-check every 10 seconds
setInterval(checkServerStatus, 10000);


// ─── Helpers ─────────────────────────────────────────────────────────────────
function setMessage(el, text, color = 'red') {
    if (!el) return;
    el.innerText = text;
    el.style.color = color;
}

async function fetchWithRetry(url, options, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
            return res;
        } catch (err) {
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function networkErrorMessage() {
    return "Cannot reach server. Make sure the backend is running (double-click start_server.bat) then try again.";
}


// ─── Handle PIN Box focus shifting (retrieve.html) ────────────────────────────
const pinBoxes = document.querySelectorAll('.pin-box');
if (pinBoxes.length > 0) {
    pinBoxes.forEach((box, index) => {
        box.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && index < pinBoxes.length - 1) {
                pinBoxes[index + 1].focus();
            }
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                pinBoxes[index - 1].focus();
            }
        });
    });
}


// ─── Request Locker Form ─────────────────────────────────────────────────────
const requestForm = document.getElementById('requestForm');
if (requestForm) {
    const cachedStudentID = localStorage.getItem('studentID');
    if (cachedStudentID) {
        const studentInput = document.getElementById('studentID');
        if (studentInput) {
            studentInput.value = cachedStudentID;
        }
    }

    requestForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const studentId = document.getElementById('studentID').value.trim();
        const parcelId  = document.getElementById('parcelID').value.trim();
        const reqDate   = document.getElementById('date').value;
        const msgEl     = document.getElementById('request-message');
        const submitBtn = requestForm.querySelector('button[type="submit"]');

        if (!studentId || !parcelId || !reqDate) {
            setMessage(msgEl, 'Please fill in all fields.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
        setMessage(msgEl, '', 'white');

        try {
            const response = await fetchWithRetry(`${API_BASE}/requests/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentID: studentId,
                    parcelID: parseInt(parcelId) || null,
                    reqDate: reqDate
                })
            });

            const data = await response.json();

            if (response.ok) {
                document.getElementById('request-box').style.display = 'none';
                document.getElementById('success-box').style.display = 'block';
                document.getElementById('success-box').innerHTML = `
                    <h2>REQUEST SUBMITTED</h2>
                    <p style="margin-bottom: 20px;">Your request for Parcel <strong>${parcelId}</strong> on <strong>${reqDate}</strong> has been submitted to staff.</p>
                    <p style="font-size: 0.9rem; color: #aaa;">Please wait for approval. Further updates will be sent via email.</p>
                    <a href="index.html" class="btn" style="margin-top: 20px;">DONE</a>
                `;
            } else {
                setMessage(msgEl, data.detail || 'Error submitting request. Please try again.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'REQUEST';
            }
        } catch (error) {
            console.error('Request error:', error);
            setMessage(msgEl, networkErrorMessage());
            submitBtn.disabled = false;
            submitBtn.textContent = 'REQUEST';
            // Force a banner re-check so the user sees the server status
            checkServerStatus();
        }
    });
}


// ─── Retrieve Locker PIN Form ─────────────────────────────────────────────────
const retrieveForm = document.getElementById('retrieveForm');
if (retrieveForm) {
    const msgEl       = document.getElementById('retrieve-message');
    const emergencyBtn = document.getElementById('emergency-btn');
    const submitBtn   = retrieveForm.querySelector('button[type="submit"]');
    const boxes       = document.querySelectorAll('.pin-box');
    let failedAttempts = parseInt(sessionStorage.getItem('pinAttempts') || '0');
    let countdownInterval = null;

    function disableForm() {
        boxes.forEach(box => box.disabled = true);
        submitBtn.disabled = true;
    }

    function enableForm() {
        boxes.forEach(box => box.disabled = false);
        submitBtn.disabled = false;
        setMessage(msgEl, '', 'white');
    }

    function checkLockout() {
        const lockoutExpiry = parseInt(sessionStorage.getItem('lockoutExpiry') || '0');
        const now = Date.now();

        if (lockoutExpiry > now) {
            disableForm();
            startCountdown(lockoutExpiry);
            return true;
        }

        if (failedAttempts >= 4) {
            setMessage(msgEl, 'Please use the emergency form.', 'red');
            if (emergencyBtn) emergencyBtn.style.display = 'block';
            disableForm();
            retrieveForm.style.display = 'none';
            return true;
        }

        enableForm();
        return false;
    }

    function startCountdown(expiryTime) {
        if (countdownInterval) clearInterval(countdownInterval);
        
        function updateTimer() {
            const timeLeft = Math.max(0, Math.round((expiryTime - Date.now()) / 1000));
            if (timeLeft > 0) {
                setMessage(msgEl, `Too many failed attempts. Please retry after ${timeLeft} seconds.`, 'red');
            } else {
                clearInterval(countdownInterval);
                sessionStorage.removeItem('lockoutExpiry');
                enableForm();
            }
        }
        
        updateTimer();
        countdownInterval = setInterval(updateTimer, 1000);
    }

    // Run initial lockout check
    checkLockout();

    retrieveForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        let pin = '';
        boxes.forEach(box => pin += box.value);

        if (pin.length !== 4) {
            setMessage(msgEl, 'Please enter a 4-digit PIN.', 'red');
            return;
        }

        submitBtn.disabled = true;
        setMessage(msgEl, 'Verifying…', 'white');

        try {
            const response = await fetchWithRetry(`${API_BASE}/verify/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ generated_pin: pin })
            });

            const data = await response.json();

            if (response.ok) {
                failedAttempts = 0;
                sessionStorage.setItem('pinAttempts', '0');
                sessionStorage.removeItem('lockoutExpiry');
                if (emergencyBtn) emergencyBtn.style.display = 'none';
                
                const retrieveBox = document.getElementById('retrieve-box');
                const successBox = document.getElementById('success-box');
                if (retrieveBox && successBox) {
                    retrieveBox.style.display = 'none';
                    successBox.style.display = 'block';
                }
            } else {
                failedAttempts++;
                sessionStorage.setItem('pinAttempts', failedAttempts);
                
                if (failedAttempts === 3) {
                    const expiry = Date.now() + 60000;
                    sessionStorage.setItem('lockoutExpiry', expiry.toString());
                    disableForm();
                    startCountdown(expiry);
                } else if (failedAttempts >= 4) {
                    setMessage(msgEl, 'Please use the emergency form.', 'red');
                    if (emergencyBtn) emergencyBtn.style.display = 'block';
                    disableForm();
                    retrieveForm.style.display = 'none';
                } else {
                    setMessage(msgEl, data.detail || 'Invalid or Expired PIN. Try again.', 'red');
                    submitBtn.disabled = false;
                }
            }
        } catch (error) {
            console.error('Verify error:', error);
            setMessage(msgEl, networkErrorMessage(), 'red');
            submitBtn.disabled = false;
            checkServerStatus();
        }
    });
}


// ─── Registration Form ────────────────────────────────────────────────────────
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name     = document.getElementById('regName').value.trim();
        const studentID = document.getElementById('regStudentID').value.trim();
        const email    = document.getElementById('regEmail').value.trim();
        const phone    = document.getElementById('regPhone').value.trim();
        const password = document.getElementById('regPassword').value;
        const confirm  = document.getElementById('regConfirmPassword').value;
        const msg      = document.getElementById('regMessage');
        const submitBtn = registerForm.querySelector('button[type="submit"]');

        if (password !== confirm) {
            setMessage(msg, 'Passwords do not match.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Registering…';

        try {
            const response = await fetchWithRetry(`${API_BASE}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, studentID, email, phoneNo: phone, password })
            });
            const data = await response.json();
            if (response.ok) {
                alert('Registration successful! Redirecting to login…');
                window.location.href = 'login.html';
            } else {
                setMessage(msg, data.detail || 'Registration failed. Please try again.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'REGISTER';
            }
        } catch (err) {
            console.error('Register error:', err);
            setMessage(msg, networkErrorMessage());
            submitBtn.disabled = false;
            submitBtn.textContent = 'REGISTER';
            checkServerStatus();
        }
    });
}


// ─── Login Form ───────────────────────────────────────────────────────────────
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email    = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const msg      = document.getElementById('loginMessage');
        const submitBtn = loginForm.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging in…';

        try {
            const response = await fetchWithRetry(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            if (response.ok) {
                localStorage.setItem('userName', data.name);
                localStorage.setItem('studentID', data.studentID || '');
                window.location.href = 'request.html';
            } else {
                setMessage(msg, data.detail || 'Invalid email or password.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'LOGIN';
            }
        } catch (err) {
            console.error('Login error:', err);
            setMessage(msg, networkErrorMessage());
            submitBtn.disabled = false;
            submitBtn.textContent = 'LOGIN';
            checkServerStatus();
        }
    });
}
