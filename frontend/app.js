// --- Config -----------------------------------------------------------
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3001/api' : '/api';

const DEFAULT_CUSTOMER_ID = 1;

const STORED_SESSION_KEY = 'mechanics-portal-session';
let loggedInAccount = null;
let authToken = null;

function restoreLoggedInAccount() {
  localStorage.removeItem('mechanics-portal-account');
  const storedSession = localStorage.getItem(STORED_SESSION_KEY);
  if (!storedSession) return;

  try {
    const session = JSON.parse(storedSession);
    if (typeof session.token !== 'string' || !session.account?.username) throw new Error('Invalid session');
    authToken = session.token;
  } catch {
    authToken = null;
    loggedInAccount = null;
    localStorage.removeItem(STORED_SESSION_KEY);
  }
}

function requestHeaders(includeJson = false) {
  const headers = includeJson ? { 'Content-Type': 'application/json' } : {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

// Treat database text as untrusted whenever it is interpolated into a markup template.
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
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
const DAILY_BOOKING_HOURS = Array.from({ length: 8 }, (_, index) => index + 9);
let availabilityRequestId = 0;

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatSlotTime(hour) {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderTimeSlots(date, bookedSlots) {
  const container = document.getElementById('available-time-slots');
  const message = document.getElementById('availability-message');
  const booked = new Set(bookedSlots);
  container.replaceChildren();

  DAILY_BOOKING_HOURS.forEach((hour) => {
    const startTime = `${String(hour).padStart(2, '0')}:00`;
    const startDateTime = new Date(`${date}T${startTime}:00`);
    const isBooked = booked.has(startTime);
    const isPast = startDateTime.getTime() <= Date.now();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'time-slot-button';
    button.disabled = isBooked || isPast;
    button.setAttribute('aria-pressed', 'false');

    const period = document.createElement('span');
    period.className = 'time-slot-period';
    period.textContent = `${formatSlotTime(hour)} – ${formatSlotTime(hour + 1)}`;
    const status = document.createElement('span');
    status.className = 'time-slot-status';
    status.textContent = isBooked ? 'Booked' : isPast ? 'Unavailable' : 'Available';
    button.append(period, status);

    if (isBooked) button.classList.add('is-booked');
    if (isPast && !isBooked) button.classList.add('is-past');
    button.addEventListener('click', () => {
      container.querySelectorAll('.time-slot-button').forEach((slotButton) => {
        slotButton.classList.remove('is-selected');
        slotButton.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('is-selected');
      button.setAttribute('aria-pressed', 'true');
      bookingState.slotStart = `${date} ${startTime}:00`;
      message.textContent = `Selected ${period.textContent}.`;
      message.className = 'availability-message is-selected';
    });
    container.appendChild(button);
  });

  const availableCount = container.querySelectorAll('.time-slot-button:not(:disabled)').length;
  message.textContent = availableCount
    ? 'Choose an available one-hour time slot.'
    : 'There are no future time slots available on this date.';
  message.className = 'availability-message';
}

async function loadAvailableTimeSlots() {
  const date = document.getElementById('booking-date').value;
  const container = document.getElementById('available-time-slots');
  const message = document.getElementById('availability-message');
  const requestId = ++availabilityRequestId;
  bookingState.slotStart = null;
  container.replaceChildren();

  if (!date || loggedInAccount?.role !== 'customer') {
    message.textContent = 'Choose a date to view available times.';
    message.className = 'availability-message';
    return;
  }

  message.textContent = 'Checking available times...';
  message.className = 'availability-message';

  try {
    const response = await fetch(`${API_BASE}/bookings/availability?date=${encodeURIComponent(date)}`, {
      headers: requestHeaders(),
    });
    const data = await response.json();
    if (requestId !== availabilityRequestId) return;
    if (!response.ok) {
      message.textContent = data.error || 'Unable to check availability.';
      return;
    }
    renderTimeSlots(date, data.bookedSlots);
  } catch {
    if (requestId === availabilityRequestId) message.textContent = 'Could not check availability. Please try again.';
  }
}

document.getElementById('booking-date').addEventListener('change', loadAvailableTimeSlots);

// --- Login and session management -------------------------------------
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

document.getElementById('landing-login-button').addEventListener('click', openLoginModal);
document.getElementById('landing-primary-login').addEventListener('click', openLoginModal);
const signupForm = document.getElementById('signup-form');
const signupError = document.getElementById('signup-error');

function closeSignupPage() {
  document.body.classList.remove('signup-open');
  signupForm.reset();
  signupError.textContent = '';
}

document.getElementById('landing-signup-button').addEventListener('click', () => {
  document.getElementById('signup-message').textContent = '';
  signupError.textContent = '';
  document.body.classList.add('signup-open');
});
document.getElementById('signup-back-button').addEventListener('click', closeSignupPage);
document.getElementById('signup-login-button').addEventListener('click', () => {
  closeSignupPage();
  openLoginModal();
});

function closeLoginModal() {
  loginModal.hidden = true;
  loginForm.reset();
  loginError.textContent = '';
}

function updateAccountControls() {
  const isLoggedIn = Boolean(loggedInAccount);
  // Guest styling exposes the landing page; a validated account restores the portal.
  document.body.classList.toggle('is-guest', !isLoggedIn);
  const isCustomer = loggedInAccount?.role === 'customer';
  const isMechanic = loggedInAccount?.role === 'mechanic';
  accountButton.textContent = isLoggedIn ? 'Log out' : 'Log in';
  accountName.textContent = isLoggedIn ? loggedInAccount.username : '';
  accountName.hidden = !isLoggedIn;
  document.getElementById('customer-home-nav-button').hidden = !isCustomer;
  // Mechanics use approvals and their schedule instead of customer booking.
  document.getElementById('booking-nav-button').hidden = !isCustomer;
  document.getElementById('bookings-nav-button').hidden = !isCustomer && !isMechanic;
  document.getElementById('bookings-nav-button').textContent = isMechanic ? 'Upcoming Bookings' : 'My Bookings';
  document.getElementById('customer-vehicles-nav-button').hidden = !isCustomer;
  document.getElementById('completed-nav-button').hidden = !isMechanic;
  document.getElementById('mechanic-nav-button').hidden = !isMechanic;
  document.getElementById('manager-nav-button').hidden = loggedInAccount?.role !== 'manager';
  document.getElementById('booking-login-message').hidden = isCustomer;
  document.getElementById('booking-customer-content').hidden = !isCustomer;
}

function acceptLoginSession(data) {
  authToken = data.token;
  loggedInAccount = data.account;
  localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ token: authToken, account: loggedInAccount }));
  document.body.classList.remove('signup-open');
  updateAccountControls();
  closeLoginModal();
  signupForm.reset();

  if (loggedInAccount.role === 'customer') {
    document.getElementById('customer-home-nav-button').click();
    loadVehicleOptions('vehicle-select');
  } else if (loggedInAccount.role === 'mechanic') {
    document.getElementById('bookings-nav-button').click();
  } else if (loggedInAccount.role === 'manager') {
    document.getElementById('manager-nav-button').click();
  }
}

function clearPrivateVehicleData() {
  document.getElementById('vehicle-select').innerHTML = '<option value="">Log in to view vehicles</option>';
  document.getElementById('history-vehicle-select').innerHTML = '<option value="">Log in to view vehicles</option>';
  document.getElementById('history-list').textContent = 'Log in to view vehicle history.';
}

accountButton.addEventListener('click', () => {
  if (loggedInAccount) {
    loggedInAccount = null;
    authToken = null;
    localStorage.removeItem(STORED_SESSION_KEY);
    document.body.classList.remove('signup-open');
    clearPrivateVehicleData();
    closeChecklistEditor();
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

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  loginError.textContent = '';

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      loginError.textContent = data.error || 'Unable to log in.';
      return;
    }

    acceptLoginSession(data);
  } catch {
    loginError.textContent = 'Could not reach the server. Please try again.';
  }
});

// --- Navigation between the three top-level views ----------------------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.remove('active');
      b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');

    if (btn.dataset.view === 'bookings') loadBookings();
    if (btn.dataset.view === 'completed') loadCompletedBookings();
    if (btn.dataset.view === 'customer-home') loadCustomerDashboard();
    if (btn.dataset.view === 'vehicles') loadCustomerVehicles();
    if (btn.dataset.view === 'booking' && loggedInAccount?.role === 'customer') loadAvailableTimeSlots();
    if (btn.dataset.view === 'history') loadHistoryVehicleOptions();
    if (btn.dataset.view === 'mechanic') loadMechanicPortal();
    if (btn.dataset.view === 'manager') loadManagerPortal();
  });
});

