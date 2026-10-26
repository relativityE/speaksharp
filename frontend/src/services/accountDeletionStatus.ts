export type AccountDeletionStatus =
  | { outcome: 'not_pending'; destructiveEnabled: false }
  | { outcome: 'pending'; requestId: string; phase: 'pending'; destructiveEnabled: false; checkoutPending: number };

/** Accept only the inactive #1658 contract, never a legacy destructive result. */
export function accountDeletionStatus(value: unknown): AccountDeletionStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.outcome === 'not_pending' && row.destructiveEnabled === false && Object.keys(row).length === 2) {
    return row as AccountDeletionStatus;
  }
  if (Object.keys(row).length !== 5 || row.outcome !== 'pending' || row.phase !== 'pending'
    || row.destructiveEnabled !== false || typeof row.requestId !== 'string'
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.requestId)
    || typeof row.checkoutPending !== 'number' || !Number.isSafeInteger(row.checkoutPending)
    || row.checkoutPending < 0) return null;
  return row as AccountDeletionStatus;
}
