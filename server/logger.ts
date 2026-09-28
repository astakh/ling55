/**
 * Structured logger for system events, operations, API requests, and LLM calls.
 * Formats console logs clearly with timestamps, action categories, colors, and contextual details.
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export function log(
  category: string,
  action: string,
  details?: Record<string, any>,
  level: LogLevel = 'INFO'
) {
  const time = formatTimestamp();
  let levelColor = COLORS.cyan;
  if (level === 'SUCCESS') levelColor = COLORS.green;
  if (level === 'WARN') levelColor = COLORS.yellow;
  if (level === 'ERROR') levelColor = COLORS.red;
  if (level === 'DEBUG') levelColor = COLORS.dim;

  const header = `${COLORS.dim}[${time}]${COLORS.reset} ${levelColor}[${level}]${COLORS.reset} ${COLORS.magenta}[${category}]${COLORS.reset} ${COLORS.bright}${action}${COLORS.reset}`;
  
  if (details && Object.keys(details).length > 0) {
    const formattedDetails = Object.entries(details)
      .map(([k, v]) => `${COLORS.dim}${k}=${COLORS.reset}${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    console.log(`${header} → ${formattedDetails}`);
  } else {
    console.log(header);
  }
}

export const logger = {
  info: (category: string, action: string, details?: Record<string, any>) => log(category, action, details, 'INFO'),
  success: (category: string, action: string, details?: Record<string, any>) => log(category, action, details, 'SUCCESS'),
  warn: (category: string, action: string, details?: Record<string, any>) => log(category, action, details, 'WARN'),
  error: (category: string, action: string, details?: Record<string, any>) => log(category, action, details, 'ERROR'),
  debug: (category: string, action: string, details?: Record<string, any>) => log(category, action, details, 'DEBUG'),
};