document.querySelectorAll('[data-customer-destination]').forEach((button) => {
  button.addEventListener('click', () => {
    const destination = button.dataset.customerDestination;
    document.querySelector(`.nav-btn[data-view="${destination}"]`)?.click();
  });
});

document.getElementById('manage-vehicles-from-booking').addEventListener('click', () => {
  // Keep booking focused on scheduling; vehicle creation lives in its own customer view.
  document.getElementById('customer-vehicles-nav-button').click();
});

document.getElementById('vehicles-booking-button').addEventListener('click', () => {
  document.getElementById('booking-nav-button').click();
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
  if (!bookingState.slotStart) {
    alert('Choose an available one-hour time slot.');
    return;
  }

  const selectedSlot = new Date(bookingState.slotStart.replace(' ', 'T'));
  if (selectedSlot.getTime() <= Date.now()) {
    alert('Please choose a future booking time.');
    loadAvailableTimeSlots();
    return;
  }

  bookingState.serviceType = serviceType;
  bookingState.notes = document.getElementById('booking-notes').value.trim();

  const vehicleLabel = document.getElementById('vehicle-select').selectedOptions[0].textContent;
  document.getElementById('confirm-summary').textContent =
    `${vehicleLabel} — ${serviceType.replace('_', ' ')} on ${selectedSlot.toLocaleString()}`;

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
      if (res.status === 409) {
        window.alert(data.error || 'That time slot is already taken. Please choose another time.');
        await loadAvailableTimeSlots();
        goToStep(2);
      }
      return;
    }

    resultBox.textContent = `Booking request submitted and pending mechanic approval. Reference: ${data.booking.confirmation_ref}`;
    resultBox.className = 'result-success';
    await loadAvailableTimeSlots();
    goToStep(1);
  } catch (err) {
    resultBox.textContent = 'Could not reach the server. Please try again.';
    resultBox.className = 'result-error';
  }
});

// --- Load vehicle options for both the booking flow and history view ----
async function loadVehicleOptions(selectElementId, selectedVehicleId = null) {
  const res = await fetch(`${API_BASE}/vehicles/customer/${getCurrentCustomerId()}`, {
    headers: requestHeaders(),
  });
  const data = await res.json();
  const select = document.getElementById(selectElementId);
  select.innerHTML = '';

  if (!res.ok) {
    select.innerHTML = '<option value="">Log in to view vehicles</option>';
    return;
  }

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
  if (selectedVehicleId && data.vehicles.some((vehicle) => String(vehicle.id) === String(selectedVehicleId))) {
    select.value = String(selectedVehicleId);
  }
}

function formatVehicleSummary(vehicle) {
  return `${vehicle.plate} - ${vehicle.make} ${vehicle.model}`;
}

