/**
 * checklists.js
 *
 * NFR05 - service checklist templates are versioned, never edited in place.
 * Each save adds a new row with the next version number for that service type:
 *  - new jobs always load the latest version, so a manager's change applies
 *    immediately without a code change or redeploy;
 *  - completed jobs keep the checklist_id of the version they were done with,
 *    so their recorded checklist never changes afterwards.
 */

const SERVICE_TYPES = ['basic_service', 'full_service', 'wof'];
const MAX_ITEMS = 30;
const MIN_ITEM_LENGTH = 3;
const MAX_ITEM_LENGTH = 200;

function toChecklist(row) {
  if (!row) return null;
  const { items_json: itemsJson, ...checklist } = row;
  return { ...checklist, items: JSON.parse(itemsJson) };
}

function getLatestChecklist(db, serviceType) {
  return toChecklist(db.prepare(
    'SELECT * FROM checklists WHERE service_type = ? ORDER BY version DESC LIMIT 1'
  ).get(serviceType));
}

function getChecklistById(db, id) {
  return toChecklist(db.prepare('SELECT * FROM checklists WHERE id = ?').get(id));
}

function listLatestChecklists(db) {
  return SERVICE_TYPES.map((serviceType) => getLatestChecklist(db, serviceType)).filter(Boolean);
}

function listChecklistVersions(db, serviceType) {
  return db.prepare(
    'SELECT * FROM checklists WHERE service_type = ? ORDER BY version DESC'
  ).all(serviceType).map(toChecklist);
}

// Returns { items } with trimmed values, or { error } explaining what is wrong.
function validateChecklistItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'A checklist needs at least one item.' };
  }
  if (items.length > MAX_ITEMS) {
    return { error: `A checklist can have at most ${MAX_ITEMS} items.` };
  }

  const cleaned = items.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (cleaned.some((item) => item.length < MIN_ITEM_LENGTH || item.length > MAX_ITEM_LENGTH)) {
    return { error: `Each checklist item must be ${MIN_ITEM_LENGTH} to ${MAX_ITEM_LENGTH} characters.` };
  }

  const seen = new Set();
  const duplicate = cleaned.find((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (duplicate) {
    return { error: `"${duplicate}" appears more than once. Each checklist item must be unique.` };
  }

  return { items: cleaned };
}

module.exports = {
  SERVICE_TYPES,
  getChecklistById,
  getLatestChecklist,
  listChecklistVersions,
  listLatestChecklists,
  validateChecklistItems,
};
