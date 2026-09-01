// --- Config -----------------------------------------------------------
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3001/api' : '/api';

// Mocked "logged in customer" for the prototype. Replace with real auth
// (session/JWT) once the auth/role module exists - everything else here
// should keep working as long as CURRENT_CUSTOMER_ID is set correctly.
const DEFAULT_CUSTOMER_ID = 1;

const MOCK_ACCOUNTS = [
  { username: 'customer1', password: '123', role: 'customer', customerId: 1 },
  { username: 'customer2', password: '123', role: 'customer', customerId: 2 },
  { username: 'mechanic1', password: '123', role: 'mechanic' },
  { username: 'manager1', password: '123', role: 'manager' },
];

let loggedInAccount = null;

function requestHeaders(includeJson = false) {
  const headers = includeJson ? { 'Content-Type': 'application/json' } : {};
  if (loggedInAccount) headers['X-Mock-Username'] = loggedInAccount.username;
  return headers;
}

function getCurrentCustomerId() {
  return loggedInAccount?.customerId || DEFAULT_CUSTOMER_ID;
}

// --- State for the booking flow ---------------------------------------
const bookingState = {
  vehicleId: null,
  serviceType: null,
  slotStart: null,
  notes: '',
};

// --- Mock login --------------------------------------------------------
const accountButton = document.getElementById('account-button');
const accountName = document.getElementById('account-name');
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

function openLoginModal() {
  loginError.textContent = '';
  loginModal.hidden = false;
  document.getElementById('login-username').focus();
}

function closeLoginModal() {
  loginModal.hidden = true;
  loginForm.reset();
  loginError.textContent = '';
}

function updateAccountControls() {
  const isLoggedIn = Boolean(loggedInAccount);
  const isMechanic = loggedInAccount?.role === 'mechanic';
  const isManager = loggedInAccount?.role === 'manager';
  accountButton.textContent = isLoggedIn ? 'Log out' : 'Log in';
  accountName.textContent = isLoggedIn ? loggedInAccount.username : '';
  accountName.hidden = !isLoggedIn;
  // Mechanics use approvals and their schedule instead of customer booking.
  document.getElementById('booking-nav-button').hidden = isMechanic;
  document.getElementById('bookings-nav-button').textContent = isMechanic ? 'Upcoming Bookings' : 'My Bookings';
  document.getElementById('completed-nav-button').hidden = !isMechanic;
  document.getElementById('mechanic-nav-button').hidden = !isMechanic;
  document.getElementById('manager-nav-button').hidden = loggedInAccount?.role !== 'manager';
}

accountButton.addEventListener('click', () => {
  if (loggedInAccount) {
    loggedInAccount = null;
    updateAccountControls();
    if (document.getElementById('view-bookings').classList.contains('active')) loadBookings();
    return;
  }
  openLoginModal();
});

document.getElementById('close-login-modal').addEventListener('click', closeLoginModal);
loginModal.addEventListener('click', (event) => {
  if (event.target === loginModal) closeLoginModal();
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const account = MOCK_ACCOUNTS.find(
    (mockAccount) => mockAccount.username === formData.get('username')
      && mockAccount.password === formData.get('password')
  );

  if (!account) {
    loginError.textContent = 'Incorrect username or password.';
    return;
  }

  loggedInAccount = account;
  updateAccountControls();
  closeLoginModal();
  loadVehicleOptions('vehicle-select');
  if (account.role === 'mechanic') {
    document.getElementById('bookings-nav-button').click();
  }
  if (document.getElementById('view-bookings').classList.contains('active')) loadBookings();
});

// --- Navigation between the three top-level views ----------------------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');

    if (btn.dataset.view === 'bookings') loadBookings();
    if (btn.dataset.view === 'completed') loadCompletedBookings();
    if (btn.dataset.view === 'history') loadHistoryVehicleOptions();
    if (btn.dataset.view === 'mechanic') loadMechanicPortal();
    if (btn.dataset.view === 'manager') loadManagerPortal();
  });
});

