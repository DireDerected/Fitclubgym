let allUsers = [];
let allReports = [];
let allStaff = [];
let staffModal;
let editStaffModal;

async function loadData() {
    try {
        const [adminRes, staffListRes, reportsRes] = await Promise.all([
            fetch('../api.php?action=get_admin_data'),
            fetch('../api.php?action=get_staff_list'),
            fetch('../api.php?action=get_all_reports')
        ]);
        
        if (adminRes.status === 403) { window.location.href = '../index.html'; return; }
        
        const adminData = await adminRes.json();
        const staffListData = await staffListRes.json();
        const reportsData = await reportsRes.json();

        if (adminData.status === 'success') {
            const user = adminData.user;
            document.getElementById('userName').textContent = user.name;
            document.getElementById('userInitials').textContent = user.name.split(' ').map(n => n[0]).join('').toUpperCase();
            
            // Stats
            if (adminData.stats) {
                document.getElementById('totalMembers').textContent = adminData.stats.members || 0;
                document.getElementById('totalStaff').textContent = adminData.stats.staff || 0;
                document.getElementById('totalCoaches').textContent = adminData.stats.coaches || 0;
            }
            
            // Monthly Registration Growth DIV
            renderMonthlyGrowthDiv(adminData.monthly_growth);
            
            // Set profile image if exists
            if (user.profile_image) {
                const avatar = document.getElementById('userInitials');
                if (avatar) {
                    avatar.innerHTML = `<img src="../${user.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                }
            }

            renderCoachTable(adminData.trainees_per_coach);
            renderAttendanceTable(adminData.attendance_report);
            
            // Set most booked coach
            if(adminData.trainees_per_coach && adminData.trainees_per_coach.length > 0) {
                document.getElementById('mostBookedCoachName').textContent = adminData.trainees_per_coach[0].name;
            }

            allUsers = adminData.all_users;
            allReports = reportsData.reports || [];
            allStaff = staffListData.staff || [];
            
            renderUsersTable(allUsers);
            renderStaffTable(allStaff);
            renderAllReportsTable(allReports);
            loadNotifications();
        }
    } catch (error) { console.error(error); }
}

function renderMonthlyGrowthDiv(data) {
    const container = document.getElementById('monthlyRegistrationDiv');
    if (!container) return;
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="col-12 text-center py-4 text-muted">No registration data found.</div>';
        return;
    }

    container.innerHTML = data.map(item => {
        const date = new Date(item.month + '-01');
        const monthName = date.toLocaleString('default', { month: 'long', year: 'numeric' });
        return `
            <div class="col-md-3">
                <div class="card p-3 border-0 shadow-sm h-100 text-center" style="background: #F8F9FA; border-left: 4px solid var(--primary-yellow) !important;">
                    <div class="small fw-bold text-muted text-uppercase mb-2">${monthName}</div>
                    <h3 class="fw-bold mb-0">${item.count}</h3>
                    <div class="small text-muted mt-1">New Members</div>
                </div>
            </div>
        `;
    }).join('');
}

async function loadNotifications() {
    try {
        const res = await fetch('../api.php?action=get_notifications');
        const data = await res.json();
        if (data.status === 'success') {
            renderNotifications(data.notifications);
        }
    } catch (e) { console.error(e); }
}

function renderNotifications(notifs) {
    const container = document.getElementById('notifItemsContainer');
    const badge = document.getElementById('notifBadge');
    if (!container || !badge) return;

    const unread = notifs.filter(n => !n.is_read).length;

    if (unread > 0) {
        badge.textContent = unread;
        badge.classList.remove('d-none');
    } else {
        badge.classList.add('d-none');
    }

    if (notifs.length === 0) {
        container.innerHTML = '<li class="p-4 text-center text-muted small">No new notifications</li>';
        return;
    }

    container.innerHTML = notifs.map(n => `
        <li class="p-3 border-bottom notif-item ${n.is_read ? '' : 'bg-light'}" onclick="markRead(${n.id}, event)">
            <div class="d-flex gap-3">
                <div class="notif-icon">
                    ${getNotifIcon(n.type)}
                </div>
                <div class="flex-grow-1">
                    <div class="fw-bold small d-flex justify-content-between">
                        ${n.title}
                        <span class="text-muted" style="font-size: 0.7rem;">${formatTime(n.created_at)}</span>
                    </div>
                    <div class="text-muted extra-small mt-1" style="font-size: 0.8rem;">${n.message}</div>
                </div>
            </div>
        </li>
    `).join('');
}

function getNotifIcon(type) {
    switch(type) {
        case 'onsite': return '<i class="bi bi-geo-alt-fill text-primary"></i>';
        case 'expiry': return '<i class="bi bi-clock-history text-danger"></i>';
        case 'report': return '<i class="bi bi-chat-dots-fill text-warning"></i>';
        default: return '<i class="bi bi-info-circle-fill text-secondary"></i>';
    }
}

function formatTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function markRead(id, event) {
    if (event) event.stopPropagation();
    await fetch('../api.php?action=mark_notif_read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    loadNotifications();
}

async function markAllAsRead(event) {
    if (event) event.stopPropagation();
    await fetch('../api.php?action=mark_notif_read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
    loadNotifications();
}

setInterval(loadNotifications, 30000);

function renderCoachTable(data) {
    document.getElementById('coachTableBody').innerHTML = data.map(c => `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-3">
                    ${c.profile_image ? 
                        `<img src="../${c.profile_image}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">` : 
                        `<div class="user-avatar" style="width:30px; height:30px; font-size: 0.7rem;">${c.name.split(' ').map(n => n[0]).join('').toUpperCase()}</div>`
                    }
                    <span>${c.name}</span>
                </div>
            </td>
            <td>${c.trainee_count}</td>
        </tr>
    `).join('');
}

function renderAttendanceTable(data) {
    document.getElementById('attendanceTableBody').innerHTML = data.map(a => `
        <tr>
            <td>${a.date}</td>
            <td>${a.daily_checkins}</td>
        </tr>
    `).join('');
}

function renderUsersTable(users) {
    const regularBody = document.getElementById('usersTableBody');
    const tempBody = document.getElementById('tempUsersTableBody');
    if (!regularBody || !tempBody) return;

    // Use absolute strict filtering
    // Catch them by role OR by their RFID prefix (e.g., 'TEMP-')
    const regularUsers = users.filter(u => {
        const r = (u.role || '').trim().toLowerCase();
        const rf = (u.rfid || '').trim().toUpperCase();
        const isTemp = r === 'temporary' || rf.startsWith('TEMP-');
        return !isTemp && r !== 'admin' && r !== 'staff';
    });
    
    const tempUsers = users.filter(u => {
        const r = (u.role || '').trim().toLowerCase();
        const rf = (u.rfid || '').trim().toUpperCase();
        return r === 'temporary' || rf.startsWith('TEMP-');
    });

    // Render Regular Table (Members & Coaches)
    if (regularUsers.length === 0) {
        regularBody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No active members or coaches found.</td></tr>';
    } else {
        regularBody.innerHTML = regularUsers.map(u => {
            const role = (u.role || 'Member').trim();
            const roleLower = role.toLowerCase();
            const roleClass = `badge-${roleLower}`;
            const duration = (u.duration_days === 'Permanent') ? 'Permanent' : ((u.duration_days !== null && u.duration_days !== undefined) ? u.duration_days + 'd' : '-');
            const expiry = u.expires_on || '-';
            
            return `
                <tr>
                    <td>
                        <div class="d-flex align-items-center gap-3">
                            ${u.profile_image ? 
                                `<img src="../${u.profile_image}" style="width:35px; height:35px; border-radius:50%; object-fit:cover;">` : 
                                `<div class="user-avatar" style="width:35px; height:35px; font-size: 0.8rem;">${u.name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase()}</div>`
                            }
                            <span class="fw-bold">${u.name}</span>
                        </div>
                    </td>
                    <td><span class="badge ${roleClass}">${role}</span></td>
                    <td class="text-danger fw-bold font-monospace">${u.rfid || 'None'}</td>
                    <td>
                        <div class="fw-bold text-primary small">
                            ${u.coach_name || '<span class="text-muted fw-normal italic">None Assigned</span>'}
                        </div>
                    </td>
                    <td>${u.start_date || '-'}</td>
                    <td>${duration}</td>
                    <td>${expiry}</td>
                    <td>
                        <span class="status-badge ${u.status === 'Active' ? 'status-active' : (u.status === 'Expired' ? 'status-expired' : 'status-deactivated')}">
                            ${u.status}
                        </span>
                    </td>
                    <td>
                        <div class="d-flex gap-2 align-items-center">
                            <button class="btn btn-sm btn-outline-primary" onclick="viewMemberInfo('${u.id}')" title="View Personal Info">
                                <i class="bi bi-person-lines-fill"></i> Info
                            </button>
                            <button class="btn btn-sm btn-outline-warning" onclick="openEditRfid('${u.id}')" title="Edit RFID Card">
                                <i class="bi bi-credit-card-2-front"></i> RFID
                            </button>
                            ${roleLower === 'member' ? `
                                <select class="form-select form-select-sm ext-select" style="width: 100px;" data-id="${u.id}">
                                    <option value="7">Weekly</option>
                                    <option value="30" selected>Monthly</option>
                                    <option value="90">Quarterly</option>
                                    <option value="365">Yearly</option>
                                </select>
                                <button class="btn btn-sm btn-outline-dark" onclick="handleExtend('${u.id}')" title="Extend Plan">
                                    <i class="bi bi-plus-circle"></i>
                                </button>
                            ` : ''}
                            <button class="btn btn-sm ${u.status !== 'Deactivated' ? 'btn-outline-danger' : 'btn-outline-success'}" 
                                    onclick="toggleStatus('${u.id}', '${u.status !== 'Deactivated' ? 'Deactivated' : 'Active'}')"
                                    title="${u.status !== 'Deactivated' ? 'Deactivate' : 'Activate'}">
                                <i class="bi ${u.status !== 'Deactivated' ? 'bi-person-x' : 'bi-person-check'}"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Render Temporary Table
    if (tempUsers.length === 0) {
        tempBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No temporary members registered.</td></tr>';
    } else {
        tempBody.innerHTML = tempUsers.map(u => {
            return `
                <tr>
                    <td>
                        <div class="d-flex align-items-center gap-3">
                            ${u.profile_image ? 
                                `<img src="../${u.profile_image}" style="width:35px; height:35px; border-radius:50%; object-fit:cover;">` : 
                                `<div class="user-avatar" style="width:35px; height:35px; font-size: 0.8rem;">${u.name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase()}</div>`
                            }
                            <span class="fw-bold">${u.name}</span>
                        </div>
                    </td>
                    <td><span class="badge badge-secondary">Temporary</span></td>
                    <td class="text-danger fw-bold font-monospace">${u.rfid || 'None'}</td>
                    <td>${u.start_date || '-'}</td>
                    <td class="text-success fw-bold">Permanent</td>
                    <td>
                        <span class="status-badge ${u.status === 'Active' ? 'status-active' : 'status-deactivated'}">
                            ${u.status}
                        </span>
                    </td>
                    <td>
                        <div class="d-flex gap-2 align-items-center">
                            <button class="btn btn-sm btn-outline-primary" onclick="viewMemberInfo('${u.id}')" title="View Personal Info">
                                <i class="bi bi-person-lines-fill"></i> Info
                            </button>
                            <button class="btn btn-sm btn-outline-warning" onclick="openEditRfid('${u.id}')" title="Edit RFID Card">
                                <i class="bi bi-credit-card-2-front"></i> RFID
                            </button>
                            <button class="btn btn-sm ${u.status !== 'Deactivated' ? 'btn-outline-danger' : 'btn-outline-success'}" 
                                    onclick="toggleStatus('${u.id}', '${u.status !== 'Deactivated' ? 'Deactivated' : 'Active'}')"
                                    title="${u.status !== 'Deactivated' ? 'Deactivate' : 'Activate'}">
                                <i class="bi ${u.status !== 'Deactivated' ? 'bi-person-x' : 'bi-person-check'}"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

async function handleExtend(id) {
    const select = document.querySelector(`.ext-select[data-id="${id}"]`);
    const days = parseInt(select.value);
    const periodName = select.options[select.selectedIndex].text;
    
    showConfirm(
        'Extend Membership',
        `Extend membership by ${periodName} (${days} days)?`,
        '<i class="bi bi-calendar-plus text-primary"></i>',
        'Extend',
        'btn-primary',
        async () => {
            try {
                const res = await fetch('../api.php?action=extend', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ member_id: id, days: days })
                });
                const ct = res.headers.get('content-type') || '';
                let result;
                if (ct.includes('application/json')) {
                    result = await res.json();
                } else {
                    const raw = await res.text();
                    if (raw && raw.trim() === 'DB_ERROR') {
                        showAlert('Database Error', 'Server cannot connect to the database. Please try again later.', 'danger');
                        return;
                    }
                    try { result = JSON.parse(raw); } catch {
                        showAlert('Server Error', `Unexpected response: ${raw.substring(0, 150)}`, 'danger');
                        return;
                    }
                }
                if (result && result.status === 'success') {
                    const email = result.email_status || null;
                    let message = `Membership extended by ${periodName}`;
                    let severity = 'success';
                    if (email) {
                        if (email.sent === true) {
                            message += ` ✅\n📧 Renewal email sent to ${email.recipient}`;
                        } else if (email.recipient_valid === true && !email.sent) {
                            severity = 'warning';
                            message += ` ⚠️\n📧 Email NOT sent to ${email.recipient}. ${email.error || email.skipped_reason || 'Unknown reason.'}`;
                        } else if (email.skipped_reason) {
                            severity = 'info';
                            message += ` ℹ️\n${email.skipped_reason}`;
                        } else if (email.error) {
                            severity = 'warning';
                            message += ` ⚠️\nEmail error: ${email.error}`;
                        } else {
                            message += ` ℹ️\nNo email on file for this member.`;
                        }
                        if (email.log_id) message += ` (log #${email.log_id})`;
                    }
                    if (result.new_expires_on) message += `\n📅 New expiry: ${new Date(result.new_expires_on + 'T00:00:00').toLocaleDateString()}`;
                    showAlert(severity === 'success' ? 'Success' : severity === 'danger' ? 'Error' : 'Notice', message, severity);
                    loadData();
                } else {
                    showAlert('Error', result?.message || 'Failed to extend membership.', 'danger');
                }
            } catch (err) {
                showAlert('Network Error', `Could not reach server: ${err.message}`, 'danger');
            }
        }
    );
}

function renderStaffTable(staff) {
    document.getElementById('staffTableBody').innerHTML = staff.map(s => `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-3">
                    ${s.profile_image ? 
                        `<img src="../${s.profile_image}" style="width:35px; height:35px; border-radius:50%; object-fit:cover;">` : 
                        `<div class="user-avatar" style="width:35px; height:35px; font-size: 0.8rem;">${s.name.split(' ').map(n => n[0]).join('').toUpperCase()}</div>`
                    }
                    <div>
                        <div class="fw-bold">${s.name}</div>
                        <div class="text-muted extra-small">@${s.username}</div>
                    </div>
                </div>
            </td>
            <td><span class="badge badge-${s.role.toLowerCase()}">${s.role}</span></td>
            <td>
                <span class="status-badge ${s.status === 'Active' ? 'status-active' : 'status-deactivated'}">
                    ${s.status}
                </span>
            </td>
            <td>${new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</td>
            <td>
                ${s.role !== 'Admin' ? `
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="viewMemberInfo('${s.id}')" title="View Personal Info">
                        <i class="bi bi-person-lines-fill"></i> Info
                    </button>
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditStaff('${s.id}')" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm ${s.status !== 'Deactivated' ? 'btn-outline-danger' : 'btn-outline-success'}" 
                            onclick="toggleStatus('${s.id}', '${s.status !== 'Deactivated' ? 'Deactivated' : 'Active'}')"
                            title="${s.status !== 'Deactivated' ? 'Deactivate' : 'Activate'}">
                        <i class="bi ${s.status !== 'Deactivated' ? 'bi-person-x' : 'bi-person-check'}"></i>
                    </button>
                ` : `
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="viewMemberInfo('${s.id}')" title="View Personal Info">
                        <i class="bi bi-person-lines-fill"></i> Info
                    </button>
                `}
            </td>
        </tr>
    `).join('');
}

function openEditStaff(id) {
    const s = allStaff.find(x => x.id === id);
    if (!s) return;
    document.getElementById('editStaffId').value = s.id;
    document.getElementById('editStaffName').value = s.name;
    document.getElementById('editStaffUser').value = s.username;
    document.getElementById('editStaffGender').value = s.gender || 'Male';
    document.getElementById('editStaffAge').value = s.age || 30;
    document.getElementById('editStaffRole').value = s.role;
    document.getElementById('editStaffStatus').value = s.status;
    document.getElementById('editStaffPass').value = '';
    if (!editStaffModal) editStaffModal = new bootstrap.Modal(document.getElementById('editStaffModal'));
    editStaffModal.show();
}

function validatePassword(pass) {
    if (!pass) return true; // Assume optional if empty (for edits)
    const minLength = 8;
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(pass);
    const hasNumber = /[0-9]/.test(pass);
    
    if (pass.length < minLength) return "Password must be at least 8 characters long.";
    if (!hasSpecial) return "Password must contain at least one special character.";
    if (!hasNumber) return "Password must contain at least one number.";
    return true;
}

let confirmModal;
let confirmCallback = null;

function showConfirm(title, message, icon, confirmText, confirmClass, callback) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    document.getElementById('confirmModalIcon').innerHTML = icon;
    const confirmBtn = document.getElementById('confirmModalConfirm');
    confirmBtn.textContent = confirmText || 'Confirm';
    confirmBtn.className = 'btn btn-lg px-5 ' + (confirmClass || 'btn-primary');
    confirmCallback = callback;
    if (!confirmModal) confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
    confirmModal.show();
}

document.getElementById('confirmModalConfirm').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
    if (confirmModal) confirmModal.hide();
});

