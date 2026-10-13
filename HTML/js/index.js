console.log('Index.js loaded! v1.9');

let allMembers = [];
let allCoaches = [];
let calendar;
let currentUserRole = '';
let attendanceChart = null;
let selectedCoachId = null; // For coach monitor
let historyDate = new Date(); // For attendance history
let staffData = null; // Store staff data globally

// Helper function to format a Date object as YYYY-MM-DD in local time
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function loadData() {
    try {
        await fetch('../api.php?action=consume_last_scan');
        const [staffRes, coachRes] = await Promise.all([
            fetch('../api.php?action=get_staff_data'),
            fetch('../api.php?action=get_all_coaches')
        ]);
        
        if (staffRes.status === 403 || coachRes.status === 403) { 
            window.location.href = '../login/Login.html'; 
            return; 
        }
        
        staffData = await staffRes.json();
        const coachData = await coachRes.json();

        if (staffData.status === 'success') {
            const user = staffData.user;
            currentUserRole = user.role;
            
            const updateText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            updateText('userName', user.name || 'Staff User');
            updateText('userRole', user.role || 'Staff');
            updateText('userRoleBadge', (user.role || 'Staff') + ' Member');
            
            const initialsEl = document.getElementById('userInitials');
            if (initialsEl) {
                const name = user.name || 'Staff User';
                initialsEl.textContent = name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase() || '?';
            }
            
            if (user.profile_image) {
                const avatar = document.getElementById('userInitials');
                if (avatar) {
                    avatar.innerHTML = `<img src="../${user.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                }
            }

            allMembers = staffData.members || [];
            allCoaches = coachData.coaches || [];
            
            renderMembers(allMembers);
            renderAttendance(staffData.attendance || []);
            renderReports(staffData.reports || []);
            renderCoachList(allCoaches);
            renderAttendanceChart(staffData.monthly_attendance || []);
            loadNotifications();
            
            // Load history attendance
            updateHistoryDateInput();
            renderHistoryAttendance(staffData.attendance || [], historyDate);
            
            // Load settings
            loadSettings();
        } else {
            console.error('Staff Data Error:', staffData.message);
            showAlert('Data Error', staffData.message || 'Failed to load system data', 'danger');
        }
    } catch (error) { 
        console.error('Fatal Error loading data:', error);
        showAlert('System Error', 'A critical error occurred while loading the dashboard. Please try refreshing.', 'danger');
    }
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

// Polling for notifications every 30 seconds
setInterval(loadNotifications, 30000);

function renderMembers(members) {
    const body = document.getElementById('membersTableBody');
    const tempBody = document.getElementById('tempMembersTableBody');
    if (!body || !tempBody) return;

    if (!members || !Array.isArray(members) || members.length === 0) {
        body.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-5"><h4><i class="bi bi-people mb-3 d-block fs-1"></i>No members found</h4><p>New members will appear here after registration.</p></td></tr>';
        tempBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-5">No temporary members found</td></tr>';
        return;
    }

    // Absolute strict filtering for roles and RFID prefixes
    const regularMembers = members.filter(m => {
        const role = (m.role || 'Member').trim().toLowerCase();
        const rfid = (m.rfid || '').trim().toUpperCase();
        const isTemp = role === 'temporary' || rfid.startsWith('TEMP-');
        return !isTemp && role !== 'admin' && role !== 'staff';
    });
    
    const temporaryMembers = members.filter(m => {
        const role = (m.role || '').trim().toLowerCase();
        const rfid = (m.rfid || '').trim().toUpperCase();
        return role === 'temporary' || rfid.startsWith('TEMP-');
    });

    // Render Regular Table
    if (regularMembers.length === 0) {
        body.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No active members or coaches found.</td></tr>';
    } else {
        body.innerHTML = regularMembers.map(m => {
            const role = (m.role || 'Member').trim();
            const roleLower = role.toLowerCase();
            const roleClass = `badge-${roleLower.replace(' ', '-')}`;
            const name = m.name || 'Unknown';
            const initials = name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase() || '?';
            const duration = (m.duration_days === 'Permanent') ? 'Permanent' : (m.duration_days ? m.duration_days + 'd' : '-');
            const expiry = m.expires_on || '-';
            
            return `
                <tr>
                    <td>
                        <div class="d-flex align-items-center gap-3">
                            ${m.profile_image ? 
                                `<img src="../${m.profile_image}" style="width:35px; height:35px; border-radius:50%; object-fit:cover;">` : 
                                `<div class="user-avatar" style="width:35px; height:35px; font-size: 0.8rem;">${initials}</div>`
                            }
                            <span class="fw-bold">${name}</span>
                        </div>
                    </td>
                    <td><span class="badge ${roleClass}">${role}</span></td>
                    <td class="text-danger fw-bold font-monospace">${m.rfid || 'None'}</td>
                    <td>
                        <div class="fw-bold text-primary small">
                            ${m.coach_name || '<span class="text-muted fw-normal italic small">None Assigned</span>'}
                        </div>
                    </td>
                    <td>${m.start_date || '-'}</td>
                    <td>${duration}</td>
                    <td>${expiry}</td>
                    <td>
                        <span class="status-badge ${m.status === 'Active' ? 'status-active' : (m.status === 'Expired' ? 'status-expired' : 'status-deactivated')}">
                            ${m.status || 'Active'}
                        </span>
                    </td>
                    <td>
                        <div class="d-flex gap-2 align-items-center">
                            <button class="btn btn-sm btn-outline-primary" onclick="viewMemberInfo('${m.id}')" title="View Personal Info">
                                <i class="bi bi-person-lines-fill"></i> Info
                            </button>
                            <button class="btn btn-sm btn-outline-warning" onclick="openEditRfid('${m.id}')" title="Edit RFID Card">
                                <i class="bi bi-credit-card-2-front"></i> RFID
                            </button>
                            ${roleLower === 'member' ? `
                                <select class="form-select form-select-sm ext-select" style="width: 100px;" data-id="${m.id}">
                                    <option value="7">Weekly</option>
                                    <option value="30" selected>Monthly</option>
                                    <option value="90">Quarterly</option>
                                    <option value="365">Yearly</option>
                                </select>
                                <button class="btn btn-sm btn-outline-dark" onclick="handleExtend('${m.id}')" title="Extend Plan">
                                    <i class="bi bi-plus-circle"></i>
                                </button>
                            ` : ''}
                            ${(currentUserRole === 'Admin' && roleLower !== 'admin') || (currentUserRole === 'Staff' && roleLower !== 'admin' && roleLower !== 'staff') ? `
                                <button class="btn btn-sm ${m.status !== 'Deactivated' ? 'btn-outline-danger' : 'btn-outline-success'}" 
                                        onclick="toggleStatus('${m.id}', '${m.status !== 'Deactivated' ? 'Deactivated' : 'Active'}')"
                                        title="${m.status !== 'Deactivated' ? 'Deactivate' : 'Activate'}">
                                    <i class="bi ${m.status !== 'Deactivated' ? 'bi-person-x' : 'bi-person-check'}"></i>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Render Temporary Table
    if (temporaryMembers.length === 0) {
        tempBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No temporary members found.</td></tr>';
    } else {
        tempBody.innerHTML = temporaryMembers.map(m => {
            const name = m.name || 'Unknown';
            const initials = name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase() || '?';
            return `
                <tr>
                    <td>
                        <div class="d-flex align-items-center gap-3">
                            ${m.profile_image ? 
                                `<img src="../${m.profile_image}" style="width:35px; height:35px; border-radius:50%; object-fit:cover;">` : 
                                `<div class="user-avatar" style="width:35px; height:35px; font-size: 0.8rem;">${initials}</div>`
                            }
                            <span class="fw-bold">${name}</span>
                        </div>
                    </td>
                    <td><span class="badge badge-secondary">Temporary</span></td>
                    <td class="text-danger fw-bold font-monospace">${m.rfid || 'None'}</td>
                    <td>${m.start_date || '-'}</td>
                    <td class="text-success fw-bold">Permanent</td>
                    <td>
                        <span class="status-badge ${m.status === 'Active' ? 'status-active' : 'status-deactivated'}">
                            ${m.status || 'Active'}
                        </span>
                    </td>
                    <td>
                        <div class="d-flex gap-2 align-items-center">
                            <button class="btn btn-sm btn-outline-primary" onclick="viewMemberInfo('${m.id}')" title="View Personal Info">
                                <i class="bi bi-person-lines-fill"></i> Info
                            </button>
                            <button class="btn btn-sm btn-outline-warning" onclick="openEditRfid('${m.id}')" title="Edit RFID Card">
                                <i class="bi bi-credit-card-2-front"></i> RFID
                            </button>
                            ${(currentUserRole === 'Admin' || currentUserRole === 'Staff') ? `
                                <button class="btn btn-sm ${m.status !== 'Deactivated' ? 'btn-outline-danger' : 'btn-outline-success'}" 
                                        onclick="toggleStatus('${m.id}', '${m.status !== 'Deactivated' ? 'Deactivated' : 'Active'}')"
                                        title="${m.status !== 'Deactivated' ? 'Deactivate' : 'Activate'}">
                                    <i class="bi ${m.status !== 'Deactivated' ? 'bi-person-x' : 'bi-person-check'}"></i>
                                </button>
                            ` : ''}
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
                if(result.status === 'success') {
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
                            message += ` ℹ️\nNo email on file for this member. Ask them to save one in Account Settings.`;
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

function renderAttendance(attendance) {
    const body = document.getElementById('attendanceTableBody');
    if (!attendance || !Array.isArray(attendance)) {
        body.innerHTML = '<tr><td colspan="5" class="text-center">No attendance today</td></tr>';
        return;
    }
    
    // Get today's date in YYYY-MM-DD format in local time
    const todayStr = formatLocalDate(new Date());
    
    const todayAttendance = attendance.filter(a => {
        // Parse check_in date and get YYYY-MM-DD in local time
        const checkIn = new Date(a.check_in);
        const checkInStr = formatLocalDate(checkIn);
        return checkInStr === todayStr;
    });
    
    if (todayAttendance.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-center">No attendance today</td></tr>';
        return;
    }
    
    body.innerHTML = todayAttendance.map(a => {
        const name = a.name || 'Unknown';
        const initials = name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase() || '?';
        const checkIn = a.check_in ? new Date(a.check_in) : new Date();
        const checkOut = a.check_out ? new Date(a.check_out) : null;
        return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-3">
                        ${a.profile_image ? 
                            `<img src="../${a.profile_image}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">` : 
                            `<div class="user-avatar" style="width:30px; height:30px; font-size: 0.7rem;">${initials}</div>`
                        }
                        <div class="fw-600">${name}</div>
                    </div>
                </td>
                <td>${checkIn.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td>${checkOut ? checkOut.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '<span class="text-success fw-bold">Active</span>'}</td>
                <td class="text-muted">${a.duration_minutes ? a.duration_minutes + ' mins' : '-'}</td>
                <td>
                    <span class="badge ${a.check_out ? 'bg-light text-muted' : 'bg-success text-white'}">
                        ${a.check_out ? 'Completed' : 'On-site'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

// Render attendance history for a specific date
function renderHistoryAttendance(attendance, date) {
    console.log('renderHistoryAttendance called with:', { date, attendanceCount: attendance.length });
    const body = document.getElementById('historyAttendanceTableBody');
    if (!attendance || !Array.isArray(attendance)) {
        body.innerHTML = '<tr><td colspan="5" class="text-center">No attendance for this date</td></tr>';
        return;
    }
    
    // Get target date in YYYY-MM-DD format in local time
    const targetDateStr = formatLocalDate(date);
    console.log('targetDateStr:', targetDateStr);
    
    const dateAttendance = attendance.filter(a => {
        // Parse check_in date and get YYYY-MM-DD in local time
        const checkIn = new Date(a.check_in);
        const checkInStr = formatLocalDate(checkIn);
        console.log('Checking attendance record:', { checkIn: a.check_in, checkInStr, targetDateStr, matches: checkInStr === targetDateStr });
        return checkInStr === targetDateStr;
    });
    console.log('Filtered dateAttendance:', dateAttendance);
    
    if (dateAttendance.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-center">No attendance for this date</td></tr>';
        return;
    }
    
    body.innerHTML = dateAttendance.map(a => {
        const name = a.name || 'Unknown';
        const initials = name.split(' ').filter(n => n.length > 0).map(n => n[0]).join('').toUpperCase() || '?';
        const checkIn = a.check_in ? new Date(a.check_in) : new Date();
        const checkOut = a.check_out ? new Date(a.check_out) : null;
        return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-3">
                        ${a.profile_image ? 
                            `<img src="../${a.profile_image}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">` : 
                            `<div class="user-avatar" style="width:30px; height:30px; font-size: 0.7rem;">${initials}</div>`
                        }
                        <div class="fw-600">${name}</div>
                    </div>
                </td>
                <td>${checkIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td>${checkOut ? checkOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '<span class="text-success fw-bold">Active</span>'}</td>
                <td class="text-muted">${a.duration_minutes ? a.duration_minutes + ' mins' : '-'}</td>
                <td>
                    <span class="badge ${a.check_out ? 'bg-light text-muted' : 'bg-success text-white'}">
                        ${a.check_out ? 'Completed' : 'On-site'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderReports(reports) {
    const body = document.getElementById('reportsTableBody');
    if (!reports || !Array.isArray(reports)) {
        body.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No support tickets found</td></tr>';
        return;
    }
    body.innerHTML = reports.map(r => `
        <tr>
            <td>
                <div class="fw-bold">${r.user_name || 'You'}</div>
                <div class="text-muted small">You</div>
            </td>
            <td><span class="badge bg-warning text-dark">${r.category}</span></td>
            <td>${r.issue}</td>
            <td>
                <span class="badge ${r.status === 'Resolved' ? 'bg-success' : (r.status === 'In Progress' ? 'bg-info' : 'bg-secondary')}">
                    ${r.status || 'Pending'}
                </span>
            </td>
            <td class="text-muted">${r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</td>
            <td>${r.resolution || '<span class="text-muted italic">Pending resolution...</span>'}</td>
        </tr>
    `).join('');
}

function renderCoachList(coaches) {
    const list = document.getElementById('coachSelectList');
    if (!coaches || !Array.isArray(coaches)) {
        list.innerHTML = '<div class="text-center text-muted small p-3">No coaches active</div>';
        return;
    }
    list.innerHTML = coaches.map(c => {
        const coachName = c.coach_name || 'Unknown Coach';
        const initials = coachName[0] || '?';
        return `
            <div class="list-group-item border-0 rounded-3 mb-2 d-flex align-items-center gap-3 px-2" style="background: #fafafa; border: 1px solid #eee;">
                <button class="flex-grow-1 d-flex align-items-center gap-3 border-0 bg-transparent text-start p-0" onclick="viewCoachCalendar('${c.coach_id}', '${coachName}')">
                    ${c.profile_image ? 
                        `<img src="../${c.profile_image}" style="width:35px; height:35px; border-radius:50%; object-fit:cover;">` : 
                        `<div class="user-avatar bg-dark text-warning small">${initials}</div>`
                    }
                    <div class="fw-bold">${coachName}</div>
                </button>
                <button class="btn btn-sm btn-outline-dark" onclick="viewCoachProfile('${c.coach_id}')" title="View Coach Profile">
                    <i class="bi bi-info-circle"></i>
                </button>
            </div>
        `;
    }).join('');
}

function formatStars(rating) {
    if (!rating) return 'No ratings yet';
    const full = Math.floor(rating);
    const half = rating - full >= 0.5;
    let stars = '';
    for (let i = 0; i < full; i++) stars += '★';
    if (half) stars += '☆';
    return `${stars} <span class="text-muted">${rating}/5</span>`;
}

let coachProfileModalInstance = null;
async function viewCoachProfile(coachId) {
    document.getElementById('cProfileName').textContent = 'Loading...';
    document.getElementById('cProfileCreds').textContent = 'Loading credentials...';
    document.getElementById('cProfileHabits').textContent = 'Loading training style...';
    document.getElementById('cProfilePhotos').innerHTML = '<div class="col-12"><small class="text-muted">Loading credential photos...</small></div>';
    document.getElementById('cProfileRating').textContent = 'Loading ratings...';
    document.getElementById('cProfileReviewCount').textContent = 'Loading...';
    document.getElementById('cProfileReviews').innerHTML = '<div class="text-muted small">Loading trainee feedback...</div>';

    if (!coachProfileModalInstance) {
        coachProfileModalInstance = new bootstrap.Modal(document.getElementById('coachProfileModal'));
    }
    coachProfileModalInstance.show();

    try {
        const res = await fetch(`../api.php?action=get_coach_profile_public&coach_id=${encodeURIComponent(coachId)}`);
        const payload = await res.json();
        if (payload.status !== 'success') {
            document.getElementById('cProfileCreds').textContent = 'Unable to load coach profile right now.';
            return;
        }

        const coach = payload.coach;
        document.getElementById('cProfileName').textContent = coach.coach_name;
        document.getElementById('cProfileCreds').textContent = coach.credentials || 'No credentials uploaded yet.';
        document.getElementById('cProfileHabits').textContent = coach.habits || 'No training style details available.';
        document.getElementById('cProfileRating').innerHTML = formatStars(coach.average_rating);
        document.getElementById('cProfileReviewCount').textContent = `${coach.review_count || 0} review(s)`;
        document.getElementById('cProfileMax').textContent = coach.max_trainees || 10;

        const avatar = document.getElementById('cProfileAvatar');
        if (coach.profile_image) {
            avatar.innerHTML = `<img src="../${coach.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        } else {
            avatar.textContent = coach.coach_name.split(' ').map(n => n[0]).join('').toUpperCase();
        }

        const photos = Array.isArray(coach.credential_photos) ? coach.credential_photos : [];
        const photosEl = document.getElementById('cProfilePhotos');
        if (photos.length) {
            photosEl.innerHTML = photos.map(p => `
                <div class="col-6 col-md-4">
                    <div class="rounded-3 overflow-hidden border" style="aspect-ratio:4/3;">
                        <img src="../${p.image_path}" style="width:100%;height:100%;object-fit:cover;" alt="Credential">
                    </div>
                </div>
            `).join('');
        } else {
            photosEl.innerHTML = '<div class="col-12"><small class="text-muted">No credential photos uploaded yet.</small></div>';
        }

        const reviews = payload.reviews || [];
        document.getElementById('cProfileReviews').innerHTML = reviews.length
            ? reviews.map(review => `
                <div class="border rounded-3 p-3 bg-light">
                    <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                        <div class="fw-bold">${review.trainee_name}</div>
                        <span class="small text-warning">${formatStars(review.member_rating)}</span>
                    </div>
                    <div class="small text-muted mb-2">${review.completed_at ? new Date(review.completed_at).toLocaleDateString() : 'Recent trainee feedback'}</div>
                    <div class="small">${review.member_feedback || '<span class="text-muted">No written feedback provided.</span>'}</div>
                </div>
            `).join('')
            : '<div class="text-muted small">No trainee feedback yet.</div>';
    } catch (err) {
        document.getElementById('cProfileCreds').textContent = 'Unable to load coach profile right now.';
    }
}

async function viewCoachCalendar(coachId, coachName) {
    const res = await fetch(`../api.php?action=get_coach_availability_public&coach_id=${coachId}`);
    const data = await res.json();
    
    const events = data.availability.map(a => ({
        title: a.status === 'Available' ? '✅ Available' : '❌ Unavailable',
        start: a.available_date,
        backgroundColor: a.status === 'Available' ? '#E8F5E9' : '#FFEBEE',
        borderColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
        textColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
        allDay: true
    }));

    if (!calendar) {
        const calendarEl = document.getElementById('coachCalendar');
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
            events: events
        });
        calendar.render();
    } else {
        calendar.removeAllEvents();
        calendar.addEventSource(events);
    }
}

async function manualAction(type, inputId) {
    const code = document.getElementById(inputId).value;
    if(!code) return;
    
    let options = {
        method: 'POST'
    };

    if (type === 'rfid_login') {
        const formData = new FormData();
        formData.append('rfid', code);
        options.body = formData;
    } else {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ code });
    }
    
    const res = await fetch(`../api.php?action=${type}`, options);
    const result = await res.json();
    
    if(result.status === 'success') {
        document.getElementById(inputId).value = '';
        showAlert('Success', result.message || `User successfully processed`, 'success');
        loadData();
    } else {
        showAlert('Error', result.message || 'Operation failed', 'danger');
    }
}

// Terminal Toggle Logic
const terminalToggle = document.getElementById('terminalToggle');
const scanInput = document.getElementById('unifiedScanInput');
const statusTitle = document.getElementById('terminalStatusTitle');
const statusDesc = document.getElementById('terminalStatusDesc');
const scanIndicator = document.getElementById('scanIndicator');

if (terminalToggle) {
    terminalToggle.addEventListener('change', function() {
        if (this.checked) {
            scanInput.readOnly = false;
            scanInput.placeholder = 'READY TO SCAN...';
            scanInput.focus();
            statusTitle.textContent = 'Terminal Active';
            statusDesc.textContent = 'Hardware scanner ready for use';
            scanIndicator.classList.add('active');
        } else {
            scanInput.readOnly = true;
            scanInput.value = '';
            scanInput.placeholder = 'WAITING...';
            statusTitle.textContent = 'Terminal Locked';
            statusDesc.textContent = 'Switch to Active to begin scanning';
            scanIndicator.classList.remove('active');
        }
    });
}

if (scanInput) {
        let terminalScanTimer = null;
        function scheduleTerminalScan() {
            clearTimeout(terminalScanTimer);
            terminalScanTimer = setTimeout(async () => {
                if (!(terminalToggle && terminalToggle.checked)) return;
                const code = scanInput.value.trim();
                if (code) {
                    await manualAction('unified_scan', 'unifiedScanInput');
                }
            }, 250);
        }

        scanInput.addEventListener('input', scheduleTerminalScan);

        scanInput.addEventListener('keypress', async function(e) {
            if (e.key === 'Enter') {
                const code = this.value.trim();
                if (code) {
                    this.disabled = true;
                    try {
                        const res = await fetch('../api.php?action=unified_scan', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code: code })
                        });
                        const result = await res.json();
                        
                        if (result.status === 'success') {
                            showAlert('Success', result.message, 'success');
                            loadData(); // Refresh attendance list
                        } else {
                            showAlert('Scan Error', result.message, 'danger');
                        }
                    } catch (err) {
                        console.error(err);
                        showAlert('Error', 'Communication error with server', 'danger');
                    }
                    this.value = '';
                    this.disabled = false;
                    this.focus();
                }
            }
        });

        // Auto-focus if active
        document.addEventListener('click', () => {
            if (terminalToggle && terminalToggle.checked) {
                scanInput.focus();
            }
        });
}

function showAlert(title, message, type) {
    const container = document.getElementById('alertContainer');
    const div = document.createElement('div');
    div.className = `alert alert-${type} alert-dismissible fade show shadow-sm border-0 mb-4`;
    div.innerHTML = `
        <strong>${title}!</strong> ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    container.prepend(div);
    setTimeout(() => { div.remove(); }, 4000);
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

document.getElementById('confirmModalConfirm')?.addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
    if (confirmModal) confirmModal.hide();
});

document.getElementById('memberSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allMembers.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || (m.rfid && m.rfid.toLowerCase().includes(q)));
    renderMembers(filtered);
});

async function toggleStatus(id, newStatus) {
    const icon = newStatus === 'Deactivated'
        ? '<i class="bi bi-person-x text-danger"></i>'
        : '<i class="bi bi-person-check text-success"></i>';
    const btnClass = newStatus === 'Deactivated' ? 'btn-danger' : 'btn-success';

    showConfirm(
        newStatus === 'Deactivated' ? 'Deactivate Member' : 'Activate Member',
        `Are you sure you want to ${newStatus.toLowerCase()} this member?`,
        icon,
        newStatus === 'Deactivated' ? 'Deactivate' : 'Activate',
        btnClass,
        async () => {
            const res = await fetch('../api.php?action=toggle_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ member_id: id, new_status: newStatus })
            });
            const result = await res.json();
            if(result.status === 'success') {
                showAlert('Updated', `User status changed to ${newStatus}`, 'success');
                loadData();
            }
        }
    );
}

// Registration logic update for roles with no plan
document.getElementById('regRole').addEventListener('change', function() {
    const planGroup = document.getElementById('regPlan').closest('.col-md-4');
    if (this.value === 'Temporary' || this.value === 'Coach') {
        planGroup.style.display = 'none';
    } else {
        planGroup.style.display = 'block';
    }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = document.getElementById('regRole').value;
    const noPlanRoles = ['Temporary', 'Coach', 'Staff', 'Admin'];
    const payload = {
        name: document.getElementById('regName').value,
        gender: document.getElementById('regGender').value,
        age: document.getElementById('regAge').value,
        role: role,
        rfid: document.getElementById('regRfid').value,
        duration_days: noPlanRoles.includes(role) ? 9999 : document.getElementById('regPlan').value
    };

    const res = await fetch('../api.php?action=create_member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if(result.status === 'success') {
        showAlert('Success', 'Registration complete!', 'success');
        document.getElementById('registerForm').reset();
        // Reset plan group visibility if it was hidden
        document.getElementById('regPlan').closest('.col-md-4').style.display = 'block';
        loadData();
    } else {
        showAlert('Error', result.message, 'danger');
    }
});

document.getElementById('staffIssueForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        category: document.getElementById('staffReportCategory').value,
        issue: document.getElementById('staffReportIssue').value
    };
    const res = await fetch('../api.php?action=submit_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if(result.status === 'success') {
        showAlert('Report Submitted', 'Your issue has been reported successfully', 'success');
        document.getElementById('staffIssueForm').reset();
        loadData();
    } else {
        showAlert('Submission Failed', result.message, 'danger');
    }
});

document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('../api.php?action=logout');
    window.location.href = '../login/Login.html';
});

function generateRFID() {
    const hex = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
    document.getElementById('regRfid').value = hex;
}


// Hardware bridge for Terminal
async function pollHardwareTerminal() {
    try {
        const res = await fetch('../api.php?action=get_last_scan');
        const data = await res.json();
        
        if (data.status === 'success' && data.rfid) {
            const rfid = data.rfid;
            console.log('[RFID Poll] New scan detected:', rfid);

            // 1. Auto-fill Registration RFID if field exists
            const regInput = document.getElementById('regRfid');
            if (regInput) {
                regInput.value = rfid;
                regInput.classList.add('is-valid');
                setTimeout(() => regInput.classList.remove('is-valid'), 2000);
            }

            // 2. Auto-fill Edit RFID modal input if modal is open
            const editRfidInput = document.getElementById('editRfidNew');
            if (editRfidInput && document.getElementById('editRfidModal')?.classList.contains('show')) {
                editRfidInput.value = rfid;
                editRfidInput.classList.add('is-valid');
                setTimeout(() => editRfidInput.classList.remove('is-valid'), 2000);
            }

            // 3. Handle Terminal Scan if toggle is active
            const toggle = document.getElementById('terminalToggle');
            const termInput = document.getElementById('unifiedScanInput');
            
            if (termInput) {
                termInput.value = rfid;
                termInput.classList.add('bg-success', 'text-white');
                
                if (toggle && toggle.checked) {
                    // Process scan automatically
                    const scanRes = await fetch('../api.php?action=unified_scan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: rfid })
                    });
                    const scanResult = await scanRes.json();
                    
                    if (scanResult.status === 'success') {
                        showAlert('Success', scanResult.message, 'success');
                        loadData();
                    } else {
                        showAlert('Error', scanResult.message || 'Scan failed', 'danger');
                    }
                }
                
                setTimeout(() => {
                    termInput.value = '';
                    termInput.classList.remove('bg-success', 'text-white');
                }, 2000);
            }

            // Consume the scan so it's not processed again by this or other polls
            await fetch('../api.php?action=consume_last_scan');
        }
    } catch (e) {
        console.error('[RFID Poll] Fetch Error:', e);
    }
}

setInterval(pollHardwareTerminal, 2000);

setInterval(() => {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleDateString('en-US', { 
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' 
    }) + ' | ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}, 1000);

function renderAttendanceChart(data) {
    const ctx = document.getElementById('monthlyAttendanceChart');
    if (!ctx) return;

    if (attendanceChart) {
        attendanceChart.destroy();
    }

    const labels = data.map(d => {
        const [year, month, day] = d.month.split('-');
        const date = new Date(year, month - 1, day);
        return date.toLocaleString('default', { month: 'short', day: 'numeric' });
    });
    const counts = data.map(d => d.count);

    // Initialize the tooltip with the first data point
    if (labels.length > 0 && counts.length > 0) {
        document.getElementById('chartTooltip').textContent = `${labels[0]}: ${counts[0]} attendees`;
    }

    attendanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Monthly Attendance',
                data: counts,
                borderColor: '#000',
                backgroundColor: 'rgba(0, 0, 0, 0.05)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#000',
                pointRadius: 0, // Hide default points
                pointHoverRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: false // Disable default tooltip, use our own
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { stepSize: Math.max(1, Math.floor(Math.max(...counts)/5)) }
                },
                x: {
                    grid: { display: false }
                }
            },
            onHover: function(e, elements) {
                const el = ctx;
                el.style.cursor = 'crosshair';
                const points = attendanceChart.getElementsAtEventForMode(e, 'nearest', { intersect: false }, true);
                if (points.length > 0) {
                    const index = points[0].index;
                    const label = labels[index];
                    const count = counts[index];
                    document.getElementById('chartTooltip').textContent = `${label}: ${count} attendees`;
                }
            }
        },
        plugins: [{
            id: 'customIndicator',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                // Find the nearest point to the mouse, or default to index 0
                let index = 0;
                if (chart.lastHoverIndex !== undefined) {
                    index = chart.lastHoverIndex;
                }
                if (index < 0 || index >= data.length) index = 0;
                
                // Get position of the point
                const meta = chart.getDatasetMeta(0);
                const point = meta.data[index];
                if (!point) return;
                
                // Draw the movable bullet (a big circle)
                ctx.save();
                ctx.fillStyle = '#FFD700';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }]
    });

    // Track last hovered index
    ctx.addEventListener('mousemove', (e) => {
        const points = attendanceChart.getElementsAtEventForMode(e, 'nearest', { intersect: false }, true);
        if (points.length > 0) {
            attendanceChart.lastHoverIndex = points[0].index;
            attendanceChart.update('none');
        }
    });

    // Reset to 0 when mouse leaves
    ctx.addEventListener('mouseleave', () => {
        attendanceChart.lastHoverIndex = 0;
        if (labels.length > 0 && counts.length > 0) {
            document.getElementById('chartTooltip').textContent = `${labels[0]}: ${counts[0]} attendees`;
        }
        attendanceChart.update('none');
    });
}

// Web Serial API Implementation for USB RFID
let serialPort = null;
let serialReader = null;
let serialKeepReading = true;
let serialConnected = false;
const RFID_BAUD_RATES = [115200, 9600, 57600, 38400, 19200];
const RFID_USB_FILTERS = [
    { usbVendorId: 0x2341 },
    { usbVendorId: 0x2A03 },
    { usbVendorId: 0x1A86 },
    { usbVendorId: 0x10C4 },
    { usbVendorId: 0x0403 }
];

function lineLooksLikeValidData(line) {
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

function extractRFID(rawLine) {
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

function setUsbButtonState(connected) {
    const buttons = [
        document.getElementById('usbConnectBtn'),
        document.getElementById('regUsbConnectBtn'),
        document.getElementById('editRfidUsbBtn')
    ];
    buttons.forEach(btn => {
        if (!btn) return;
        if (connected) {
            btn.classList.remove('btn-outline-dark', 'btn-outline-success');
            btn.classList.add('btn-success');
            btn.title = 'RFID Reader Connected — click to disconnect';
        } else {
            btn.classList.remove('btn-success');
            if (btn.id === 'regUsbConnectBtn') btn.classList.add('btn-outline-success');
            else btn.classList.add('btn-outline-dark');
            btn.title = 'Connect USB RFID Reader';
        }
    });
}

async function disconnectUSB() {
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
    setUsbButtonState(false);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function openSerialAtBaud(port, baudRate) {
    try {
        await port.open({
            baudRate: baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
        });
        try {
            if (port.setSignals) {
                await port.setSignals({ dataTerminalReady: true, requestToSend: true });
            }
        } catch (_) {}
        return true;
    } catch (e) {
        console.warn(`[USB] open() at ${baudRate} failed:`, e.message);
        return false;
    }
}

async function probeBaud(port, baudRate, probeMs) {
    console.log(`[USB] Probing baud ${baudRate} for ${probeMs}ms...`);
    const decoder = new TextDecoder();
    let buffer = '';
    let reader = null;
    let gotData = false;
    let timedOut = false;

    const timeoutId = setTimeout(() => { timedOut = true; if (reader) { try { reader.cancel(); } catch (_) {} } }, probeMs);

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
                        if (lineLooksLikeValidData(l)) {
                            console.log(`[USB] Matched valid line at ${baudRate}:`, l.trim());
                            gotData = true;
                            clearTimeout(timeoutId);
                            try { reader.cancel(); } catch (_) {}
                            break;
                        }
                    }
                    if (gotData) break;
                }
            } catch (e) {
                if (e && e.name !== 'BreakError') console.debug(`[USB] probe read loop at ${baudRate}:`, e?.message || e);
            } finally {
                try { reader.releaseLock(); } catch (_) {}
                reader = null;
            }
            if (gotData || timedOut) break;
        }
    } catch (outer) {
        console.debug(`[USB] probe outer for ${baudRate}:`, outer?.message || outer);
    } finally {
        clearTimeout(timeoutId);
    }
    return gotData;
}

async function tryForceHandshake(port) {
    try {
        if (!port || !port.writable) return false;
        const writer = port.writable.getWriter();
        try {
            const enc = new TextEncoder();
            await writer.write(enc.encode('\r\nPING\r\n'));
            await sleep(150);
            await writer.write(enc.encode('STATUS?\n'));
            return true;
        } finally {
            try { writer.releaseLock(); } catch (_) {}
        }
    } catch (_) { return false; }
}

async function pickBaudManually(triedList) {
    const msg =
        'Auto-detect could not find a match at these baud rates: ' + triedList.join(', ') + '\n\n' +
        'Your sketch sets: Serial.begin(115200);\n' +
        'Pick the baud rate from your Arduino sketch:\n\n' +
        '  1) 115200    (most common for MFRC522 sketches)\n' +
        '  2) 9600\n' +
        '  3) 57600\n' +
        '  4) 38400\n' +
        '  5) 19200\n' +
        '  0) Cancel\n\n' +
        'TIP: Verify Arduino Serial Monitor is closed first (it locks the COM port).';
    const choice = prompt(msg, '1');
    if (choice === null) return null;
    switch (choice.trim()) {
        case '1': return 115200;
        case '2': return 9600;
        case '3': return 57600;
        case '4': return 38400;
        case '5': return 19200;
        default: return parseInt(choice.trim(), 10) || null;
    }
}

async function establishConnection(port) {
    let baud = null;
    let usedManual = false;

    const info = port.getInfo ? port.getInfo() : {};
    const vid = info.usbVendorId || 0;
    const isFTDI = vid === 0x0403;
    const skipProbe = isFTDI;

    if (skipProbe) {
        console.log(`[USB] VID=0x${vid.toString(16).toUpperCase()} (FTDI FT232R) detected — SKIP probe, lock to 115200 immediately.`);
        const ok = await openSerialAtBaud(port, 115200);
        if (!ok) {
            return { ok: false, reason: 'FTDI_OPEN_FAIL', baud: 115200 };
        }
        baud = 115200;
        try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
        return { ok: true, baud, usedManual: false, fastBypass: true };
    }

    for (const rate of RFID_BAUD_RATES) {
        const ok = await openSerialAtBaud(port, rate);
        if (!ok) {
            console.warn(`[USB] Could not open() port at ${rate}`);
            try { await port.close(); } catch (_) {}
            continue;
        }
        await sleep(1800);
        tryForceHandshake(port);
        const matched = await probeBaud(port, rate, 2500);
        if (matched) {
            baud = rate;
            console.log(`[USB] Auto-detected correct baud: ${rate}`);
            break;
        } else {
            console.warn(`[USB] No valid data at ${rate} — will retry next baud`);
        }
        try { await port.close(); } catch (_) {}
        await sleep(200);
    }

    if (!baud) {
        const manual = await pickBaudManually(RFID_BAUD_RATES);
        if (!manual) { return { ok: false, reason: 'NO_BAUD_PICKED' }; }
        const ok = await openSerialAtBaud(port, manual);
        if (!ok) { return { ok: false, reason: 'MANUAL_OPEN_FAILED', baud: manual }; }
        await sleep(2200);
        baud = manual;
        usedManual = true;
    }

    try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}

    return { ok: true, baud, usedManual };
}

function formatRawError(e) {
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
        await disconnectUSB();
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
            console.warn('[USB] requestPort(filters=[]) failed, retrying with vendor filters:', retry1);
            port = await navigator.serial.requestPort({ filters: RFID_USB_FILTERS });
        }
    } catch (selErr) {
        console.error('[USB] requestPort() threw raw error:', selErr);
        const raw = formatRawError(selErr);
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

    await disconnectUSB();
    serialPort = port;

    const info = port.getInfo ? port.getInfo() : null;
    if (info) console.log('[USB] Selected port info:', info);

    let est;
    try {
        est = await establishConnection(serialPort);
    } catch (estErr) {
        console.error('[USB] establishConnection() crashed with:', estErr);
        showAlert(
            'USB Connect Failed (establish)',
            `Port was picked, but opening COM port failed.\n\nRaw error:\n${formatRawError(estErr)}\n\n` +
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
        } else if (est.reason === 'MANUAL_OPEN_FAILED') {
            showAlert(
                'Port Open Failed',
                `Could not open the port at manual baud ${est.baud}.\n\n` +
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
    setUsbButtonState(true);
    const bypass = est.fastBypass ? ' (FTDI fast-connect)' : '';
    const hintBaud = est.usedManual ? ` (you picked ${est.baud})` : ` @ ${est.baud}`;
    showAlert('USB Connected', `RFID Reader ready${hintBaud}${bypass}. Scan a card now.`, 'success');

    serialPort.addEventListener('disconnect', async () => {
        console.warn('[USB] Device disconnected.');
        serialConnected = false;
        setUsbButtonState(false);
        showAlert('USB Disconnected', 'The Arduino/RFID reader was unplugged.', 'warning');
    });

    const decoder = new TextDecoder();
    let buffer = '';
    let lastScannedRfid = '';
    let lastScannedAt = 0;
    const DEDUP_MS = 1200;

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
                        const trimmed = rawLine.trim();
                        if (!trimmed) continue;
                        if (/^USB[_ -]?READY\b/i.test(trimmed)) {
                            console.log('[USB] Handshake received: reader booted OK ✅');
                            continue;
                        }
                        const rfid = extractRFID(rawLine);
                        if (!rfid) continue;

                        const now = Date.now();
                        if (rfid === lastScannedRfid && (now - lastScannedAt) < DEDUP_MS) continue;
                        lastScannedRfid = rfid;
                        lastScannedAt = now;

                        console.log('[USB Serial] Scanned Tag:', rfid, '(raw:', rawLine.trim(), ')');
                        handleScannedRFID(rfid);
                    }
                }
            } catch (loopErr) {
                if (loopErr && loopErr.name === 'BreakError') {
                    console.log('[USB] Reader loop cancelled (disconnect requested).');
                    break;
                }
                console.error('[USB] Serial Read Error:', loopErr);
                showAlert(
                    'USB Read Error',
                    `Serial stream crashed mid-read.\n\nRaw error:\n${formatRawError(loopErr)}\n\n` +
                    'Likely: Arduino lost power or USB cable was jostled. Re-plug and retry.',
                    'warning'
                );
            } finally {
                try { reader.releaseLock(); } catch (e) {}
                if (serialReader === reader) serialReader = null;
            }
        }
    } catch (outerErr) {
        console.error('[USB] Serial port loop error:', outerErr);
    } finally {
        if (serialConnected) {
            serialConnected = false;
            setUsbButtonState(false);
            try { await serialPort.close(); } catch (e) {}
        }
        serialPort = null;
    }
}

async function autoConnectLastUsb() {
    if (!("serial" in navigator)) return;
    try {
        const ports = await navigator.serial.getPorts();
        if (!ports || ports.length === 0) return;
        console.log('[USB] Found', ports.length, 'previously authorized port(s) — auto-connecting.');
        const port = ports[0];
        await disconnectUSB();
        serialPort = port;

        const est = await establishConnection(serialPort);
        if (!est.ok) {
            console.warn('[USB] Auto-connect: baud detection failed, giving up silently.');
            try { await serialPort.close(); } catch (_) {}
            serialPort = null;
            return;
        }

        serialConnected = true;
        serialKeepReading = true;
        setUsbButtonState(true);

        port.addEventListener('disconnect', () => {
            serialConnected = false;
            setUsbButtonState(false);
        });

        const decoder = new TextDecoder();
        let buffer = '';
        let lastScannedRfid = '';
        let lastScannedAt = 0;
        const DEDUP_MS = 1200;

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
                            const trimmed = rawLine.trim();
                            if (!trimmed) continue;
                            if (/^USB[_ -]?READY\b/i.test(trimmed)) continue;
                            const rfid = extractRFID(rawLine);
                            if (!rfid) continue;
                            const now = Date.now();
                            if (rfid === lastScannedRfid && (now - lastScannedAt) < DEDUP_MS) continue;
                            lastScannedRfid = rfid;
                            lastScannedAt = now;
                            console.log('[USB Auto] Scanned Tag:', rfid);
                            handleScannedRFID(rfid);
                        }
                    }
                } finally {
                    try { reader.releaseLock(); } catch (e) {}
                }
            }
        } catch (e) {
            console.warn('[USB Auto] Port loop ended:', e?.message || e);
        }
    } catch (e) {
        console.warn('[USB Auto] Skipped auto-connect:', e?.message || e);
    }
}

