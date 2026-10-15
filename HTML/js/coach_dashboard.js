let coachCal, traineeCal, routineModal;
let allTrainees = [];
let currentTraineeRoutines = [];
let selectedTraineeId = '';
let selectedAssignmentId = '';

// Credential photos state
let existingPhotos = [];        // [{id, image_path}] from server
let replaceFiles = {};          // {photoId: File}
let removedPhotoIds = [];       // [photoId, ...]
let newPhotoFiles = [];         // [File, ...]

async function loadData(tid = '') {
    const res = await fetch(`../api.php?action=get_coach_data&trainee_id=${tid}`);
    if (res.status === 403) {
        window.location.href = '../index.html';
        return;
    }
    
    const data = await res.json();
    if (data.status !== 'success') return;

    const user = data.user;
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userInitials').textContent = user.name.split(' ').map(n => n[0]).join('').toUpperCase();

    if (user.profile_image) {
        const avatar = document.getElementById('userInitials');
        avatar.innerHTML = `<img src="../${user.profile_image}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    }

    allTrainees = data.trainees || [];
    selectedTraineeId = data.selected_trainee?.member_id || '';
    selectedAssignmentId = data.selected_trainee?.id || '';
    currentTraineeRoutines = data.trainee_routines || [];

    renderTrainees(allTrainees, selectedTraineeId);
    renderPending(data.pending || []);
    fillProfile(data.coach || {});
    renderReports(data.reports || []);
    updateSelectedTraineePanel(data.selected_trainee, currentTraineeRoutines);
    initCoachCal(data.availability || []);
    initTraineeCal(data.trainee_attendance || []);
    loadNotifications();
}

async function loadNotifications() {
    try {
        const res = await fetch('../api.php?action=get_notifications');
        const data = await res.json();
        if (data.status === 'success') {
            renderNotifications(data.notifications);
        }
    } catch (e) {
        console.error(e);
    }
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
    switch (type) {
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

function updateClock() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clockEl = document.getElementById('clock');
    if (clockEl) {
        clockEl.innerHTML = `<i class="bi bi-clock me-2"></i>${dateStr} | ${timeStr}`;
    }
}
updateClock();
setInterval(updateClock, 1000);

document.querySelector('a[href="#settings"]').addEventListener('shown.bs.tab', async () => {
    const res = await fetch('../api.php?action=get_profile');
    const data = await res.json();
    if (data.status !== 'success') return;

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
        
        const topAvatar = document.getElementById('userInitials');
        const settingsAvatarImg = document.querySelector('#settingsAvatar img');
        if (settingsAvatarImg) {
            topAvatar.innerHTML = `<img src="${settingsAvatarImg.src}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        }
        document.getElementById('userName').textContent = document.getElementById('setName').value;
        loadData(selectedTraineeId);
    }
});

document.getElementById('profileUpload').addEventListener('change', function() {
    if (this.files && this.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('settingsAvatar').innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        };
        reader.readAsDataURL(this.files[0]);
    }
});

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
    confirmBtn.className = `btn btn-lg px-5 ${confirmClass || 'btn-brand'}`;
    confirmCallback = callback;
    if (!confirmModal) confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
    confirmModal.show();
}

document.getElementById('confirmModalConfirm')?.addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
    if (confirmModal) confirmModal.hide();
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

function renderTrainees(ts, activeId) {
    const list = document.getElementById('traineeList');
    if (!ts.length) {
        list.innerHTML = '<div class="text-center text-muted small py-4">No active trainees assigned.</div>';
        return;
    }

    list.innerHTML = ts.map(t => `
        <button type="button" class="list-group-item list-group-item-action text-start ${t.member_id === activeId ? 'active' : ''}" onclick="loadData('${t.member_id}')">
            <div class="d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center gap-3">
                    ${t.profile_image ?
                        `<img src="../${t.profile_image}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">` :
                        `<div class="user-avatar" style="width:30px; height:30px; font-size: 0.7rem;">${t.trainee_name.split(' ').map(n => n[0]).join('').toUpperCase()}</div>`
                    }
                    <span>${t.trainee_name}</span>
                </div>
                ${t.medical_condition ? '<i class="bi bi-exclamation-triangle-fill text-warning" title="Has Medical Condition"></i>' : ''}
            </div>
            ${t.member_id === activeId && t.medical_condition ? `<div class="mt-2 p-2 bg-warning-subtle rounded small text-dark"><strong>Medical:</strong> ${t.medical_condition}</div>` : ''}
        </button>
    `).join('');
}

