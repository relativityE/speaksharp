/**
 * Safely formats a date string or Date object.
 * If the date is invalid, returns an empty string.
 * @param {string | Date | number} dateInput - The date to format.
 * @returns {string} The formatted date string or an empty string.
 */
export function formatDate(dateInput) {
  if (!dateInput) {
    return '';
  }

  const date = new Date(dateInput);

  // Check if the date is valid
  if (isNaN(date.getTime())) {
    return '';
  }

  // Using toLocaleDateString for a user-friendly, locale-aware format.
  // This can be customized further if needed.
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Safely formats a date-time string or Date object.
 * If the date is invalid, returns an empty string.
 * @param {string | Date | number} dateInput - The date to format.
 * @returns {string} The formatted date-time string or an empty string.
 */
export function formatDateTime(dateInput) {
  if (!dateInput) {
    return '';
  }

  const date = new Date(dateInput);

  // Check if the date is valid
  if (isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