function handleScannedRFID(rfid) {
    // 1. Auto-fill Registration RFID
    const regInput = document.getElementById('regRfid');
    if (regInput) {
        regInput.value = rfid;
        regInput.classList.add('is-valid');
        setTimeout(() => regInput.classList.remove('is-valid'), 2000);
    }

    // 2. Auto-fill Edit RFID modal input
    const editRfidInput = document.getElementById('editRfidNew');
    if (editRfidInput && document.getElementById('editRfidModal')?.classList.contains('show')) {
        editRfidInput.value = rfid;
        editRfidInput.classList.add('is-valid');
        setTimeout(() => editRfidInput.classList.remove('is-valid'), 2000);
    }

    // 3. Handle Terminal Scan
    const termInput = document.getElementById('unifiedScanInput');
    const toggle = document.getElementById('terminalToggle');

    if (termInput) {
        termInput.value = rfid;
        termInput.classList.add('bg-success', 'text-white');

        if (toggle && toggle.checked) {
            fetch('../api.php?action=unified_scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: rfid })
            })
            .then(res => res.json())
            .then(scanResult => {
                if (scanResult.status === 'success') {
                    showAlert('Success', scanResult.message, 'success');
                    loadData();
                } else {
                    showAlert('Error', scanResult.message || 'Scan failed', 'danger');
                }
            });
        }

        setTimeout(() => {
            termInput.value = '';
            termInput.classList.remove('bg-success', 'text-white');
        }, 2000);
    }
}

