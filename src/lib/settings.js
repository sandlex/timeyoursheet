'use strict';

const { parseRange } = require('./duration');

const DEFAULTS = {
  workHours: '09:00-17:00',
  lunch: '12:00-13:00',
  workDays: [1, 2, 3, 4, 5],
};

/**
 * Turn raw configuration values into the numeric settings used by compute.
 * Invalid values fall back to defaults and are reported in `errors`.
 * @param {{workHours?: string, lunch?: string, workDays?: number[]}} raw
 */
function resolveSettings(raw = {}) {
  const errors = [];

  let workHours = parseRange(raw.workHours ?? DEFAULTS.workHours);
  if (!workHours) {
    errors.push(`Invalid workHours "${raw.workHours}", expected e.g. "09:00-17:00"`);
    workHours = parseRange(DEFAULTS.workHours);
  }

  let lunch = null;
  const lunchRaw = raw.lunch ?? DEFAULTS.lunch;
  if (lunchRaw) {
    lunch = parseRange(lunchRaw);
    if (!lunch) {
      errors.push(`Invalid lunch "${lunchRaw}", expected e.g. "12:00-13:00" or empty to disable`);
      lunch = parseRange(DEFAULTS.lunch);
    }
  }

  let workDays = raw.workDays ?? DEFAULTS.workDays;
  if (!Array.isArray(workDays) || !workDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) {
    errors.push('Invalid workDays, expected ISO weekday numbers 1 (Mon) .. 7 (Sun)');
    workDays = DEFAULTS.workDays;
  }

  return { settings: { workHours, lunch, workDays }, errors };
}

module.exports = { resolveSettings, DEFAULTS };
