const API_BASE = "http://localhost:8000";

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
    const lockerId = document.getElementById('emergencyLockerId').value;
    const reason = document.getElementById('emergencyReason').value;

    if(!lockerId) return alert("Please enter a Locker ID");

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
    const data = {
        lockerID: parseInt(document.getElementById('modalLockerId').value),
        studentID: document.getElementById('modalStudentId').value,
        parcelPIN: Math.floor(1000 + Math.random() * 9000).toString(),
        hasPenalty: false
    };

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
function sendNotification(studentId) {
    alert(`Notification sent to Student ${studentId}: Your parcel is OVERDUE! Please collect it immediately.`);
}

// --- Data Loading Logic ---

async function loadRequestTable() {
    const tbody = document.getElementById('requestTableBody');
    if (!tbody) return;

    try {
        const response = await fetch(`${API_BASE}/admin/requests`);
        const requests = await response.json();
        
        tbody.innerHTML = requests.map(r => `
            <tr>
                <td>P${r.parcelID || '-'}</td>
                <td>R${r.requestID}</td>
                <td>S${r.studentID}</td>
                <td>${new Date(r.timestamp).toLocaleDateString()}</td>
                <td><span class="status-tag status-pending">${r.requestStatus}</span></td>
                <td>
                    <button onclick="updateStatus(${r.parcelID}, 'Stored')" style="cursor:pointer">Approve</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="6">No pending requests</td></tr>';
    } catch (err) {
        console.error("Failed to load requests:", err);
    }
}

async function loadParcelTable() {
    const tbody = document.getElementById('parcelTableBody');
    if (!tbody) return;

    try {
        const response = await fetch(`${API_BASE}/admin/parcels`);
        const parcels = await response.json();
        
        tbody.innerHTML = parcels.map(p => `
            <tr>
                <td>L${p.lockerID}</td>
                <td>P${p.parcelID}</td>
                <td>PIN: ${p.parcelPIN}</td>
                <td><span class="status-tag status-active">Active</span></td>
                <td>${p.hasPenalty ? 'Penalty' : 'None'}</td>
            </tr>
        `).join('') || '<tr><td colspan="5">No parcels found</td></tr>';
    } catch (err) {
        console.error("Failed to load parcels:", err);
    }
}

async function loadMonitorTable() {
    const tbody = document.getElementById('monitorTableBody');
    if (!tbody) return;

    try {
        const response = await fetch(`${API_BASE}/admin/parcels`);
        const parcels = await response.json();
        
        tbody.innerHTML = parcels.map(p => {
            const entryDate = new Date(p.storageTime);
            const now = new Date();
            const diffTime = Math.abs(now - entryDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            return `
                <tr>
                    <td>L${p.lockerID}</td>
                    <td>P${p.parcelID}</td>
                    <td>-</td>
                    <td>${entryDate.toLocaleDateString()}</td>
                    <td>${entryDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                    <td>${diffDays}</td>
                    <td><span class="status-tag status-active">Active</span></td>
                    <td>${p.hasPenalty ? 'Penalty Applied' : '-'}</td>
                    <td>
                        <button onclick="sendNotification('0000')">Notify</button>
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="9">No storage data</td></tr>';
    } catch (err) {
        console.error("Failed to load monitor data:", err);
    }
}

async function updateStatus(parcelId, newStatus) {
    if(!parcelId) return alert("No Parcel ID associated with this request.");
    try {
        const response = await fetch(`${API_BASE}/admin/parcels/${parcelId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (response.ok) {
            alert(`Status updated to ${newStatus}`);
            location.reload();
        }
    } catch (err) {
        console.error(err);
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
    displayAdminProfile();
    loadRequestTable();
    loadParcelTable();
    loadMonitorTable();
}

window.onload = loadAdminData;