// Add event listeners for USB buttons
document.addEventListener('DOMContentLoaded', () => {
    const usbBtn = document.getElementById('usbConnectBtn');
    if (usbBtn) usbBtn.addEventListener('click', connectUSB);

    const regUsbBtn = document.getElementById('regUsbConnectBtn');
    if (regUsbBtn) regUsbBtn.addEventListener('click', connectUSB);

    const editRfidUsbBtn = document.getElementById('editRfidUsbBtn');
    if (editRfidUsbBtn) editRfidUsbBtn.addEventListener('click', connectUSB);

    autoConnectLastUsb();
});

// Initial load
loadData();

// Member list sorting
let sortColumn = null;
let sortDirection = 1; // 1 = ascending, -1 = descending
function updateSortIndicators() {
    // Reset all sort icons
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.className = 'sort-icon bi';
    });
    if (sortColumn) {
        // Set the active sort icon
        const activeHeaders = document.querySelectorAll(`th[data-column="${sortColumn}"] .sort-icon`);
        activeHeaders.forEach(icon => {
            icon.classList.add(sortDirection === 1 ? 'bi-arrow-down' : 'bi-arrow-up');
        });
    }
}
function sortMembers(column) {
    if (sortColumn === column) {
        sortDirection *= -1;
    } else {
        sortColumn = column;
        sortDirection = 1;
    }
    allMembers.sort((a, b) => {
        let valA = a[column] || '';
        let valB = b[column] || '';
        if (typeof valA === 'string') {
            return valA.toLowerCase().localeCompare(valB.toLowerCase()) * sortDirection;
        } else {
            return (valA - valB) * sortDirection;
        }
    });
    renderMembers(allMembers);
    updateSortIndicators();
}

