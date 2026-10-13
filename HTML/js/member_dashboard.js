let calendar;
let availabilityCalendar;
let routineModal;
let coachModal;
let availabilityModal;
let resignCoachModal;
let allCoaches = [];
let myCoach = null;

async function loadData() {
    const res = await fetch('../api.php?action=get_member_data');
    if (res.status === 403) { window.location.href = '../login/Login.html'; return; }
    const data = await res.json();
    if (data.status === 'success') {
        const user = data.user;
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userInitials').textContent = user.name.split(' ').map(n => n[0]).join('').toUpperCase();
        
        // Set profile image if exists
        if (user.profile_image) {
            const avatar = document.getElementById('userInitials');
            avatar.innerHTML = `<img src="../${user.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        }
        
        allCoaches = data.coaches || [];
        myCoach = data.my_coach || null;
        renderSub(data.subscription);
        renderTodayWorkouts(data.today_workouts || [], data.today_name || 'Today');
        renderCoaches(allCoaches, myCoach);
        renderMyCoach(myCoach);
        renderRoutines(data.routines);
        renderReports(data.reports);
        initCalendar(data.attendance, data.subscription);
        loadNotifications();
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

// Settings Logic
document.querySelector('a[href="#settings"]').addEventListener('shown.bs.tab', async () => {
    const res = await fetch('../api.php?action=get_profile');
    const data = await res.json();
    if (data.status === 'success') {
        const p = data.profile;
        document.getElementById('setName').value = p.name;
        document.getElementById('setUserName').value = p.username || 'N/A';
        document.getElementById('setGender').value = p.gender || 'Male';
        document.getElementById('setEmail').value = p.email || '';
        document.getElementById('setPhone').value = p.phone || '';
        document.getElementById('setAddress').value = p.address || '';
        
        if (p.role === 'Member') {
            document.getElementById('medicalField').style.display = 'block';
            document.getElementById('setMedical').value = p.medical_condition || '';
        }

        const avatar = document.getElementById('settingsAvatar');
        if (p.profile_image) {
            avatar.innerHTML = `<img src="../${p.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        } else {
            avatar.textContent = p.name.split(' ').map(n => n[0]).join('').toUpperCase();
        }
    }
});

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', document.getElementById('setName').value);
    formData.append('gender', document.getElementById('setGender').value);
    formData.append('email', document.getElementById('setEmail').value);
    formData.append('phone', document.getElementById('setPhone').value);
    formData.append('address', document.getElementById('setAddress').value);
    formData.append('medical_condition', document.getElementById('setMedical').value);
    
    const fileInput = document.getElementById('profileUpload');
    if (fileInput.files[0]) {
        formData.append('profile_image', fileInput.files[0]);
    }

    const res = await fetch('../api.php?action=update_profile', {
        method: 'POST',
        body: formData
    });
    
    const result = await res.json();
    if (result.status === 'success') {
        showAlert('Updated', 'Profile updated successfully', 'success');

        // Store the preview URL before loadData potentially resets it
        const previewImg = document.getElementById('settingsPreviewImg');
        const previewSrc = previewImg ? previewImg.src : null;
        const newName = document.getElementById('setName').value;

        // Call loadData and wait for it to complete
        await loadData();

        // Then apply the preview image to top avatar after loadData completes
        if (previewSrc) {
            const topAvatar = document.getElementById('userInitials');
            if (topAvatar) {
                topAvatar.innerHTML = '';
                topAvatar.style.backgroundImage = `url(${previewSrc})`;
                topAvatar.style.backgroundSize = 'cover';
                topAvatar.style.backgroundPosition = 'center';
            }
        }
        if (newName) {
            document.getElementById('userName').textContent = newName;
        }
    }
});

document.getElementById('profileUpload').addEventListener('change', function(e) {
    if (this.files && this.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const imgEl = document.getElementById('settingsAvatar');
            imgEl.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" id="settingsPreviewImg">`;
        }
        reader.readAsDataURL(this.files[0]);
    }
});

