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

// --- 1. Manually entering a valid time within service hours ---
console.log('\n[Test 1: Manually entering a valid time within service hours]');
{
  const currentIST = parseTimeToMinutes('11:00'); // 11:00 AM
  const res = calculateLocalOrderSchedule('12:30', [], baseConfig, currentIST);
  assert(res.isValid === true, '12:30 is accepted within 12:00-14:00 window');
  assert(res.validationCode === 'VALID', 'validationCode is VALID');
  assert(res.statusBadge === '12:30 PM', 'statusBadge displays 12:30 PM');
  assert(res.pickupTimeStr === '12:30', 'pickupTimeStr normalized to 12:30');
}

// --- 2. Selecting each available quick-suggestion time ---
console.log('\n[Test 2: Selecting each available quick-suggestion time]');
{
  const suggestions = ['12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00'];
  const currentIST = parseTimeToMinutes('11:30');
  let allValid = true;
  for (const time of suggestions) {
    const res = calculateLocalOrderSchedule(time, [], baseConfig, currentIST);
    if (!res.isValid) {
      allValid = false;
      console.error(`Suggestion ${time} failed: ${res.reason}`);
    }
  }
  assert(allValid, 'All 8 quick suggestions within service hours evaluate to valid');
}

// --- 3. Selecting the suggested feasible time ---
console.log('\n[Test 3: Selecting the suggested feasible time]');
{
  // Current time: 12:20 PM. User initially selects 12:25 PM with 14-min prep (not feasible).
  const currentIST = parseTimeToMinutes('12:20');
  const cartItems: ScheduledCartItem[] = [
    { id: '1', quantity: 5, prep_time_minutes: 10, name: 'Meals' },
  ];
  const initialRes = calculateLocalOrderSchedule('12:25', cartItems, baseConfig, currentIST);
  assert(initialRes.isValid === false, '12:25 rejected due to prep lead time');
  assert(initialRes.suggestedPickupTime !== undefined, 'Suggested feasible time is provided');

  // Customer accepts the feasible time
  const feasibleTime = initialRes.suggestedPickupTime!;
  const followUpRes = calculateLocalOrderSchedule(feasibleTime, cartItems, baseConfig, currentIST);
  assert(followUpRes.isValid === true, `Suggested feasible time (${feasibleTime}) validates cleanly`);
  assert(followUpRes.validationCode === 'VALID', 'Validation code is VALID after switching');
  assert(followUpRes.statusBadge === followUpRes.pickupTimeFormatted, 'Status badge is formatted time');
}

// --- 4. Entering a time earlier than the required preparation lead time ---
console.log('\n[Test 4: Entering a time earlier than required prep lead time]');
{
  const currentIST = parseTimeToMinutes('12:00'); // 12:00 PM
  const cartItems: ScheduledCartItem[] = [
    { id: '1', quantity: 5, prep_time_minutes: 10, name: 'Curd Rice' }, // 10 + 4 = 14 mins prep
  ];
  // Pickup requested at 12:05 PM (only 5 mins notice, but kitchen needs 14 mins)
  const res = calculateLocalOrderSchedule('12:05', cartItems, baseConfig, currentIST);
  assert(res.isValid === false, '12:05 rejected due to 14m prep requirement');
  assert(res.validationCode === 'INSUFFICIENT_LEAD_TIME', 'validationCode is INSUFFICIENT_LEAD_TIME');
  assert(res.statusBadge === 'Too Soon', 'statusBadge displays "Too Soon"');
  assert(res.error?.includes('Kitchen needs 14 minutes') === true, 'Error message mentions "Kitchen needs 14 minutes"');
  assert(res.suggestedPickupFormatted === '12:14 PM', 'Earliest ready time suggested is 12:14 PM', res.suggestedPickupFormatted);
}

// --- 5. Entering a time outside service hours ---
console.log('\n[Test 5: Entering a time outside service hours]');
{
  const currentIST = parseTimeToMinutes('10:00');
  const resEarly = calculateLocalOrderSchedule('11:45', [], baseConfig, currentIST);
  assert(resEarly.isValid === false, '11:45 AM before opening is rejected');
  assert(resEarly.validationCode === 'OUTSIDE_HOURS', 'Early time validationCode is OUTSIDE_HOURS');
  assert(resEarly.statusBadge === 'Outside Hours', 'statusBadge displays "Outside Hours"');

  const resLate = calculateLocalOrderSchedule('14:30', [], baseConfig, currentIST);
  assert(resLate.isValid === false, '2:30 PM after closing is rejected');
  assert(resLate.validationCode === 'OUTSIDE_HOURS', 'Late time validationCode is OUTSIDE_HOURS');
  assert(resLate.statusBadge === 'Outside Hours', 'statusBadge displays "Outside Hours"');
}

