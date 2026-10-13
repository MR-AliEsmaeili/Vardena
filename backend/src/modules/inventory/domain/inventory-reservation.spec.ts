import { describe, expect, it } from 'vitest';
import {
  isReservationStatus,
  planRelease,
  RESERVATION_STATUSES,
  reservationTransitionMessage,
} from './inventory-reservation.js';

describe('reservation lifecycle', () => {
  it('is a closed ACTIVE → RELEASED lifecycle', () => {
    expect([...RESERVATION_STATUSES].sort()).toEqual(['active', 'released']);
    expect(isReservationStatus('active')).toBe(true);
    expect(isReservationStatus('released')).toBe(true);
    expect(isReservationStatus('cancelled')).toBe(false);
    expect(isReservationStatus('ACTIVE')).toBe(false);
  });

  it('allows releasing an active reservation', () => {
    expect(planRelease('active')).toEqual({ problem: null });
  });

  it('forbids releasing twice', () => {
    expect(planRelease('released')).toEqual({ problem: 'already_released' });
    expect(reservationTransitionMessage('already_released')).toMatch(
      /already released/,
    );
  });

  it('fails closed on unknown states', () => {
    expect(planRelease('cancelled')).toEqual({ problem: 'unknown_status' });
  });
});