// Coach monitor - editable availability
async function viewCoachCalendar(coachId, coachName) {
    selectedCoachId = coachId;
    const response = await fetch(`../api.php?action=get_coach_availability_public&coach_id=${coachId}`);
    const data = await response.json();
    
    const events = data.availability.map(a => ({
        title: a.status === 'Available' ? '✅ Available' : '❌ Unavailable',
        start: a.available_date,
        backgroundColor: a.status === 'Available' ? '#E8F5E9' : '#FFEBEE',
        borderColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
        textColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
        allDay: true
    }));

    if (!calendar) {
        const calendarEl = document.getElementById('coachCalendar');
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
            events: events,
            dateClick: function(info) {
                toggleCoachAvailability(info.dateStr);
            },
            eventClick: function(info) {
                info.jsEvent.preventDefault();
                toggleCoachAvailability(info.event.startStr);
            }
        });
        calendar.render();
    } else {
        calendar.removeAllEvents();
        calendar.addEventSource(events);
    }
}

async function toggleCoachAvailability(dateStr) {
    if (!selectedCoachId) return;
    // Get current status
    let newStatus = 'Available';
    const currentEvents = calendar.getEvents();
    for (let e of currentEvents) {
        if (e.startStr === dateStr) {
            newStatus = e.title.includes('Available') ? 'Unavailable' : 'Available';
            break;
        }
    }
    // Call API to update
    const coach = allCoaches.find(c => c.coach_id === selectedCoachId);
    try {
        // We need to use update_availability, which requires the coach to be logged in as coach
        // For staff, we'll add a new action to api.php
        const response = await fetch('../api.php?action=staff_update_coach_availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coach_id: selectedCoachId,
                date: dateStr,
                status: newStatus
            })
        });
        const result = await response.json();
        if (result.status === 'success') {
            showAlert('Success', 'Availability updated', 'success');
            viewCoachCalendar(selectedCoachId, coach?.coach_name || '');
        } else {
            showAlert('Error', result.message || 'Failed to update availability', 'danger');
        }
    } catch (err) {
        console.error(err);
        showAlert('Error', 'Failed to update availability', 'danger');
    }
}