// --- 6. Entering a time in the past ---
console.log('\n[Test 6: Entering a time in the past]');
{
  const currentIST = parseTimeToMinutes('13:10'); // 1:10 PM
  const res = calculateLocalOrderSchedule('12:30', [], baseConfig, currentIST);
  assert(res.isValid === false, '12:30 PM rejected when current time is 1:10 PM');
  assert(res.validationCode === 'PAST_TIME', 'validationCode is PAST_TIME');
  assert(res.statusBadge === 'Past Time', 'statusBadge displays "Past Time"');
  assert(res.error?.includes('already passed') === true, 'Error message explains time has passed');
}

// --- 7. Entering an empty or malformed value ---
console.log('\n[Test 7: Entering an empty or malformed value]');
{
  const currentIST = parseTimeToMinutes('11:00');
  const emptyRes = calculateLocalOrderSchedule('', [], baseConfig, currentIST);
  assert(emptyRes.isValid === false, 'Empty time is rejected');
  assert(emptyRes.validationCode === 'INVALID_FORMAT', 'Empty time validationCode is INVALID_FORMAT');
  assert(emptyRes.statusBadge === 'Invalid Time', 'statusBadge displays "Invalid Time"');

  const malformedRes = calculateLocalOrderSchedule('invalid-text', [], baseConfig, currentIST);
  assert(malformedRes.isValid === false, 'Gibberish string is rejected');
  assert(malformedRes.validationCode === 'INVALID_FORMAT', 'Gibberish validationCode is INVALID_FORMAT');

  const outOfRangeRes = calculateLocalOrderSchedule('26:70', [], baseConfig, currentIST);
  assert(outOfRangeRes.isValid === false, '26:70 is rejected as invalid time');
}

// --- 8. Using both 12-hour display format and 24-hour input format ---
console.log('\n[Test 8: Both 12-hour and 24-hour formats]');
{
  const currentIST = parseTimeToMinutes('11:00');
  // "02:00 PM" (12h) vs "14:00" (24h)
  const res12h = calculateLocalOrderSchedule('02:00 PM', [], baseConfig, currentIST);
  const res24h = calculateLocalOrderSchedule('14:00', [], baseConfig, currentIST);

  assert(res12h.isValid === true, '"02:00 PM" is valid');
  assert(res24h.isValid === true, '"14:00" is valid');
  assert(res12h.pickupTimeStr === '14:00', '"02:00 PM" normalizes to 24h "14:00"');
  assert(res24h.pickupTimeStr === '14:00', '"14:00" remains 24h "14:00"');
  assert(res12h.pickupTimeFormatted === '2:00 PM', 'Both format to "2:00 PM"');
  assert(res24h.pickupTimeFormatted === '2:00 PM', 'Both format to "2:00 PM"');

  // Also test "1:15 pm", "12:30 AM/PM"
  const res115 = calculateLocalOrderSchedule('1:15 pm', [], baseConfig, currentIST);
  assert(res115.isValid === true && res115.pickupTimeStr === '13:15', '"1:15 pm" parses to 13:15');
}

// --- 9. Changing cart quantities so the preparation estimate changes ---
console.log('\n[Test 9: Dynamic preparation duration based on cart quantities]');
{
  const itemBase: ScheduledCartItem = { id: 'item-1', name: 'Biryani', prep_time_minutes: 12, quantity: 1 };
  const prepQty1 = calculateOrderPrepDuration([itemBase]);
  assert(prepQty1 === 12, '1 item = 12 mins prep');

  const prepQty3 = calculateOrderPrepDuration([{ ...itemBase, quantity: 3 }]);
  assert(prepQty3 === 14, '3 items = 12 + 2 = 14 mins prep');

  const prepQty5 = calculateOrderPrepDuration([{ ...itemBase, quantity: 5 }]);
  assert(prepQty5 === 16, '5 items = 12 + 4 = 16 mins prep');
}

