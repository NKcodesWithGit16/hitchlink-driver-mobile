/* Load lifecycle helpers — mirrors the backend LoadStatus enum:
   Posted → Assigned → EnRouteToPickup → AtPickup → Loaded →
   EnRouteToDropoff → Delivered → Closed / Cancelled.

   The UI adds one screen-only intermediate, "AtDelivery", between
   EnRouteToDropoff and Delivered, so the driver taps "Arrived" then
   "Delivered" (the backend collapses both into Delivered). */

export const STATUS = {
  Posted: 'Posted',
  Assigned: 'Assigned',
  EnRouteToPickup: 'EnRouteToPickup',
  AtPickup: 'AtPickup',
  Loaded: 'Loaded',
  EnRouteToDropoff: 'EnRouteToDropoff',
  AtDelivery: 'AtDelivery',
  Delivered: 'Delivered',
};

// Order used by the stage stepper.
const ORDER = [
  'EnRouteToPickup', 'AtPickup', 'EnRouteToDropoff', 'AtDelivery', 'Delivered',
];

// Returns a labelKey (translated at render time via t()) rather than a
// literal string, so this stays UI-language-agnostic.
export function statusChip(status) {
  switch (status) {
    case 'Assigned': return { labelKey: 'load.chip.newLoad', tone: 'caution' };
    case 'EnRouteToPickup': return { labelKey: 'load.chip.toPickup', tone: 'teal' };
    case 'AtPickup': return { labelKey: 'load.chip.atPickup', tone: 'caution' };
    case 'Loaded':
    case 'EnRouteToDropoff': return { labelKey: 'load.chip.onLoad', tone: 'teal' };
    case 'AtDelivery': return { labelKey: 'load.chip.atDelivery', tone: 'caution' };
    case 'Delivered': return { labelKey: 'load.chip.delivered', tone: 'go' };
    default: return { labelKey: 'load.chip.posted', tone: 'teal' };
  }
}

// The single contextual action shown on the home screen.
// `milestone: true` marks the irreversible-feeling steps (cargo now on board;
// delivered) that always ask for confirmation. Arrivals are cheap to take back,
// so they advance on a single tap unless the driver opts into confirm-every-step.
// Returns a labelKey (translated at render time via t()) rather than a
// literal string, so this stays UI-language-agnostic.
export function nextAction(status) {
  switch (status) {
    case 'Assigned':
    case 'EnRouteToPickup':
      return { labelKey: 'load.action.arrivedPickup', icon: 'map-pin', tone: 'teal', next: 'AtPickup' };
    case 'AtPickup':
      return { labelKey: 'load.action.loadedGo', icon: 'check', tone: 'go', next: 'EnRouteToDropoff', milestone: true };
    case 'Loaded':
    case 'EnRouteToDropoff':
      return { labelKey: 'load.action.arrivedDelivery', icon: 'map-pin', tone: 'teal', next: 'AtDelivery' };
    case 'AtDelivery':
      return { labelKey: 'load.action.delivered', icon: 'check-circle', tone: 'go', next: 'Delivered', confirm: true, pod: true, milestone: true };
    default:
      return null;
  }
}

// Whether the current target is the pickup or the dropoff.
export function isPrePickup(status) {
  return ['Posted', 'Assigned', 'EnRouteToPickup', 'AtPickup'].includes(status);
}

// Which mileage bucket the odometer attributes distance to right now: 'deadhead'
// while running empty to the pickup, 'loaded' once the freight is aboard, null
// when there's nothing to measure (posted / terminal). See lib/odometer.
export function loadPhase(status) {
  switch (status) {
    case 'Assigned':
    case 'EnRouteToPickup':
    case 'AtPickup':
      return 'deadhead';
    case 'Loaded':
    case 'EnRouteToDropoff':
    case 'AtDelivery':
      return 'loaded';
    default:
      return null;
  }
}

// Resolve the "next stop" the driver is heading to.
export function nextStop(load, status) {
  if (isPrePickup(status)) {
    return {
      kind: 'PICKUP',
      city: load.origin,
      address: load.originAddress,
      date: load.pickupDate,
      by: load.pickupWindowText,
      remainingMiles: load.remainingMiles,
      eta: load.etaText,
    };
  }
  return {
    kind: 'DELIVERY',
    city: load.destination,
    address: load.destAddress,
    date: load.deliveryDate,
    by: load.deliverBy,
    remainingMiles: load.deliveryRemainingMiles,
    eta: load.deliveryEtaText,
  };
}

// Stepper progress: index of the furthest stage reached.
export function stageIndex(status) {
  const i = ORDER.indexOf(status === 'Loaded' ? 'EnRouteToDropoff' : status);
  return i < 0 ? 0 : i;
}