// Settings functionality
async function loadSettings() {
    try {
        const response = await fetch('../api.php?action=get_profile');
        const data = await response.json();
        if (data.status === 'success') {
            const profile = data.profile;
            document.getElementById('settingsName').value = profile.name || '';
            document.getElementById('settingsEmail').value = profile.email || '';
            document.getElementById('settingsPhone').value = profile.phone || '';
            document.getElementById('settingsAddress').value = profile.address || '';
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
}

document.getElementById('profileSettingsForm').addEventListener('submit', async function(e) {
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
            showAlert('Success', 'Profile updated', 'success');
            loadData(); // Refresh user info
        } else {
            showAlert('Error', result.message || 'Failed to update profile', 'danger');
        }
    } catch (err) {
        console.error(err);
        showAlert('Error', 'Server error', 'danger');
    }
});

const securityQuestionsForm = document.getElementById('securityQuestionsForm');
if (securityQuestionsForm) {
    const secSel = document.getElementById('secQuestionSelect');
    if (secSel) {
        secSel.addEventListener('change', function() {
            const wrap = document.getElementById('customQuestionWrap');
            if (secSel.value === 'custom') {
                wrap.style.display = 'block';
            } else {
                wrap.style.display = 'none';
            }
        });
    }
    securityQuestionsForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const sel = document.getElementById('secQuestionSelect').value;
        let question = sel;
        if (sel === 'custom') {
            question = document.getElementById('secCustomQuestion').value.trim();
            if (!question) {
                showAlert('Error', 'Please enter your custom security question', 'danger');
                return;
            }
        }
        const answer = document.getElementById('secAnswer').value;
        if (!question || !answer) {
            showAlert('Error', 'Both security question and answer are required', 'danger');
            return;
        }
        try {
            const response = await fetch('../api.php?action=save_security_questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: question,
                    answer: answer
                })
            });
            const result = await response.json();
            if (result.status === 'success') {
                showAlert('Success', result.message, 'success');
            } else {
                showAlert('Error', result.message || 'Failed to save security question', 'danger');
            }
        } catch (err) {
            console.error(err);
            showAlert('Error', 'Server error', 'danger');
        }
    });
}