// --- Step navigation within the booking flow ----------------------------
function goToStep(stepNumber) {
  document.querySelectorAll('.step-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  document.getElementById(`step-${stepNumber}`).classList.add('active');
  document.querySelector(`.step[data-step="${stepNumber}"]`).classList.add('active');
}

document.getElementById('to-step-2').addEventListener('click', () => {
  const select = document.getElementById('vehicle-select');
  if (!select.value) {
    alert('Please select a vehicle first.');
    return;
  }
  bookingState.vehicleId = select.value;
  goToStep(2);
});

document.getElementById('back-to-1').addEventListener('click', () => goToStep(1));

document.getElementById('to-step-3').addEventListener('click', () => {
  const serviceType = document.getElementById('service-type').value;
  const slotTime = document.getElementById('slot-time').value;

  if (!slotTime) {
    alert('Please choose a time slot.');
    return;
  }

  bookingState.serviceType = serviceType;
  bookingState.slotStart = slotTime.replace('T', ' ') + ':00';
  bookingState.notes = document.getElementById('booking-notes').value.trim();

  const vehicleLabel = document.getElementById('vehicle-select').selectedOptions[0].textContent;
  document.getElementById('confirm-summary').textContent =
    `${vehicleLabel} — ${serviceType.replace('_', ' ')} on ${new Date(slotTime).toLocaleString()}`;

  goToStep(3);
});

document.getElementById('back-to-2').addEventListener('click', () => goToStep(2));

document.getElementById('confirm-booking').addEventListener('click', async () => {
  const resultBox = document.getElementById('booking-result');
  resultBox.textContent = 'Submitting...';
  resultBox.className = '';

  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify(bookingState),
    });
    const data = await res.json();

    if (!res.ok) {
      resultBox.textContent = data.error || 'Something went wrong.';
      resultBox.className = 'result-error';
      return;
    }

    resultBox.textContent = `Booking request submitted and pending mechanic approval. Reference: ${data.booking.confirmation_ref}`;
    resultBox.className = 'result-success';
    goToStep(1);
  } catch (err) {
    resultBox.textContent = 'Could not reach the server. Please try again.';
    resultBox.className = 'result-error';
  }
});

// --- Load vehicle options for both the booking flow and history view ----
async function loadVehicleOptions(selectElementId) {
  const res = await fetch(`${API_BASE}/vehicles/customer/${getCurrentCustomerId()}`);
  const data = await res.json();
  const select = document.getElementById(selectElementId);
  select.innerHTML = '';

  if (data.vehicles.length === 0) {
    select.innerHTML = '<option value="">No vehicles found</option>';
    return;
  }

  data.vehicles.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.plate} - ${v.make} ${v.model}`;
    select.appendChild(opt);
  });
}

// --- Customer and mechanic bookings view ---------------------------------
async function loadBookings() {
  const container = document.getElementById('bookings-list');
  container.textContent = 'Loading...';

  // Mechanics only see confirmed future appointments here.
  const isMechanic = loggedInAccount?.role === 'mechanic';
  const bookingsUrl = isMechanic
    ? `${API_BASE}/mechanics/upcoming`
    : `${API_BASE}/bookings/customer/${getCurrentCustomerId()}`;
  const res = await fetch(bookingsUrl, { headers: requestHeaders() });
  const data = await res.json();

  if (!res.ok) {
    container.textContent = data.error || 'Please log in to view bookings.';
    return;
  }

  if (data.bookings.length === 0) {
    container.textContent = isMechanic ? 'No upcoming bookings.' : 'You have no bookings yet.';
    return;
  }

  container.innerHTML = '';
  data.bookings.forEach((b) => {
    const card = document.createElement('div');
    card.className = 'booking-card';
    const badgeClass = `badge-${b.status}`;

    card.innerHTML = `
      <strong>${b.plate} - ${b.make} ${b.model}</strong><br />
      ${b.service_type.replace('_', ' ')} on ${new Date(b.slot_start.replace(' ', 'T')).toLocaleString()}<br />
      Ref: ${b.confirmation_ref}
      <span class="badge ${badgeClass}">${b.status}</span>
    `;

    if (!isMechanic && b.status === 'completed' && b.customer_notification) {
      const notice = document.createElement('p');
      notice.className = 'completion-notice';
      notice.textContent = b.customer_notification;
      card.appendChild(notice);
    }

    // Mechanics can cancel approved appointments; customers can cancel pending or approved requests.
    if (b.status === 'confirmed' || (!isMechanic && b.status === 'pending')) {
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel Booking';
      cancelBtn.className = 'cancel-btn';
      cancelBtn.addEventListener('click', () => cancelBooking(b.id));
      card.appendChild(cancelBtn);
    }

    const detailsBtn = document.createElement('button');
    detailsBtn.textContent = 'View Details';
    detailsBtn.className = 'details-btn';
    detailsBtn.addEventListener('click', () => showBookingDetails(b));
    card.appendChild(detailsBtn);

    container.appendChild(card);
  });
}

// Show services that have finished and passed their checklist.
async function loadCompletedBookings() {
  const container = document.getElementById('completed-bookings-list');
  container.textContent = 'Loading...';

  try {
    const res = await fetch(`${API_BASE}/mechanics/completed`, { headers: requestHeaders() });
    const data = await res.json();
    if (!res.ok) {
      container.textContent = data.error || 'Unable to load completed bookings.';
      return;
    }
    if (data.bookings.length === 0) {
      container.textContent = 'No completed bookings.';
      return;
    }

    container.innerHTML = '';
    data.bookings.forEach((booking) => {
      const card = document.createElement('div');
      card.className = 'booking-card';
      card.innerHTML = `
        <strong>${booking.plate} - ${booking.make} ${booking.model}</strong><br />
        Customer: ${booking.customer_name}<br />
        ${booking.service_type.replace('_', ' ')}<br />
        Completed: ${new Date(booking.completed_at.replace(' ', 'T')).toLocaleString()}
        <span class="badge badge-completed">completed</span>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