document.getElementById('editStaffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('editStaffPass').value;
    const passError = validatePassword(password);
    if (passError !== true) {
        showAlert(passError, 'danger');
        return;
    }

    const payload = {
        id: document.getElementById('editStaffId').value,
        name: document.getElementById('editStaffName').value,
        username: document.getElementById('editStaffUser').value,
        password: password,
        gender: document.getElementById('editStaffGender').value,
        age: parseInt(document.getElementById('editStaffAge').value),
        role: document.getElementById('editStaffRole').value,
        status: document.getElementById('editStaffStatus').value
    };
    
    const res = await fetch('../api.php?action=manage_staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.status === 'success') {
        showAlert('Staff account updated successfully', 'success');
        if (editStaffModal) editStaffModal.hide();
        loadData();
    } else {
        showAlert('Update failed: ' + (result.message || 'Unknown error'), 'danger');
    }
});

function renderAllReportsTable(reports) {
    document.getElementById('allReportsTableBody').innerHTML = reports.map(r => {
        const isResolved = r.status === 'Resolved';
        return `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-3">
                    ${r.profile_image ? 
                        `<img src="../${r.profile_image}" style="width:35px; height:35px; border-radius:50%; object-fit:cover;">` : 
                        `<div class="user-avatar" style="width:35px; height:35px; font-size: 0.8rem;">${r.user_name.split(' ').map(n => n[0]).join('').toUpperCase()}</div>`
                    }
                    <div>
                        <div class="fw-bold">${r.user_name}</div>
                        <div class="text-muted extra-small">${r.user_role}</div>
                    </div>
                </div>
            </td>
            <td>${r.category}</td>
            <td>${r.issue}</td>
            <td>
                ${isResolved ? `
                    <div class="fw-bold text-success">Resolved</div>
                ` : `
                    <div class="d-flex gap-2">
                        <input type="text" class="form-control form-control-sm resolution-input" 
                               placeholder="Resolution details..." 
                               value="${r.resolution || ''}" 
                               data-id="${r.id}">
                        <button class="btn btn-sm btn-primary" onclick="saveReport('${r.id}')">
                            <i class="bi bi-save"></i>
                        </button>
                    </div>
                `}
            </td>
            <td>
                <div class="status-dropdown-wrapper">
                    <select class="form-select form-select-sm status-select" data-id="${r.id}" data-prev-status="${r.status}" onchange="handleStatusChange(this)" ${isResolved ? 'disabled' : ''}>
                        <option value="Pending" ${r.status === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="In Progress" ${r.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option value="Resolved" ${r.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                    </select>
                </div>
            </td>
            <td>
                <div class="text-nowrap">${new Date(r.created_at).toLocaleDateString()}</div>
            </td>
        </tr>
    `;
    }).join('');
}

