'use strict';

// The balance model
// -----------------
// On a work day you are assumed to be working during work hours; you only log
// the exceptions. Lunch is ignored both ways: leaving during lunch costs nothing
// and working through lunch earns nothing.
//
//   day net = time worked (lunch excluded) - scheduled time (lunch excluded) + adjusts
//
// Working intervals for a day are derived from its in/out events:
//   * Before the first event: if the first event is "out" (or there are no events, or
//     the first event is an evening "in" after work hours) on a work day, you are taken
//     to be "in" from the start of work hours. If the first event is an "in" before the
//     end of work hours, you were out before it (a late start, or an early one).
//   * An "in" after work hours while already "in" from the day starts a new evening
//     session: you are taken to have left at the end of work hours.
//   * A trailing "in" with no "out" is closed at the end of work hours
//     (or at the "in" itself if that is later): unlogged evening work earns nothing.
//   * A trailing "out" means out for the rest of the day, except today, where
//     you are assumed to come back right now (the debt grows live while you're out).
//   * Non-work days have no schedule: only explicit in -> out pairs count, all as advance.
//
// The total is the latest "balance" line (taken as the balance at the start of
// its day) plus the net of every day from that day up to today.

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** ISO weekday 1 (Mon) .. 7 (Sun) for a YYYY-MM-DD string. */
function isoWeekday(date) {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * @param {{events: Array<{t:number,type:string,line:number}>, adjusts: Array<{seconds:number}>}} day
 * @param {{workHours:[number,number], lunch:[number,number]|null, workDays:number[]}} settings
 * @param {{isToday: boolean, now: number}} ctx  now = seconds since midnight (only used for today)
 */
function computeDay(day, settings, ctx) {
  const workday = settings.workDays.includes(isoWeekday(day.date));
  const [whs, whe] = settings.workHours;
  const lunch = workday ? settings.lunch : null;
  const diagnostics = [];

  const events = [...day.events].sort((a, b) => a.t - b.t);

  const intervals = [];
  let state = 'out';
  let since = null;

  // Assume the scheduled day was worked unless the first line is an "in" before the
  // end of work hours (a late or early start). An evening-only "in" doesn't cancel the day.
  const first = events[0];
  if (workday && (!first || first.type === 'out' || first.t >= whe)) {
    state = 'in';
    since = whs;
  }

  let lastEvent = null;
  for (const e of events) {
    if (e.type === state) {
      // "in" again after hours while still "in" from the day: you left at the end of
      // work hours without logging it, and this is a new evening session.
      if (e.type === 'in' && workday && since < whe && e.t >= whe) {
        intervals.push([since, whe]);
        since = e.t;
        lastEvent = e;
        continue;
      }
      diagnostics.push({ line: e.line, message: `Already ${state}, ignored` });
      continue;
    }
    if (e.type === 'out') {
      if (state === 'in') intervals.push([since, e.t]);
      state = 'out';
    } else {
      since = e.t;
      state = 'in';
    }
    lastEvent = e;
  }

  let pending = 0;
  if (state === 'in') {
    const end = Math.max(since, workday ? whe : since);
    intervals.push([since, end]);
    // Only an explicit evening (or non-work-day) "in" is shown as unbanked work.
    // A day still "in" from work hours is just a normal day that ended at 17:00.
    const eveningIn = lastEvent && lastEvent.type === 'in' && (!workday || lastEvent.t >= whe);
    if (ctx.isToday && ctx.now > end && eveningIn) pending = ctx.now - end;
  } else if (ctx.isToday && workday && ctx.now < whe) {
    // Currently out: assume back now for the rest of the scheduled day.
    const back = Math.max(ctx.now, whs);
    intervals.push([back, whe]);
  }

  const lunchOverlap = (a, b) => (lunch ? overlap(a, b, lunch[0], lunch[1]) : 0);
  let worked = 0;
  for (const [a, b] of intervals) {
    if (b > a) worked += b - a - lunchOverlap(a, b);
  }
  const expected = workday ? whe - whs - lunchOverlap(whs, whe) : 0;
  const adjust = day.adjusts.reduce((s, a) => s + a.seconds, 0);

  let current = null;
  if (ctx.isToday) {
    if (lastEvent) {
      current = { state: lastEvent.type, since: lastEvent.t, explicit: true };
      // Being out only costs during scheduled hours; after a final evening "out"
      // there's nothing to count.
      if (lastEvent.type === 'out') current.accruing = workday && ctx.now >= whs && ctx.now < whe;
    } else if (workday && ctx.now >= whs && ctx.now < whe) {
      current = { state: 'in', since: whs, explicit: false };
    } else {
      current = { state: 'off', since: null, explicit: false };
    }
    // After hours on a work day that is still "in" from the day, a toggle could mean
    // "I stayed late, done now" (out) or "back for an evening session" (in).
    current.ambiguous = Boolean(
      workday && ctx.now >= whe && (!lastEvent || (lastEvent.type === 'in' && lastEvent.t < whe)),
    );
  }

  return {
    date: day.date,
    workday,
    worked,
    expected,
    adjust,
    net: worked - expected + adjust,
    pending,
    current,
    diagnostics,
  };
}

/**
 * @param {ReturnType<import('./parse').parseNote>} parsed
 * @param settings see computeDay
 * @param {{date: string, t: number}} now today's date (YYYY-MM-DD) and seconds since midnight
 */
function computeBalance(parsed, settings, now) {
  const diagnostics = [];
  const allDays = [...parsed.days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let start = null;
  for (const d of allDays) {
    if (d.date <= now.date && d.balances.length) start = d;
  }
  if (!start) {
    return { ok: false, reason: 'no-balance', total: 0, days: [], today: null, diagnostics };
  }
  if (start.balances.length > 1) {
    for (const b of start.balances.slice(0, -1)) {
      diagnostics.push({ line: b.line, message: 'More than one balance line for this day, the last one is used' });
    }
  }

  let running = start.balances[start.balances.length - 1].seconds;
  const days = [];
  let today = null;
  for (const d of allDays) {
    if (d.date < start.date || d.date > now.date) continue;
    const isToday = d.date === now.date;
    const r = computeDay(d, settings, { isToday, now: now.t });
    running += r.net;
    r.running = running;
    r.headerLine = d.headerLine;
    diagnostics.push(...r.diagnostics);
    days.push(r);
    if (isToday) today = r;
  }

  if (!today) {
    // No section for today yet: compute an empty day for the status display.
    today = computeDay({ date: now.date, events: [], adjusts: [] }, settings, { isToday: true, now: now.t });
    today.running = running;
    today.headerLine = null;
  }

  return { ok: true, total: running, startDate: start.date, days, today, diagnostics };
}

module.exports = { computeDay, computeBalance, isoWeekday, overlap };