function renderCustomerVehicleList(container, vehicles, emptyMessage) {
  container.replaceChildren();
  if (vehicles.length === 0) {
    container.textContent = emptyMessage;
    return;
  }

  vehicles.forEach((vehicle) => {
    const item = document.createElement('article');
    item.className = 'customer-vehicle-item';
    const heading = document.createElement('h4');
    heading.textContent = formatVehicleSummary(vehicle);
    item.appendChild(heading);

    const registration = document.createElement('p');
    registration.textContent = vehicle.wof_expiry
      ? `WOF expiry ${new Date(`${vehicle.wof_expiry}T00:00:00`).toLocaleDateString()}`
      : 'WOF expiry not recorded';
    item.appendChild(registration);

    const service = document.createElement('p');
    service.textContent = vehicle.service_due
      ? `Next service due ${new Date(`${vehicle.service_due}T00:00:00`).toLocaleDateString()}`
      : 'Next service date not recorded';
    item.appendChild(service);
    container.appendChild(item);
  });
}

// The customer home summary is scoped to the signed-in account via token-protected APIs.
async function loadCustomerDashboard() {
  if (loggedInAccount?.role !== 'customer') return;

  const vehiclesContainer = document.getElementById('customer-home-vehicles');
  const nextVisit = document.getElementById('customer-next-visit');
  vehiclesContainer.textContent = 'Loading your vehicles...';
  nextVisit.textContent = 'Checking your bookings...';

  try {
    const [vehiclesResponse, bookingsResponse] = await Promise.all([
      fetch(`${API_BASE}/vehicles/customer/${getCurrentCustomerId()}`, { headers: requestHeaders() }),
      fetch(`${API_BASE}/bookings/customer/${getCurrentCustomerId()}`, { headers: requestHeaders() }),
    ]);
    const vehiclesData = await vehiclesResponse.json();
    const bookingsData = await bookingsResponse.json();
    if (!vehiclesResponse.ok || !bookingsResponse.ok) {
      vehiclesContainer.textContent = vehiclesData.error || bookingsData.error || 'Unable to load your account overview.';
      nextVisit.textContent = '';
      return;
    }

    const vehicles = vehiclesData.vehicles;
    const countText = `${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}`;
    document.getElementById('customer-vehicle-count').textContent = countText;
    renderCustomerVehicleList(vehiclesContainer, vehicles.slice(0, 3), vehicles.length
      ? 'Your garage is ready.'
      : 'Add your first vehicle to get started.');

    const upcomingBookings = bookingsData.bookings
      .filter((booking) => ['pending', 'confirmed'].includes(booking.status)
        && new Date(booking.slot_start.replace(' ', 'T')).getTime() > Date.now())
      .sort((left, right) => new Date(left.slot_start.replace(' ', 'T')) - new Date(right.slot_start.replace(' ', 'T')));
    if (upcomingBookings.length === 0) {
      nextVisit.textContent = 'No upcoming appointments.';
      return;
    }

    const appointment = upcomingBookings[0];
    const summary = document.createElement('p');
    summary.className = 'customer-next-visit-summary';
    summary.textContent = `${appointment.plate} · ${appointment.service_type.replace('_', ' ')} · ${new Date(appointment.slot_start.replace(' ', 'T')).toLocaleString()}`;
    const status = document.createElement('span');
    status.className = `badge badge-${appointment.status}`;
    status.textContent = appointment.status;
    nextVisit.replaceChildren(summary, status);
  } catch {
    vehiclesContainer.textContent = 'Could not reach the server. Please try again.';
    nextVisit.textContent = '';
  }
}