function renderReports(reports) {
    const body = document.getElementById('reportsTableBody');
    body.innerHTML = reports.map(r => `
        <tr>
            <td><span class="badge bg-warning text-dark">${r.category}</span></td>
            <td>${r.issue}</td>
            <td><span class="badge ${r.status === 'Resolved' ? 'bg-success' : (r.status === 'In Progress' ? 'bg-info' : 'bg-secondary')}">${r.status}</span></td>
            <td class="text-muted small">${new Date(r.created_at).toLocaleDateString()}</td>
            <td class="small">${r.resolution || '<span class="text-muted">Pending...</span>'}</td>
        </tr>
    `).join('');
}

function renderSub(sub) {
    const el = document.getElementById('subStatus');
    if (sub) {
        const expires = new Date(sub.expires_on);
        const now = new Date();
        const isExpired = expires < now;
        
        if (isExpired) {
            el.innerHTML = `<span class="badge bg-danger">Expired</span><p class="mt-2 small text-danger">Your plan expired on ${sub.expires_on}</p>`;
        } else {
            el.innerHTML = `<span class="badge bg-success">Active</span><p class="mt-2 small">Expires: ${sub.expires_on}</p>`;
        }
    } else {
        el.innerHTML = `<span class="badge bg-danger">No Active Plan</span>`;
    }
}

function getInitials(name = '') {
    return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase();
}

function formatStars(rating) {
    const value = Number(rating || 0);
    if (!value) return 'Not rated yet';
    return `${'★'.repeat(Math.round(value))}${'☆'.repeat(Math.max(0, 5 - Math.round(value)))} ${value.toFixed(1)}`;
}

function renderTodayWorkouts(workouts, todayName) {
    const title = document.getElementById('todayWorkoutTitle');
    const list = document.getElementById('todayWorkoutList');
    if (title) title.textContent = todayName || 'Today';
    if (!list) return;

    if (!workouts.length) {
        list.innerHTML = '<div class="text-muted small">No workout routine scheduled for today yet.</div>';
        return;
    }

    list.innerHTML = workouts.map(r => `
        <div class="border rounded-3 p-3 bg-light">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                <div>
                    <div class="fw-bold">${r.routine_name}</div>
                    <div class="small text-muted">${r.assigned_by_name ? `Assigned by Coach ${r.assigned_by_name}` : 'Saved in My Workout Routines'}</div>
                </div>
                <span class="badge bg-dark">${r.day_of_week || todayName}</span>
            </div>
            <ul class="small list-unstyled mb-0">
                ${JSON.parse(r.routine_data || '[]').map(ex => `<li>• ${ex.name} (${ex.sets} sets)</li>`).join('')}
            </ul>
        </div>
    `).join('');
}

function renderCoaches(coaches, myCoach) {
    const hasCoach = myCoach && (myCoach.status === 'Active' || myCoach.status === 'Pending');
    document.getElementById('coachList').innerHTML = coaches.map(c => `
        <div class="list-group-item d-flex justify-content-between align-items-center p-3">
            <div class="d-flex align-items-center gap-3">
                ${c.profile_image ? 
                    `<img src="../${c.profile_image}" style="width:45px; height:45px; border-radius:50%; object-fit:cover;">` : 
                    `<div class="user-avatar" style="width:45px; height:45px; font-size: 1rem;">${getInitials(c.coach_name)}</div>`
                }
                <div>
                    <h6 class="mb-0 fw-bold">${c.coach_name}</h6>
                    <small class="text-muted">Max trainees: ${c.max_trainees} • ${c.review_count || 0} review(s)</small>
                </div>
            </div>
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-light border" onclick="viewCoachProfile('${c.id}')">
                    <i class="bi bi-info-circle"></i>
                </button>
                <button class="btn btn-sm btn-light border" onclick="viewCoachAvailability('${c.id}')" title="View availability">
                    <i class="bi bi-calendar3"></i>
                </button>
                <button class="btn btn-sm btn-outline-primary" onclick="applyCoach('${c.id}')" ${hasCoach ? 'disabled title="You already have a coach"' : ''}>Apply</button>
            </div>
        </div>
    `).join('');
}

