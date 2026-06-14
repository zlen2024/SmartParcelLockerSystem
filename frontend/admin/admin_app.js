const API_BASE = (window.location.protocol === 'file:') ? "http://127.0.0.1:8000" : window.location.origin;

// --- Navigation & UI ---
function showAddModal() {
    document.getElementById('addModal').style.display = 'flex';
}

function hideAddModal() {
    document.getElementById('addModal').style.display = 'none';
}

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

// Save Manual Parcel (Fig 25)
async function saveParcel() {
    console.log("[admin_app.js] saveParcel() triggered.");
    const data = {
        lockerID: parseInt(document.getElementById('modalLockerId').value),
        studentID: document.getElementById('modalStudentId').value,
        parcelPIN: Math.floor(1000 + Math.random() * 9000).toString(),
        hasPenalty: false
    };
    console.log("[admin_app.js] Sending Parcel data:", data);

    try {
        const response = await fetch(`${API_BASE}/parcels/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            alert("Parcel Added Successfully");
            hideAddModal();
            location.reload();
        } else {
            alert("Error adding parcel.");
        }
    } catch (err) {
        console.error(err);
    }
}

// Send Notification (Fig 26)
function sendNotification(contactNumber) {
    console.log(`[admin_app.js] sendNotification() triggered for contact: ${contactNumber}`);
    alert(`Notification sent to ${contactNumber}: Your parcel is OVERDUE! Please collect it immediately.`);
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
            let actionButtons = "";

            if (status === 'Available' || status === 'Pending') {
                actionButtons = `
                    <button onclick="approveRequest('${r.requestID}', 'Stored')" style="cursor:pointer; background:#4CAF50; color:white; border:none; padding:5px 10px; border-radius:3px; margin-right:5px;">Approve</button>
                    <button onclick="approveRequest('${r.requestID}', 'Rejected')" style="cursor:pointer; background:#f44336; color:white; border:none; padding:5px 10px; border-radius:3px;">Reject</button>
                `;
            } else {
                actionButtons = `<span style="color:#888;">—</span>`;
            }

            const displayStatus = (status === 'Pending') ? 'Available' : status;
            const statusColor = displayStatus === 'Available' ? '#FFC107' : displayStatus === 'Stored' ? '#4CAF50' : '#f44336';
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
        }).join('') || '<tr><td colspan="6">No pending requests</td></tr>';

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

            // Real status determined by request status and expiry
            const isActive = p.status === 'Stored' || p.status === 'Available' || p.status === 'Pending';
            let statusLabel = p.status;
            if (isActive) {
                statusLabel = isOverdue ? 'Overdue' : 'Stored';
            }

            const dateDisplay = entryDate ? entryDate.toLocaleDateString() : '-';

            // Actions: Only display actions if active
            let actionButtons = '';
            if (isActive) {
                actionButtons = `
                    <button onclick="sendNotification('${p.phoneNo && p.phoneNo !== "Unknown" ? p.phoneNo : p.studentID}')" style="cursor:pointer; background:#2196F3; color:white; border:none; padding:5px 10px; border-radius:3px; margin-right:5px;">Notify</button>
                    <button onclick="updateParcelStatus('${p.parcelID}', 'Collected')" style="cursor:pointer; background:#4CAF50; color:white; border:none; padding:5px 10px; border-radius:3px; margin-right:5px;">Collect</button>
                    <button onclick="updateParcelStatus('${p.parcelID}', 'Removed')" style="cursor:pointer; background:#f44336; color:white; border:none; padding:5px 10px; border-radius:3px;">Remove</button>
                `;
            } else {
                actionButtons = `<span style="color:#888;">—</span>`;
            }

            return `
                <tr>
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
        }).join('') || '<tr><td colspan="7" style="padding: 10px; text-align: center;">No parcels found</td></tr>';
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
        const activeParcels = parcels.filter(p => p.status === 'Stored' || p.status === 'Available' || p.status === 'Pending');

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
            alert(`Request ${newStatus === 'Stored' ? 'Approved' : 'Rejected'} successfully!`);
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
            const l = lockers.find(locker => locker.lockerID === id) || { lockerStatus: "Vacant" };
            let status = l.lockerStatus === "Available" ? "Vacant" : l.lockerStatus;

            let icon = "🟢";
            let pInfo = "";
            let lockerClass = "available";

            if (status === "Occupied" || status === "Stored") {
                status = "Stored";
                icon = "📦";
                lockerClass = "occupied";

                const p = parcels.find(parcel => parcel.lockerID === id && parcel.parcelID === l.parcelID);
                if (p && p.storageTime) {
                    const entryDate = new Date(p.storageTime);
                    const diffHours = Math.floor(Math.abs(new Date() - entryDate) / (1000 * 60 * 60));
                    if (diffHours >= 72) {
                        status = "Overdue";
                        icon = "⚠️";
                        lockerClass = "alarm";
                    }
                }
                pInfo = l.parcelID ? `<p style="margin-top: 5px; color: #fff;">Parcel ID: P${l.parcelID}</p>` : '';
            } else if (status === "Alarm") {
                icon = "🚨";
                lockerClass = "alarm";
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
