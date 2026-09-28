/**
 * Algorithm 5.6: Streak calculation across all language profiles.
 */

import { logger } from './logger.js';

export interface StreakResult {
  current: number;
  longest: number;
  today_done: boolean;
  extended_today?: boolean;
}

export function getLocalDateString(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date); // YYYY-MM-DD
  } catch (err) {
    return date.toISOString().slice(0, 10);
  }
}

export function getMidnightResetUtc(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);

    const secondsSinceTzMidnight = (hour % 24) * 3600 + minute * 60 + second;
    const secondsUntilTzMidnight = 86400 - secondsSinceTzMidnight;

    const resetDate = new Date(now.getTime() + secondsUntilTzMidnight * 1000);
    return resetDate.toISOString();
  } catch (e) {
    const now = new Date();
    now.setUTCHours(24, 0, 0, 0);
    return now.toISOString();
  }
}

function parseDateOnly(str: string): number {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(dateStr: string, days: number): string {
  const ts = parseDateOnly(dateStr) + days * 24 * 60 * 60 * 1000;
  return new Date(ts).toISOString().slice(0, 10);
}

export function calculateStreak(rawDates: string[], todayStr: string): StreakResult {
  // Dates greater than today are clamped to today
  const clampedDates = new Set<string>();
  for (const d of rawDates) {
    if (d > todayStr) {
      clampedDates.add(todayStr);
    } else {
      clampedDates.add(d);
    }
  }

  const D = Array.from(clampedDates).sort();
  if (D.length === 0) {
    return { current: 0, longest: 0, today_done: false };
  }

  const today_done = clampedDates.has(todayStr);
  const yesterdayStr = addDays(todayStr, -1);

  let anchor: string | null = null;
  if (today_done) {
    anchor = todayStr;
  } else if (clampedDates.has(yesterdayStr)) {
    anchor = yesterdayStr;
  }

  let current = 0;
  if (anchor !== null) {
    let checkDay = anchor;
    while (clampedDates.has(checkDay)) {
      current++;
      checkDay = addDays(checkDay, -1);
    }
  }

  // Calculate longest chain in D
  let longest = 0;
  if (D.length > 0) {
    let curChain = 1;
    longest = 1;
    for (let i = 1; i < D.length; i++) {
      const prev = D[i - 1];
      const curr = D[i];
      if (curr === addDays(prev, 1)) {
        curChain++;
        if (curChain > longest) longest = curChain;
      } else {
        curChain = 1;
      }
    }
  }

  return {
    current,
    longest: Math.max(current, longest),
    today_done,
  };
}
