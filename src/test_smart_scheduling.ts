import {
  calculateOrderPrepDuration,
  calculateLocalOrderSchedule,
  getPrepUrgencyStatus,
  verifyBackendOrderSchedule,
  ScheduledCartItem,
} from './lib/smartScheduling';
import {
  LunchSlotConfig,
  parseTimeToMinutes,
  minutesToTimeString,
  formatSingleTime,
  normalizeTimeTo24h,
  isValidTimeString,
  getISTDateTime,
  getAvailableServiceDates,
  getNextFeasibleServiceDate,
  DEFAULT_LUNCH_SLOT_CONFIG,
} from './lib/lunchSlots';

const baseConfig: LunchSlotConfig = {
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

console.log('====================================================');
console.log('  SKIP TRAY CANTEEN: COMPREHENSIVE SCHEDULING TESTS ');
console.log('====================================================');

// Fixed mock reference timestamp: Wednesday, 2026-10-14 16:43:00 IST (4:43 PM)
// 16:43 IST = 1003 minutes
const mockCurrentTime443PM = new Date('2026-10-14T16:43:00+05:30').getTime();
const mockCurrentTime11AM = new Date('2026-10-14T11:00:00+05:30').getTime();
const mockCurrentTime1230PM = new Date('2026-10-14T12:30:00+05:30').getTime();

// --- Test 1: Before booking opens (before 9:30 AM) ---
console.log('\n[Test 1: Before booking opens]');
{
  const earlyMs = new Date('2026-10-14T08:30:00+05:30').getTime(); // 8:30 AM
  const currentIST = parseTimeToMinutes('08:30');
  const res = calculateLocalOrderSchedule('12:30', [], baseConfig, currentIST, '2026-10-14', earlyMs);
  // Evaluates validity of requested lunch time for today
  assert(res.pickupTimeStr === '12:30', '12:30 parsed correctly');
}

// --- Test 2: During booking hours before lunch service (e.g. 11:00 AM) ---
console.log('\n[Test 2: During booking hours before lunch service]');
{
  const currentIST = parseTimeToMinutes('11:00');
  const res = calculateLocalOrderSchedule('12:30', [], baseConfig, currentIST, '2026-10-14', mockCurrentTime11AM);
  assert(res.isValid === true, '12:30 accepted before service starts at 11:00 AM');
  assert(res.validationCode === 'VALID', 'validationCode is VALID');
  assert(res.statusBadge === '12:30 PM', 'statusBadge displays 12:30 PM');
}

// --- Test 3: During active lunch service (e.g. 12:30 PM) ---
console.log('\n[Test 3: During active lunch service]');
{
  const currentIST = parseTimeToMinutes('12:30');
  const res = calculateLocalOrderSchedule('13:15', [], baseConfig, currentIST, '2026-10-14', mockCurrentTime1230PM);
  assert(res.isValid === true, '13:15 is valid during active service at 12:30 PM');
  assert(res.prepStartFormatted === '1:05 PM', 'Preparation starts at 1:05 PM (10 min prep)');
}

// --- Test 4: Requested pickup time already in the past ---
console.log('\n[Test 4: Requested pickup time already in the past]');
{
  const currentIST = parseTimeToMinutes('13:00'); // 1:00 PM
  const midServiceMs = new Date('2026-10-14T13:00:00+05:30').getTime();
  const res = calculateLocalOrderSchedule('12:15', [], baseConfig, currentIST, '2026-10-14', midServiceMs);
  assert(res.isValid === false, '12:15 PM rejected when current time is 1:00 PM');
  assert(res.validationCode === 'PAST_TIME', 'validationCode is PAST_TIME');
  assert(res.statusBadge === 'Past Time', 'statusBadge is Past Time');
  assert(res.error?.includes('already passed') === true, 'Error explains time has passed');
  assert(res.suggestedPickupFormatted === '1:10 PM', 'Suggests earliest ready time 1:10 PM today');
}

// --- Test 5: Requested pickup time too soon for preparation ---
console.log('\n[Test 5: Requested pickup time too soon for preparation]');
{
  const currentIST = parseTimeToMinutes('12:15'); // 12:15 PM
  const currentMs = new Date('2026-10-14T12:15:00+05:30').getTime();
  const cart: ScheduledCartItem[] = [
    { id: '1', quantity: 5, prep_time_minutes: 10, name: 'Biryani' }, // 10 + 4 = 14 min prep
  ];
  const res = calculateLocalOrderSchedule('12:20', cart, baseConfig, currentIST, '2026-10-14', currentMs);
  assert(res.isValid === false, '12:20 rejected when 14 min prep needed at 12:15');
  assert(res.validationCode === 'INSUFFICIENT_LEAD_TIME', 'validationCode is INSUFFICIENT_LEAD_TIME');
  assert(res.statusBadge === 'Too Soon', 'statusBadge is Too Soon');
  assert(res.suggestedPickupFormatted === '12:29 PM', 'Suggests 12:29 PM (12:15 + 14m)');
}

// --- Test 6: Pickup time exactly at the service closing boundary ---
console.log('\n[Test 6: Pickup time exactly at service closing boundary (14:00)]');
{
  const currentIST = parseTimeToMinutes('11:00');
  const res = calculateLocalOrderSchedule('14:00', [], baseConfig, currentIST, '2026-10-14', mockCurrentTime11AM);
  assert(res.isValid === true, '14:00 (2:00 PM) accepted when booked in advance');
  assert(res.pickupTimeFormatted === '2:00 PM', 'Formats to 2:00 PM');
  assert(res.plannedPrepStartTime.includes('T13:50:00'), 'Planned prep start is 13:50:00 (10 mins before close)');
}

// --- Test 7: Current time after lunch service closes (THE ROOT CAUSE BUG: 4:43 PM selecting 1:00 PM) ---
console.log('\n[Test 7: CRITICAL ROOT CAUSE BUG - 4:43 PM selecting 1:00 PM today]');
{
  const currentIST = parseTimeToMinutes('16:43'); // 4:43 PM (1003 minutes)
  const cart: ScheduledCartItem[] = [
    { id: '1', quantity: 2, prep_time_minutes: 10, name: 'Meals' }, // 10 + 1 = 11 mins prep
  ];

  const res = calculateLocalOrderSchedule('13:00', cart, baseConfig, currentIST, '2026-10-14', mockCurrentTime443PM);

  assert(res.isValid === false, '1:00 PM rejected at 4:43 PM');
  assert(res.validationCode === 'NO_FEASIBLE_TIME_TODAY', 'validationCode is NO_FEASIBLE_TIME_TODAY (not generic or misleading)');
  assert(res.statusBadge === 'Closed', 'statusBadge is "Closed"');
  assert(res.error?.includes('closed for today') === true, 'Error message explicitly explains lunch service has closed for today');

  // CRITICAL CHECK: Never suggest 2:00 PM today after closing!
  assert(res.suggestedPickupTime !== '14:00' || res.suggestedDateStr !== '2026-10-14', 'DO NOT suggest 2:00 PM today when service is closed');
  assert(res.suggestedDateStr === '2026-10-15', 'Suggests tomorrow (2026-10-15)');
  assert(res.suggestedDateFormatted?.includes('Tomorrow') || res.suggestedDateFormatted?.includes('Thursday'), 'Suggested date formatted includes Tomorrow/Thursday');
  assert(res.suggestedPickupTime === '12:00', 'Suggests opening time tomorrow (12:00 PM)');
  assert(res.suggestedPickupFormatted === '12:00 PM', 'Formatted suggestion is 12:00 PM');
}

// --- Test 8: No remaining feasible pickup times today (e.g. 1:55 PM needing 15 min prep) ---
console.log('\n[Test 8: No remaining feasible pickup times today]');
{
  const currentIST = parseTimeToMinutes('13:55'); // 1:55 PM (closes at 2:00 PM, needs 10 min prep)
  const currentMs = new Date('2026-10-14T13:55:00+05:30').getTime();
  const res = calculateLocalOrderSchedule('14:00', [], baseConfig, currentIST, '2026-10-14', currentMs);
  assert(res.isValid === false, '14:00 rejected when 10 min prep would finish at 14:05 (past 14:00 closing)');
  assert(res.validationCode === 'NO_FEASIBLE_TIME_TODAY', 'validationCode is NO_FEASIBLE_TIME_TODAY');
  assert(res.suggestedDateStr === '2026-10-15', 'Suggests tomorrow as next service date');
}

// --- Test 9: Next configured service date when future bookings are enabled ---
console.log('\n[Test 9: Future date booking for Tomorrow]');
{
  // User selects tomorrow 2026-10-15 at 1:00 PM while current time is today 4:43 PM
  const currentIST = parseTimeToMinutes('16:43');
  const resTomorrow = calculateLocalOrderSchedule('13:00', [], baseConfig, currentIST, '2026-10-15', mockCurrentTime443PM);
  assert(resTomorrow.isValid === true, '1:00 PM tomorrow is VALID even when placed at 4:43 PM today');
  assert(resTomorrow.validationCode === 'VALID', 'validationCode is VALID');
  assert(resTomorrow.serviceDateStr === '2026-10-15', 'serviceDateStr is 2026-10-15');
  assert(resTomorrow.requestedPickupTime.startsWith('2026-10-15T13:00:00+05:30'), 'Timestamp has tomorrow date in IST');
  assert(resTomorrow.plannedPrepStartTime.startsWith('2026-10-15T12:50:00+05:30'), 'Planned prep start is on tomorrow at 12:50');
}

// --- Test 10: Sunday canteen restriction (Closed on Sundays) ---
console.log('\n[Test 10: Sunday restriction and skipping to Monday]');
{
  // 2026-10-18 is a Sunday
  const sundayStr = '2026-10-18';
  const sundayMs = new Date('2026-10-18T12:30:00+05:30').getTime();
  const resSunday = calculateLocalOrderSchedule('12:30', [], baseConfig, 750, sundayStr, sundayMs);
  assert(resSunday.isValid === false, 'Orders rejected on Sunday');
  assert(resSunday.validationCode === 'CLOSED_ON_SUNDAYS', 'validationCode is CLOSED_ON_SUNDAYS');
  assert(resSunday.error?.includes('Sundays') === true, 'Error explains canteen closed on Sundays');
}

// --- Test 11: Quick suggestions generation for today vs future date ---
console.log('\n[Test 11: Quick suggestions behavior]');
{
  const prep = 10;
  // Today at 4:43 PM: getAvailableServiceDates
  const dates = getAvailableServiceDates(mockCurrentTime443PM, baseConfig, prep, 3);
  assert(dates[0].isToday === true, 'First date is Today');
  assert(dates[0].isBookable === false, 'Today is not bookable after lunch closing');
  assert(dates[0].unbookableReason?.includes('Closed') === true, 'Reason explains closed for today');
  assert(dates[1].dayName === 'Tomorrow', 'Second date is Tomorrow');
  assert(dates[1].isBookable === true, 'Tomorrow is bookable');

  // getNextFeasibleServiceDate returns Tomorrow
  const nextFeasible = getNextFeasibleServiceDate(mockCurrentTime443PM, baseConfig, prep);
  assert(nextFeasible.dateStr === '2026-10-15', 'Next feasible service date is Tomorrow (2026-10-15)');
}

// --- Test 12: Valid pickup time selected manually ---
console.log('\n[Test 12: Valid pickup time selected manually (e.g. 12:47)]');
{
  const currentIST = parseTimeToMinutes('11:00');
  const res = calculateLocalOrderSchedule('12:47', [], baseConfig, currentIST, '2026-10-14', mockCurrentTime11AM);
  assert(res.isValid === true, 'Exact minute 12:47 is accepted');
  assert(res.pickupTimeStr === '12:47', 'pickupTimeStr is 12:47');
  assert(res.pickupTimeFormatted === '12:47 PM', 'pickupTimeFormatted is 12:47 PM');
  assert(res.prepStartFormatted === '12:37 PM', 'prepStartFormatted is 12:37 PM');
}

// --- Test 13: Valid pickup time selected using a suggestion ---
console.log('\n[Test 13: Valid pickup time selected using suggestion (12:30)]');
{
  const currentIST = parseTimeToMinutes('11:30');
  const res = calculateLocalOrderSchedule('12:30', [], baseConfig, currentIST, '2026-10-14', mockCurrentTime11AM);
  assert(res.isValid === true, 'Suggested time 12:30 evaluates cleanly');
  assert(res.statusBadge === '12:30 PM', 'statusBadge displays 12:30 PM');
}

// --- Test 14: Clicking "Switch to Feasible Time" (or Next Service Date) ---
console.log('\n[Test 14: Switching to suggested feasible date and time]');
{
  // Simulated customer state: on today at 4:43 PM, selects 1:00 PM
  const initial = calculateLocalOrderSchedule('13:00', [], baseConfig, 1003, '2026-10-14', mockCurrentTime443PM);
  assert(initial.isValid === false, 'Initial state is invalid');
  assert(initial.suggestedDateStr !== undefined, 'Suggested date provided');
  assert(initial.suggestedPickupTime !== undefined, 'Suggested time provided');

  // Customer accepts the suggested date and time
  const updated = calculateLocalOrderSchedule(
    initial.suggestedPickupTime!,
    [],
    baseConfig,
    1003,
    initial.suggestedDateStr!,
    mockCurrentTime443PM
  );
  assert(updated.isValid === true, 'Switched date and time validates as TRUE');
  assert(updated.validationCode === 'VALID', 'Validation code is VALID');
}

// --- Test 15: Frontend / backend timezone consistency (IST Asia/Kolkata) ---
console.log('\n[Test 15: Timezone consistency]');
{
  const istInfo = getISTDateTime(mockCurrentTime443PM);
  assert(istInfo.hours === 16, 'IST hour is 16');
  assert(istInfo.minutes === 43, 'IST minute is 43');
  assert(istInfo.totalMinutes === 1003, 'IST total minutes is 1003 (16 * 60 + 43)');
  assert(istInfo.timeStr === '16:43', 'timeStr is 16:43');
  assert(istInfo.formattedDisplay === '4:43 PM', 'formattedDisplay is 4:43 PM');
}

// --- Test 16: Backend rejection of an invalid date or time ---
console.log('\n[Test 16: Rejection of past date or malformed time]');
{
  const pastDateRes = calculateLocalOrderSchedule('12:30', [], baseConfig, 700, '2026-10-10', mockCurrentTime443PM);
  assert(pastDateRes.isValid === false, 'Past date 2026-10-10 rejected');
  assert(pastDateRes.validationCode === 'PAST_TIME', 'Past date returns PAST_TIME');

  const malformedRes = calculateLocalOrderSchedule('abc:def', [], baseConfig, 700, '2026-10-15', mockCurrentTime443PM);
  assert(malformedRes.isValid === false, 'Malformed string rejected');
  assert(malformedRes.validationCode === 'INVALID_FORMAT', 'Malformed string returns INVALID_FORMAT');
}

// --- Test 17: Cart quantity changes affect preparation duration dynamically ---
console.log('\n[Test 17: Cart quantity changes affecting preparation duration]');
{
  const item: ScheduledCartItem = { id: 'item-1', name: 'Thali', prep_time_minutes: 10, quantity: 1 };
  const d1 = calculateOrderPrepDuration([item]);
  assert(d1 === 10, '1 Thali = 10 mins');

  const d5 = calculateOrderPrepDuration([{ ...item, quantity: 5 }]);
  assert(d5 === 14, '5 Thalis = 10 + 4 = 14 mins');

  const d10 = calculateOrderPrepDuration([{ ...item, quantity: 10 }]);
  assert(d10 === 19, '10 Thalis = 10 + 9 = 19 mins');
}

setTimeout(() => {
  console.log(`\n====================================================`);
  console.log(`TOTAL SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================\n`);
  if (failed > 0) process.exit(1);
}, 200);
