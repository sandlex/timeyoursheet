'use strict';

const { formatDuration, formatClock } = require('./duration');

/**
 * Status bar text for a computeBalance() result.
 * @param result computeBalance() result
 * @param {number} nowT seconds since midnight
 */
function statusText(result, nowT) {
  if (!result.ok) return '$(clock) add a "balance" line';
  const total = formatDuration(result.total);
  const cur = result.today && result.today.current;
  if (cur && cur.explicit && cur.state === 'out' && cur.accruing) {
    return `$(debug-pause) out ${formatDuration(nowT - cur.since, { sign: false })} · ${total}`;
  }
  if (result.today && result.today.pending > 0) {
    return `$(clock) in · ${total} (+${formatDuration(result.today.pending, { sign: false })} unbanked)`;
  }
  return `$(clock) ${total}`;
}

/** One-line summary for the CodeLens above a date header. */
function lensTitle(day) {
  const parts = [`day ${formatDuration(day.net)}`];
  if (day.adjust) parts.push(`adjust ${formatDuration(day.adjust)}`);
  parts.push(`balance ${formatDuration(day.running)}`);
  return parts.join('  ·  ');
}

/** Markdown tooltip: state + last few days. */
function tooltipMarkdown(result, nowT, maxDays = 7) {
  if (!result.ok) {
    return 'No `balance` line found.\n\nAdd one under today\'s date header, e.g. `balance -45m`.';
  }
  const out = [];
  const cur = result.today && result.today.current;
  if (cur && cur.explicit) {
    out.push(`**${cur.state}** since ${formatClock(cur.since)}`);
  }
  if (result.today && result.today.pending > 0) {
    out.push(`Working after hours: ${formatDuration(result.today.pending, { sign: false })} is counted once you log \`out\`.`);
  }
  out.push(`**Balance: ${formatDuration(result.total)}** (since ${result.startDate})`);
  const rows = result.days.slice(-maxDays).reverse();
  if (rows.length) {
    const table = ['| Day | Worked | Net | Balance |', '|---|---:|---:|---:|'];
    for (const d of rows) {
      const worked = formatDuration(d.worked, { sign: false });
      table.push(`| ${d.date} | ${worked} | ${formatDuration(d.net)} | ${formatDuration(d.running)} |`);
    }
    out.push(table.join('\n'));
  }
  out.push('Click to open the note.');
  return out.join('\n\n');
}

module.exports = { statusText, lensTitle, tooltipMarkdown };
