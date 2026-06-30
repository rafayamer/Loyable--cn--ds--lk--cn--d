import { useNavigate } from 'react-router-dom';
import { type ThemeTokens } from '../design/tokens';

export const MarketingFooter = ({ t, dark }: { t: ThemeTokens; dark: boolean }) => {
  const nav = useNavigate();
  const cols: { h: string; links: { label: string; to?: string; href?: string }[] }[] = [
    { h: 'Product', links: [{ label: 'Overview', to: '/product' }, { label: 'Pricing', to: '/pricing' }, { label: 'About', to: '/about' }] },
    { h: 'Company', links: [{ label: 'Our story', to: '/about' }, { label: 'Contact', href: 'mailto:hello@theloyaly.com' }] },
    { h: 'Legal', links: [{ label: 'Privacy', href: '/terms' }, { label: 'Terms', href: '/terms' }, { label: 'GDPR', href: '/terms' }] },
  ];
  return (
    <footer className="px-5 md:px-10 pt-14 pb-8 mt-10" style={{ borderTop: `1px solid ${t.bdr}` }}>
      <div className="mx-auto max-w-6xl flex flex-col md:flex-row justify-between gap-10">
        <div className="max-w-xs">
          <img src={dark ? '/white.png' : '/black.png'} alt="The Loyaly" className="h-7 w-auto object-contain mb-4" loading="lazy" decoding="async" />
          <p className="text-sm leading-relaxed" style={{ color: t.tx2 }}>Bring customers back automatically — loyalty, campaigns and retention for local businesses.</p>
        </div>
        <div className="flex flex-wrap gap-10">
          {cols.map(c => (
            <div key={c.h}>
              <h4 className="text-sm font-semibold mb-3" style={{ color: t.tx }}>{c.h}</h4>
              <ul className="space-y-2">
                {c.links.map(l => (
                  <li key={l.label}>
                    {l.to
                      ? <button onClick={() => nav(l.to!)} className="text-sm transition-colors hover:opacity-80" style={{ color: t.tx2 }}>{l.label}</button>
                      : <a href={l.href} className="text-sm transition-colors hover:opacity-80" style={{ color: t.tx2 }}>{l.label}</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-6xl mt-10 pt-6 text-xs" style={{ borderTop: `1px solid ${t.bdr}`, color: t.tx3 }}>
        © {new Date().getFullYear()} The Loyaly. All rights reserved.
      </div>
    </footer>
  );
};