function updateSelectedTraineePanel(trainee, routines) {
    const label = document.getElementById('selectedTraineeLabel');
    const addBtn = document.getElementById('addRoutineBtn');
    const resignBtn = document.getElementById('resignCoachBtn');
    const saveAssessmentBtn = document.getElementById('saveAssessmentBtn');

    if (!trainee) {
        label.textContent = 'Select an active trainee to manage routines and attendance.';
        addBtn.disabled = true;
        resignBtn.disabled = true;
        saveAssessmentBtn.disabled = true;
        document.getElementById('assessmentRating').value = '';
        document.getElementById('assessmentFeedback').value = '';
        renderTraineeRoutines([]);
        return;
    }

    const medicalText = trainee.medical_condition ? ` Medical: ${trainee.medical_condition}` : '';
    label.textContent = `Selected trainee: ${trainee.trainee_name}.${medicalText}`;
    addBtn.disabled = false;
    resignBtn.disabled = false;
    saveAssessmentBtn.disabled = false;
    document.getElementById('assessmentRating').value = trainee.coach_assessment_rating || '';
    document.getElementById('assessmentFeedback').value = trainee.coach_assessment_feedback || '';
    renderTraineeRoutines(routines);
}

function renderTraineeRoutines(routines) {
    const list = document.getElementById('traineeRoutineList');
    currentTraineeRoutines = routines || [];

    if (!currentTraineeRoutines.length) {
        list.innerHTML = '<div class="col-12"><div class="text-center text-muted small py-3">No workout routines saved for this trainee yet.</div></div>';
        return;
    }

    list.innerHTML = currentTraineeRoutines.map(r => `
        <div class="col-md-6">
            <div class="routine-card d-flex flex-column">
                <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
                    <div>
                        <h6 class="fw-bold mb-1">${r.routine_name}</h6>
                        <small class="text-muted">${r.day_of_week || 'No day selected'} • ${new Date(r.created_at).toLocaleDateString()}</small>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-dark" onclick="editRoutine('${r.id}')">
                        <i class="bi bi-pencil-square me-1"></i>Edit
                    </button>
                </div>
                <div class="small text-muted mb-2">${r.assigned_by_name ? `Assigned by Coach ${r.assigned_by_name}` : 'Member-created routine'}</div>
                <ul class="small list-unstyled mb-0">
                    ${JSON.parse(r.routine_data || '[]').map(ex => `<li>• ${ex.name} (${ex.sets} sets)</li>`).join('')}
                </ul>
            </div>
        </div>
    `).join('');
}

function editRoutine(routineId) {
    const routine = currentTraineeRoutines.find(item => String(item.id) === String(routineId));
    if (routine) {
        showRoutineModal(routine);
    }
}

document.getElementById('traineeSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allTrainees.filter(t => t.trainee_name.toLowerCase().includes(q));
    renderTrainees(filtered, selectedTraineeId);
});

function renderPending(ps) {
    const list = document.getElementById('pendingList');
    if (!ps.length) {
        list.innerHTML = '<div class="text-center text-muted small py-4">No pending applications.</div>';
        return;
    }

    list.innerHTML = ps.map(p => `
        <div class="list-group-item d-flex justify-content-between align-items-center gap-3">
            <div class="d-flex align-items-center gap-3">
                ${p.profile_image ?
                    `<img src="../${p.profile_image}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">` :
                    `<div class="user-avatar" style="width:30px; height:30px; font-size: 0.7rem;">${p.trainee_name.split(' ').map(n => n[0]).join('').toUpperCase()}</div>`
                }
                <span>${p.trainee_name}</span>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-success" onclick="manageApp('${p.id}', 'Active')">
                    <i class="bi bi-check-lg"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="manageApp('${p.id}', 'Rejected')">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
        </div>
    `).join('');
}

async function manageApp(aid, status) {
    const actionText = status === 'Active' ? 'Approve' : 'Reject';
    const actionIcon = status === 'Active' ? '<i class="bi bi-check-circle text-success"></i>' : '<i class="bi bi-x-circle text-danger"></i>';
    const btnClass = status === 'Active' ? 'btn-success' : 'btn-danger';

    showConfirm(
        `${actionText} Application`,
        `Are you sure you want to ${actionText.toLowerCase()} this trainee application?`,
        actionIcon,
        actionText,
        btnClass,
        async () => {
            const res = await fetch('../api.php?action=manage_assignment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignment_id: aid, status })
            });
            const result = await res.json();
            if (result.status === 'success') {
                showAlert('Success', `Application ${status === 'Active' ? 'approved' : 'rejected'}`, 'success');
                loadData(selectedTraineeId);
            } else {
                showAlert('Error', result.message || 'Failed to update application', 'danger');
            }
        }
    );
}

