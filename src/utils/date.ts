import type { DateRange, PeriodMode } from '../types';

export function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface MonthDateRange {
  startDate: string;
  endDate: string;
}

export type { DateRange };

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseLocalDate(value);
  return !Number.isNaN(date.getTime())
    && formatLocalDate(date.getFullYear(), date.getMonth() + 1, date.getDate()) === value;
}

export function isValidDateRange(range: DateRange): boolean {
  return isValidLocalDate(range.startDate) && isValidLocalDate(range.endDate)
    && range.startDate <= range.endDate;
}

export function getDateRange(mode: PeriodMode, anchorDate: string, customRange?: DateRange): DateRange {
  if (mode === 'custom') {
    if (!customRange || !isValidDateRange(customRange)) throw new Error('自定义日期范围无效。');
    return { ...customRange };
  }
  if (!isValidLocalDate(anchorDate)) throw new Error('日期无效。');
  const date = parseLocalDate(anchorDate);
  if (mode === 'day') return { startDate: anchorDate, endDate: anchorDate };
  if (mode === 'week') {
    const offset = (date.getDay() + 6) % 7;
    const startDate = addDays(anchorDate, -offset);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  if (mode === 'year') {
    const year = date.getFullYear();
    return { startDate: formatLocalDate(year, 1, 1), endDate: formatLocalDate(year, 12, 31) };
  }
  return getMonthDateRange(date.getFullYear(), date.getMonth() + 1);
}

export function shiftPeriodDate(mode: PeriodMode, anchorDate: string, offset: number): string {
  if (!isValidLocalDate(anchorDate)) throw new Error('日期无效。');
  const date = parseLocalDate(anchorDate);
  if (mode === 'day') date.setDate(date.getDate() + offset);
  else if (mode === 'week') date.setDate(date.getDate() + offset * 7);
  else {
    const day = date.getDate();
    if (mode === 'year') date.setFullYear(date.getFullYear() + offset, date.getMonth(), 1);
    else {
      date.setDate(1);
      date.setMonth(date.getMonth() + offset);
    }
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  }
  return formatLocalDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function shiftDateRange(range: DateRange, offset: number): DateRange {
  const start = parseLocalDate(range.startDate);
  const end = parseLocalDate(range.endDate);
  const duration = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const startDate = addDays(range.startDate, duration * offset);
  return { startDate, endDate: addDays(startDate, duration - 1) };
}

export function formatDateRangeLabel(mode: PeriodMode, range: DateRange): string {
  if (mode === 'day') return range.startDate;
  if (mode === 'week') return `${range.startDate} – ${range.endDate}`;
  if (mode === 'month') return `${range.startDate.slice(0, 4)}年${Number(range.startDate.slice(5, 7))}月`;
  if (mode === 'year') return `${range.startDate.slice(0, 4)}年`;
  return `${range.startDate} – ${range.endDate}`;
}

export function formatLocalDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getMonthDateRange(year: number, month: number): MonthDateRange {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('月份无效。');
  }
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startDate: formatLocalDate(year, month, 1),
    endDate: formatLocalDate(year, month, lastDay)
  };
}

export function getMonthAnchorDate(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('月份无效。');
  }
  return formatLocalDate(year, month, 1);
}

export function getYearMonthDrilldown(year: number, month: number): { mode: 'month'; anchorDate: string } {
  return { mode: 'month', anchorDate: getMonthAnchorDate(year, month) };
}

export function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const date = new Date(year, month - 1 + offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}
