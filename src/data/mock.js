/* Demo fixtures so the app runs with no backend.
   When EXPO_PUBLIC_API_MAIN_URL is set, src/api swaps these for live data. */

export const driver = {
  id: 'demo-driver',
  firstName: 'Mike',
  lastName: 'Reyes',
  name: 'Mike Reyes',
  email: 'mike.reyes@example.com',
  phone: '+13125550147',
  truck: 'Freightliner Cascadia · #4471',
  mpg: 6.5,
  dispatcher: { name: 'Dana Whitfield', phone: '+13125550110' },
};

export const activeLoad = {
  id: 'LD-4827',
  status: 'EnRouteToPickup',
  origin: 'Chicago, IL',
  originState: 'IL',
  originAddress: '2200 S Western Ave, Chicago, IL 60608',
  destination: 'Atlanta, GA',
  destState: 'GA',
  destAddress: '4500 Fulton Industrial Blvd, Atlanta, GA 30336',
  miles: 720,
  rate: 1820,
  rpm: 2.53,
  equipment: '53FT Dry Van',
  commodity: 'Consumer Goods',
  weight: 38000,
  isPartial: false,
  pickupDate: 'Today',
  pickupWindowText: '08:00 – 12:00',
  deliveryDate: 'Tue',
  deliveryWindowText: '12:00 – 17:00',
  deliverBy: '2:00 PM',
  broker: { name: 'Coyote Logistics', phone: '+13125550184', ref: 'CY-184293' },
  notes: 'No touch freight. Lumper service at destination — keep the receipt.',
  // live-ish telemetry
  remainingMiles: 38, // to pickup right now
  etaText: '52m',
  deliveryRemainingMiles: 212,
  deliveryEtaText: '3h 40m',
};

export const weatherNow = { tempF: 41, condition: 'Light snow', icon: 'cloud-snow', severe: false };

export const weatherAlert = {
  severity: 'warning', // 'warning' | 'severe'
  title: 'Winter storm warning ahead',
  near: 'Joliet, IL',
  etaMinutes: 30,
  advice: 'Heavy snow and reduced visibility expected. Consider slowing down or finding a safe stop.',
};

// HOS — best-effort demo values. driveMinutesLeft drives the color state.
export const hos = {
  driveMinutesLeft: 372, // 6h 12m
  onDutyMinutesLeft: 492,
  breakInMinutes: 96,
  cycleHoursLeft: 41,
  drivenTodayMinutes: 288,
};

export const messages = [
  { id: 'm1', from: 'dispatcher', text: 'Morning Mike — LD-4827 is all yours. Pickup at the Coyote dock, ask for door 14.', at: '7:42 AM' },
  { id: 'm2', from: 'driver', text: 'Got it. Rolling now, ETA about an hour.', at: '7:45 AM' },
  { id: 'm3', from: 'dispatcher', text: 'Broker says detention starts after 2 hrs if they are slow loading.', at: '7:46 AM' },
  { id: 'm4', from: 'dispatcher', kind: 'voice', durationSec: 14, at: '7:47 AM' },
];

export const quickReplies = ['On my way', 'Running late', 'At the dock', 'Loaded', 'Delivered ✅'];

export const earnings = {
  week: {
    net: 3284, gross: 3760, miles: 2140, loads: 4, rpm: 1.76,
    fuelGal: 329, fuelCost: 1184, deductions: 476, prevNet: 2980,
    bars: [
      { d: 'Mon', v: 520 }, { d: 'Tue', v: 0 }, { d: 'Wed', v: 880 },
      { d: 'Thu', v: 610 }, { d: 'Fri', v: 720 }, { d: 'Sat', v: 554 }, { d: 'Sun', v: 0 },
    ],
  },
  month: {
    net: 12940, gross: 15010, miles: 8620, loads: 17, rpm: 1.74,
    fuelGal: 1326, fuelCost: 4770, deductions: 2070, prevNet: 11200,
    bars: [
      { d: 'W1', v: 2980 }, { d: 'W2', v: 3120 }, { d: 'W3', v: 3556 }, { d: 'W4', v: 3284 },
    ],
  },
  loads: [
    { id: 'LD-4810', date: 'Jun 3', from: 'Dallas, TX', to: 'Chicago, IL', miles: 925, gross: 2080, net: 1790, deductions: 290 },
    { id: 'LD-4798', date: 'Jun 1', from: 'Denver, CO', to: 'Dallas, TX', miles: 925, gross: 1990, net: 1712, deductions: 278 },
    { id: 'LD-4781', date: 'May 29', from: 'Phoenix, AZ', to: 'Denver, CO', miles: 600, gross: 1520, net: 1305, deductions: 215 },
    { id: 'LD-4772', date: 'May 27', from: 'Los Angeles, CA', to: 'Phoenix, AZ', miles: 370, gross: 980, net: 842, deductions: 138 },
  ],
};

export const documents = [
  { id: 'cdl', label: 'CDL', sub: "Commercial Driver's License", number: 'IL D824-5519', expires: '2027-04-12', icon: 'credit-card' },
  { id: 'med', label: 'Medical Certificate', sub: 'DOT Medical Card', number: 'MC-99214', expires: '2026-06-28', icon: 'activity' },
  { id: 'reg', label: 'Truck Registration', sub: 'Cascadia #4471', number: 'IL-PRP-7741', expires: '2026-12-01', icon: 'truck' },
  { id: 'ins', label: 'Insurance Card', sub: 'Progressive Commercial', number: 'PC-5521-08', expires: '2026-09-15', icon: 'shield' },
];