async function viewCoachAvailability(coachId) {
    const listCoach = allCoaches.find(c => String(c.id) === String(coachId));
    if (!listCoach) return;

    document.getElementById('modalAvailabilityTitle').textContent = `${listCoach.coach_name}'s Availability`;

    const modalEl = document.getElementById('coachAvailabilityModal');
    if (!availabilityModal) {
        availabilityModal = new bootstrap.Modal(modalEl);
    }

    const el = document.getElementById('coachAvailabilityCalendar');
    el.innerHTML = '<div class="text-muted small text-center py-4">Loading availability...</div>';
    availabilityModal.show();

    try {
        const res = await fetch(`../api.php?action=get_coach_availability_public&coach_id=${encodeURIComponent(coachId)}`);
        const payload = await res.json();
        const availability = payload.status === 'success' ? (payload.availability || []) : [];

        const events = availability.map(a => ({
            title: a.status === 'Available' ? 'Available' : 'Unavailable',
            start: a.available_date,
            backgroundColor: a.status === 'Available' ? '#E8F5E9' : '#FFEBEE',
            borderColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
            textColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
            allDay: true
        }));

        // Render after the modal is fully visible so FullCalendar can measure dimensions
        const renderCal = () => {
            if (availabilityCalendar) availabilityCalendar.destroy();
            el.innerHTML = '';
            availabilityCalendar = new FullCalendar.Calendar(el, {
                initialView: 'dayGridMonth',
                height: 'auto',
                headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
                events
            });
            availabilityCalendar.render();
        };

        if (modalEl.classList.contains('show')) {
            renderCal();
        } else {
            modalEl.addEventListener('shown.bs.modal', renderCal, { once: true });
        }
    } catch (err) {
        el.innerHTML = '<div class="text-muted small text-center py-4">Unable to load availability right now.</div>';
    }
}

async function viewCoachProfile(coachId) {
    const listCoach = allCoaches.find(c => String(c.id) === String(coachId));
    if (!listCoach) return;

    document.getElementById('modalCoachName').textContent = `Coach Profile: ${listCoach.coach_name}`;
    document.getElementById('modalCoachTitle').textContent = listCoach.coach_name;
    document.getElementById('modalCoachCreds').textContent = 'Loading credentials...';
    document.getElementById('modalCoachHabits').textContent = 'Loading training style...';
    document.getElementById('modalCoachPhotos').innerHTML = '<div class="col-12"><small class="text-muted">Loading credential photos...</small></div>';
    document.getElementById('modalCoachRating').textContent = 'Loading ratings...';
    document.getElementById('modalCoachReviewCount').textContent = 'Loading...';
    document.getElementById('modalCoachReviews').innerHTML = '<div class="text-muted small">Loading trainee feedback...</div>';

    const avatar = document.getElementById('modalCoachAvatar');
    if (listCoach.profile_image) {
        avatar.innerHTML = `<img src="../${listCoach.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    } else {
        avatar.innerHTML = getInitials(listCoach.coach_name);
    }

    const hasCoach = myCoach && (myCoach.status === 'Active' || myCoach.status === 'Pending');
    const applyBtn = document.getElementById('modalApplyBtn');
    if (hasCoach) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'You already have a coach';
        applyBtn.classList.remove('btn-primary');
        applyBtn.classList.add('btn-secondary');
        applyBtn.onclick = null;
    } else {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply for Coaching';
        applyBtn.classList.remove('btn-secondary');
        applyBtn.classList.add('btn-primary');
        applyBtn.onclick = () => {
            if (coachModal) coachModal.hide();
            applyCoach(listCoach.id);
        };
    }

    if (!coachModal) coachModal = new bootstrap.Modal(document.getElementById('coachProfileModal'));
    coachModal.show();

    const res = await fetch(`../api.php?action=get_coach_profile_public&coach_id=${encodeURIComponent(coachId)}`);
    const payload = await res.json();
    if (payload.status !== 'success') {
        document.getElementById('modalCoachCreds').textContent = 'Unable to load coach profile right now.';
        document.getElementById('modalCoachHabits').textContent = 'Please try again.';
        document.getElementById('modalCoachReviews').innerHTML = '<div class="text-muted small">No feedback available.</div>';
        return;
    }

    const coach = payload.coach;
    document.getElementById('modalCoachName').textContent = `Coach Profile: ${coach.coach_name}`;
    document.getElementById('modalCoachTitle').textContent = coach.coach_name;
    document.getElementById('modalCoachCreds').textContent = coach.credentials || 'No credentials uploaded yet.';
    document.getElementById('modalCoachHabits').textContent = coach.habits || 'No training style details available.';
    document.getElementById('modalCoachRating').textContent = formatStars(coach.average_rating);
    document.getElementById('modalCoachReviewCount').textContent = `${coach.review_count || 0} review(s)`;

    const photos = Array.isArray(coach.credential_photos) ? coach.credential_photos : [];
    const photosEl = document.getElementById('modalCoachPhotos');
    if (photos.length) {
        photosEl.innerHTML = photos.map(p => `
            <div class="col-6 col-md-4">
                <div class="position-relative rounded-3 overflow-hidden border" style="aspect-ratio:4/3;">
                    <img src="../${p.image_path}" style="width:100%;height:100%;object-fit:cover;" alt="Credential">
                </div>
            </div>
        `).join('');
    } else {
        photosEl.innerHTML = '<div class="col-12"><small class="text-muted">No credential photos uploaded yet.</small></div>';
    }

    document.getElementById('modalCoachReviews').innerHTML = (payload.reviews || []).length
        ? payload.reviews.map(review => `
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
}

async function applyCoach(id) {
    const hasCoach = myCoach && (myCoach.status === 'Active' || myCoach.status === 'Pending');
    if (hasCoach) {
        const msg = myCoach.status === 'Active'
            ? 'You already have an active coach. Please resign from your current coach before applying for a new one.'
            : 'You already have a pending coach application. Please wait for it to be approved or cancelled before applying again.';
        showAlert('Cannot Apply', msg, 'warning');
        return;
    }

    showConfirm(
        'Apply for Coach',
        'Are you sure you want to apply for this coach?',
        '<i class="bi bi-person-check text-primary"></i>',
        'Apply',
        'btn-primary',
        async () => {
            const res = await fetch('../api.php?action=apply_coach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ coach_id: id })
            });
            const result = await res.json();
            if (result.status === 'success') {
                showAlert('Success', 'Application submitted successfully', 'success');
                loadData();
            } else {
                showAlert('Error', result.message || 'Failed to apply', 'danger');
            }
        }
    );
}