async function handleStatusChange(selectEl) {
    const reportId = selectEl.getAttribute('data-id');
    const newStatus = selectEl.value;
    const prevStatus = selectEl.getAttribute('data-prev-status');
    const resolutionInput = document.querySelector(`.resolution-input[data-id="${reportId}"]`);
    const resolution = resolutionInput ? resolutionInput.value : '';

    if (newStatus === 'Resolved' && !resolution.trim()) {
        showAlert("Please provide a resolution description before marking as Resolved.", 'danger');
        // Reset select to previous status
        selectEl.value = prevStatus;
        return;
    }

    // Save current resolution as well when status changes
    await updateReport(reportId, newStatus, resolution);
}

async function saveReport(id) {
    const resolutionInput = document.querySelector(`.resolution-input[data-id="${id}"]`);
    const statusSelect = document.querySelector(`.status-select[data-id="${id}"]`);
    const resolution = resolutionInput.value;
    const status = statusSelect.value;

    if (status === 'Resolved' && !resolution.trim()) {
        showAlert("Please provide a resolution description before marking as Resolved.", 'danger');
        return;
    }

    await updateReport(id, status, resolution);
}

async function updateReport(id, status, resolution) {
    try {
        const res = await fetch('../api.php?action=update_report_status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status, resolution })
        });
        const result = await res.json();
        if (result.status === 'success') {
            showAlert('Report updated successfully!', 'success');
            loadData();
        } else {
            showAlert(result.message, 'danger');
        }
    } catch (error) {
        console.error('Error updating report:', error);
        showAlert('An error occurred. Please try again.', 'danger');
    }
}