document.getElementById('changePasswordForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    if (newPassword !== confirmNewPassword) {
        showAlert('Error', 'Passwords do not match', 'danger');
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
            showAlert('Success', result.message, 'success');
            document.getElementById('changePasswordForm').reset();
        } else {
            showAlert('Error', result.message || 'Failed to update password', 'danger');
        }
    } catch (err) {
        console.error(err);
        showAlert('Error', 'Server error', 'danger');
    }
});

// Attendance history date navigation
function updateHistoryDateInput() {
    document.getElementById('historyDate').value = formatLocalDate(historyDate);
}

document.getElementById('prevDayBtn').addEventListener('click', function() {
    historyDate.setDate(historyDate.getDate() - 1);
    updateHistoryDateInput();
    renderHistoryAttendance(staffData.attendance || [], historyDate); // Need to have staffData stored
});

document.getElementById('nextDayBtn').addEventListener('click', function() {
    historyDate.setDate(historyDate.getDate() + 1);
    updateHistoryDateInput();
    renderHistoryAttendance(staffData.attendance || [], historyDate);
});

document.getElementById('historyDate').addEventListener('change', function(e) {
    historyDate = new Date(e.target.value);
    renderHistoryAttendance(staffData.attendance || [], historyDate);
});



// Re-render calendar when tab is shown
document.querySelector('a[href="#coach-monitor"]').addEventListener('shown.bs.tab', function() {
    if (calendar) calendar.render();
});

