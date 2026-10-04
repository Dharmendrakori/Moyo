/**
 * THE 20 OFFICIAL MAIN CATEGORIES
 *
 * Source of truth: the official Moyo service specification.
 * These names and their order MUST NOT be renamed or reordered. Sub-catalogues
 * are the operational groupings used to make the catalog navigable.
 */

export type SubSpec = {
  name: string;
  services: string[];
};

export type CategorySpec = {
  position: number;
  name: string;
  description: string;
  /** Short, neutral icon key resolved by components/ui/Icon.tsx */
  icon: string;
  subcategories: SubSpec[];
};

export const CATEGORIES: CategorySpec[] = [
  {
    position: 1,
    name: 'Home & Household Services',
    description: 'Electrical, appliance and general maintenance for homes and flats.',
    icon: 'home',
    subcategories: [
      {
        name: 'Wiring & Switchboards',
        services: [
          'Switchboard & Socket Repair / Replacement',
          'Complete House Wiring',
          'Short Circuit & Power Trip Diagnosis',
          'MCB / Distribution Board Upgrade',
        ],
      },
      {
        name: 'Appliances',
        services: [
          'Air Conditioner Servicing',
          'Refrigerator & Deep Freezer Repair',
          'Washing Machine Repair',
          'Television & Audio Repair',
        ],
      },
      {
        name: 'Lighting & Fans',
        services: [
          'Ceiling Fan Installation & Repair',
          'Lighting Design & Installation',
          'Street & Garden Lighting',
        ],
      },
      {
        name: 'Water & Pumps',
        services: [
          'Water Pump Installation & Repair',
          'Water Heater (Geyser) Service',
          'Water Tank & Plumbing Repairs',
        ],
      },
    ],
  },
  {
    position: 2,
    name: 'Hospital & Medical Equipment Services',
    description: 'Electrical support and maintenance for medical equipment installations.',
    icon: 'medical',
    subcategories: [
      {
        name: 'Medical Equipment Power',
        services: ['Medical Equipment Power Backup', 'Isolation & UPS Systems'],
      },
      {
        name: 'Clinical Infrastructure',
        services: ['Operation Theatre Lighting & Power', 'Laboratory Equipment Electrical Support'],
      },
    ],
  },
  {
    position: 3,
    name: 'Office & Shop Services',
    description: 'Electrical and HVAC maintenance for commercial premises.',
    icon: 'office',
    subcategories: [
      {
        name: 'Electrical Maintenance',
        services: ['Office Wiring & Load Balancing', 'Commercial Lighting Upgrades'],
      },
      {
        name: 'Climate & Power',
        services: ['Office AC Servicing', 'UPS & DG Set Maintenance'],
      },
    ],
  },
  {
    position: 4,
    name: 'Hotel & Restaurant Services',
    description: 'Kitchen, refrigeration and electrical support for hospitality businesses.',
    icon: 'hotel',
    subcategories: [
      {
        name: 'Kitchen Equipment',
        services: ['Commercial Kitchen Equipment Repair', 'Refrigeration & Cold Room Maintenance'],
      },
      {
        name: 'Front of House',
        services: ['Hospitality Lighting & Power', 'Inverter & Power Backup'],
      },
    ],
  },
  {
    position: 5,
    name: 'College & School Services',
    description: 'Campus electrical, laboratory and equipment maintenance.',
    icon: 'education',
    subcategories: [
      {
        name: 'Campus Electrical',
        services: ['Laboratory Wiring & Maintenance', 'Classroom & Corridor Lighting'],
      },
      {
        name: 'Equipment Support',
        services: ['Computer Lab Power & UPS', 'Sports Equipment Electrical Support'],
      },
    ],
  },
  {
    position: 6,
    name: 'Event Management & Support',
    description: 'Temporary and permanent power, lighting and audio for events.',
    icon: 'event',
    subcategories: [
      {
        name: 'Power & Lighting',
        services: ['Event Power Distribution', 'Stage & Decorative Lighting'],
      },
      {
        name: 'Equipment Support',
        services: ['Audio & Visual Equipment Setup', 'CCTV Coverage for Events'],
      },
    ],
  },
  {
    position: 7,
    name: 'Industrial & Company Services',
    description: 'Plant-level electrical maintenance and industrial installations.',
    icon: 'industry',
    subcategories: [
      {
        name: 'Plant Electrical',
        services: [
          'Industrial Wiring & Maintenance',
          'Motor Starters & Control Panels',
          'HT/LT Panel Maintenance',
        ],
      },
      {
        name: 'Safety & Compliance',
        services: ['Earthing & Lightning Protection', 'Safety Audit Support'],
      },
    ],
  },
  {
    position: 8,
    name: 'Renewable Energy & Solar Projects',
    description: 'Solar installation, commissioning and maintenance.',
    icon: 'solar',
    subcategories: [
      {
        name: 'Solar Installation',
        services: [
          'Rooftop Solar Installation',
          'Ground Mount Solar Projects',
          'Solar Water Heater Installation',
        ],
      },
      {
        name: 'Solar Maintenance',
        services: ['Solar Panel Cleaning', 'Inverter & Wiring Maintenance', 'Solar AMC Plans'],
      },
    ],
  },
  {
    position: 9,
    name: 'Agricultural Electrical Services',
    description: 'Pump, irrigation and farm structure electrical support.',
    icon: 'agriculture',
    subcategories: [
      {
        name: 'Irrigation',
        services: ['Pump & Well Installation', 'Drip & Sprinkler Irrigation Electrification'],
      },
      {
        name: 'Farm Structures',
        services: ['Poly House Electrification', 'Farm Shed Wiring'],
      },
    ],
  },
  {
    position: 10,
    name: 'Computing & Electronics Item Services',
    description: 'Installation, networking and repair of computers and electronics.',
    icon: 'compute',
    subcategories: [
      {
        name: 'Computing Devices',
        services: ['Desktop & Laptop Repair', 'Computer Installation & Setup'],
      },
      {
        name: 'Networking & Peripherals',
        services: ['Network & Router Setup', 'Printer Installation & Repair'],
      },
    ],
  },
  {
    position: 11,
    name: 'Construction & Building Electrical Services',
    description: 'Electrical works for construction sites and building projects.',
    icon: 'construction-electrical',
    subcategories: [
      {
        name: 'Site Electrification',
        services: ['Construction Site Temporary Power', 'Building Internal Electrical Work'],
      },
      {
        name: 'Fit-out',
        services: ['Electrical Fit-out & Commissioning', 'Fire & Emergency Lighting'],
      },
    ],
  },
  {
    position: 12,
    name: 'Civil & Building Construction Services',
    description: 'Civil works coordination for building and construction projects.',
    icon: 'civil',
    subcategories: [
      {
        name: 'Civil Works',
        services: ['Wall & Partition Work', 'Waterproofing & Seepage Repair'],
      },
      {
        name: 'Site Work',
        services: ['Site Supervision Support', 'Material Estimation & Advice'],
      },
    ],
  },
  {
    position: 13,
    name: 'Plumbing & Water System Services',
    description: 'Water supply, sanitary and drainage systems.',
    icon: 'plumbing',
    subcategories: [
      {
        name: 'Water Systems',
        services: ['Pipeline Installation & Repair', 'Overhead Tank Maintenance'],
      },
      {
        name: 'Sanitary',
        services: ['Sanitary Fixture Installation', 'Drainage & Sewer Cleaning'],
      },
    ],
  },
  {
    position: 14,
    name: 'Carpentry & Woodwork Services',
    description: 'Furniture, doors and woodwork for homes and offices.',
    icon: 'carpentry',
    subcategories: [
      {
        name: 'Furniture',
        services: ['Furniture Installation & Fitting', 'Custom Furniture Fabrication'],
      },
      {
        name: 'Doors & Windows',
        services: ['Door & Window Repair', 'Modular Kitchen Carpentry'],
      },
    ],
  },
  {
    position: 15,
    name: 'Painting & Home Improvement Services',
    description: 'Painting, finishing and general home improvement work.',
    icon: 'painting',
    subcategories: [
      {
        name: 'Painting',
        services: ['Interior Wall Painting', 'Exterior & Texture Painting'],
      },
      {
        name: 'Home Improvement',
        services: ['Celing & False Work', 'Small Repairs & Fixups'],
      },
    ],
  },
  {
    position: 16,
    name: 'Cleaning & Sanitization Services',
    description: 'Residential, commercial and post-works sanitization services.',
    icon: 'cleaning',
    subcategories: [
      {
        name: 'Cleaning',
        services: ['Deep Cleaning', 'Office & Commercial Cleaning'],
      },
      {
        name: 'Sanitization',
        services: ['Post-Work Sanitization', 'Pest Control Support'],
      },
    ],
  },
  {
    position: 17,
    name: 'Home Renovation & Interior Design',
    description: 'Renovation planning and interior execution.',
    icon: 'interior',
    subcategories: [
      {
        name: 'Renovation',
        services: ['Full Home Renovation', 'Kitchen Renovation', 'Bathroom Renovation'],
      },
      {
        name: 'Design',
        services: ['Interior Design Consultation', 'Space Planning Advice'],
      },
    ],
  },
  {
    position: 18,
    name: 'Contract & Maintenance Plans',
    description: 'Annual maintenance contracts and preventive maintenance plans.',
    icon: 'contract',
    subcategories: [
      {
        name: 'Contracts',
        services: ['Annual Maintenance Contract (AMC)', 'Preventive Maintenance Plan'],
      },
      {
        name: 'Documentation',
        services: ['Electrical Safety Documentation', 'Compliance Report Preparation'],
      },
    ],
  },
  {
    position: 19,
    name: 'Man-Power Requirement',
    description: 'Skilled manpower supply for sites and projects.',
    icon: 'people',
    subcategories: [
      {
        name: 'Supply',
        services: ['Skilled Electrician Supply', 'Helper / Support Staff Supply'],
      },
      {
        name: 'Placement',
        services: ['Project-Based Manpower', 'Temporary Staffing Support'],
      },
    ],
  },
  {
    position: 20,
    name: 'New Material Ordering',
    description: 'Procurement of electrical, electronic and general materials.',
    icon: 'materials',
    subcategories: [
      {
        name: 'Electrical Materials',
        services: [
          'Wires, Cables & Conduits',
          'Switches, Sockets & MCBs',
          'LED & Lighting Materials',
        ],
      },
      {
        name: 'Equipment',
        services: [
          'Air Conditioners & Appliances',
          'Inverters, Batteries & Solar',
          'Pumps & Water Equipment',
        ],
      },
      {
        name: 'Security & Electronics',
        services: ['CCTV & Security Equipment', 'Networking Devices'],
      },
    ],
  },
];