function showBookingDetails(booking) {
  const modal = document.getElementById('booking-details-modal');
  const content = document.getElementById('modal-content');
  content.innerHTML = '';

  const details = [
    ['Vehicle', `${booking.plate} - ${booking.make} ${booking.model}`],
    ['Service', booking.service_type.replace('_', ' ')],
    ['Appointment', new Date(booking.slot_start.replace(' ', 'T')).toLocaleString()],
    ['Reference', booking.confirmation_ref],
    ['Status', booking.status],
    ['Booked by', booking.booked_by || 'Unknown'],
    ['Additional notes', booking.notes || 'No additional notes provided.'],
  ];

  details.forEach(([label, value]) => {
    const row = document.createElement('p');
    const labelElement = document.createElement('strong');
    labelElement.textContent = `${label}: `;
    row.append(labelElement, value);
    content.appendChild(row);
  });

  modal.hidden = false;
}

function closeBookingDetails() {
  document.getElementById('booking-details-modal').hidden = true;
}

document.getElementById('close-modal').addEventListener('click', closeBookingDetails);
document.getElementById('booking-details-modal').addEventListener('click', (event) => {
  if (event.target.id === 'booking-details-modal') closeBookingDetails();
});

async function cancelBooking(bookingId) {
  const res = await fetch(`${API_BASE}/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: requestHeaders(),
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.error);
    return;
  }

  alert('Booking cancelled. The mechanic has been notified.');
  loadBookings();
}

// --- Mechanic Portal ------------------------------------------------------
async function loadMechanicPortal() {
  const container = document.getElementById('mechanic-bookings-list');
  container.textContent = 'Loading approval requests...';

  try {
    const [res, vehiclesRes, upcomingRes] = await Promise.all([
      fetch(`${API_BASE}/mechanics/dashboard`, { headers: requestHeaders() }),
      fetch(`${API_BASE}/vehicles/all`, { headers: requestHeaders() }),
      fetch(`${API_BASE}/mechanics/upcoming`, { headers: requestHeaders() }),
    ]);
    const data = await res.json();
    const vehiclesData = await vehiclesRes.json();
    const upcomingData = await upcomingRes.json();

    if (!res.ok) {
      container.textContent = data.error || 'Unable to load mechanic appointments.';
      return;
    }
    loadDiagnosticVehicleOptions(vehiclesData.vehicles || []);
    loadChecklistBookingOptions(upcomingData.bookings || []);
    loadChecklistItems(document.getElementById('checklist-service-type').value);

    container.innerHTML = '';
    if (data.pendingBookings.length === 0) {
      container.textContent = 'No booking requests are waiting for approval.';
    }
    // Add one approval card for every pending request.
    data.pendingBookings.forEach((booking) => {
      const card = document.createElement('div');
      card.className = 'booking-card';
      card.innerHTML = `
        <strong>${booking.plate} - ${booking.make} ${booking.model}</strong><br />
        Customer: ${booking.customer_name}<br />
        ${booking.service_type.replace('_', ' ')} on ${new Date(booking.slot_start.replace(' ', 'T')).toLocaleString()}<br />
        Notes: ${booking.notes || 'No additional notes provided.'}
      `;
      const approveButton = document.createElement('button');
      approveButton.textContent = 'Approve';
      approveButton.className = 'approve-btn';
      approveButton.addEventListener('click', () => decideBooking(booking.id, 'approve'));
      const denyButton = document.createElement('button');
      denyButton.textContent = 'Deny';
      denyButton.className = 'deny-btn';
      denyButton.addEventListener('click', () => decideBooking(booking.id, 'deny'));
      card.append(approveButton, denyButton);
      container.appendChild(card);
    });

  } catch (err) {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

// Fill the job form with approved upcoming bookings.
function loadChecklistBookingOptions(bookings) {
  const select = document.getElementById('checklist-booking-id');
  select.innerHTML = '<option value="">Select an upcoming booking</option>';
  bookings.forEach((booking) => {
    const option = document.createElement('option');
    option.value = booking.id;
    option.dataset.serviceType = booking.service_type;
    // Include the reference number so mechanics can identify the booking.
    option.textContent = `${booking.confirmation_ref} - ${booking.plate} - ${booking.service_type.replace('_', ' ')}`;
    select.appendChild(option);
  });
}

// Load checkbox items from the dedicated checklist table.
async function loadChecklistItems(serviceType) {
  const container = document.getElementById('checklist-items');
  container.textContent = 'Loading checklist...';

  try {
    const res = await fetch(`${API_BASE}/mechanics/checklists/${serviceType}`, { headers: requestHeaders() });
    const data = await res.json();
    if (!res.ok) {
      container.textContent = data.error || 'Unable to load checklist.';
      return;
    }

    container.innerHTML = '';
    data.checklist.items.forEach((item) => {
      const label = document.createElement('label');
      label.className = 'checklist-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'checklistItem';
      checkbox.value = item;
      label.append(checkbox, item);
      container.appendChild(label);
    });
  } catch (err) {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

document.getElementById('checklist-service-type').addEventListener('change', (event) => {
  loadChecklistItems(event.target.value);
});

document.getElementById('checklist-booking-id').addEventListener('change', (event) => {
  const selectedOption = event.target.selectedOptions[0];
  const serviceType = selectedOption?.dataset.serviceType;
  if (!serviceType) return;

  // Use the selected booking's service type for its checklist.
  const serviceTypeSelect = document.getElementById('checklist-service-type');
  serviceTypeSelect.value = serviceType;
  loadChecklistItems(serviceType);
});

// Save a compliant job only after every item has been checked.
document.getElementById('checklist-job-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const resultBox = document.getElementById('checklist-result');
  const checkboxes = [...form.querySelectorAll('input[name="checklistItem"]')];
  const completedItems = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);

  if (checkboxes.length === 0 || completedItems.length !== checkboxes.length) {
    resultBox.textContent = 'Complete every checklist item before saving.';
    resultBox.className = 'result-error';
    return;
  }

  const formData = new FormData(form);
  try {
    const res = await fetch(`${API_BASE}/mechanics/jobs/checklist-compliance`, {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({
        bookingId: Number(formData.get('bookingId')),
        serviceType: formData.get('serviceType'),
        completedItems,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      resultBox.textContent = data.error || 'Unable to save checklist.';
      resultBox.className = 'result-error';
      return;
    }

    resultBox.textContent = `Job #${data.jobId} saved as ${data.status}.`;
    resultBox.className = 'result-success';
    loadChecklistItems(formData.get('serviceType'));
  } catch (err) {
    resultBox.textContent = 'Could not reach the server. Please try again.';
    resultBox.className = 'result-error';
  }
});

