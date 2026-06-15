const API_BASE = (window.location.protocol === 'file:') ? "http://127.0.0.1:8000" : window.location.origin;



// --- API Calls ---

// Emergency Open (Fig 27)
async function emergencyOpen() {
    console.log("[admin_app.js] emergencyOpen() triggered.");
    const lockerId = document.getElementById('emergencyLockerId').value;
    const reason = document.getElementById('emergencyReason').value;

    if (!lockerId) {
        console.warn("[admin_app.js] emergencyOpen() aborted: No Locker ID provided.");
        return alert("Please enter a Locker ID");
    }

    try {
        const response = await fetch(`${API_BASE}/admin/override/${lockerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        });

        if (response.ok) {
            alert(`EMERGENCY OVERRIDE: Locker ${lockerId} is now OPEN.`);
        } else {
            alert("Error: Could not trigger override.");
        }
    } catch (err) {
        console.error(err);
        alert("Server connection failed.");
    }
}



async function unlockLocker(lockerId) {
    if (!confirm(`Are you sure you want to trigger emergency override to UNLOCK Locker L${lockerId}?`)) return;
    try {
        const response = await fetch(`${API_BASE}/admin/override/${lockerId}`, {
            method: 'POST'
        });
        if (response.ok) {
            alert(`EMERGENCY OVERRIDE: Locker L${lockerId} unlocked.`);
            location.reload();
        } else {
            alert("Error: Could not trigger override.");
        }
    } catch (err) {
        console.error(err);
        alert("Server connection failed.");
    }
}

// Send Notification (Fig 26)
function sendNotification(contactNumber) {
    console.log(`[admin_app.js] sendNotification() triggered for contact: ${contactNumber}`);
    alert(`Notification sent to ${contactNumber}: Your parcel is OVERDUE! Please collect it immediately.`);
}

async function notifyAndRemove(requestId, contactNumber) {
    sendNotification(contactNumber);
    await updateRequestStatus(requestId, 'Removed');
}

async function updateRequestStatus(requestID, newStatus) {
    console.log(`[admin_app.js] updateRequestStatus() for requestID: ${requestID}, newStatus: ${newStatus}`);
    try {
        const response = await fetch(`${API_BASE}/admin/requests/${requestID}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (response.ok) {
            alert(`Request updated to ${newStatus}. Locker is now free.`);
            location.reload();
        } else {
            const errData = await response.json();
            alert(errData.detail || "Error updating status.");
        }
    } catch (err) {
        console.error(err);
        alert("Network error. Please try again.");
    }
}

async function updateParcelStatus(parcelID, newStatus) {
    console.log(`[admin_app.js] updateParcelStatus() for parcelID: ${parcelID}, newStatus: ${newStatus}`);
    try {
        const response = await fetch(`${API_BASE}/admin/parcels/${parcelID}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (response.ok) {
            alert(`Parcel ${parcelID} status updated to ${newStatus}.`);
            location.reload();
        } else {
            const errData = await response.json();
            alert(errData.detail || "Error updating parcel status.");
        }
    } catch (err) {
        console.error(err);
        alert("Network error. Please try again.");
    }
}

// --- Data Loading Logic ---

async function loadRequestTable() {
    console.log("[admin_app.js] loadRequestTable() triggered.");
    const tbody = document.getElementById('requestTableBody');
    if (!tbody) {
        console.log("[admin_app.js] requestTableBody not found. Skipping.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/requests`);
        const requests = await response.json();

        tbody.innerHTML = requests.map(r => {
            const status = r.requestStatus;
            
            // Map statuses to Pending, Approved, or Rejected without filtering any requests
            const displayStatus = (status === 'Pending' || status === 'Available') ? 'Pending' : 
                                  (status === 'Approved' || status === 'Stored' || status === 'Collected' || status === 'Removed') ? 'Approved' : 'Rejected';
            
            let actionButtons = "";

            if (displayStatus === 'Pending') {
                actionButtons = `
                    <button onclick="approveRequest('${r.requestID}', 'Approved')" style="cursor:pointer; background:#4CAF50; color:white; border:none; padding:5px 10px; border-radius:3px; margin-right:5px;">Approve</button>
                    <button onclick="approveRequest('${r.requestID}', 'Rejected')" style="cursor:pointer; background:#f44336; color:white; border:none; padding:5px 10px; border-radius:3px;">Reject</button>
                `;
            } else {
                actionButtons = `<span style="color:#888;">—</span>`;
            }

            const statusColor = displayStatus === 'Pending' ? '#FFC107' : displayStatus === 'Approved' ? '#4CAF50' : '#f44336';
            const parcelRef = r.requestedParcelRef || (r.parcelID ? `P${r.parcelID}` : '-');

            return `
                <tr>
                    <td>R${r.requestID}</td>
                    <td>S${r.studentID}</td>
                    <td>${parcelRef}</td>
                    <td>${new Date(r.timestamp).toLocaleDateString()}</td>
                    <td><strong>${r.pin || '-'}</strong></td>
                    <td><span style="padding: 4px 8px; border-radius: 4px; color: white; background: ${statusColor}">${displayStatus}</span></td>
                    <td>${actionButtons}</td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="7">No requests found</td></tr>';

    } catch (err) {
        console.error("Failed to load requests:", err);
    }
}

async function loadParcelTable() {
    console.log("[admin_app.js] loadParcelTable() triggered.");
    const tbody = document.getElementById('parcelTableBody');
    if (!tbody) {
        console.log("[admin_app.js] parcelTableBody not found. Skipping.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/parcels`);
        const parcels = await response.json();

        tbody.innerHTML = parcels.map(p => {
            const entryDate = p.storageTime ? new Date(p.storageTime) : null;
            const now = new Date();
            const diffHours = entryDate ? Math.floor(Math.abs(now - entryDate) / (1000 * 60 * 60)) : 0;
            const isOverdue = diffHours >= 72;

            const isDbActive = p.status === 'Approved' || p.status === 'Stored' || p.status === 'Available' || p.status === 'Pending';
            
            let state = 'Active';
            if (p.status === 'Emergency Requested') {
                state = 'Emergency';
            } else if (p.status === 'Collected') {
                state = 'Collected';
            } else if (p.status === 'Removed' || p.status === 'Clear' || p.status === 'Rejected') {
                state = 'Removed';
            } else if (isDbActive) {
                if (isOverdue) {
                    state = 'Overdue';
                } else {
                    state = 'Active';
                }
            } else {
                state = 'Removed';
            }

            let statusLabel = '';
            let actionButtons = '';
            let rowClass = '';

            const contact = p.phoneNo && p.phoneNo !== "Unknown" ? p.phoneNo : p.studentID;

            if (state === 'Overdue') {
                statusLabel = '<span style="color: #ff4d4d; font-weight: bold;">Overdue</span>';
                actionButtons = `
                    <button onclick="notifyAndRemove('${p.requestID}', '${contact}')" style="cursor:pointer; background:#ff4d4d; color:white; border:none; padding:5px 10px; border-radius:3px;">Notify and Remove</button>
                `;
            } else if (state === 'Emergency') {
                statusLabel = '<span style="color: #ff9f43; font-weight: bold;">Emergency Requested</span>';
                actionButtons = `
                    <button onclick="unlockLocker('${p.lockerID}')" style="cursor:pointer; background:#ff9f43; color:white; border:none; padding:5px 10px; border-radius:3px;">Unlock Locker</button>
                `;
            } else if (state === 'Collected') {
                statusLabel = '<span style="color: #888;">Collected</span>';
                actionButtons = `<span style="color:#888;">—</span>`;
                rowClass = 'class="grayed-out-row"';
            } else if (state === 'Removed') {
                statusLabel = '<span style="color: #888;">Removed</span>';
                actionButtons = `<span style="color:#888;">—</span>`;
                rowClass = 'class="grayed-out-row"';
            } else {
                statusLabel = '<span style="color: #2ecc71; font-weight: bold;">Stored</span>';
                actionButtons = `<span style="color:#888;">—</span>`;
            }

            const dateDisplay = entryDate ? entryDate.toLocaleDateString() : '-';

            return `
                <tr ${rowClass}>
                    <td style="padding: 10px; border-bottom: 1px solid #444;">${p.requestID || '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #444;">S${p.studentID}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #444;">P${p.parcelID}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #444;">L${p.lockerID}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #444;"><strong>${p.parcelPIN || '-'}</strong></td>
                    <td style="padding: 10px; border-bottom: 1px solid #444;">${dateDisplay}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #444;">${statusLabel}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #444;">
                        ${actionButtons}
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="8" style="padding: 10px; text-align: center;">No parcels found</td></tr>';
    } catch (err) {
        console.error("Failed to load parcels:", err);
    }
}

async function loadMonitorTable() {
    console.log("[admin_app.js] loadMonitorTable() triggered.");
    const tbody = document.getElementById('monitorTableBody');
    if (!tbody) {
        console.log("[admin_app.js] monitorTableBody not found. Skipping.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/parcels`);
        const parcels = await response.json();

        // Filter to only display active parcels inside the lockers
        const activeParcels = parcels.filter(p => p.status === 'Approved' || p.status === 'Stored' || p.status === 'Available' || p.status === 'Pending');

        tbody.innerHTML = activeParcels.map(p => {
            const entryDate = new Date(p.storageTime);
            const now = new Date();
            const diffTime = Math.abs(now - entryDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const isOverdue = (diffTime / (1000 * 60 * 60)) >= 72;
            const statusLabel = isOverdue ? 'Overdue' : 'Active';
            const statusClass = isOverdue ? 'status-overdue' : 'status-active';

            return `
                <tr>
                    <td>L${p.lockerID}</td>
                    <td>P${p.parcelID}</td>
                    <td>S${p.studentID}</td>
                    <td>${entryDate.toLocaleDateString()}</td>
                    <td>${entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>${diffDays}</td>
                    <td><span class="status-tag ${statusClass}">${statusLabel}</span></td>
                    <td>${p.hasPenalty ? 'Penalty Applied' : '-'}</td>
                    <td>
                        <button onclick="sendNotification('${p.phoneNo && p.phoneNo !== "Unknown" ? p.phoneNo : p.studentID}')" style="cursor:pointer; background:#2196F3; color:white; border:none; padding:5px 10px; border-radius:3px;">Notify</button>
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="9">No active storage data</td></tr>';
    } catch (err) {
        console.error("Failed to load monitor data:", err);
    }
}

async function approveRequest(requestId, newStatus) {
    const rid = parseInt(requestId, 10);
    console.log(`[admin_app.js] approveRequest() for requestId: ${rid}, newStatus: ${newStatus}`);
    if (!rid || isNaN(rid)) {
        return alert("No valid Request ID.");
    }
    try {
        const response = await fetch(`${API_BASE}/admin/requests/${rid}/approve`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (response.ok) {
            const data = await response.json();
            if (newStatus === 'Approved' && data.parcelPIN) {
                alert(`Request Approved successfully!\nAssigned Locker: L${data.lockerID}\nGenerated PIN: ${data.parcelPIN}`);
            } else {
                alert(`Request ${newStatus === 'Approved' ? 'Approved' : 'Rejected'} successfully!`);
            }
            location.reload();
        } else {
            const errData = await response.json();
            alert(errData.detail || "Error updating request.");
        }
    } catch (err) {
        console.error(err);
        alert("Network error. Please try again.");
    }
}

// --- Admin Profile Display ---
function displayAdminProfile() {
    const adminName = localStorage.getItem('adminName');
    if (!adminName) {
        // Not logged in — redirect to staff login
        window.location.href = "staff_login.html";
        return;
    }

    // Update all profile links in the header
    const profileLinks = document.querySelectorAll('.admin-links');
    profileLinks.forEach(container => {
        container.innerHTML = `
            <span style="color: #4CAF50; font-weight: bold;">👤 ${adminName}</span>
            <a href="#" onclick="adminLogout()">LOGOUT</a>
        `;
    });
}

function adminLogout() {
    localStorage.removeItem('adminName');
    localStorage.removeItem('adminID');
    window.location.href = "staff_login.html";
}

// Initial Data Load
async function loadAdminData() {
    console.log("[admin_app.js] loadAdminData() started.");
    loadSidebar();
    displayAdminProfile();
    loadRequestTable();
    loadParcelTable();
    loadMonitorTable();
    if (document.getElementById('lockerGrid')) {
        loadLockerDashboard();
    }
}

async function loadLockerDashboard() {
    console.log("[admin_app.js] loadLockerDashboard() triggered.");
    const grid = document.getElementById('lockerGrid');
    if (!grid) {
        console.log("[admin_app.js] lockerGrid not found. Skipping.");
        return;
    }

    try {
        const [lockersRes, parcelsRes] = await Promise.all([
            fetch(`${API_BASE}/admin/lockers`),
            fetch(`${API_BASE}/admin/parcels`)
        ]);
        const lockers = await lockersRes.json();
        const parcels = await parcelsRes.json();

        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(3, 1fr)";
        grid.style.gap = "20px";

        const fixedLockers = [1, 2, 3];
        grid.innerHTML = fixedLockers.map(id => {
            const l = lockers.find(locker => locker.lockerID === id) || { lockerStatus: "Available" };
            
            // Source of truth: find any parcel with Approved or Emergency Requested status in this locker
            // This is based on the request status (from /admin/parcels API) which is always correct
            const activeParcelsInLocker = parcels.filter(p => p.lockerID === id && 
                (p.status === 'Approved' || p.status === 'Emergency Requested')
            );
            // Pick the most recent one (highest parcelID)
            activeParcelsInLocker.sort((a, b) => b.parcelID - a.parcelID);
            const activeParcel = activeParcelsInLocker[0] || null;

            let status = "Vacant";
            let icon = "🟢";
            let pInfo = "";
            let lockerClass = "available";

            if (l.lockerStatus === "Alarm") {
                status = "Alarm";
                icon = "🚨";
                lockerClass = "alarm";
            } else if (activeParcel) {
                const entryDate = activeParcel.storageTime ? new Date(activeParcel.storageTime) : null;
                const now = new Date();
                const diffHours = entryDate ? Math.floor(Math.abs(now - entryDate) / (1000 * 60 * 60)) : 0;
                const isOverdue = diffHours >= 72;

                if (activeParcel.status === 'Emergency Requested') {
                    status = "Emergency";
                    icon = "🚨";
                    lockerClass = "alarm";
                } else if (isOverdue) {
                    status = "Overdue";
                    icon = "⚠️";
                    lockerClass = "alarm";
                } else {
                    status = "Stored";
                    icon = "📦";
                    lockerClass = "occupied";
                }
                pInfo = `<p style="margin-top: 5px; color: #fff;">Parcel ID: P${activeParcel.parcelID}</p>`;
            }

            return `
                <div class="locker-card ${lockerClass}">
                    <div class="locker-icon">${icon}</div>
                    <div class="locker-info">
                        <h3>Locker ${id}</h3>
                        <p style="font-weight: bold; text-transform: uppercase;">${status}</p>
                        ${pInfo}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Failed to load locker dashboard:", err);
    }
}

function loadSidebar() {
    console.log("[admin_app.js] loadSidebar() triggered.");
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) {
        console.log("[admin_app.js] .sidebar not found. Skipping.");
        return;
    }

    const path = window.location.pathname;
    const page = path.split('/').pop() || 'dashboard.html';

    const adminName = localStorage.getItem('adminName');

    const navItems = [
        { href: 'dashboard.html', label: 'DASHBOARD' },
        { href: 'request_mgmt.html', label: 'MANAGE REQUEST' },
        { href: 'parcel_mgmt.html', label: 'MANAGE PARCEL' }
    ];

    // Master Role feature
    if (adminName === 'Administrator') {
        navItems.push({ href: 'statistics.html', label: 'STATISTICS & RECORDS' });
    }

    const menuHtml = navItems.map(item => {
        const isActive = page === item.href ? 'class="active"' : '';
        return `<li ${isActive}><a href="${item.href}">${item.label}</a></li>`;
    }).join('');

    sidebar.innerHTML = `
        <div class="sidebar-header">
            <h2>MENU</h2>
        </div>
        <ul class="sidebar-menu">
            ${menuHtml}
        </ul>
    `;
}

window.onload = loadAdminData;
