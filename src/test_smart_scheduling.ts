import {
  calculateOrderPrepDuration,
  calculateLocalOrderSchedule,
  getPrepUrgencyStatus,
  ScheduledCartItem
} from '../src/lib/smartScheduling';
import { LunchSlotConfig, parseTimeToMinutes, minutesToTimeString, formatSingleTime } from '../src/lib/lunchSlots';

const testConfig: LunchSlotConfig = {
  serviceStartTime: '12:00',
  serviceEndTime: '14:00',
  slotDurationMinutes: 15,
  minNoticeMinutes: 15,
  isLunchEnabled: true,
  disabledSlots: [],
  slotCapacities: {},
  maxConcurrentOrders: 15,
  defaultPrepTimeMinutes: 10,
  orderCutoffMinutes: 15,
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${testName} - ${details || ''}`);
    failed++;
  }
}

console.log('--- TEST SUITE: SMART PREPARATION SCHEDULING ---');

// Test 1: Non-10-minute times (12:17 PM, 12:26 PM, 12:43 PM)
console.log('\n[Scenario 1: Arbitrary Flexible Minutes]');
const currentISTMin = parseTimeToMinutes('11:30'); // Early morning before service

const schedule1217 = calculateLocalOrderSchedule('12:17', [], testConfig, currentISTMin);
assert(schedule1217.isAvailable === true, '12:17 is accepted as valid pickup time');
assert(schedule1217.pickupTimeFormatted === '12:17 PM', '12:17 formats to 12:17 PM');
assert(schedule1217.plannedPrepStartTime.includes('12:07'), 'Prep starts 10m before (12:07)', schedule1217.plannedPrepStartTime);

const schedule1226 = calculateLocalOrderSchedule('12:26', [], testConfig, currentISTMin);
assert(schedule1226.isAvailable === true, '12:26 is accepted as valid pickup time');
assert(schedule1226.pickupTimeFormatted === '12:26 PM', '12:26 formats to 12:26 PM');
assert(schedule1226.plannedPrepStartTime.includes('12:16'), 'Prep starts at 12:16', schedule1226.plannedPrepStartTime);

const schedule1243 = calculateLocalOrderSchedule('12:43', [], testConfig, currentISTMin);
assert(schedule1243.isAvailable === true, '12:43 is accepted as valid pickup time');
assert(schedule1243.pickupTimeFormatted === '12:43 PM', '12:43 formats to 12:43 PM');
assert(schedule1243.plannedPrepStartTime.includes('12:33'), 'Prep starts at 12:33', schedule1243.plannedPrepStartTime);

// Test 2: Concurrent Preparation Time Calculation
console.log('\n[Scenario 2: Concurrent Kitchen Cooking Model]');
const singleItem: ScheduledCartItem[] = [{ id: '1', quantity: 1, prep_time_minutes: 10, name: 'Burger' }];
const prepSingle = calculateOrderPrepDuration(singleItem, 10);
assert(prepSingle === 10, 'Single item takes exact item prep time (10m)');

const multiItems: ScheduledCartItem[] = [
  { id: '1', quantity: 1, prep_time_minutes: 10, name: 'Burger' },
  { id: '2', quantity: 2, prep_time_minutes: 8, name: 'Fries' },
  { id: '3', quantity: 1, prep_time_minutes: 5, name: 'Drink' },
];
// total quantity = 4. max prep = 10. additional items = 3. total = 10 + 3 = 13 mins (NOT 10+8+8+5 = 31 mins naive sum)
const prepMulti = calculateOrderPrepDuration(multiItems, 10);
assert(prepMulti === 13, `Multi-item concurrent prep duration is 13m (got ${prepMulti})`);

// Test 3: Planned Prep Start Time Formula
console.log('\n[Scenario 3: Planned Prep Start Time = Requested Pickup - Prep Duration]');
// Pickup 12:30, multiItems (13m prep) -> Prep start 12:17, Ready by 12:30
const schedule1230Multi = calculateLocalOrderSchedule('12:30', multiItems, testConfig, currentISTMin);
assert(schedule1230Multi.isAvailable === true, '12:30 order is valid');
assert(schedule1230Multi.estimatedPrepDurationMinutes === 13, 'Prep duration is 13 mins');
assert(schedule1230Multi.plannedPrepStartTime.includes('12:17'), 'Prep starts at 12:17', schedule1230Multi.plannedPrepStartTime);
assert(schedule1230Multi.prepStartFormatted === '12:17 PM', 'Prep start formatted is 12:17 PM');
assert(schedule1230Multi.readyByFormatted === '12:30 PM', 'Ready by formatted is 12:30 PM');

// Test 4: Out of Bounds (Service Hours)
console.log('\n[Scenario 4: Service Hours Boundary Enforcement]');
const scheduleEarly = calculateLocalOrderSchedule('11:45', [], testConfig, currentISTMin);
assert(scheduleEarly.isAvailable === false, 'Time before 12:00 PM is rejected');
assert(scheduleEarly.error?.includes('during lunch service') === true, 'Error explains service window requirement');

const scheduleLate = calculateLocalOrderSchedule('14:15', [], testConfig, currentISTMin);
assert(scheduleLate.isAvailable === false, 'Time after 2:00 PM is rejected');
assert(scheduleLate.error?.includes('during lunch service') === true || scheduleLate.error?.includes('closing') === true, 'Error explains closing time');

// Test 5: Insufficient Preparation Lead Time (Prep Start In The Past)
console.log('\n[Scenario 5: Insufficient Preparation Lead Time]');
const currentMidday = parseTimeToMinutes('12:25'); // Current time is 12:25 PM
// If user selects 12:30 with 10m prep: requires prep to start at 12:20 (5 mins ago!)
const scheduleTooSoon = calculateLocalOrderSchedule('12:30', singleItem, testConfig, currentMidday);
assert(scheduleTooSoon.isAvailable === false, 'Order with past prep start time is rejected');
assert(scheduleTooSoon.suggestedPickupTime !== undefined, 'Suggests nearest feasible alternative');
console.log(`  Suggested alternative pickup: ${scheduleTooSoon.suggestedPickupFormatted}`);

// Test 6: Staff Urgency Calculation
console.log('\n[Scenario 6: Kitchen Urgency Status]');
const nowMs = new Date('2026-10-12T12:00:00+05:30').getTime();

const upcomingOrder = {
  status: 'ACCEPTED',
  planned_prep_start_time: '2026-10-12T12:15:00+05:30', // In 15 mins
};
const upcomingStatus = getPrepUrgencyStatus(upcomingOrder, nowMs);
assert(upcomingStatus.stage === 'UPCOMING', '15m in future is UPCOMING');

const urgentOrder = {
  status: 'ACCEPTED',
  planned_prep_start_time: '2026-10-12T11:58:00+05:30', // 2 mins overdue
};
const urgentStatus = getPrepUrgencyStatus(urgentOrder, nowMs);
assert(urgentStatus.stage === 'START_NOW', 'Overdue prep start is START_NOW');

const cookingOrder = {
  status: 'PREPARING',
  planned_prep_start_time: '2026-10-12T11:50:00+05:30',
};
const cookingStatus = getPrepUrgencyStatus(cookingOrder, nowMs);
assert(cookingStatus.stage === 'COOKING', 'Status PREPARING is COOKING');

const readyOrder = {
  status: 'READY',
};
const readyStatus = getPrepUrgencyStatus(readyOrder, nowMs);
assert(readyStatus.stage === 'READY', 'Status READY is READY');

console.log(`\n========================================`);
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
