/**
 * workshopTime.js
 *
 * One place for converting between the workshop's local time and UTC.
 * Booking slots are stored as workshop-local wall time ('YYYY-MM-DD HH:MM:SS'),
 * while event timestamps (completed_at, decided_at, cancelled_at) are stored as
 * UTC ISO strings. Mixing the two without converting caused defects D03 and D10.
 */

const WORKSHOP_TIMEZONE = process.env.WORKSHOP_TIMEZONE || 'Pacific/Auckland';

// Wall-clock parts of an instant in the workshop's timezone.
function workshopParts(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: WORKSHOP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant).map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Current date and hour in the workshop's timezone.
function workshopClock(now = new Date()) {
  const { date, hour } = workshopParts(now);
  return { date, hour };
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Accepts real calendar dates in YYYY-MM-DD form only (rejects e.g. 2026-02-30).
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Offset (ms) between workshop wall time and UTC at a given instant.
function workshopOffsetMs(instantMs) {
  const { date, hour, minute, second } = workshopParts(new Date(instantMs));
  const wallAsUtc = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Converts workshop wall time ('YYYY-MM-DD HH:MM[:SS]' or 'YYYY-MM-DD') to a UTC Date.
 * Returns null for anything unparseable.
 */
function workshopLocalToUtc(localDateTime) {
  const match = typeof localDateTime === 'string'
    && localDateTime.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match || !isValidDateString(match[1])) return null;

  const [, date, hour = '00', minute = '00', second = '00'] = match;
  const wallAsUtc = Date.parse(`${date}T${hour}:${minute}:${second}Z`);
  // Two passes so the offset is taken at the real instant (correct across DST changes).
  let instant = wallAsUtc - workshopOffsetMs(wallAsUtc);
  instant = wallAsUtc - workshopOffsetMs(instant);
  return new Date(instant);
}

module.exports = {
  WORKSHOP_TIMEZONE,
  addDays,
  isValidDateString,
  workshopClock,
  workshopLocalToUtc,
};