// The dedicated garage view owns vehicle creation and refreshes both customer summaries after save.
async function loadCustomerVehicles() {
  if (loggedInAccount?.role !== 'customer') return;

  const container = document.getElementById('customer-vehicles-list');
  container.textContent = 'Loading your vehicles...';
  try {
    const response = await fetch(`${API_BASE}/vehicles/customer/${getCurrentCustomerId()}`, {
      headers: requestHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      container.textContent = data.error || 'Unable to load your vehicles.';
      return;
    }

    const countText = `${data.vehicles.length} ${data.vehicles.length === 1 ? 'vehicle' : 'vehicles'}`;
    document.getElementById('vehicles-page-count').textContent = countText;
    renderCustomerVehicleList(container, data.vehicles, 'No vehicles added yet. Use the form to add one to your garage.');
  } catch {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

document.getElementById('add-vehicle-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById('add-vehicle-result');
  result.textContent = '';
  result.className = '';
  const formData = new FormData(form);

  try {
    const response = await fetch(`${API_BASE}/vehicles`, {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({
        plate: formData.get('plate'),
        make: formData.get('make'),
        model: formData.get('model'),
        wofExpiry: formData.get('wofExpiry'),
        serviceDue: formData.get('serviceDue'),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      result.textContent = data.error || 'Unable to add vehicle.';
      result.className = 'result-error';
      return;
    }

    form.reset();
    result.textContent = `${data.vehicle.plate} added to your vehicles.`;
    result.className = 'result-success';
    await loadVehicleOptions('vehicle-select', data.vehicle.id);
    await loadCustomerVehicles();
    await loadCustomerDashboard();
  } catch {
    result.textContent = 'Could not reach the server. Please try again.';
    result.className = 'result-error';
  }
});

// --- Customer and mechanic bookings view ---------------------------------
async function loadBookings() {
  const upcomingContainer = document.getElementById('bookings-list');
  const pastContainer = document.getElementById('past-bookings-list');
  const isMechanic = loggedInAccount?.role === 'mechanic';
  const pastSection = document.getElementById('past-bookings-section');
  pastSection.hidden = isMechanic;
  upcomingContainer.textContent = 'Loading...';
  pastContainer.textContent = '';

  const bookingsUrl = isMechanic
    ? `${API_BASE}/mechanics/upcoming`
    : `${API_BASE}/bookings/customer/${getCurrentCustomerId()}`;
  try {
    const response = await fetch(bookingsUrl, { headers: requestHeaders() });
    const data = await response.json();
    if (!response.ok) {
      upcomingContainer.textContent = data.error || 'Please log in to view bookings.';
      return;
    }

    if (isMechanic) {
      renderBookingCards(upcomingContainer, data.bookings, true, 'No upcoming bookings.', true);
      return;
    }

    const now = Date.now();
    const upcoming = [];
    const past = [];
    data.bookings.forEach((booking) => {
      const startsAt = new Date(booking.slot_start.replace(' ', 'T')).getTime();
      if (startsAt > now && ['pending', 'confirmed'].includes(booking.status)) upcoming.push(booking);
      else past.push(booking);
    });

    upcoming.sort((left, right) => new Date(left.slot_start.replace(' ', 'T')) - new Date(right.slot_start.replace(' ', 'T')));
    past.sort((left, right) => new Date(right.slot_start.replace(' ', 'T')) - new Date(left.slot_start.replace(' ', 'T')));
    renderBookingCards(upcomingContainer, upcoming, false, 'No upcoming bookings.', true);
    renderBookingCards(pastContainer, past, false, 'No past bookings.', false);
  } catch {
    upcomingContainer.textContent = 'Could not reach the server. Please try again.';
  }
}

function renderBookingCards(container, bookings, isMechanic, emptyMessage, allowCancellation) {
  container.replaceChildren();
  if (bookings.length === 0) {
    container.textContent = emptyMessage;
    return;
  }

  bookings.forEach((b) => {
    const card = document.createElement('div');
    card.className = 'booking-card';
    const badgeClass = `badge-${b.status}`;

    card.innerHTML = `
      <strong>${escapeHTML(b.plate)} - ${escapeHTML(b.make)} ${escapeHTML(b.model)}</strong><br />
      ${escapeHTML(b.service_type.replace('_', ' '))} on ${escapeHTML(new Date(b.slot_start.replace(' ', 'T')).toLocaleString())}<br />
      Ref: ${escapeHTML(b.confirmation_ref)}
      <span class="badge ${escapeHTML(badgeClass)}">${escapeHTML(b.status)}</span>
    `;

    // Approval, decline, cancellation and completion updates are shown on the customer's card.
    if (!isMechanic && b.customer_notification) {
      const notice = document.createElement('p');
      notice.className = `completion-notice notice-${b.status}`;
      notice.textContent = b.customer_notification;
      card.appendChild(notice);
    }

    // Mechanics can cancel approved appointments; customers can cancel pending or approved requests.
    if (allowCancellation && (b.status === 'confirmed' || (!isMechanic && b.status === 'pending'))) {
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
        <strong>${escapeHTML(booking.plate)} - ${escapeHTML(booking.make)} ${escapeHTML(booking.model)}</strong><br />
        Customer: ${escapeHTML(booking.customer_name)}<br />
        ${escapeHTML(booking.service_type.replace('_', ' '))}<br />
        Completed: ${escapeHTML(new Date(booking.completed_at.replace(' ', 'T')).toLocaleString())}
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
  if (booking.cancelled_at) {
    details.splice(5, 0, ['Cancelled', new Date(booking.cancelled_at).toLocaleString()]);
  }

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

  alert('Booking cancelled. The workshop has been notified by email.');
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
    updateChecklistServiceType();

    container.innerHTML = '';
    if (data.pendingBookings.length === 0) {
      container.textContent = 'No booking requests are waiting for approval.';
    }
    // Add one approval card for every pending request.
    data.pendingBookings.forEach((booking) => {
      const card = document.createElement('div');
      card.className = 'booking-card';
      card.innerHTML = `
        <strong>${escapeHTML(booking.plate)} - ${escapeHTML(booking.make)} ${escapeHTML(booking.model)}</strong><br />
        Customer: ${escapeHTML(booking.customer_name)}<br />
        ${escapeHTML(booking.service_type.replace('_', ' '))} on ${escapeHTML(new Date(booking.slot_start.replace(' ', 'T')).toLocaleString())}<br />
        Notes: ${escapeHTML(booking.notes || 'No additional notes provided.')}
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

function updateChecklistServiceType() {
  const bookingSelect = document.getElementById('checklist-booking-id');
  const serviceTypeSelect = document.getElementById('checklist-service-type');
  const serviceType = bookingSelect.selectedOptions[0]?.dataset.serviceType || '';
  serviceTypeSelect.disabled = true;

  if (!serviceType) {
    serviceTypeSelect.value = '';
    document.getElementById('checklist-items').textContent = 'Select a confirmed booking to load its checklist.';
    return;
  }

  serviceTypeSelect.value = serviceType;
  loadChecklistItems(serviceType);
}

// Load checkbox items from the dedicated checklist table.
async function loadChecklistItems(serviceType) {
  const container = document.getElementById('checklist-items');
  container.textContent = 'Loading checklist...';
  delete container.dataset.checklistId;

  try {
    const res = await fetch(`${API_BASE}/mechanics/checklists/${serviceType}`, { headers: requestHeaders() });
    const data = await res.json();
    if (!res.ok) {
      container.textContent = data.error || 'Unable to load checklist.';
      return;
    }

    container.innerHTML = '';
    // Remember which template version was loaded so the job is saved against it.
    container.dataset.checklistId = data.checklist.id;
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

document.getElementById('checklist-booking-id').addEventListener('change', updateChecklistServiceType);

// Close the job: fully ticked jobs are compliant; anything less is saved as
// "Checklist Incomplete" (with its completion %) after the mechanic confirms.
document.getElementById('checklist-job-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const resultBox = document.getElementById('checklist-result');
  const checkboxes = [...form.querySelectorAll('input[name="checklistItem"]')];
  const completedItems = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);

  if (checkboxes.length === 0) {
    resultBox.textContent = 'Select a confirmed booking to load its checklist.';
    resultBox.className = 'result-error';
    return;
  }
  if (completedItems.length < checkboxes.length) {
    const percentDone = Math.round((completedItems.length / checkboxes.length) * 100);
    const accepted = window.confirm(
      `Only ${completedItems.length} of ${checkboxes.length} checklist items are ticked (${percentDone}%). `
      + 'Close this job as "Checklist Incomplete"?'
    );
    if (!accepted) return;
  }

  const formData = new FormData(form);
  try {
    const res = await fetch(`${API_BASE}/mechanics/jobs/checklist-compliance`, {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({
        bookingId: Number(formData.get('bookingId')),
        serviceType: document.getElementById('checklist-service-type').value,
        checklistId: Number(document.getElementById('checklist-items').dataset.checklistId) || undefined,
        completedItems,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      resultBox.textContent = data.error || 'Unable to save checklist.';
      resultBox.className = 'result-error';
      return;
    }

    resultBox.textContent = `Job #${data.jobId} saved as ${data.status} (${data.completionPercent}% of checklist complete).`;
    resultBox.className = 'result-success';
    document.getElementById('checklist-booking-id').value = '';
    updateChecklistServiceType();
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

function formatHours(hours) {
  if (hours === null || hours === undefined) return 'N/A';
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function formatDateOnly(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString();
}

function formatPercent(value) {
  return value === null || value === undefined ? 'N/A' : `${value}%`;
}

async function loadManagerAccounts() {
  const container = document.getElementById('manager-account-list');
  container.textContent = 'Loading accounts...';

  try {
    const response = await fetch(`${API_BASE}/manager/accounts`, { headers: requestHeaders() });
    const data = await response.json();
    if (!response.ok) {
      container.textContent = data.error || 'Unable to load accounts.';
      return;
    }
    if (data.accounts.length === 0) {
      container.textContent = 'No customer or mechanic accounts.';
      return;
    }

    const table = document.createElement('table');
    table.className = 'account-table';
    const head = document.createElement('thead');
    const headingRow = document.createElement('tr');
    ['Name', 'Username', 'Email', 'Role', ''].forEach((heading) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = heading;
      headingRow.appendChild(cell);
    });
    head.appendChild(headingRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    data.accounts.forEach((account) => {
      const row = document.createElement('tr');
      [account.display_name, account.username, account.email || 'Not provided', account.role].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });
      const actionCell = document.createElement('td');
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-account-button';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete ${account.role} account ${account.username}`);
      deleteButton.addEventListener('click', () => deleteManagedAccount(account));
      actionCell.appendChild(deleteButton);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
    table.appendChild(body);
    container.replaceChildren(table);
  } catch {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

async function deleteManagedAccount(account) {
  const accepted = window.confirm(
    `Delete sign-in access for ${account.display_name} (${account.username})? Their service records will be retained.`
  );
  if (!accepted) return;

  const container = document.getElementById('manager-account-list');
  try {
    const response = await fetch(`${API_BASE}/manager/accounts/${account.id}`, {
      method: 'DELETE',
      headers: requestHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      container.textContent = data.error || 'Unable to delete account.';
      return;
    }
    await loadManagerAccounts();
  } catch {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

// --- Manager: service checklist templates ----------------------------------
const SERVICE_TYPE_LABELS = { basic_service: 'Basic Service', full_service: 'Full Service', wof: 'WOF' };
// The checklist open in the editor and the version it was opened at.
let checklistEditorState = null;

function describeChecklistVersion(checklist) {
  return checklist.created_by
    ? `Version ${checklist.version} · updated ${new Date(checklist.created_at).toLocaleString()} by ${checklist.created_by}`
    : `Version ${checklist.version} · original template`;
}

async function loadManagerChecklists() {
  const container = document.getElementById('manager-checklist-list');
  container.textContent = 'Loading checklists...';

  try {
    const response = await fetch(`${API_BASE}/manager/checklists`, { headers: requestHeaders() });
    const data = await response.json();
    if (!response.ok) {
      container.textContent = data.error || 'Unable to load checklists.';
      return;
    }

    container.replaceChildren();
    data.checklists.forEach((checklist) => {
      const card = document.createElement('div');
      card.className = 'checklist-summary';
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = SERVICE_TYPE_LABELS[checklist.service_type] || checklist.service_type;
      const meta = document.createElement('p');
      meta.textContent = `${checklist.items.length} items · ${describeChecklistVersion(checklist)}`;
      text.append(title, meta);

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'details-btn';
      editButton.textContent = 'Edit';
      editButton.setAttribute('aria-label', `Edit ${title.textContent} checklist`);
      editButton.addEventListener('click', () => openChecklistEditor(checklist));
      card.append(text, editButton);
      container.appendChild(card);
    });
  } catch {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

function openChecklistEditor(checklist) {
  checklistEditorState = { serviceType: checklist.service_type, baseVersion: checklist.version };
  const label = SERVICE_TYPE_LABELS[checklist.service_type] || checklist.service_type;
  document.getElementById('checklist-editor-title').textContent = `Edit ${label} checklist (version ${checklist.version})`;
  document.getElementById('checklist-editor-empty').hidden = true;
  document.getElementById('checklist-editor-form').hidden = false;
  const result = document.getElementById('checklist-editor-result');
  result.textContent = '';
  result.className = '';

  document.getElementById('checklist-editor-items').replaceChildren();
  checklist.items.forEach((item) => addChecklistEditorRow(item));
  renumberChecklistEditorRows();
  loadChecklistVersions(checklist.service_type);
}

function closeChecklistEditor() {
  checklistEditorState = null;
  document.getElementById('checklist-editor-title').textContent = 'Edit a checklist';
  document.getElementById('checklist-editor-form').hidden = true;
  document.getElementById('checklist-editor-empty').hidden = false;
}

function createRowButton(text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className} checklist-row-button`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function addChecklistEditorRow(value = '') {
  const list = document.getElementById('checklist-editor-items');
  const row = document.createElement('li');
  row.className = 'checklist-editor-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.minLength = 3;
  input.maxLength = 200;
  input.required = true;

  const moveUp = createRowButton('↑', 'details-btn', () => {
    if (row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    renumberChecklistEditorRows();
  });
  const moveDown = createRowButton('↓', 'details-btn', () => {
    if (row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    renumberChecklistEditorRows();
  });
  const remove = createRowButton('Remove', 'delete-account-button', () => {
    row.remove();
    renumberChecklistEditorRows();
  });

  row.append(input, moveUp, moveDown, remove);
  list.appendChild(row);
  return input;
}

// Keeps accessible labels and the first/last move buttons in sync with the order.
function renumberChecklistEditorRows() {
  const rows = [...document.getElementById('checklist-editor-items').children];
  rows.forEach((row, index) => {
    const [input, moveUp, moveDown, remove] = row.children;
    input.setAttribute('aria-label', `Checklist item ${index + 1}`);
    moveUp.setAttribute('aria-label', `Move item ${index + 1} up`);
    moveDown.setAttribute('aria-label', `Move item ${index + 1} down`);
    remove.setAttribute('aria-label', `Remove item ${index + 1}`);
    moveUp.disabled = index === 0;
    moveDown.disabled = index === rows.length - 1;
  });
}

async function loadChecklistVersions(serviceType) {
  const container = document.getElementById('checklist-version-list');
  container.textContent = 'Loading versions...';

  try {
    const response = await fetch(`${API_BASE}/manager/checklists/${serviceType}/versions`, { headers: requestHeaders() });
    const data = await response.json();
    if (!response.ok) {
      container.textContent = data.error || 'Unable to load previous versions.';
      return;
    }

    container.replaceChildren();
    data.versions.forEach((version, index) => {
      const entry = document.createElement('details');
      entry.className = 'checklist-version';
      const summary = document.createElement('summary');
      summary.textContent = `${describeChecklistVersion(version)} · ${version.items.length} items${index === 0 ? ' (current)' : ''}`;
      const items = document.createElement('ol');
      version.items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        items.appendChild(li);
      });
      entry.append(summary, items);
      container.appendChild(entry);
    });
  } catch {
    container.textContent = 'Could not reach the server. Please try again.';
  }
}

document.getElementById('checklist-add-item').addEventListener('click', () => {
  const input = addChecklistEditorRow();
  renumberChecklistEditorRows();
  input.focus();
});

document.getElementById('checklist-editor-cancel').addEventListener('click', closeChecklistEditor);

document.getElementById('checklist-editor-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!checklistEditorState) return;
  const result = document.getElementById('checklist-editor-result');
  const items = [...document.querySelectorAll('#checklist-editor-items input')].map((input) => input.value);

  try {
    const response = await fetch(`${API_BASE}/manager/checklists/${checklistEditorState.serviceType}`, {
      method: 'PUT',
      headers: requestHeaders(true),
      body: JSON.stringify({ items, baseVersion: checklistEditorState.baseVersion }),
    });
    const data = await response.json();
    if (!response.ok) {
      result.textContent = data.error || 'Unable to save the checklist.';
      result.className = 'result-error';
      // Someone else saved first: refresh the list so the newer version is visible.
      if (response.status === 409) loadManagerChecklists();
      return;
    }

    const label = SERVICE_TYPE_LABELS[data.checklist.service_type] || data.checklist.service_type;
    checklistEditorState.baseVersion = data.checklist.version;
    document.getElementById('checklist-editor-title').textContent = `Edit ${label} checklist (version ${data.checklist.version})`;
    result.textContent = `Saved as version ${data.checklist.version}. New ${label} jobs will use this checklist.`;
    result.className = 'result-success';
    loadManagerChecklists();
    loadChecklistVersions(data.checklist.service_type);
  } catch {
    result.textContent = 'Could not reach the server. Please try again.';
    result.className = 'result-error';
  }
});

async function loadManagerPortal() {
  loadManagerAccounts();
  loadManagerChecklists();
  const filterSelect = document.getElementById('manager-mechanic-filter');
  const fromInput = document.getElementById('manager-date-from');
  const toInput = document.getElementById('manager-date-to');
  const rangeSummary = document.getElementById('manager-range-summary');
  const selectedMechanic = filterSelect.value;
  const jobsContainer = document.getElementById('manager-jobs-list');
  jobsContainer.textContent = 'Loading...';

  try {
    // Empty dates let the server apply its default (the last 30 days).
    const params = new URLSearchParams();
    if (selectedMechanic) params.set('mechanic', selectedMechanic);
    if (fromInput.value) params.set('from', fromInput.value);
    if (toInput.value) params.set('to', toInput.value);
    const query = params.toString() ? `?${params}` : '';
    const [dashboardRes, jobsRes] = await Promise.all([
      fetch(`${API_BASE}/manager/dashboard${query}`, { headers: requestHeaders() }),
      fetch(`${API_BASE}/manager/jobs${query}`, { headers: requestHeaders() }),
    ]);
    const dashboardData = await dashboardRes.json();
    const jobsData = await jobsRes.json();

    if (!dashboardRes.ok) {
      rangeSummary.textContent = dashboardData.error || 'Unable to load the manager dashboard.';
      rangeSummary.className = 'dashboard-range-summary result-error';
      // Clear the cards so figures from the previous range are not mistaken for this one.
      ['stat-total-completed', 'stat-incomplete', 'stat-avg-time', 'stat-acceptance', 'stat-compliance', 'stat-avg-completion']
        .forEach((id) => { document.getElementById(id).textContent = '-'; });
      jobsContainer.textContent = '';
      return;
    }

    // Show the range actually applied, including the server's default.
    fromInput.value = dashboardData.range.from;
    toInput.value = dashboardData.range.to;
    rangeSummary.textContent = `Showing jobs completed ${formatDateOnly(dashboardData.range.from)} to ${formatDateOnly(dashboardData.range.to)}.`;
    rangeSummary.className = 'dashboard-range-summary';

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
    document.getElementById('stat-avg-time').textContent = formatHours(totals.averageRepairTimeHours);
    document.getElementById('stat-acceptance').textContent = formatPercent(totals.acceptanceRatePercent);
    document.getElementById('stat-compliance').textContent = formatPercent(totals.checklistCompliancePercent);
    document.getElementById('stat-avg-completion').textContent = formatPercent(totals.averageChecklistCompletionPercent);

    jobsContainer.innerHTML = '';
    if (jobsData.jobs.length === 0) {
      jobsContainer.textContent = 'No jobs were completed in this date range.';
      return;
    }
    jobsData.jobs.forEach((job) => {
      const card = document.createElement('div');
      card.className = 'booking-card job-card';
      card.innerHTML = `
        <strong>${escapeHTML(job.plate)} - ${escapeHTML(job.make)} ${escapeHTML(job.model)}</strong><br />
        Customer: ${escapeHTML(job.customer_name)}<br />
        Mechanic: ${escapeHTML(job.mechanic_name)} — ${escapeHTML(job.service_type.replace('_', ' '))}<br />
        Completed: ${escapeHTML(new Date(job.completed_at).toLocaleString())}
        <span class="badge ${job.checklist_compliant ? 'badge-completed' : 'badge-pending'}">${escapeHTML(job.job_status)}${job.checklist_compliant ? '' : ` · ${escapeHTML(job.completion_percent)}%`}</span>
      `;
      card.addEventListener('click', () => openJobDetails(job.job_id));
      jobsContainer.appendChild(card);
    });
  } catch (err) {
    jobsContainer.textContent = 'Could not reach the server. Please try again.';
  }
}

document.getElementById('manager-mechanic-filter').addEventListener('change', loadManagerPortal);
document.getElementById('manager-date-from').addEventListener('change', loadManagerPortal);
document.getElementById('manager-date-to').addEventListener('change', loadManagerPortal);
document.getElementById('manager-date-reset').addEventListener('click', () => {
  document.getElementById('manager-date-from').value = '';
  document.getElementById('manager-date-to').value = '';
  loadManagerPortal();
});

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
      ['Duration', job.completedEarly
        ? `${formatMinutes(job.durationMinutes)} (completed before the booked time)`
        : formatMinutes(job.durationMinutes)],
      ['Checklist result', `${job.status} (${job.completionPercent}% complete)`],
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
    checklistHeading.innerHTML = job.checklistVersion
      ? `<strong>Checklist (version ${escapeHTML(job.checklistVersion)}):</strong>`
      : '<strong>Checklist:</strong>';
    content.appendChild(checklistHeading);

    const list = document.createElement('ul');
    list.className = 'job-checklist';
    job.checklistItems.forEach(({ item, completed }) => {
      const li = document.createElement('li');
      li.className = completed ? 'job-checklist-done' : 'job-checklist-missed';
      const mark = document.createElement('span');
      mark.className = 'job-checklist-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = completed ? '✓' : '✗';
      const text = document.createElement('span');
      text.textContent = item;
      if (!completed) {
        const note = document.createElement('span');
        note.className = 'job-checklist-note';
        note.textContent = ' (not done)';
        text.appendChild(note);
      }
      li.append(mark, text);
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

  const res = await fetch(`${API_BASE}/vehicles/${vehicleId}/history`, {
    headers: requestHeaders(),
  });
  const data = await res.json();

  if (!res.ok) {
    container.textContent = data.error || 'Unable to load vehicle history.';
    return;
  }

  if (data.history.length === 0) {
    container.textContent = data.message || 'No history found.';
    return;
  }

  container.innerHTML = '';

  // Group entries by lineage so each edited entry has one visible card
  // with a click-to-expand dropdown for its older versions.
  const groups = new Map();
  data.history.forEach((entry) => {
    if (!groups.has(entry.root_entry_id)) groups.set(entry.root_entry_id, []);
    groups.get(entry.root_entry_id).push(entry);
  });

  const sortedGroups = [...groups.values()].sort(
    (a, b) => new Date(b[0].created_at.replace(' ', 'T')) - new Date(a[0].created_at.replace(' ', 'T'))
  );

  sortedGroups.forEach((groupEntries) => {
    // The non-superseded entry is the current version; fall back to the first
    // entry so a lineage never disappears if every row were somehow flagged.
    const current = groupEntries.find((entry) => !entry.is_superseded) || groupEntries[0];
    const olderVersions = groupEntries.filter((entry) => entry.id !== current.id);

    const card = document.createElement('div');
    card.className = 'history-card';
    const badgeClass = current.status === 'fixed' ? 'badge-fixed' : 'badge-flagged';

    card.innerHTML = `
      <strong>${escapeHTML(current.fault_description)}</strong>
      <span class="badge ${escapeHTML(badgeClass)}">${escapeHTML(current.status.replace('_', ' '))}</span><br />
      Severity: ${escapeHTML(current.severity)} — ${escapeHTML(new Date(current.created_at.replace(' ', 'T')).toLocaleString())}
    `;

    // Only the current (non-superseded) version of an entry can be edited;
    // older versions stay visible for the record but are read-only.
    if (loggedInAccount?.role === 'mechanic') {
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.className = 'details-btn';
      editBtn.addEventListener('click', () => openDiagnosticEditModal(current, vehicleId));
      card.appendChild(editBtn);
    }

    if (olderVersions.length > 0) {
      const details = document.createElement('details');
      details.className = 'history-edit-trail';

      const summary = document.createElement('summary');
      summary.textContent = `${olderVersions.length} earlier ${olderVersions.length === 1 ? 'version' : 'versions'}`;
      details.appendChild(summary);

      olderVersions.forEach((entry) => {
        const oldBadgeClass = entry.status === 'fixed' ? 'badge-fixed' : 'badge-flagged';
        const oldEntry = document.createElement('div');
        oldEntry.className = 'history-card history-card-old';
        oldEntry.innerHTML = `
          <strong>${escapeHTML(entry.fault_description)}</strong>
          <span class="badge ${escapeHTML(oldBadgeClass)}">${escapeHTML(entry.status.replace('_', ' '))}</span><br />
          Severity: ${escapeHTML(entry.severity)} — ${escapeHTML(new Date(entry.created_at.replace(' ', 'T')).toLocaleString())}
        `;
        details.appendChild(oldEntry);
      });

      card.appendChild(details);
    }

    container.appendChild(card);
  });
}

// --- Diagnostic entry editing (mechanic only) ------------------------------
let editingDiagnosticId = null;
let editingDiagnosticVehicleId = null;

function openDiagnosticEditModal(entry, vehicleId) {
  editingDiagnosticId = entry.id;
  editingDiagnosticVehicleId = vehicleId;

  const resultBox = document.getElementById('diagnostic-edit-result');
  resultBox.textContent = '';
  resultBox.className = '';

  document.getElementById('edit-fault-description').value = entry.fault_description;
  document.getElementById('edit-diagnostic-severity').value = entry.severity;
  document.getElementById('edit-diagnostic-status').value = entry.status;

  document.getElementById('diagnostic-edit-modal').hidden = false;
}

function closeDiagnosticEditModal() {
  document.getElementById('diagnostic-edit-modal').hidden = true;
  editingDiagnosticId = null;
  editingDiagnosticVehicleId = null;
}

document.getElementById('close-diagnostic-edit-modal').addEventListener('click', closeDiagnosticEditModal);
document.getElementById('diagnostic-edit-modal').addEventListener('click', (event) => {
  if (event.target.id === 'diagnostic-edit-modal') closeDiagnosticEditModal();
});

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  signupError.textContent = '';
  const formData = new FormData(signupForm);

  try {
    const response = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: formData.get('displayName'),
        email: formData.get('email'),
        username: formData.get('username'),
        password: formData.get('password'),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      signupError.textContent = data.error || 'Unable to create your account.';
      return;
    }

    acceptLoginSession(data);
  } catch {
    signupError.textContent = 'Could not reach the server. Please try again.';
  }
});

document.getElementById('create-mechanic-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById('create-mechanic-result');
  result.textContent = '';
  const formData = new FormData(form);

  try {
    const response = await fetch(`${API_BASE}/manager/accounts/mechanics`, {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({
        displayName: formData.get('displayName'),
        username: formData.get('username'),
        password: formData.get('password'),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      result.textContent = data.error || 'Unable to create mechanic account.';
      result.className = 'result-error';
      return;
    }

    form.reset();
    result.textContent = `Mechanic account created for ${data.account.display_name}.`;
    result.className = 'result-success';
    await loadManagerAccounts();
  } catch {
    result.textContent = 'Could not reach the server. Please try again.';
    result.className = 'result-error';
  }
});

document.getElementById('diagnostic-edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const resultBox = document.getElementById('diagnostic-edit-result');
  const formData = new FormData(form);

  try {
    const res = await fetch(`${API_BASE}/mechanics/diagnostics/${editingDiagnosticId}`, {
      method: 'PUT',
      headers: requestHeaders(true),
      body: JSON.stringify({
        faultDescription: formData.get('faultDescription'),
        severity: formData.get('severity'),
        status: formData.get('status'),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      resultBox.textContent = data.error || 'Unable to save changes.';
      resultBox.className = 'result-error';
      return;
    }

    const vehicleId = editingDiagnosticVehicleId;
    closeDiagnosticEditModal();
    loadHistory(vehicleId);
  } catch (err) {
    resultBox.textContent = 'Could not reach the server. Please try again.';
    resultBox.className = 'result-error';
  }
});

// --- Initial load ----------------------------------------------------------
async function initializeApp() {
  restoreLoggedInAccount();

  if (authToken) {
    try {
      const response = await fetch(`${API_BASE}/auth/session`, { headers: requestHeaders() });
      const data = await response.json();
      if (response.ok) {
        loggedInAccount = data.account;
        localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ token: authToken, account: loggedInAccount }));
      } else {
        authToken = null;
        loggedInAccount = null;
        localStorage.removeItem(STORED_SESSION_KEY);
        clearPrivateVehicleData();
      }
    } catch {
      loggedInAccount = null;
    }
  }

  updateAccountControls();
  const bookingDateInput = document.getElementById('booking-date');
  bookingDateInput.min = localDateString();
  bookingDateInput.value = localDateString();
  if (loggedInAccount?.role === 'customer') {
    loadVehicleOptions('vehicle-select');
    loadAvailableTimeSlots();
    document.getElementById('customer-home-nav-button').click();
  } else if (loggedInAccount?.role === 'mechanic') {
    document.getElementById('bookings-nav-button').click();
  } else if (loggedInAccount?.role === 'manager') {
    document.getElementById('manager-nav-button').click();
  }
}

initializeApp();
