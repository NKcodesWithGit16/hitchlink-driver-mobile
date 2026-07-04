import { STATUS, statusChip, nextAction, isPrePickup, nextStop, stageIndex } from '../src/lib/load';

describe('load lifecycle state machine', () => {
  test('nextAction walks the full driver flow to Delivered', () => {
    // Assigned → tap → AtPickup → tap → EnRouteToDropoff → tap → AtDelivery → tap → Delivered
    let status = STATUS.Assigned;
    const path = [status];
    for (let guard = 0; guard < 10; guard++) {
      const action = nextAction(status);
      if (!action) break;
      status = action.next;
      path.push(status);
    }
    expect(path).toEqual(['Assigned', 'AtPickup', 'EnRouteToDropoff', 'AtDelivery', 'Delivered']);
  });

  test('Delivered is terminal — no further action', () => {
    expect(nextAction('Delivered')).toBeNull();
  });

  test('final Delivered step requires confirmation and offers POD capture', () => {
    const action = nextAction('AtDelivery');
    expect(action.next).toBe('Delivered');
    expect(action.confirm).toBe(true);
    expect(action.pod).toBe(true);
  });

  test('Loaded and EnRouteToDropoff share the same action (backend has both states)', () => {
    expect(nextAction('Loaded')).toEqual(nextAction('EnRouteToDropoff'));
  });

  test('isPrePickup splits the trip at pickup completion', () => {
    for (const s of ['Posted', 'Assigned', 'EnRouteToPickup', 'AtPickup']) {
      expect(isPrePickup(s)).toBe(true);
    }
    for (const s of ['Loaded', 'EnRouteToDropoff', 'AtDelivery', 'Delivered']) {
      expect(isPrePickup(s)).toBe(false);
    }
  });

  test('nextStop targets pickup before loading, delivery after', () => {
    const load = {
      origin: 'Atlanta, GA', originAddress: '100 Dock St', pickupDate: '2026-06-05',
      pickupWindowText: 'by 09:00', remainingMiles: 42, etaText: '38 min',
      destination: 'Nashville, TN', destAddress: '9 Freight Way', deliveryDate: '2026-06-06',
      deliverBy: 'by 17:00', deliveryRemainingMiles: 250, deliveryEtaText: '4 hr',
    };
    expect(nextStop(load, 'EnRouteToPickup')).toMatchObject({ kind: 'PICKUP', city: 'Atlanta, GA', remainingMiles: 42 });
    expect(nextStop(load, 'EnRouteToDropoff')).toMatchObject({ kind: 'DELIVERY', city: 'Nashville, TN', remainingMiles: 250 });
  });

  test('stageIndex maps statuses onto the stepper, treating Loaded as in-transit', () => {
    expect(stageIndex('EnRouteToPickup')).toBe(0);
    expect(stageIndex('AtPickup')).toBe(1);
    expect(stageIndex('Loaded')).toBe(2);
    expect(stageIndex('EnRouteToDropoff')).toBe(2);
    expect(stageIndex('AtDelivery')).toBe(3);
    expect(stageIndex('Delivered')).toBe(4);
    // Unknown / pre-trip statuses clamp to the first stage instead of -1.
    expect(stageIndex('Posted')).toBe(0);
    expect(stageIndex(undefined)).toBe(0);
  });

  test('statusChip tones: teal = progress, caution = action needed, go = done', () => {
    expect(statusChip('Assigned').tone).toBe('caution');
    expect(statusChip('EnRouteToDropoff').tone).toBe('teal');
    expect(statusChip('Delivered').tone).toBe('go');
    expect(statusChip('SomethingUnknown')).toEqual({ label: 'POSTED', tone: 'teal' });
  });
});
