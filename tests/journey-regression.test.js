const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, 'fixtures', 'journey-regression.json');
const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

assert.ok(Array.isArray(cases) && cases.length > 0, 'The journey regression catalogue must contain cases.');
assert.equal(new Set(cases.map(item => item.id)).size, cases.length, 'Every journey case needs a unique ID.');

for (const item of cases) {
  assert.match(item.id, /^[a-z0-9-]+$/, `${item.id}: IDs use lowercase letters, numbers, and hyphens.`);
  assert.ok(item.origin?.name && item.destination?.name, `${item.id}: origin and destination names are required.`);
  assert.match(item.departure?.time || '', /^([01]\d|2[0-3]):[0-5]\d$/, `${item.id}: departure time must be HH:MM.`);
  assert.equal(item.departure?.timezone, 'Asia/Kuala_Lumpur', `${item.id}: use Malaysia's routing timezone.`);
  assert.ok(Array.isArray(item.scenario) && item.scenario.length, `${item.id}: at least one scenario is required.`);
  assert.ok(item.expected?.preferred_mode, `${item.id}: declare the expected preferred mode.`);
  assert.ok(['needs_field_verification', 'verified', 'blocked'].includes(item.status), `${item.id}: invalid verification status.`);
  for (const point of [item.origin, item.destination]) {
    const hasCoordinates = Number.isFinite(point.lat) && Number.isFinite(point.lng);
    const isPending = point.lat === null && point.lng === null;
    assert.ok(hasCoordinates || isPending, `${item.id}: coordinates must be both present or both pending.`);
  }
}

console.log(`Journey regression catalogue is valid (${cases.length} cases; ${cases.filter(item => item.status === 'verified').length} verified).`);