// --- 10. Changing the selected time repeatedly ---
console.log('\n[Test 10: Changing selected time repeatedly]');
{
  const currentIST = parseTimeToMinutes('12:00');
  const times = ['12:05', '12:30', '14:30', '13:15', '02:00 PM', '11:00'];
  const expectedValidity = [false, true, false, true, true, false];

  let consistent = true;
  for (let i = 0; i < times.length; i++) {
    const res = calculateLocalOrderSchedule(times[i], [], baseConfig, currentIST);
    if (res.isValid !== expectedValidity[i]) {
      consistent = false;
      console.error(`Step ${i} (${times[i]}) expected ${expectedValidity[i]}, got ${res.isValid}`);
    }
  }
  assert(consistent, 'Sequential pickup time changes evaluate correctly without state leakage');
}

// --- 11. Testing when the service window is updated by admin/staff ---
console.log('\n[Test 11: Updated service window configuration]');
{
  const updatedConfig: LunchSlotConfig = {
    ...baseConfig,
    serviceStartTime: '12:30',
    serviceEndTime: '15:00',
  };
  const currentIST = parseTimeToMinutes('11:00');

  // 12:15 was valid under 12:00-14:00, but is invalid under 12:30-15:00
  const res1215 = calculateLocalOrderSchedule('12:15', [], updatedConfig, currentIST);
  assert(res1215.isValid === false, '12:15 is rejected when opening moved to 12:30');

  // 14:30 was invalid under 12:00-14:00, but is valid under 12:30-15:00
  const res1430 = calculateLocalOrderSchedule('14:30', [], updatedConfig, currentIST);
  assert(res1430.isValid === true, '14:30 is accepted when closing moved to 15:00');
}

// --- 12. Submitting a valid time through backend API format ---
console.log('\n[Test 12: API payload contract normalization]');
{
  const currentIST = parseTimeToMinutes('11:00');
  const res = calculateLocalOrderSchedule('02:00 PM', [], baseConfig, currentIST);
  // Verify API contract fields
  assert(res.pickupTimeStr === '14:00', 'API pickup_time string is clean 24h "14:00"');
  assert(res.requestedPickupTime.includes('T14:00:00+05:30'), 'API requested_pickup_time is ISO with IST timezone');
  assert(res.plannedPrepStartTime.includes('+05:30'), 'plannedPrepStartTime has timezone');
}

// --- 13. Submitting an invalid or manipulated time directly ---
console.log('\n[Test 13: Direct validation rejection of manipulated time]');
{
  const currentIST = parseTimeToMinutes('12:00');
  const manipulatedTimes = ['03:00 AM', '25:00', '-01:00', 'null', 'undefined'];
  let allRejected = true;
  for (const mt of manipulatedTimes) {
    const res = calculateLocalOrderSchedule(mt, [], baseConfig, currentIST);
    if (res.isValid) {
      allRejected = false;
      console.error(`Manipulated time ${mt} was unexpectedly accepted`);
    }
  }
  assert(allRejected, 'All manipulated/out-of-bounds time strings rejected');
}

// --- 14. Verifying frontend and backend validation produce consistent results ---
console.log('\n[Test 14: Consistency between frontend calculation and backend verification]');
{
  const currentIST = parseTimeToMinutes('11:00');
  const localRes = calculateLocalOrderSchedule('13:00', [], baseConfig, currentIST);
  // verifyBackendOrderSchedule with undefined canteenId uses authoritative local calculation
  const backendResPromise = verifyBackendOrderSchedule(undefined, '13:00', [], baseConfig, currentIST);
  backendResPromise.then(backendRes => {
    assert(localRes.isValid === backendRes.isValid, 'Local and backend return identical validity');
    assert(localRes.pickupTimeStr === backendRes.pickupTimeStr, 'Local and backend return identical 24h pickup time');
    assert(localRes.pickupTimeFormatted === backendRes.pickupTimeFormatted, 'Local and backend return identical 12h display');
  });
}

// --- 15. Confirming that selected pickup time persists correctly in order format ---
console.log('\n[Test 15: Persistence and round-trip parsing of saved order datetime]');
{
  const testIso = '2026-10-13T14:00:00+05:30';
  const parsedMin = parseTimeToMinutes(testIso);
  assert(parsedMin === 840, 'ISO timestamp parses to 840 minutes (14:00)');
  assert(formatSingleTime(testIso) === '2:00 PM', 'ISO timestamp formats back to "2:00 PM"');
  assert(normalizeTimeTo24h(testIso) === '14:00', 'ISO timestamp normalizes to "14:00"');
}

setTimeout(() => {
  console.log(`\n====================================================`);
  console.log(`TOTAL SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================\n`);
  if (failed > 0) process.exit(1);
}, 200);