// Fill the diagnostic form with vehicles already in the database.
function loadDiagnosticVehicleOptions(vehicles) {
  const select = document.getElementById('diagnostic-vehicle-id');
  select.innerHTML = '<option value="">Select a vehicle</option>';

  vehicles.forEach((vehicle) => {
    const option = document.createElement('option');
    option.value = vehicle.id;
    option.textContent = `ID ${vehicle.id}: ${vehicle.plate} - ${vehicle.make} ${vehicle.model}`;
    select.appendChild(option);
  });
}

async function decideBooking(bookingId, decision) {
  // Send the mechanic's approval decision to the server.
  const res = await fetch(`${API_BASE}/mechanics/bookings/${bookingId}/decision`, {
    method: 'POST',
    headers: requestHeaders(true),
    body: JSON.stringify({ decision }),
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Unable to update the booking.');
    return;
  }

  loadMechanicPortal();
}

// Save a new diagnostic entry. Existing entries are never changed here.
document.getElementById('diagnostic-entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const resultBox = document.getElementById('diagnostic-result');
  const formData = new FormData(form);

  try {
    const res = await fetch(`${API_BASE}/mechanics/diagnostics`, {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({
        vehicleId: Number(formData.get('vehicleId')),
        faultDescription: formData.get('faultDescription'),
        severity: formData.get('severity'),
        status: formData.get('status'),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      resultBox.textContent = data.error || 'Unable to save diagnostic entry.';
      resultBox.className = 'result-error';
      return;
    }

    resultBox.textContent = `Diagnostic entry #${data.entry.id} saved.`;
    resultBox.className = 'result-success';
    form.reset();
  } catch (err) {
    resultBox.textContent = 'Could not reach the server. Please try again.';
    resultBox.className = 'result-error';
  }
});

// --- Manager Dashboard ------------------------------------------------------
function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return 'N/A';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatPercent(value) {
  return value === null || value === undefined ? 'N/A' : `${value}%`;
}

async function loadManagerPortal() {
  const filterSelect = document.getElementById('manager-mechanic-filter');
  const selectedMechanic = filterSelect.value;
  const jobsContainer = document.getElementById('manager-jobs-list');
  jobsContainer.textContent = 'Loading...';

  try {
    const query = selectedMechanic ? `?mechanic=${encodeURIComponent(selectedMechanic)}` : '';
    const [dashboardRes, jobsRes] = await Promise.all([
      fetch(`${API_BASE}/manager/dashboard${query}`, { headers: requestHeaders() }),
      fetch(`${API_BASE}/manager/jobs${query}`, { headers: requestHeaders() }),
    ]);
    const dashboardData = await dashboardRes.json();
    const jobsData = await jobsRes.json();

    if (!dashboardRes.ok) {
      jobsContainer.textContent = dashboardData.error || 'Unable to load the manager dashboard.';
      return;
    }

    // Keep the current selection when repopulating the filter dropdown.
    filterSelect.innerHTML = '<option value="">All mechanics</option>';
    dashboardData.mechanics.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      filterSelect.appendChild(option);
    });
    filterSelect.value = selectedMechanic;

    const totals = dashboardData.totals;
    document.getElementById('stat-total-completed').textContent = totals.totalCompletedJobs;
    document.getElementById('stat-incomplete').textContent = totals.incompleteChecklistCount;
    document.getElementById('stat-avg-time').textContent = formatMinutes(totals.averageRepairTimeMinutes);
    document.getElementById('stat-acceptance').textContent = formatPercent(totals.acceptanceRatePercent);
    document.getElementById('stat-compliance').textContent = formatPercent(totals.checklistCompliancePercent);

    jobsContainer.innerHTML = '';
    if (jobsData.jobs.length === 0) {
      jobsContainer.textContent = 'No completed jobs yet.';
      return;
    }
    jobsData.jobs.forEach((job) => {
      const card = document.createElement('div');
      card.className = 'booking-card job-card';
      card.innerHTML = `
        <strong>${job.plate} - ${job.make} ${job.model}</strong><br />
        Customer: ${job.customer_name}<br />
        Mechanic: ${job.mechanic_name} — ${job.service_type.replace('_', ' ')}<br />
        Completed: ${new Date(job.completed_at.replace(' ', 'T')).toLocaleString()}
        <span class="badge badge-completed">${job.job_status}</span>
      `;
      card.addEventListener('click', () => openJobDetails(job.job_id));
      jobsContainer.appendChild(card);
    });
  } catch (err) {
    jobsContainer.textContent = 'Could not reach the server. Please try again.';
  }
}

document.getElementById('manager-mechanic-filter').addEventListener('change', loadManagerPortal);

async function openJobDetails(jobId) {
  const modal = document.getElementById('job-details-modal');
  const content = document.getElementById('job-modal-content');
  content.textContent = 'Loading...';
  modal.hidden = false;

  try {
    const res = await fetch(`${API_BASE}/manager/jobs/${jobId}`, { headers: requestHeaders() });
    const data = await res.json();
    if (!res.ok) {
      content.textContent = data.error || 'Unable to load job details.';
      return;
    }

    const job = data.job;
    content.innerHTML = '';

    const details = [
      ['Vehicle', `${job.plate} - ${job.make} ${job.model}`],
      ['Customer', job.customer_name],
      ['Mechanic', job.mechanic_name],
      ['Service', job.service_type.replace('_', ' ')],
      ['Duration', formatMinutes(job.durationMinutes)],
      ['Reference', job.confirmation_ref],
    ];
    details.forEach(([label, value]) => {
      const row = document.createElement('p');
      const labelElement = document.createElement('strong');
      labelElement.textContent = `${label}: `;
      row.append(labelElement, value);
      content.appendChild(row);
    });

    const checklistHeading = document.createElement('p');
    checklistHeading.innerHTML = '<strong>Checklist:</strong>';
    content.appendChild(checklistHeading);

    const list = document.createElement('ul');
    job.checklistItems.forEach(({ item }) => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
    content.appendChild(list);
  } catch (err) {
    content.textContent = 'Could not reach the server. Please try again.';
  }
}

function closeJobDetails() {
  document.getElementById('job-details-modal').hidden = true;
}

document.getElementById('close-job-modal').addEventListener('click', closeJobDetails);
document.getElementById('job-details-modal').addEventListener('click', (event) => {
  if (event.target.id === 'job-details-modal') closeJobDetails();
});

// --- Vehicle History view -------------------------------------------------
async function loadHistoryVehicleOptions() {
  // Mechanics and managers can review history for every vehicle.
  if (['mechanic', 'manager'].includes(loggedInAccount?.role)) {
    // This route returns all vehicles for approved staff users.
    const res = await fetch(`${API_BASE}/vehicles/all`, { headers: requestHeaders() });
    const data = await res.json();
    loadHistoryVehicleSelect(data.vehicles || []);
    const select = document.getElementById('history-vehicle-select');
    // Load history for the first vehicle in the list.
    if (select.value) loadHistory(select.value);
    return;
  }

  // Customers only see vehicles linked to their account.
  await loadVehicleOptions('history-vehicle-select');
  const select = document.getElementById('history-vehicle-select');
  if (select.value) loadHistory(select.value);
}

// Fill the Vehicle History selector with the available vehicles.
function loadHistoryVehicleSelect(vehicles) {
  const select = document.getElementById('history-vehicle-select');
  select.innerHTML = '';

  vehicles.forEach((vehicle) => {
    const option = document.createElement('option');
    option.value = vehicle.id;
    option.textContent = `${vehicle.plate} - ${vehicle.make} ${vehicle.model}`;
    select.appendChild(option);
  });
}

document.getElementById('history-vehicle-select').addEventListener('change', (e) => {
  loadHistory(e.target.value);
});

async function loadHistory(vehicleId) {
  const container = document.getElementById('history-list');
  if (!vehicleId) {
    container.textContent = '';
    return;
  }
  container.textContent = 'Loading...';

  const res = await fetch(`${API_BASE}/vehicles/${vehicleId}/history`);
  const data = await res.json();

  if (data.history.length === 0) {
    container.textContent = data.message || 'No history found.';
    return;
  }

  container.innerHTML = '';
  data.history.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const badgeClass = entry.status === 'fixed' ? 'badge-fixed' : 'badge-flagged';

    card.innerHTML = `
      <strong>${entry.fault_description}</strong>
      <span class="badge ${badgeClass}">${entry.status.replace('_', ' ')}</span><br />
      Severity: ${entry.severity} — ${new Date(entry.created_at.replace(' ', 'T')).toLocaleString()}
    `;
    container.appendChild(card);
  });
}

// --- Initial load ----------------------------------------------------------
loadVehicleOptions('vehicle-select');
