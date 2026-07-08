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
    fuelGal: 329, fuelCost: 1184, deductions: 476, prevNet: 2980, goal: 4000,
    bars: [
      { d: 'Mon', v: 520 }, { d: 'Tue', v: 0 }, { d: 'Wed', v: 880 },
      { d: 'Thu', v: 610 }, { d: 'Fri', v: 720 }, { d: 'Sat', v: 554 }, { d: 'Sun', v: 0 },
    ],
  },
  month: {
    net: 12940, gross: 15010, miles: 8620, loads: 17, rpm: 1.74,
    fuelGal: 1326, fuelCost: 4770, deductions: 2070, prevNet: 11200, goal: 15000,
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

// ── Load history ─────────────────────────────────────────────────────
// The driver's completed loads for the Load History screen. Mirrors the
// /loads/driver/{id}/history shape: terminal-state loads, newest first, each
// with its proof-of-delivery photos inline. Demo photos are externally hosted
// (deterministic picsum seeds) so the screen renders without a backend.
const pod = (seed, caption) => ({
  id: `p-${seed}`,
  url: `https://picsum.photos/seed/${seed}/900/700`,
  thumbnailUrl: `https://picsum.photos/seed/${seed}/240/240`,
  caption,
});

export const loadHistory = [
  {
    id: 'LD-4810', origin: 'Dallas, TX', destination: 'Chicago, IL', originState: 'TX', destState: 'IL',
    miles: 925, rate: 2080, rpm: 2.25, equipment: '53FT Dry Van', commodity: 'Consumer goods', weight: 38000,
    broker: 'Coyote Logistics', status: 'Delivered', completedAt: '2026-06-03',
    photos: [pod('hlh4810a', 'Delivery paperwork'), pod('hlh4810b', 'Signed BOL'), pod('hlh4810c', 'Cargo delivered')],
  },
  {
    id: 'LD-4798', origin: 'Denver, CO', destination: 'Dallas, TX', originState: 'CO', destState: 'TX',
    miles: 780, rate: 1990, rpm: 2.55, equipment: 'Reefer', commodity: 'Produce', weight: 41000,
    broker: 'TQL', status: 'Delivered', completedAt: '2026-06-01',
    photos: [pod('hlh4798a', 'Delivery paperwork'), pod('hlh4798b', 'Reefer temps')],
  },
  {
    id: 'LD-4781', origin: 'Phoenix, AZ', destination: 'Denver, CO', originState: 'AZ', destState: 'CO',
    miles: 600, rate: 1520, rpm: 2.53, equipment: 'Flatbed', commodity: 'Steel', weight: 44000,
    broker: 'Echo', status: 'Closed', completedAt: '2026-05-29',
    photos: [pod('hlh4781a', 'Delivery paperwork'), pod('hlh4781b', 'Load secured'), pod('hlh4781c', 'Tarps on')],
  },
  {
    id: 'LD-4772', origin: 'Los Angeles, CA', destination: 'Phoenix, AZ', originState: 'CA', destState: 'AZ',
    miles: 370, rate: 980, rpm: 2.65, equipment: '53FT Dry Van', commodity: 'Electronics', weight: 22000,
    broker: 'RXO', status: 'Delivered', completedAt: '2026-05-27',
    photos: [pod('hlh4772a', 'Delivery paperwork')],
  },
  {
    id: 'LD-4759', origin: 'Seattle, WA', destination: 'Portland, OR', originState: 'WA', destState: 'OR',
    miles: 175, rate: 720, rpm: 4.11, equipment: 'Reefer', commodity: 'Seafood', weight: 18000,
    broker: 'Coyote Logistics', status: 'Cancelled', completedAt: '2026-05-24',
    cancellationReason: 'Shipper cancelled at the dock', photos: [],
  },
  {
    id: 'LD-4741', origin: 'Kansas City, MO', destination: 'St. Louis, MO', originState: 'MO', destState: 'MO',
    miles: 250, rate: 890, rpm: 3.56, equipment: 'Flatbed', commodity: 'Machinery', weight: 39000,
    broker: 'Echo', status: 'Closed', completedAt: '2026-05-20',
    photos: [pod('hlh4741a', 'Delivery paperwork'), pod('hlh4741b', 'Cargo delivered')],
  },
];

// ── Notifications inbox ──────────────────────────────────────────────
// Feed for the Alerts screen. Copy is drawn straight from the fixtures above
// (activeLoad, hos, documents, earnings) so it reads coherently. Each item:
//   category: 'load' | 'hos' | 'document' | 'weather' | 'earnings'
//   tone:     drives the accent color (see toneOf) — teal/caution/danger/go
//   critical: pinned to the top of the list until read (can't-miss items)
//   minutesAgo: relative timestamp source (kept deterministic for the demo)
//   action:   optional affordance — { label, route } to navigate, or
//             { label, kind } for a special handler ('weatherTakeover'|'findStop')
export const notifications = [
  {
    id: 'n-weather',
    category: 'weather',
    tone: 'caution',
    icon: 'alert-triangle',
    critical: true,
    title: 'Winter storm warning ahead',
    body: 'Heavy snow near Joliet, IL — about 30 min out. Reduced visibility expected; plan a stop.',
    minutesAgo: 3,
    read: false,
    action: { label: 'Find a safe truck stop', kind: 'weatherTakeover' },
  },
  {
    id: 'n-load-new',
    category: 'load',
    tone: 'teal',
    icon: 'truck',
    title: 'New load assigned — LD-4827',
    body: 'Chicago, IL → Atlanta, GA · 720 mi · $1,820. Pickup window 08:00–12:00 today.',
    minutesAgo: 18,
    read: false,
    action: { label: 'View load', route: '/(tabs)' },
  },
  {
    id: 'n-doc-med',
    category: 'document',
    tone: 'caution',
    icon: 'file-text',
    title: 'Medical Certificate expires soon',
    body: 'Your DOT medical card (MC-99214) expires Jun 28 — 23 days left. Renew to stay compliant.',
    minutesAgo: 65,
    read: false,
    action: { label: 'View documents', route: '/(tabs)/documents' },
  },
  {
    id: 'n-hos-break',
    category: 'hos',
    tone: 'caution',
    icon: 'clock',
    title: '30-minute break due soon',
    body: 'About 1h 36m of drive time left before your required 30-minute break. Line up a stop.',
    minutesAgo: 120,
    read: true,
    action: { label: 'Find a stop', kind: 'findStop' },
  },
  {
    id: 'n-pay',
    category: 'earnings',
    tone: 'go',
    icon: 'dollar-sign',
    title: "This week's settlement posted",
    body: '$3,284 net across 4 loads · 2,140 mi. Detention on LD-4810 was approved and added.',
    minutesAgo: 1440,
    read: true,
    action: { label: 'See breakdown', route: '/(tabs)/earnings' },
  },
  {
    id: 'n-load-note',
    category: 'load',
    tone: 'teal',
    icon: 'message-square',
    title: 'Broker note on LD-4827',
    body: 'Detention starts after 2 hrs if loading is slow. Keep the lumper receipt at destination.',
    minutesAgo: 1500,
    read: true,
    action: { label: 'View load', route: '/(tabs)' },
  },
];

export const documents = [
  { id: 'cdl', label: 'CDL', sub: "Commercial Driver's License", number: 'IL D824-5519', expires: '2027-04-12', icon: 'credit-card' },
  { id: 'med', label: 'Medical Certificate', sub: 'DOT Medical Card', number: 'MC-99214', expires: '2026-06-28', icon: 'activity' },
  { id: 'reg', label: 'Truck Registration', sub: 'Cascadia #4471', number: 'IL-PRP-7741', expires: '2026-12-01', icon: 'truck' },
  { id: 'ins', label: 'Insurance Card', sub: 'Progressive Commercial', number: 'PC-5521-08', expires: '2026-09-15', icon: 'shield' },
];