function fillProfile(c) {
    document.getElementById('profCreds').value = c.credentials || '';
    document.getElementById('profHabits').value = c.habits || '';
    document.getElementById('profMax').value = c.max_trainees || 10;

    // Reset credential photos state
    existingPhotos = Array.isArray(c.credential_photos) ? c.credential_photos : [];
    replaceFiles = {};
    removedPhotoIds = [];
    newPhotoFiles = [];
    renderCredentialPhotos();
}

function renderCredentialPhotos() {
    const grid = document.getElementById('credentialPhotosGrid');
    grid.innerHTML = '';

    // Existing photos (not removed)
    existingPhotos.forEach(photo => {
        if (removedPhotoIds.includes(photo.id)) return;
        const hasReplace = !!replaceFiles[photo.id];
        const src = hasReplace
            ? URL.createObjectURL(replaceFiles[photo.id])
            : `../${photo.image_path}`;
        const col = document.createElement('div');
        col.className = 'col-6 col-md-4 col-lg-3';
        col.innerHTML = `
            <div class="card h-100 shadow-sm border-0">
                <div class="position-relative" style="aspect-ratio: 4/3; overflow: hidden;">
                    <img src="${src}" style="width:100%; height:100%; object-fit:cover;" class="rounded-top">
                </div>
                <div class="p-2 d-flex gap-1">
                    <button type="button" class="btn btn-sm btn-outline-dark flex-fill" data-edit-photo="${photo.id}">
                        <i class="bi bi-pencil-square"></i> Edit
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-danger flex-fill" data-remove-photo="${photo.id}">
                        <i class="bi bi-trash"></i> Remove
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(col);
    });

    // New pending photos
    newPhotoFiles.forEach((file, idx) => {
        const src = URL.createObjectURL(file);
        const col = document.createElement('div');
        col.className = 'col-6 col-md-4 col-lg-3';
        col.innerHTML = `
            <div class="card h-100 shadow-sm border-0">
                <div class="position-relative" style="aspect-ratio: 4/3; overflow: hidden;">
                    <img src="${src}" style="width:100%; height:100%; object-fit:cover;" class="rounded-top">
                </div>
                <div class="p-2">
                    <button type="button" class="btn btn-sm btn-outline-danger w-100" data-remove-new="${idx}">
                        <i class="bi bi-trash"></i> Remove
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(col);
    });

    if (!grid.children.length) {
        grid.innerHTML = '<div class="col-12"><p class="text-muted small mb-0"><i class="bi bi-image me-1"></i>No photos uploaded yet.</p></div>';
    }
}

function editCredentialPhoto(photoId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        document.body.removeChild(input);
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            showAlert('File Too Large', 'Please select an image smaller than 2MB.', 'warning');
            return;
        }
        replaceFiles[photoId] = file;
        renderCredentialPhotos();
    });
    input.click();
}

function initCoachCal(avs) {
    const el = document.getElementById('coachCalendar');
    if (coachCal) coachCal.destroy();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const events = avs.map(a => ({
        title: a.status === 'Available' ? 'Available' : 'Unavailable',
        start: a.available_date,
        backgroundColor: a.status === 'Available' ? '#E8F5E9' : '#FFEBEE',
        borderColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
        textColor: a.status === 'Available' ? '#2E7D32' : '#C62828',
        allDay: true
    }));

    coachCal = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        height: 'auto',
        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        events,
        validRange: {
            start: today
        },
        dateClick: async (info) => {
            const clicked = new Date(info.dateStr);
            clicked.setHours(0, 0, 0, 0);
            if (clicked < today) {
                showAlert('Invalid Date', 'You cannot set availability for past dates.', 'warning');
                return;
            }
            const existing = avs.find(a => a.available_date === info.dateStr);
            const status = existing && existing.status === 'Available' ? 'Unavailable' : 'Available';
            await fetch('../api.php?action=update_availability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: info.dateStr, status })
            });
            loadData(selectedTraineeId);
        }
    });

    // Only render if the My Schedule tab is currently visible; otherwise
    // the calendar renders with zero width and looks broken until resized.
    const monitorPane = document.getElementById('monitor');
    if (monitorPane && monitorPane.classList.contains('show')) {
        coachCal.render();
    }
}

