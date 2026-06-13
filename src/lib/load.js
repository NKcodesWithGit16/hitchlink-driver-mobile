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

export function statusChip(status) {
  switch (status) {
    case 'Assigned': return { label: 'NEW LOAD', tone: 'caution' };
    case 'EnRouteToPickup': return { label: 'TO PICKUP', tone: 'teal' };
    case 'AtPickup': return { label: 'AT PICKUP', tone: 'caution' };
    case 'Loaded':
    case 'EnRouteToDropoff': return { label: 'ON LOAD', tone: 'teal' };
    case 'AtDelivery': return { label: 'AT DELIVERY', tone: 'caution' };
    case 'Delivered': return { label: 'DELIVERED', tone: 'go' };
    default: return { label: 'POSTED', tone: 'teal' };
  }
}

// The single contextual action shown on the home screen.
export function nextAction(status) {
  switch (status) {
    case 'Assigned':
    case 'EnRouteToPickup':
      return { label: "I've Arrived at Pickup", icon: 'map-pin', tone: 'teal', next: 'AtPickup' };
    case 'AtPickup':
      return { label: "I'm Loaded — Go", icon: 'check', tone: 'go', next: 'EnRouteToDropoff' };
    case 'Loaded':
    case 'EnRouteToDropoff':
      return { label: "I've Arrived at Delivery", icon: 'map-pin', tone: 'teal', next: 'AtDelivery' };
    case 'AtDelivery':
      return { label: 'Delivered', icon: 'check-circle', tone: 'go', next: 'Delivered', confirm: true, pod: true };
    default:
      return null;
  }
}

// Whether the current target is the pickup or the dropoff.
export function isPrePickup(status) {
  return ['Posted', 'Assigned', 'EnRouteToPickup', 'AtPickup'].includes(status);
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

export const STAGES = ['Pickup', 'Loaded', 'In transit', 'Delivery', 'Done'];