let memberInfoModalInstance;
function viewMemberInfo(id) {
    const dataSource = (typeof allMembers !== 'undefined') ? allMembers :
                       ((typeof allUsers !== 'undefined') ? allUsers : null);
    const m = dataSource ? dataSource.find(u => u.id === id) : null;
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
    setText('mInfoStart', m.start_date);
    const statusEl = document.getElementById('mInfoStatus');
    if (statusEl) {
        const st = m.status || 'Active';
        statusEl.innerHTML = `<span class="status-badge ${st === 'Active' ? 'status-active' : (st === 'Expired' ? 'status-expired' : 'status-deactivated')}">${st}</span>`;
    }
    setText('mInfoEmail', m.email);
    setText('mInfoPhone', m.phone);
    setText('mInfoAddress', m.address);
    setText('mInfoCoach', m.coach_name, 'None Assigned');
    setText('mInfoExpiry', (m.duration_days === 'Permanent') ? 'Permanent (no expiry)' : m.expires_on);
    setText('mInfoMedical', m.medical_condition, 'No medical conditions on file.');
    if (!memberInfoModalInstance) {
        memberInfoModalInstance = new bootstrap.Modal(document.getElementById('memberInfoModal'));
    }
    memberInfoModalInstance.show();
}

let editRfidModalInstance = null;
function openEditRfid(id) {
    const dataSource = (typeof allMembers !== 'undefined') ? allMembers :
                       ((typeof allUsers !== 'undefined') ? allUsers : null);
    const m = dataSource ? dataSource.find(u => u.id === id) : null;
    if (!m) {
        showAlert('Not Found', 'Member data could not be located', 'warning');
        return;
    }
    document.getElementById('editRfidMemberId').value = m.id;
    document.getElementById('editRfidMemberName').textContent = m.name || 'Unknown';
    document.getElementById('editRfidCurrent').textContent = m.rfid || 'None';
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
        showAlert('Error', 'Please enter or scan a new RFID code', 'danger');
        document.getElementById('editRfidNew').focus();
        return;
    }
    if (!member_id) {
        showAlert('Error', 'Member not found. Close the modal and try again.', 'danger');
        return;
    }
    fetch('../api.php?action=update_rfid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: member_id, new_rfid: new_rfid })
    }).then(r => r.json()).then(result => {
        if (result.status === 'success') {
            showAlert('Success', result.message, 'success');
            if (editRfidModalInstance) editRfidModalInstance.hide();
            loadData();
        } else {
            showAlert('Error', result.message || 'Failed to update RFID', 'danger');
        }
    }).catch(err => {
        console.error(err);
        showAlert('Error', 'Server error', 'danger');
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
