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
  accountButton.textContent = isLoggedIn ? 'Log out' : 'Log in';
  accountName.textContent = isLoggedIn ? loggedInAccount.username : '';
  accountName.hidden = !isLoggedIn;
  // Mechanics use approvals and their schedule instead of customer booking.
  document.getElementById('booking-nav-button').hidden = isMechanic;
  document.getElementById('bookings-nav-button').textContent = isMechanic ? 'Upcoming Bookings' : 'My Bookings';
  document.getElementById('mechanic-nav-button').hidden = !isMechanic;
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
    if (btn.dataset.view === 'history') loadHistoryVehicleOptions();
    if (btn.dataset.view === 'mechanic') loadMechanicPortal();
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
  const checklistsContainer = document.getElementById('service-checklists-list');
  container.textContent = 'Loading approval requests...';
  checklistsContainer.textContent = '';

  try {
    const res = await fetch(`${API_BASE}/mechanics/dashboard`, { headers: requestHeaders() });
    const data = await res.json();

    if (!res.ok) {
      container.textContent = data.error || 'Unable to load mechanic appointments.';
      return;
    }

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

    // Show the stored steps for each service type.
    data.checklists.forEach((checklist) => {
      const card = document.createElement('div');
      card.className = 'checklist-card';
      const heading = document.createElement('strong');
      heading.textContent = checklist.service_type.replace('_', ' ');
      const list = document.createElement('ul');
      checklist.items.forEach((item) => {
        const listItem = document.createElement('li');
        listItem.textContent = item;
        list.appendChild(listItem);
      });
      card.append(heading, list);
      checklistsContainer.appendChild(card);
    });
  } catch (err) {
    container.textContent = 'Could not reach the server. Please try again.';
  }
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

// --- Vehicle History view -------------------------------------------------
async function loadHistoryVehicleOptions() {
  await loadVehicleOptions('history-vehicle-select');
  const select = document.getElementById('history-vehicle-select');
  if (select.value) loadHistory(select.value);
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