function showAlert(title, message, type) {
    const container = document.getElementById('alertContainer');
    if (!container) return;
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

function renderMyCoach(mc) {
    const el = document.getElementById('myCoaching');
    if (mc) {
        el.innerHTML = `
            <div class="alert alert-light border mb-0">
                <div class="d-flex align-items-center gap-3 mb-3">
                    ${mc.profile_image ?
                        `<img src="../${mc.profile_image}" style="width:50px; height:50px; border-radius:50%; object-fit:cover;">` :
                        `<div class="user-avatar" style="width:50px; height:50px; font-size: 1.1rem;">${getInitials(mc.coach_name)}</div>`
                    }
                    <div>
                        <h6 class="mb-0">${mc.coach_name}</h6>
                        <p class="small text-muted mb-0">Status: <span class="badge ${mc.status === 'Active' ? 'bg-success' : 'bg-warning'}">${mc.status}</span></p>
                    </div>
                </div>
                <div class="border rounded-3 p-3 bg-white mb-3">
                    <div class="small text-muted text-uppercase fw-bold mb-2">Coach Assessment</div>
                    <div class="fw-bold mb-1">${formatStars(mc.coach_assessment_rating)}</div>
                    <div class="small">${mc.coach_assessment_feedback || '<span class="text-muted">Your coach has not added an assessment yet.</span>'}</div>
                </div>
                <div class="d-flex gap-2 flex-wrap">
                    <button class="btn btn-sm btn-outline-primary" onclick="viewCoachProfile('${mc.coach_id}')">
                        <i class="bi bi-info-circle me-1"></i>View Profile
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="openResignCoachModal('${mc.id}')">
                        <i class="bi bi-person-dash me-1"></i>${mc.status === 'Pending' ? 'Cancel Request' : 'Resign from Coach'}
                    </button>
                </div>
            </div>`;
    } else {
        el.innerHTML = `<p class="text-muted">No active coach</p>`;
    }
}

function renderRoutines(routines) {
    document.getElementById('routineList').innerHTML = routines.map(r => `
        <div class="col-md-4 mb-3">
            <div class="card p-3 h-100">
                <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <h6 class="mb-0">${r.routine_name}</h6>
                    <span class="badge bg-dark">${r.day_of_week || 'No Day'}</span>
                </div>
                <div class="small text-muted mb-2">${r.assigned_by_name ? `Assigned by Coach ${r.assigned_by_name}` : 'Created by you'}</div>
                <ul class="small list-unstyled">
                    ${JSON.parse(r.routine_data || '[]').map(ex => `<li>• ${ex.name} (${ex.sets} sets)</li>`).join('')}
                </ul>
                <small class="text-muted mt-auto">${new Date(r.created_at).toLocaleDateString()}</small>
            </div>
        </div>
    `).join('');
}

function initCalendar(att, sub) {
    const el = document.getElementById('calendar');
    if(calendar) calendar.destroy();
    calendar = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth', height: 'auto',
        dayCellDidMount: (info) => {
            const d = info.date.toISOString().split('T')[0];
            if (att.includes(d)) info.el.classList.add('fc-day-present');
            if (sub && (d < sub.start_date || d > sub.expires_on)) info.el.classList.add('fc-day-not-available');
        }
    });
    calendar.render();
}

