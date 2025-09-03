import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime } from '../dateUtils';

describe('formatDate', () => {
  it('should format a valid date string', () => {
    const dateStr = '2023-10-27T10:00:00.000Z';
    expect(formatDate(dateStr)).toBe('October 27, 2023');
  });

  it('should format a valid Date object', () => {
    const dateObj = new Date('2023-10-27T10:00:00.000Z');
    expect(formatDate(dateObj)).toBe('October 27, 2023');
  });

  it('should return an empty string for a null input', () => {
    expect(formatDate(null)).toBe('');
  });

  it('should return an empty string for an undefined input', () => {
    expect(formatDate(undefined)).toBe('');
  });

  it('should return an empty string for an invalid date string', () => {
    expect(formatDate('not a real date')).toBe('');
  });

  it('should return an empty string for an invalid Date object', () => {
    const invalidDate = new Date('not a real date');
    expect(formatDate(invalidDate)).toBe('');
  });
});

describe('formatDateTime', () => {
  it('should format a valid date-time string', () => {
    const dateStr = '2023-10-27T10:30:00.000Z';
    // The output can vary based on the test runner's timezone.
    // We will check for the presence of key components.
    const result = formatDateTime(dateStr);
    expect(result).toContain('October 27, 2023');
    expect(result).toMatch(/\d{1,2}:\d{2}\s(AM|PM)/); // e.g., 5:30 AM
  });

  it('should return an empty string for a null input', () => {
    expect(formatDateTime(null)).toBe('');
  });

  it('should return an empty string for an invalid date string', () => {
    expect(formatDateTime('not a real date')).toBe('');
  });
});
