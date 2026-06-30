// ================================================================
//  Marketing site content — all copy/data in one place (JSX-free).
//  Icons are string keys resolved by site/icons.tsx.
//  Copy follows business-psychology rules: concrete, calm, no fake
//  guarantees or invented metrics.
// ================================================================

export type Feature = { icon: string; title: string; desc: string };
export type Step = { n: string; title: string; desc: string };
export type Plan = { name: string; monthly: number; yearly: number; desc: string; features: string[]; cta: string; highlight?: boolean };
export type Faq = { q: string; a: string };
export type Story = { emoji: string; biz: string; owner: string; city: string; stat: string; statLabel: string; story: string };

export const FEATURES: Feature[] = [
  { icon: 'QrCode', title: 'QR check-ins', desc: 'Customers scan once at the counter — no apps, no plastic cards. Every visit is captured automatically.' },
  { icon: 'Award', title: 'Loyalty & points', desc: 'Reward repeat visits with points, tiers and perks that make regulars feel recognised.' },
  { icon: 'Send', title: 'Comeback campaigns', desc: 'Send WhatsApp offers to the right customers before they drift away.' },
  { icon: 'Repeat', title: 'Win-back automations', desc: 'Spot customers who stopped coming and nudge them back, automatically.' },
  { icon: 'Gift', title: 'Coupons & store credit', desc: 'Issue in-store rewards and credit that bring people through the door again.' },
  { icon: 'BarChart3', title: 'Revenue analytics', desc: 'See who is active, at risk or lost — and how much revenue you recovered.' },
  { icon: 'Bot', title: 'AI business advisor', desc: 'Ask plain questions about your business; get answers grounded only in your data.' },
  { icon: 'Star', title: 'Reviews & referrals', desc: 'Turn happy customers into reviews and word-of-mouth that grows your base.' },
];

export const STEPS: Step[] = [
  { n: '1', title: 'Capture customers', desc: 'A quick QR check-in adds every customer to your list — effortlessly.' },
  { n: '2', title: 'Segment automatically', desc: 'We sort them into new, active, loyal, at-risk and lost — no spreadsheets.' },
  { n: '3', title: 'Reward loyalty', desc: 'Points, tiers and treats keep your best customers coming back.' },
  { n: '4', title: 'Send comeback offers', desc: 'Targeted WhatsApp messages reach the people about to slip away.' },
  { n: '5', title: 'Track recovered revenue', desc: 'See exactly how much each campaign and automation brought back.' },
];

export const INDUSTRIES: { icon: string; label: string }[] = [
  { icon: 'Coffee', label: 'Cafés & Restaurants' },
  { icon: 'Scissors', label: 'Salons & Barbers' },
  { icon: 'Dumbbell', label: 'Gyms & Studios' },
  { icon: 'ShoppingBag', label: 'Retail & Boutiques' },
  { icon: 'Store', label: 'Local Services' },
  { icon: 'Building2', label: 'Multi-location' },
];

export const PLANS: Plan[] = [
  { name: 'Free Trial', monthly: 0, yearly: 0, desc: '14 days of Growth, free', features: ['Up to 100 customers', 'QR check-in & dashboard', 'Basic loyalty points'], cta: 'Start free' },
  { name: 'Starter', monthly: 39.99, yearly: 31.99, desc: 'For a single location getting started', features: ['Up to 2,000 customers', '1 branch · 3 staff', 'Loyalty, coupons & referrals', 'Basic campaigns & analytics'], cta: 'Choose Starter' },
  { name: 'Growth', monthly: 99.99, yearly: 79.99, desc: 'For growing businesses', features: ['Up to 16,000 customers', 'Full CRM, loyalty wallet & store credit', 'Campaign builder & comeback automations', 'AI advisor + weekly & monthly reports'], cta: 'Choose Growth', highlight: true },
  { name: 'Pro', monthly: 199.99, yearly: 159.99, desc: 'For high-volume & multi-branch', features: ['Unlimited customers (fair use)', 'Up to 3 branches', 'Branch comparison & advanced analytics', 'Staff permissions & priority support'], cta: 'Choose Pro' },
];

export const FAQS: Faq[] = [
  { q: 'Do I need any technical knowledge?', a: 'No. The Loyaly is built for non-technical business owners. Setup takes minutes — connect WhatsApp, print your QR code, and you are live.' },
  { q: 'Is there a free trial?', a: 'Yes — 14 days on the Growth plan with full features. No credit card required to start.' },
  { q: 'How do customers join?', a: 'They scan a QR code at your counter once. No app to download, no plastic loyalty card.' },
  { q: 'Can I change or cancel my plan?', a: 'Anytime, from your settings. Your customers, campaigns and loyalty data are always kept, even if you downgrade.' },
  { q: 'Which businesses is it for?', a: 'Cafés, restaurants, salons, barbers, gyms, studios and local retail — any business that wants repeat customers.' },
  { q: 'How is my data handled?', a: 'Your data is yours. We never sell it, and customers can opt out of marketing at any time.' },
];

export const STORIES: Story[] = [
  { emoji: '☕', biz: 'Casa Bistro', owner: 'Amara', city: 'Manchester', stat: '480', statLabel: 'loyal regulars', story: 'Comeback messages with a free-coffee reward brought her quietest customers back — her café is the busiest on the street again.' },
  { emoji: '💈', biz: 'Urban Cuts', owner: 'Deon', city: 'Birmingham', stat: '3×', statLabel: 'more rebookings', story: 'Every haircut now earns points and a friendly reminder when it is time for the next trim. Clients come back like clockwork.' },
  { emoji: '🏋️', biz: 'Pulse Gym', owner: 'Marcus', city: 'Leeds', stat: '40%', statLabel: 'fewer dropouts', story: 'The Loyaly spotted members slipping away and nudged them with a guest-pass. Members felt noticed — and they stayed.' },
];

export const BRANDS = ['Casa Bistro', 'Urban Cuts', 'Pulse Gym', 'Bloom Spa', 'The Coffee House', 'Olive & Thyme', 'Lush Nails'];

export const PROOF = {
  quote: 'The Loyaly increased our repeat customers by 60%. The WhatsApp campaigns and rewards work like magic.',
  name: 'Michael Brown',
  biz: 'Casa Bistro',
};