document.getElementById('createStaffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('staffPass').value;
    const passError = validatePassword(password);
    if (passError !== true) {
        showAlert(passError, 'danger');
        return;
    }

    const payload = {
        name: document.getElementById('staffName').value,
        username: document.getElementById('staffUser').value,
        password: password,
        gender: document.getElementById('staffGender').value,
        age: document.getElementById('staffAge').value,
        role: 'Staff',
        status: 'Active'
    };
    try {
        const res = await fetch('../api.php?action=manage_staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.status === 'success') {
            showAlert('Staff account created successfully!', 'success');
            document.getElementById('createStaffForm').reset();
            loadData();
        } else {
            showAlert(result.message || 'Error creating staff account', 'danger');
        }
    } catch (error) {
        console.error(error);
        showAlert('An error occurred. Please try again.', 'danger');
    }
});

function showAlert(message, type = 'success') {
    const container = document.getElementById('alertContainer');
    if (!container) return;
    container.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    setTimeout(() => {
        const alert = container.querySelector('.alert');
        if (alert) {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
        }
    }, 5000);
}

document.getElementById('userSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u => u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
    renderUsersTable(filtered);
});

async function toggleStatus(id, newStatus) {
    const icon = newStatus === 'Deactivated' 
        ? '<i class="bi bi-person-x text-danger"></i>'
        : '<i class="bi bi-person-check text-success"></i>';
    const btnClass = newStatus === 'Deactivated' ? 'btn-danger' : 'btn-success';
    
    showConfirm(
        newStatus === 'Deactivated' ? 'Deactivate Staff' : 'Activate Staff',
        `Are you sure you want to ${newStatus.toLowerCase()} this staff member?`,
        icon,
        newStatus === 'Deactivated' ? 'Deactivate' : 'Activate',
        btnClass,
        async () => {
            await fetch('../api.php?action=toggle_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ member_id: id, new_status: newStatus })
            });
            loadData();
        }
    );
}

document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('../api.php?action=logout');
    window.location.href = '../index.html';
});

function updateClock() {
    const now = new Date();
    const options = { 
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    };
    const clockEl = document.getElementById('clock');
    if (clockEl) {
        clockEl.innerHTML = `<i class="bi bi-clock me-2"></i>${now.toLocaleDateString('en-US', options)}`;
    }
}

setInterval(updateClock, 1000);
updateClock();

