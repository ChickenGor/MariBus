const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window:{} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/transit-services.js','utf8'), context);
const services = context.window.MariBusTransitServices;

assert.equal(services.JourneyState.ON_BUS, 'ON_BUS');
assert.equal(services.adviseLeaveNow({ walkingSeconds:480, busMinutes:14 }).tone, 'likely');
assert.equal(services.adviseLeaveNow({ walkingSeconds:480, busMinutes:18 }).tone, 'plenty');
assert.equal(services.adviseLeaveNow({ walkingSeconds:720, busMinutes:7, nextBusMinutes:21 }).tone, 'miss');
assert.equal(services.adviseLeaveNow({ walkingSeconds:600, busMinutes:NaN }).tone, 'unknown');
assert.equal(services.occupancy('MANY_SEATS_AVAILABLE').label, 'Seats available');
assert.equal(services.occupancy('UNSUPPORTED_VALUE'), null);

console.log('Transit service tests passed');
