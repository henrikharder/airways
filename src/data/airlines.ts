// Real airlines that compete as AI. Networks are a representative subset of
// each carrier's real routes, restricted to airports in airports.ts.

export interface AirlineSeed {
  code: string; // IATA designator
  name: string;
  color: string;
  hubs: string[];
  fleet: string[]; // aircraft type ids the airline operates
  style: 'legacy' | 'premium' | 'lowcost';
  reputation: number;
  aggression: number; // 0–1: how hard they fight newcomers
  routes: string[]; // "HUB-DEST"
}

const r = (hub: string, dests: string) => dests.split(' ').map((d) => `${hub}-${d}`);

export const AIRLINES: AirlineSeed[] = [
  {
    code: 'BA', name: 'British Airways', color: '#5b8def', hubs: ['LHR'], style: 'legacy', reputation: 70, aggression: 0.6,
    fleet: ['A20N', 'A21N', 'B789', 'A35K', 'B77W', 'A388'],
    routes: r('LHR', 'JFK BOS LAX SFO MIA ORD IAD YYZ DXB DOH HKG SIN DEL BOM JNB HND MAD FCO CDG AMS EDI MAN DUB ATH CPH'),
  },
  {
    code: 'LH', name: 'Lufthansa', color: '#f5b800', hubs: ['FRA', 'MUC'], style: 'legacy', reputation: 72, aggression: 0.6,
    fleet: ['A20N', 'A21N', 'B789', 'A359', 'B77W', 'A388'],
    routes: [
      ...r('FRA', 'JFK ORD IAD SFO LAX YYZ GRU DEL BOM PVG SIN BKK HND JNB TLV LHR CDG MAD BCN VIE BER HAM MUC'),
      ...r('MUC', 'JFK LAX BOS ICN BKK FCO CPH'),
    ],
  },
  {
    code: 'AF', name: 'Air France', color: '#3d6fd9', hubs: ['CDG'], style: 'legacy', reputation: 72, aggression: 0.55,
    fleet: ['BCS3', 'A20N', 'A359', 'B789', 'B77W'],
    routes: r('CDG', 'JFK LAX MIA BOS YUL MEX GRU EZE DXB DEL BKK SIN HND ICN PVG JNB CMN CAI NCE MAD FCO LHR AMS BCN LIS CPH'),
  },
  {
    code: 'KL', name: 'KLM', color: '#00a1de', hubs: ['AMS'], style: 'legacy', reputation: 74, aggression: 0.5,
    fleet: ['E295', 'B738', 'A339', 'B78X', 'B77W'],
    routes: r('AMS', 'JFK ATL SFO YYZ MEX LIM GRU DXB DEL SIN BKK ICN NRT JNB NBO CPT LHR CDG BCN FCO CPH OSL ARN MAN DUB'),
  },
  {
    code: 'SK', name: 'SAS Scandinavian', color: '#2a3f8f', hubs: ['CPH', 'ARN', 'OSL'], style: 'legacy', reputation: 68, aggression: 0.7,
    fleet: ['A20N', 'A21N', 'A339', 'A359'],
    routes: [
      ...r('CPH', 'LHR CDG AMS FRA OSL ARN HEL BCN PMI AGP NCE FCO JFK ORD SFO EWR MIA LAX HND SEA KEF'),
      ...r('ARN', 'LHR EWR'),
      ...r('OSL', 'LHR EWR'),
    ],
  },
  {
    code: 'EK', name: 'Emirates', color: '#d71921', hubs: ['DXB'], style: 'premium', reputation: 87, aggression: 0.5,
    fleet: ['A359', 'B77W', 'A388'],
    routes: r('DXB', 'LHR LGW CDG FRA MUC AMS MAN FCO MXP BCN MAD IST JFK LAX SFO SEA IAH BOS YYZ GRU JNB CPT NBO CAI DEL BOM BLR BKK SIN KUL CGK MNL HKG PVG ICN HND SYD MEL BNE AKL MLE'),
  },
  {
    code: 'QR', name: 'Qatar Airways', color: '#8c1d40', hubs: ['DOH'], style: 'premium', reputation: 88, aggression: 0.55,
    fleet: ['A20N', 'B789', 'A359', 'A35K', 'B77W', 'A388'],
    routes: r('DOH', 'LHR CDG FRA AMS MAD FCO IST JFK ORD DFW IAD LAX JNB CPT NBO CAI DEL BOM BLR BKK SIN KUL CGK MNL HKG PVG ICN HND SYD MEL PER AKL MLE GRU'),
  },
  {
    code: 'TK', name: 'Turkish Airlines', color: '#e81932', hubs: ['IST'], style: 'legacy', reputation: 75, aggression: 0.65,
    fleet: ['A21N', 'B38M', 'A339', 'B789', 'A359', 'B77W'],
    routes: r('IST', 'LHR CDG FRA AMS MAD BCN FCO ATH VIE ZRH CPH ARN OSL WAW BUD PRG OTP JFK ORD IAD LAX MIA YYZ GRU CAI ADD NBO LOS JNB CMN DXB DOH RUH JED DEL BOM BKK SIN KUL HKG ICN HND MLE AYT'),
  },
  {
    code: 'DL', name: 'Delta Air Lines', color: '#c01933', hubs: ['ATL', 'JFK', 'MSP', 'SEA'], style: 'legacy', reputation: 76, aggression: 0.6,
    fleet: ['BCS3', 'A21N', 'B738', 'A339', 'A359'],
    routes: [
      ...r('ATL', 'LAX DFW DEN JFK LAS MCO MIA BOS SEA SFO PHX CUN MEX LHR CDG AMS FCO JNB GRU ICN HND'),
      ...r('JFK', 'LHR CDG LAX SFO ATH TLV'),
      ...r('MSP', 'AMS LAS'),
      ...r('SEA', 'ICN HND'),
    ],
  },
  {
    code: 'UA', name: 'United Airlines', color: '#1a6fd4', hubs: ['ORD', 'EWR', 'SFO', 'IAH', 'DEN'], style: 'legacy', reputation: 65, aggression: 0.6,
    fleet: ['B38M', 'A21N', 'B738', 'B789', 'B78X', 'B77W'],
    routes: [
      ...r('EWR', 'LHR FRA CDG TLV DEL NRT LAX SFO ORD MCO CUN'),
      ...r('ORD', 'LHR FRA HND DEN LAX SFO LAS'),
      ...r('SFO', 'HND ICN SYD SIN HKG PVG HNL LAX'),
      ...r('IAH', 'MEX LIM'),
      ...r('DEN', 'LAS PHX'),
    ],
  },
  {
    code: 'AA', name: 'American Airlines', color: '#9da6ab', hubs: ['DFW', 'MIA', 'CLT', 'PHL', 'JFK'], style: 'legacy', reputation: 62, aggression: 0.55,
    fleet: ['A21N', 'B738', 'B788', 'B789', 'B77W'],
    routes: [
      ...r('DFW', 'LAX ORD DEN LAS PHX MIA JFK MEX CUN LHR MAD HND ICN BNE GRU'),
      ...r('MIA', 'GRU EZE BOG LIM SCL MAD LHR'),
      ...r('CLT', 'LHR'),
      ...r('PHL', 'LHR FCO'),
      ...r('JFK', 'LHR LAX'),
    ],
  },
  {
    code: 'SQ', name: 'Singapore Airlines', color: '#f0a020', hubs: ['SIN'], style: 'premium', reputation: 90, aggression: 0.45,
    fleet: ['B38M', 'B78X', 'A359', 'B77W', 'A388'],
    routes: r('SIN', 'LHR FRA CDG AMS ZRH IST JFK EWR LAX SFO SEA YVR DEL BOM BLR BKK CGK DPS KUL MNL SGN HAN HKG TPE PVG PEK ICN HND NRT SYD MEL BNE PER AKL MLE'),
  },
  {
    code: 'CX', name: 'Cathay Pacific', color: '#1c7a6b', hubs: ['HKG'], style: 'premium', reputation: 82, aggression: 0.5,
    fleet: ['A21N', 'A339', 'A359', 'A35K', 'B77W'],
    routes: r('HKG', 'LHR FRA CDG AMS ZRH JFK LAX SFO ORD BOS YVR YYZ DFW SEA DEL BOM BKK SIN KUL CGK MNL SGN TPE PVG PEK ICN HND NRT KIX SYD MEL AKL PER'),
  },
  {
    code: 'NH', name: 'All Nippon Airways', color: '#2f6fc0', hubs: ['HND', 'NRT'], style: 'premium', reputation: 85, aggression: 0.4,
    fleet: ['A21N', 'B38M', 'B788', 'B789', 'B77W', 'A388'],
    routes: [
      ...r('HND', 'LHR FRA CDG MUC JFK ORD LAX SFO SEA IAD HNL SIN BKK HKG TPE ICN PEK PVG MNL SGN DEL SYD KIX'),
      ...r('NRT', 'HNL IAH'),
    ],
  },
  {
    code: 'QF', name: 'Qantas', color: '#e0001b', hubs: ['SYD', 'MEL', 'PER', 'BNE'], style: 'legacy', reputation: 78, aggression: 0.6,
    fleet: ['B738', 'A21X', 'A339', 'B789', 'A388'],
    routes: [
      ...r('SYD', 'MEL BNE PER AKL NAN HNL LAX DFW SFO SIN HND HKG JNB DPS MNL'),
      ...r('MEL', 'BNE PER LAX SIN DEL'),
      ...r('PER', 'LHR CDG FCO'),
      ...r('BNE', 'LAX'),
    ],
  },
  {
    code: 'FR', name: 'Ryanair', color: '#f1c933', hubs: ['DUB', 'STN', 'MAN'], style: 'lowcost', reputation: 50, aggression: 0.9,
    fleet: ['B738', 'B38M'],
    routes: [
      ...r('DUB', 'STN MAN EDI BCN MAD AGP PMI FCO LIS BUD'),
      ...r('STN', 'BCN MAD AGP PMI LIS ATH BUD WAW PRG VCE CPH BER'),
      ...r('MAN', 'AGP PMI'),
    ],
  },
  {
    code: 'U2', name: 'easyJet', color: '#ff6600', hubs: ['LGW', 'GVA', 'MXP'], style: 'lowcost', reputation: 58, aggression: 0.75,
    fleet: ['A20N', 'A21N'],
    routes: [
      ...r('LGW', 'EDI AMS NCE BCN MAD PMI AGP LIS FCO VCE ATH GVA BER PRG CPH MXP RAK AYT'),
      ...r('GVA', 'BCN NCE'),
      ...r('MXP', 'BCN'),
    ],
  },
  {
    code: 'AC', name: 'Air Canada', color: '#e31837', hubs: ['YYZ', 'YVR', 'YUL'], style: 'legacy', reputation: 62, aggression: 0.55,
    fleet: ['BCS3', 'B38M', 'A21N', 'B789', 'B77W'],
    routes: [
      ...r('YYZ', 'YVR YUL YYC LHR CDG FRA FCO DEL HND LAX SFO MCO CUN MIA BOG GRU'),
      ...r('YVR', 'HND ICN SYD LHR YYC'),
      ...r('YUL', 'CDG LHR'),
    ],
  },
  {
    code: 'LA', name: 'LATAM', color: '#e8114b', hubs: ['GRU', 'SCL', 'LIM'], style: 'legacy', reputation: 66, aggression: 0.5,
    fleet: ['A20N', 'A21N', 'B789'],
    routes: [
      ...r('GRU', 'GIG EZE SCL LIM BOG MIA JFK MCO LHR FRA MAD LIS MXP JNB'),
      ...r('SCL', 'LIM EZE SYD MEL AKL MAD'),
      ...r('LIM', 'MIA BOG CUN'),
    ],
  },
  {
    code: 'ET', name: 'Ethiopian Airlines', color: '#2e9e48', hubs: ['ADD'], style: 'legacy', reputation: 68, aggression: 0.45,
    fleet: ['DH8D', 'B38M', 'B789', 'A359'],
    routes: r('ADD', 'NBO JNB CPT LOS CAI DXB JED RUH DEL BOM BKK HKG CAN PEK ICN NRT LHR FRA CDG BRU FCO IST IAD EWR YYZ GRU'),
  },
  {
    code: '6E', name: 'IndiGo', color: '#2a2bb0', hubs: ['DEL', 'BOM', 'BLR'], style: 'lowcost', reputation: 64, aggression: 0.8,
    fleet: ['AT76', 'A20N', 'A21N', 'A21X', 'B789'],
    routes: [
      ...r('DEL', 'BOM BLR DXB DOH BKK SIN IST JED HKT KUL'),
      ...r('BOM', 'BLR DXB SIN IST AMS MAN JED'),
      ...r('BLR', 'SIN DXB MLE'),
    ],
  },
  {
    code: 'KE', name: 'Korean Air', color: '#6aa9d8', hubs: ['ICN'], style: 'premium', reputation: 78, aggression: 0.45,
    fleet: ['A21N', 'B38M', 'A339', 'B789', 'B77W', 'A388'],
    routes: r('ICN', 'LAX JFK SFO SEA ATL YVR LHR CDG FRA HND NRT KIX PEK PVG HKG TPE BKK SIN SGN HAN MNL DEL SYD CAN'),
  },
  {
    code: 'CA', name: 'Air China', color: '#c8102e', hubs: ['PEK'], style: 'legacy', reputation: 66, aggression: 0.4,
    fleet: ['A20N', 'A21N', 'A339', 'B789', 'A359', 'B77W'],
    routes: r('PEK', 'PVG CAN CTU SZX HKG ICN HND NRT SIN BKK LHR FRA CDG JFK LAX SFO MEL SYD'),
  },
  {
    code: 'WN', name: 'Southwest Airlines', color: '#f9b612', hubs: ['DEN', 'LAS', 'PHX'], style: 'lowcost', reputation: 70, aggression: 0.7,
    fleet: ['B738', 'B38M'],
    routes: [
      ...r('DEN', 'LAS PHX LAX SFO SEA ORD MCO ATL'),
      ...r('LAS', 'LAX SFO SEA ORD PHX'),
      ...r('PHX', 'LAX SFO'),
    ],
  },
];