function showRoutineModal() {
    if(!routineModal) routineModal = new bootstrap.Modal(document.getElementById('routineModal'));
    document.getElementById('routName').value = '';
    document.getElementById('routineDay').value = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    document.getElementById('exerciseList').innerHTML = '<div class="mb-2 input-group"><input class="form-control" placeholder="Exercise name"><input type="number" class="form-control" placeholder="Sets" style="max-width: 80px;"></div>';
    routineModal.show();
}

function addExerciseField() {
    const div = document.createElement('div');
    div.className = 'mb-2 input-group';
    div.innerHTML = '<input class="form-control" placeholder="Exercise name"><input type="number" class="form-control" placeholder="Sets" style="max-width: 80px;">';
    document.getElementById('exerciseList').appendChild(div);
}

document.getElementById('routineForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const exercises = Array.from(document.getElementById('exerciseList').children).map(div => ({
        name: div.children[0].value,
        sets: div.children[1].value
    })).filter(ex => ex.name);

    await fetch('../api.php?action=save_routine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: document.getElementById('routName').value, day_of_week: document.getElementById('routineDay').value, exercises })
    });
    routineModal.hide();
    loadData();
});

function openResignCoachModal(assignmentId) {
    document.getElementById('resignCoachRating').value = '';
    document.getElementById('resignCoachFeedback').value = '';
    document.getElementById('resignCoachForm').dataset.assignmentId = assignmentId;
    if (!resignCoachModal) resignCoachModal = new bootstrap.Modal(document.getElementById('resignCoachModal'));
    resignCoachModal.show();
}

document.getElementById('resignCoachForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const assignmentId = e.currentTarget.dataset.assignmentId;
    const res = await fetch('../api.php?action=member_end_coaching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assignment_id: assignmentId,
            rating: document.getElementById('resignCoachRating').value,
            feedback: document.getElementById('resignCoachFeedback').value
        })
    });
    const result = await res.json();
    if (result.status === 'success') {
        if (resignCoachModal) resignCoachModal.hide();
        showAlert('Success', result.message || 'Coaching updated successfully', 'success');
        loadData();
    } else {
        showAlert('Error', result.message || 'Unable to update coaching assignment', 'danger');
    }
});

document.getElementById('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await fetch('../api.php?action=submit_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: document.getElementById('repCat').value, issue: document.getElementById('repIssue').value })
    });
    document.getElementById('reportForm').reset();
    showAlert('Success', 'Report submitted successfully', 'success');
    loadData();
});

document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('../api.php?action=logout');
    window.location.href = '../login/Login.html';
});

loadData();