let memberInfoModalInstance;
function viewMemberInfo(id) {
    let m = (typeof allUsers !== 'undefined') ? allUsers.find(u => u.id === id) : null;
    if (!m && typeof allStaff !== 'undefined') {
        m = allStaff.find(u => u.id === id);
    }
    if (!m) {
        showAlert('Not Found', 'Member data could not be located', 'warning');
        return;
    }
    const name = m.name || 'Unknown';
    const initials = name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase() || '?';
    const avatarEl = document.getElementById('mInfoAvatar');
    if (avatarEl) {
        if (m.profile_image) {
            avatarEl.innerHTML = `<img src="../${m.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
            avatarEl.style.padding = '0';
        } else {
            avatarEl.innerHTML = initials;
            avatarEl.style.cssText = '';
            avatarEl.style.width = '64px'; avatarEl.style.height = '64px'; avatarEl.style.fontSize = '1.5rem';
            avatarEl.style.border = '3px solid #FFD700';
        }
    }
    const setText = (id, val, def) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (val === null || val === undefined || val === '') {
            el.textContent = def || '—';
            if (id === 'mInfoAddress' || id === 'mInfoMedical') el.style.fontWeight = 'normal';
        } else {
            el.textContent = val;
            if (id === 'mInfoAddress' || id === 'mInfoMedical') el.style.fontWeight = 'bold';
        }
    };
    setText('mInfoName', name);
    setText('mInfoFullName', name);
    const roleEl = document.getElementById('mInfoRole');
    if (roleEl) roleEl.textContent = (m.role || 'Member');
    setText('mInfoGender', m.gender);
    setText('mInfoAge', m.age ? m.age + ' yrs old' : null);
    setText('mInfoRfid', m.rfid, 'None');
    setText('mInfoStart', m.start_date || (m.created_at ? new Date(m.created_at).toLocaleDateString('en-CA') : null));
    const statusEl = document.getElementById('mInfoStatus');
    if (statusEl) {
        const st = m.status || 'Active';
        statusEl.innerHTML = `<span class="status-badge ${st === 'Active' ? 'status-active' : (st === 'Expired' ? 'status-expired' : 'status-deactivated')}">${st}</span>`;
    }
    setText('mInfoEmail', m.email);
    setText('mInfoPhone', m.phone);
    setText('mInfoAddress', m.address);
    setText('mInfoCoach', m.coach_name, 'None Assigned');
    setText('mInfoExpiry', (m.duration_days === 'Permanent') ? 'Permanent (no expiry)' : (m.expires_on || (m.created_at ? '—' : null)));
    setText('mInfoMedical', m.medical_condition, 'No medical conditions on file.');
    if (!memberInfoModalInstance) {
        memberInfoModalInstance = new bootstrap.Modal(document.getElementById('memberInfoModal'));
    }
    memberInfoModalInstance.show();
}

const settingsTabLink = document.querySelector('a[href="#settings"]');
if (settingsTabLink) {
    settingsTabLink.addEventListener('shown.bs.tab', async () => {
        try {
            const res = await fetch('../api.php?action=get_profile');
            const data = await res.json();
            if (data.status === 'success') {
                const p = data.profile;
                const sName = document.getElementById('settingsName');
                const sEmail = document.getElementById('settingsEmail');
                const sPhone = document.getElementById('settingsPhone');
                const sAddress = document.getElementById('settingsAddress');
                if (sName) sName.value = p.name || '';
                if (sEmail) sEmail.value = p.email || '';
                if (sPhone) sPhone.value = p.phone || '';
                if (sAddress) sAddress.value = p.address || '';
                try {
                    const secRes = await fetch('../api.php?action=get_security_questions');
                    const secData = await secRes.json();
                    if (secData.status === 'success') {
                        const q = secData.security.question || '';
                        const a = secData.security.answer || '';
                        const selectEl = document.getElementById('secQuestionSelect');
                        if (selectEl) {
                            const presets = [
                                'What is the name of your first pet/dog?',
                                'What is your favorite food?',
                                'What city/town do you currently live in?',
                                'What is the name of a specific item/thing you own?'
                            ];
                            if (presets.includes(q)) {
                                selectEl.value = q;
                                document.getElementById('customQuestionWrap').style.display = 'none';
                            } else if (q) {
                                selectEl.value = 'custom';
                                document.getElementById('customQuestionWrap').style.display = 'block';
                                document.getElementById('secCustomQuestion').value = q;
                            }
                        }
                        document.getElementById('secAnswer').value = a;
                    }
                } catch (e) { console.error(e); }
            }
        } catch (err) {
            console.error(err);
        }
    });
}

const profileSettingsForm = document.getElementById('profileSettingsForm');
if (profileSettingsForm) {
    profileSettingsForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const formData = new FormData();
        formData.append('name', document.getElementById('settingsName').value);
        formData.append('email', document.getElementById('settingsEmail').value);
        formData.append('phone', document.getElementById('settingsPhone').value);
        formData.append('address', document.getElementById('settingsAddress').value);
        try {
            const response = await fetch('../api.php?action=update_profile', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            if (result.status === 'success') {
                showAlert('Profile updated successfully', 'success');
                loadData();
            } else {
                showAlert(result.message || 'Failed to update profile', 'danger');
            }
        } catch (err) {
            console.error(err);
            showAlert('Server error', 'danger');
        }
    });
}

const adminChangePassForm = document.getElementById('changePasswordForm');
if (adminChangePassForm) {
    adminChangePassForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const newPassword = document.getElementById('newPassword').value;
        const confirmNewPassword = document.getElementById('confirmNewPassword').value;
        if (newPassword !== confirmNewPassword) {
            showAlert('Passwords do not match', 'danger');
            return;
        }
        try {
            const response = await fetch('../api.php?action=change_password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    new_password: newPassword,
                    confirm_password: confirmNewPassword
                })
            });
            const result = await response.json();
            if (result.status === 'success') {
                showAlert(result.message, 'success');
                adminChangePassForm.reset();
            } else {
                showAlert(result.message || 'Failed to update password', 'danger');
            }
        } catch (err) {
            console.error(err);
            showAlert('Server error', 'danger');
        }
    });
}

let editRfidModalInstance = null;
function openEditRfid(id) {
    const dataSource = (typeof allUsers !== 'undefined') ? allUsers :
                       ((typeof allMembers !== 'undefined') ? allMembers : null);
    const m = dataSource ? dataSource.find(u => u.id === id) : null;
    const s = (!m && typeof allStaff !== 'undefined') ? allStaff.find(u => u.id === id) : null;
    const member = m || s;
    if (!member) {
        showAlert('Member data could not be located', 'warning');
        return;
    }
    document.getElementById('editRfidMemberId').value = member.id;
    document.getElementById('editRfidMemberName').textContent = member.name || 'Unknown';
    document.getElementById('editRfidCurrent').textContent = member.rfid || 'None';
    document.getElementById('editRfidNew').value = '';
    if (!editRfidModalInstance) {
        editRfidModalInstance = new bootstrap.Modal(document.getElementById('editRfidModal'));
    }
    editRfidModalInstance.show();
    setTimeout(() => document.getElementById('editRfidNew').focus(), 500);
}

function generateEditRfid() {
    const hex = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
    const input = document.getElementById('editRfidNew');
    input.value = hex;
    input.classList.add('is-valid');
    setTimeout(() => input.classList.remove('is-valid'), 2000);
}

function submitEditRfidForm() {
    const member_id = document.getElementById('editRfidMemberId').value;
    const new_rfid = document.getElementById('editRfidNew').value.trim().toUpperCase();
    if (!new_rfid) {
        showAlert('Please enter or scan a new RFID code', 'danger');
        document.getElementById('editRfidNew').focus();
        return;
    }
    if (!member_id) {
        showAlert('Member not found. Close the modal and try again.', 'danger');
        return;
    }
    fetch('../api.php?action=update_rfid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: member_id, new_rfid: new_rfid })
    }).then(r => r.json()).then(result => {
        if (result.status === 'success') {
            showAlert(result.message, 'success');
            if (editRfidModalInstance) editRfidModalInstance.hide();
            loadData();
        } else {
            showAlert(result.message || 'Failed to update RFID', 'danger');
        }
    }).catch(err => {
        console.error(err);
        showAlert('Server error', 'danger');
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const rfidInput = document.getElementById('editRfidNew');
    if (rfidInput) {
        rfidInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitEditRfidForm();
            }
        });
    }
});

let serialPort = null;
let serialReader = null;
let serialKeepReading = true;
let serialConnected = false;
const ADMIN_RFID_BAUDS = [115200, 9600, 57600, 38400, 19200];
const ADMIN_USB_FILTERS = [
    { usbVendorId: 0x2341 },
    { usbVendorId: 0x2A03 },
    { usbVendorId: 0x1A86 },
    { usbVendorId: 0x10C4 },
    { usbVendorId: 0x0403 }
];

function adminLineLooksValid(line) {
    if (!line) return false;
    const s = String(line).trim();
    if (!s) return false;
    if (/^USB[_ -]?READY\b/i.test(s)) return true;
    if (/^RFID[_ -]?OK\b/i.test(s)) return true;
    if (/^READER[_ -]?OK\b/i.test(s)) return true;
    if (/^MFRC522/i.test(s)) return true;
    if (/^TAG\s*[:=|]/i.test(s)) return true;
    if (/^UID\s*[:=|]/i.test(s)) return true;
    if (/^CARD(?:\s*ID)?\s*[:=|]/i.test(s)) return true;
    if (/^SCAN\s*[:=|]/i.test(s)) return true;
    const justHex = s.replace(/[^A-Fa-f0-9]/g, '');
    if (justHex.length >= 6 && justHex.length <= 16) return true;
    return false;
}

function adminExtractRFID(rawLine) {
    if (!rawLine) return null;
    const line = String(rawLine).trim();
    if (!line) return null;

    const patterns = [
        /^TAG\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^UID\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^CARD(?:\s*ID)?\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^RFID\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^SCAN\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^\s*0x([A-Fa-f0-9]{6,16})\b/,
        /\b([A-Fa-f0-9]{8,16})\b/
    ];
    for (const re of patterns) {
        const m = line.match(re);
        if (m) return m[1].toUpperCase();
    }
    const justHex = line.replace(/[^A-Fa-f0-9]/g, '');
    if (justHex.length >= 6 && justHex.length <= 16) return justHex.toUpperCase();
    return null;
}

function setAdminUsbBtnState(connected) {
    const btn = document.getElementById('editRfidUsbBtn');
    if (!btn) return;
    if (connected) {
        btn.title = 'RFID Reader Connected — click to disconnect';
        btn.style.background = 'linear-gradient(135deg, #81C784, #4CAF50)';
        btn.style.color = '#fff';
    } else {
        btn.title = 'Connect USB RFID Reader';
        btn.style.background = 'linear-gradient(135deg, #E8E8E8, #C0C0C0)';
        btn.style.color = '#1a1a1a';
    }
}

async function adminDisconnectUSB() {
    serialKeepReading = false;
    if (serialReader) {
        try { await serialReader.cancel(); } catch (e) {}
        serialReader = null;
    }
    if (serialPort) {
        try { await serialPort.close(); } catch (e) {}
        serialPort = null;
    }
    serialConnected = false;
    setAdminUsbBtnState(false);
}

function adminSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function adminOpenAtBaud(port, baud) {
    try {
        await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
        return true;
    } catch (e) {
        console.warn(`[Admin USB] open() at ${baud} failed:`, e.message);
        return false;
    }
}

async function adminProbeBaud(port, baud, probeMs) {
    console.log(`[Admin USB] Probing baud ${baud} for ${probeMs}ms...`);
    const decoder = new TextDecoder();
    let buffer = '';
    let reader = null;
    let got = false;
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; if (reader) { try { reader.cancel(); } catch (_) {} } }, probeMs);
    try {
        while (!timedOut && port.readable) {
            reader = port.readable.getReader();
            try {
                while (!timedOut) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value || new Uint8Array(), { stream: true });
                    if (text) buffer += text;
                    if (buffer.length > 4096) buffer = buffer.slice(-2048);
                    const lines = buffer.split(/\r?\n/);
                    buffer = lines.pop() || '';
                    for (const l of lines) {
                        if (adminLineLooksValid(l)) {
                            console.log(`[Admin USB] Valid match at ${baud}:`, l.trim());
                            got = true;
                            clearTimeout(t);
                            try { reader.cancel(); } catch (_) {}
                            break;
                        }
                    }
                    if (got) break;
                }
            } catch (e) {
                if (e && e.name !== 'BreakError') console.debug(`[Admin USB] probe read at ${baud}:`, e?.message || e);
            } finally {
                try { reader.releaseLock(); } catch (_) {}
                reader = null;
            }
            if (got || timedOut) break;
        }
    } catch (outer) {
        console.debug(`[Admin USB] probe outer ${baud}:`, outer?.message || outer);
    } finally { clearTimeout(t); }
    return got;
}

async function adminTryHandshake(port) {
    try {
        if (!port || !port.writable) return false;
        const w = port.writable.getWriter();
        try {
            const e = new TextEncoder();
            await w.write(e.encode('\r\nPING\r\n'));
            await adminSleep(150);
            await w.write(e.encode('STATUS?\n'));
            return true;
        } finally { try { w.releaseLock(); } catch (_) {} }
    } catch (_) { return false; }
}

async function adminPickManualBaud(tried) {
    const msg =
        'Auto-detect could not match baud: ' + tried.join(', ') + '\n\n' +
        'Sketch uses Serial.begin(115200);\n' +
        'Pick baud matching your sketch:\n\n' +
        '  1) 115200  (MFRC522 default)\n' +
        '  2) 9600\n' +
        '  3) 57600\n' +
        '  4) 38400\n' +
        '  5) 19200\n' +
        '  0) Cancel\n\n' +
        'TIP: Close Arduino Serial Monitor first.';
    const c = prompt(msg, '1');
    if (c === null) return null;
    switch (c.trim()) {
        case '1': return 115200;
        case '2': return 9600;
        case '3': return 57600;
        case '4': return 38400;
        case '5': return 19200;
        default: return parseInt(c.trim(), 10) || null;
    }
}

async function adminEstablish(port) {
    let baud = null;
    let manual = false;

    const info = port.getInfo ? port.getInfo() : {};
    const vid = info.usbVendorId || 0;
    const isFTDI = vid === 0x0403;

    if (isFTDI) {
        console.log(`[Admin USB] VID=0x${vid.toString(16).toUpperCase()} (FTDI FT232R) — SKIP probe, lock 115200.`);
        const ok = await adminOpenAtBaud(port, 115200);
        if (!ok) return { ok: false, reason: 'FTDI_OPEN_FAIL', baud: 115200 };
        baud = 115200;
        try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
        return { ok: true, baud, manual: false, fastBypass: true };
    }

    for (const rate of ADMIN_RFID_BAUDS) {
        const ok = await adminOpenAtBaud(port, rate);
        if (!ok) { try { await port.close(); } catch (_) {} continue; }
        await adminSleep(1800);
        adminTryHandshake(port);
        const matched = await adminProbeBaud(port, rate, 2500);
        if (matched) { baud = rate; console.log(`[Admin USB] Auto-detected baud: ${rate}`); break; }
        console.warn(`[Admin USB] No data at ${rate}`);
        try { await port.close(); } catch (_) {}
        await adminSleep(200);
    }
    if (!baud) {
        const p = await adminPickManualBaud(ADMIN_RFID_BAUDS);
        if (!p) return { ok: false, reason: 'NO_BAUD' };
        const ok = await adminOpenAtBaud(port, p);
        if (!ok) return { ok: false, reason: 'MANUAL_FAIL', baud: p };
        await adminSleep(2200);
        baud = p; manual = true;
    }
    try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
    return { ok: true, baud, manual };
}

function adminFormatRawError(e) {
    if (!e) return '(no error object)';
    const parts = [];
    if (e.name) parts.push('Name: ' + e.name);
    if (e.message) parts.push('Message: ' + e.message);
    if (e.code) parts.push('Code: ' + e.code);
    if (parts.length === 0) parts.push(String(e));
    return parts.join('\n');
}

async function connectUSB() {
    if (!("serial" in navigator)) {
        showAlert('Browser Error', 'Web Serial API is not supported. Use Brave, Chrome, or Edge (HTTPS or localhost required).', 'danger');
        return;
    }

    if (serialConnected) {
        await adminDisconnectUSB();
        showAlert('USB Disconnected', 'RFID reader disconnected.', 'info');
        return;
    }

    let port = null;
    try {
        const preMsg =
            '➡️  HOW TO USE THIS POPUP:\n\n' +
            '1) Find "FT232R USB UART (COM3)" in the list\n' +
            '2) CLICK THAT ROW ONCE so it has a BLUE HIGHLIGHT\n' +
            '3) Now the gray "Connect" button at the bottom turns BLUE — click it.\n\n' +
            'If the Connect button stays GRAY, you forgot Step 2 (click the row first).\n\n' +
            'Also: Close Arduino IDE Serial Monitor FIRST (it locks COM3).';
        alert(preMsg);

        try {
            port = await navigator.serial.requestPort({ filters: [] });
        } catch (retry1) {
            console.warn('[Admin USB] requestPort(filters=[]) failed, retrying vendor filters:', retry1);
            port = await navigator.serial.requestPort({ filters: ADMIN_USB_FILTERS });
        }
    } catch (selErr) {
        console.error('[Admin USB] requestPort() raw:', selErr);
        const raw = adminFormatRawError(selErr);
        let hint = '';
        if (selErr && selErr.name === 'NotFoundError') {
            hint =
                '\n\n✅ FIX: Click the FT232R ROW first so it turns BLUE, then Connect enables.\n' +
                'Also:\n' +
                '• Arduino IDE Serial Monitor MUST be closed (it locks COM3)\n' +
                '• Brave Shield (🦁 icon in URL bar) → "Device Recognition" set to Allow\n' +
                '• If "FT232R USB UART (COM3) - Paired" appears → click it ONCE → then click Connect.';
        } else if (selErr && selErr.name === 'SecurityError') {
            hint =
                '\n\n✅ FIX: Click the 🦁 Brave Shield (top-right) → Lower shield for localhost,\n' +
                'or go to brave://settings/content/serialDevices and add localhost as allowed.';
        } else if (selErr && selErr.name === 'NetworkError') {
            hint =
                '\n\n✅ FIX: NetworkError = COM3 is already opened by another program.\n' +
                'Close Arduino IDE Serial Monitor NOW → click the X on that window.\n' +
                'Then unplug USB → wait 2s → replug → retry.';
        } else {
            hint =
                '\n\nTroubleshooting:\n' +
                '1) Close Arduino IDE Serial Monitor / Putty / TeraTerm (they lock COM3)\n' +
                '2) Click the device ROW first (Connect is gray until row is highlighted)\n' +
                '3) Click Brave 🦁 shield → Allow device recognition\n' +
                '4) Unplug USB → 2s → replug';
        }
        showAlert(
            'USB Connect Failed (requestPort)',
            `Browser rejected the connection.\n\nRaw error:\n${raw}${hint}`,
            'danger'
        );
        return;
    }
    if (!port) return;

    await adminDisconnectUSB();
    serialPort = port;

    const info = port.getInfo ? port.getInfo() : null;
    if (info) console.log('[Admin USB] port info:', info);

    let est;
    try {
        est = await adminEstablish(serialPort);
    } catch (estErr) {
        console.error('[Admin USB] adminEstablish crashed:', estErr);
        showAlert(
            'USB Connect Failed (establish)',
            `Port was picked, but opening COM port failed.\n\nRaw error:\n${adminFormatRawError(estErr)}\n\n` +
            'Most likely: Arduino IDE Serial Monitor still has COM3 open. Close it completely.',
            'danger'
        );
        try { await serialPort.close(); } catch (_) {}
        serialPort = null;
        return;
    }

    if (!est.ok) {
        if (est.reason === 'FTDI_OPEN_FAIL') {
            showAlert(
                'FTDI FT232R Port Locked',
                `Could not open FT232R (COM3) at ${est.baud} baud.\n\n` +
                'Cause: Another program EXCLUSIVELY locked COM3.\n\n' +
                'FIX (do in order):\n' +
                '1) Close Arduino IDE Serial Monitor window (click X)\n' +
                '2) If you use Putty/TeraTerm with COM3 → close them\n' +
                '3) Unplug USB cable from computer → wait 2s → replug\n' +
                '4) Click USB button again and try once more.',
                'danger'
            );
        } else if (est.reason === 'MANUAL_FAIL') {
            showAlert(
                'Port Open Failed',
                `Could not open port at manual baud ${est.baud}.\n\n` +
                'Raw cause: Serial Monitor / Putty has COM3 locked → Close it first.',
                'danger'
            );
        } else {
            showAlert(
                'Baud Detection Timed Out',
                'Browser opened the port OK, but received ZERO valid characters from the Arduino.\n\n' +
                'Since you have FT232R (external adapter):\n' +
                '  1) Make sure RX (Arduino pin 0) ← TX (FT232R)\n' +
                '     and TX (Arduino pin 1) ← RX (FT232R)\n' +
                '     (TX/RX must be CROSSED, not same-named!)\n' +
                '  2) GND wire between Arduino GND ↔ FT232R GND (REQUIRED)\n' +
                '  3) Arduino is POWERED ON (separate USB or 9V barrel)\n' +
                '  4) Hold a card on the reader during connect — forces TAG: output',
                'danger'
            );
        }
        try { await serialPort.close(); } catch (_) {}
        serialPort = null;
        return;
    }

    serialConnected = true;
    serialKeepReading = true;
    setAdminUsbBtnState(true);
    const bypass = est.fastBypass ? ' (FTDI fast-connect)' : '';
    const hint = est.manual ? ` (you picked ${est.baud})` : ` @ ${est.baud}`;
    showAlert('USB Connected', `RFID Reader ready${hint}${bypass}. Scan a card now.`, 'success');

    port.addEventListener('disconnect', async () => {
        console.warn('[Admin USB] Device disconnected.');
        serialConnected = false;
        setAdminUsbBtnState(false);
        showAlert('USB Disconnected', 'The Arduino/RFID reader was unplugged.', 'warning');
    });

    const decoder = new TextDecoder();
    let buffer = '';
    let lastRfid = '';
    let lastAt = 0;
    const DEDUP = 1200;

    try {
        while (serialKeepReading && serialPort && serialPort.readable) {
            const reader = serialPort.readable.getReader();
            serialReader = reader;
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value || new Uint8Array(), { stream: true });
                    const rawLines = buffer.split(/\r?\n/);
                    buffer = rawLines.pop() || '';
                    for (const rawLine of rawLines) {
                        const t = rawLine.trim();
                        if (!t) continue;
                        if (/^USB[_ -]?READY\b/i.test(t)) {
                            console.log('[Admin USB] Handshake received ✅');
                            continue;
                        }
                        const rfid = adminExtractRFID(rawLine);
                        if (!rfid) continue;
                        const now = Date.now();
                        if (rfid === lastRfid && (now - lastAt) < DEDUP) continue;
                        lastRfid = rfid;
                        lastAt = now;
                        console.log('[Admin USB] Scanned Tag:', rfid, 'raw:', rawLine.trim());
                        handleScannedRFID(rfid);
                    }
                }
            } catch (loopErr) {
                if (loopErr && loopErr.name === 'BreakError') {
                    console.log('[Admin USB] Reader loop cancelled.');
                    break;
                }
                console.error('[Admin USB] Serial Read Error:', loopErr);
                showAlert(
                    'USB Read Error',
                    `Serial stream crashed mid-read.\n\nRaw error:\n${adminFormatRawError(loopErr)}\n\n` +
                    'Likely: Arduino lost power or USB cable was jostled. Re-plug and retry.',
                    'warning'
                );
            } finally {
                try { reader.releaseLock(); } catch (e) {}
                if (serialReader === reader) serialReader = null;
            }
        }
    } catch (outerErr) {
        console.error('[Admin USB] Port loop error:', outerErr);
    } finally {
        if (serialConnected) {
            serialConnected = false;
            setAdminUsbBtnState(false);
            try { await serialPort.close(); } catch (e) {}
        }
        serialPort = null;
    }
}

async function adminAutoConnectUsb() {
    if (!("serial" in navigator)) return;
    try {
        const ports = await navigator.serial.getPorts();
        if (!ports || ports.length === 0) return;
        console.log('[Admin USB] Found', ports.length, 'previously authorized port(s) — auto-connecting.');
        const port = ports[0];
        await adminDisconnectUSB();
        serialPort = port;

        const est = await adminEstablish(serialPort);
        if (!est.ok) {
            console.warn('[Admin USB] Auto-connect: baud detect failed, giving up silently.');
            try { await serialPort.close(); } catch (_) {}
            serialPort = null;
            return;
        }

        serialConnected = true;
        serialKeepReading = true;
        setAdminUsbBtnState(true);

        port.addEventListener('disconnect', () => {
            serialConnected = false;
            setAdminUsbBtnState(false);
        });

        const decoder = new TextDecoder();
        let buffer = '';
        let lastRfid = '';
        let lastAt = 0;
        const DEDUP = 1200;
        while (serialKeepReading && serialPort && serialPort.readable) {
            const reader = serialPort.readable.getReader();
            serialReader = reader;
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value || new Uint8Array(), { stream: true });
                    const rawLines = buffer.split(/\r?\n/);
                    buffer = rawLines.pop() || '';
                    for (const rawLine of rawLines) {
                        const t = rawLine.trim();
                        if (!t) continue;
                        if (/^USB[_ -]?READY\b/i.test(t)) continue;
                        const rfid = adminExtractRFID(rawLine);
                        if (!rfid) continue;
                        const now = Date.now();
                        if (rfid === lastRfid && (now - lastAt) < DEDUP) continue;
                        lastRfid = rfid;
                        lastAt = now;
                        console.log('[Admin USB Auto] Scanned Tag:', rfid);
                        handleScannedRFID(rfid);
                    }
                }
            } finally {
                try { reader.releaseLock(); } catch (e) {}
            }
        }
    } catch (e) {
        console.warn('[Admin USB] Auto-connect skipped:', e?.message || e);
    }
}

function handleScannedRFID(rfid) {
    const editRfidInput = document.getElementById('editRfidNew');
    if (editRfidInput && document.getElementById('editRfidModal')?.classList.contains('show')) {
        editRfidInput.value = rfid;
        editRfidInput.classList.add('is-valid');
        setTimeout(() => editRfidInput.classList.remove('is-valid'), 2000);
    }
}

async function pollHardwareTerminal() {
    try {
        const res = await fetch('../api.php?action=get_last_scan');
        const data = await res.json();
        
        if (data.status === 'success' && data.rfid) {
            const rfid = data.rfid;
            console.log('[RFID Poll] New scan detected:', rfid);

            const editRfidInput = document.getElementById('editRfidNew');
            if (editRfidInput && document.getElementById('editRfidModal')?.classList.contains('show')) {
                editRfidInput.value = rfid;
                editRfidInput.classList.add('is-valid');
                setTimeout(() => editRfidInput.classList.remove('is-valid'), 2000);
            }

            await fetch('../api.php?action=consume_last_scan');
        }
    } catch (e) {
        console.error('[RFID Poll] Fetch Error:', e);
    }
}

setInterval(pollHardwareTerminal, 2000);

document.addEventListener('DOMContentLoaded', () => {
    const editRfidUsbBtn = document.getElementById('editRfidUsbBtn');
    if (editRfidUsbBtn) editRfidUsbBtn.addEventListener('click', connectUSB);

    adminAutoConnectUsb();
});

loadData();