// Render / re-measure the coach calendar whenever the My Schedule tab becomes visible.
document.querySelectorAll('.nav-link[data-bs-toggle="tab"]').forEach(link => {
    link.addEventListener('shown.bs.tab', (e) => {
        if (e.target.getAttribute('href') === '#monitor') {
            if (coachCal) {
                try { coachCal.render(); } catch (_) { coachCal.updateSize(); }
            }
        }
    });
});

function initTraineeCal(att) {
    const el = document.getElementById('traineeCalendar');
    if (traineeCal) traineeCal.destroy();
    
    const events = att.map(date => ({
        title: 'Present',
        start: date,
        allDay: true,
        backgroundColor: '#E8F5E9',
        borderColor: '#2E7D32',
        textColor: '#2E7D32'
    }));

    traineeCal = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        height: 'auto',
        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        events
    });
    traineeCal.render();
}

function showRoutineModal(routine = null) {
    if (!selectedTraineeId) {
        showAlert('Select a Trainee', 'Choose an active trainee first.', 'warning');
        return;
    }

    document.getElementById('routineModalTitle').textContent = routine ? 'Edit Workout Routine' : 'Add Workout Routine';
    document.getElementById('routineId').value = routine?.id || '';
    document.getElementById('routName').value = routine?.routine_name || '';
    document.getElementById('routineDay').value = routine?.day_of_week || new Date().toLocaleDateString('en-US', { weekday: 'long' });
    document.getElementById('exerciseList').innerHTML = '';

    const exercises = routine ? JSON.parse(routine.routine_data || '[]') : [];
    if (exercises.length) {
        exercises.forEach(exercise => addExerciseField(exercise));
    } else {
        addExerciseField();
    }

    if (!routineModal) {
        routineModal = new bootstrap.Modal(document.getElementById('routineModal'));
    }
    routineModal.show();
}

function addExerciseField(exercise = {}) {
    const div = document.createElement('div');
    div.className = 'mb-2 input-group';
    div.innerHTML = `
        <input class="form-control" placeholder="Exercise name" value="${exercise.name || ''}">
        <input type="number" class="form-control" placeholder="Sets" style="max-width: 100px;" value="${exercise.sets || ''}">
    `;
    document.getElementById('exerciseList').appendChild(div);
}

document.getElementById('addRoutineBtn').addEventListener('click', () => showRoutineModal());

document.getElementById('routineForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const exercises = Array.from(document.getElementById('exerciseList').children).map(div => ({
        name: div.children[0].value.trim(),
        sets: div.children[1].value.trim()
    })).filter(ex => ex.name);

    const payload = {
        routine_id: document.getElementById('routineId').value || null,
        member_id: selectedTraineeId,
        name: document.getElementById('routName').value.trim(),
        day_of_week: document.getElementById('routineDay').value,
        exercises
    };

    const res = await fetch('../api.php?action=save_routine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.status === 'success') {
        routineModal.hide();
        document.getElementById('routineForm').reset();
        document.getElementById('exerciseList').innerHTML = '';
        showAlert('Success', payload.routine_id ? 'Routine updated successfully' : 'Routine added successfully', 'success');
        loadData(selectedTraineeId);
    } else {
        showAlert('Error', result.message || 'Failed to save routine', 'danger');
    }
});

document.getElementById('assessmentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedAssignmentId) {
        showAlert('Select a Trainee', 'Choose an active trainee first.', 'warning');
        return;
    }

    const res = await fetch('../api.php?action=save_coach_assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assignment_id: selectedAssignmentId,
            rating: document.getElementById('assessmentRating').value,
            feedback: document.getElementById('assessmentFeedback').value.trim()
        })
    });
    const result = await res.json();
    if (result.status === 'success') {
        showAlert('Success', 'Assessment saved for this trainee', 'success');
        loadData(selectedTraineeId);
    } else {
        showAlert('Error', result.message || 'Failed to save assessment', 'danger');
    }
});

document.getElementById('resignCoachBtn').addEventListener('click', () => {
    if (!selectedAssignmentId) return;

    showConfirm(
        'Resign as Coach',
        'This will remove you as the active coach for the selected trainee.',
        '<i class="bi bi-person-dash text-danger"></i>',
        'Resign',
        'btn-danger',
        async () => {
            const res = await fetch('../api.php?action=manage_assignment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignment_id: selectedAssignmentId, status: 'Completed' })
            });
            const result = await res.json();
            if (result.status === 'success') {
                showAlert('Success', 'You have resigned as coach for this trainee', 'success');
                loadData('');
            } else {
                showAlert('Error', result.message || 'Failed to update assignment', 'danger');
            }
        }
    );
});

document.getElementById('weeklyAvailabilityForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const weekdays = Array.from(document.querySelectorAll('input[name="weekday"]:checked')).map(input => Number(input.value));
    if (!weekdays.length) {
        showAlert('Select Days', 'Choose at least one weekday to apply.', 'warning');
        return;
    }

    const res = await fetch('../api.php?action=batch_update_availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            weekdays,
            status: document.getElementById('weeklyAvailabilityStatus').value,
            weeks: document.getElementById('weeklyAvailabilityWeeks').value
        })
    });
    const result = await res.json();

    if (result.status === 'success') {
        showAlert('Success', `Updated ${result.count} calendar dates from your weekday selection`, 'success');
        loadData(selectedTraineeId);
    } else {
        showAlert('Error', result.message || 'Failed to update weekly availability', 'danger');
    }
});

document.getElementById('credentialsPhoto').addEventListener('change', function() {
    if (this.files && this.files.length) {
        Array.from(this.files).forEach(file => {
            if (file.size > 2 * 1024 * 1024) {
                showAlert('File Too Large', `${file.name} exceeds 2MB and was skipped.`, 'warning');
                return;
            }
            newPhotoFiles.push(file);
        });
        this.value = '';
        renderCredentialPhotos();
    }
});

// Delegated handlers for Edit / Remove on credential photo cards
document.getElementById('credentialPhotosGrid').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-photo]');
    const removeBtn = e.target.closest('[data-remove-photo]');
    const removeNewBtn = e.target.closest('[data-remove-new]');

    if (editBtn) {
        editCredentialPhoto(parseInt(editBtn.dataset.editPhoto, 10));
    } else if (removeBtn) {
        const id = parseInt(removeBtn.dataset.removePhoto, 10);
        if (!removedPhotoIds.includes(id)) removedPhotoIds.push(id);
        delete replaceFiles[id];
        renderCredentialPhotos();
    } else if (removeNewBtn) {
        const idx = parseInt(removeNewBtn.dataset.removeNew, 10);
        newPhotoFiles.splice(idx, 1);
        renderCredentialPhotos();
    }
});

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const credentials = document.getElementById('profCreds').value.trim();
    const habits = document.getElementById('profHabits').value.trim();
    const maxTrainees = document.getElementById('profMax').value;

    const hasPhotoChanges = removedPhotoIds.length > 0 || Object.keys(replaceFiles).length > 0 || newPhotoFiles.length > 0;

    if (!credentials && !habits && !maxTrainees && !hasPhotoChanges) {
        showAlert('Empty Form', 'Please fill in at least one field before saving.', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('credentials', credentials);
    formData.append('habits', habits);
    if (maxTrainees) formData.append('max_trainees', maxTrainees);

    // New photos
    newPhotoFiles.forEach(file => {
        formData.append('new_photos[]', file);
    });

    // Replacements
    Object.keys(replaceFiles).forEach(photoId => {
        formData.append(`replace_photo_${photoId}`, replaceFiles[photoId]);
    });

    // Removals
    removedPhotoIds.forEach(id => {
        formData.append('remove_photos[]', id);
    });

    try {
        const res = await fetch('../api.php?action=update_coach_profile', {
            method: 'POST',
            body: formData
        });
        if (!res.ok) {
            showAlert('Error', 'Server error. Please try again.', 'danger');
            return;
        }
        const result = await res.json();
        if (result.status === 'success') {
            document.getElementById('credentialsPhoto').value = '';
            showAlert('Success', 'Coach profile updated successfully', 'success');
            loadData(selectedTraineeId);
        } else {
            showAlert('Error', result.message || 'Failed to update profile', 'danger');
        }
    } catch (err) {
        showAlert('Error', 'Network error. Please try again.', 'danger');
    }
});

document.getElementById('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('../api.php?action=submit_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: document.getElementById('repCat').value, issue: document.getElementById('repIssue').value })
    });
    const result = await res.json();
    if (result.status === 'success') {
        document.getElementById('reportForm').reset();
        showAlert('Success', 'Report submitted successfully', 'success');
        loadData(selectedTraineeId);
    } else {
        showAlert('Error', result.message || 'Failed to submit report', 'danger');
    }
});

document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('../api.php?action=logout');
    window.location.href = '../index.html';
});

loadData();
