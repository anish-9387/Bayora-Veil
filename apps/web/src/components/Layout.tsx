import { ReactNode, useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Shield, Activity, Search, FileText, AlertTriangle, Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import clsx from 'clsx';

const navigation = [
  { path: '/', label: 'Overview', icon: Activity },
  { path: '/runs', label: 'Runs', icon: Shield },
  { path: '/leakage', label: 'Leakage Lab', icon: Search },
  { path: '/forensics', label: 'Forensics', icon: FileText },
  { path: '/threat-model', label: 'Threat Model', icon: AlertTriangle }
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const mobileMenu = useRef<HTMLDialogElement>(null);
  useEffect(() => { mobileMenu.current?.close(); }, [location.pathname]);
  const links = navigation.map(item => {
    const Icon = item.icon;
    const active = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path + '/'));
    return <NavLink key={item.path} to={item.path} end={item.path === '/'} title={item.label} className={clsx('nav-item', active && 'nav-active')}><Icon className="w-[18px] h-[18px] shrink-0" /><span>{item.label}</span></NavLink>;
  });

  return (
    <div className={clsx("app-shell", collapsed && "sidebar-collapsed")}>
      <aside className="app-sidebar" id="desktop-sidebar">
        <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="desktop-sidebar">{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
        <NavLink to="/" className="brand" aria-label="Bayora Veil home">
          <div className="brand-mark"><Shield className="w-6 h-6" /></div>
          <div><h1 className="font-semibold tracking-tight text-lg">BAYORA VEIL</h1><p className="text-xs text-bayora-text-muted">Evaluation workspace</p></div>
        </NavLink>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="app-nav" aria-label="Main navigation">
          {links}
        </nav>
        <div className="sidebar-note text-xs text-bayora-text-muted">Bayora Veil / v0.1</div>
      </aside>
      <dialog ref={mobileMenu} className="mobile-drawer" aria-label="Navigation" onClick={event => { if (event.target === event.currentTarget) mobileMenu.current?.close(); }}>
        <div className="mobile-drawer-content"><div className="flex items-center justify-between mb-6"><strong>BAYORA VEIL</strong><button aria-label="Close navigation" onClick={() => mobileMenu.current?.close()}><X size={22} /></button></div><nav aria-label="Mobile navigation" className="app-nav">{links}</nav></div>
      </dialog>
      <main className="app-main">
        <header className="workspace-bar">
          <button className="mobile-menu-button" aria-label="Open navigation" aria-haspopup="dialog" onClick={() => mobileMenu.current?.showModal()}><Menu size={22} /></button>
          <span className="text-sm text-bayora-text-muted">Workspace <span className="mx-3 opacity-40">/</span> <span className="text-bayora-text font-medium">{navigation.find(item => item.path === location.pathname || (item.path !== '/' && location.pathname.startsWith(item.path + '/')))?.label || 'Evaluation'}</span></span>
          <select aria-label="Workspace role" className="role-select" defaultValue={typeof sessionStorage === 'undefined' ? 'orchestrator' : sessionStorage.getItem('bayora-role') || 'orchestrator'} onChange={event => { sessionStorage.setItem('bayora-role', event.target.value); window.location.reload(); }}>
            <option value="orchestrator">Orchestrator</option><option value="red">Red team</option><option value="blue">Blue team</option><option value="auditor">Auditor</option>
          </select>
        </header>
        <div className="page-content" key={location.pathname}>{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <h2 className="text-3xl lg:text-4xl font-semibold tracking-tight text-bayora-text">{title}</h2>
        {description && <p className="text-bayora-text-muted mt-1">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('glass-card p-6', className)}>
      {title && <h3 className="text-lg font-semibold text-bayora-text mb-4">{title}</h3>}
      {children}
    </div>
  );
}

export function Badge({ children, variant = 'default', className = '' }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'primary'; className?: string }) {
  const variants = {
    default: 'bg-bayora-border text-bayora-text',
    success: 'bg-green-500/20 text-green-700 border border-green-500/30',
    warning: 'bg-amber-500/20 text-amber-800 border border-amber-500/30',
    danger: 'bg-red-500/20 text-red-700 border border-red-500/30',
    primary: 'bg-blue-500/20 text-blue-700 border border-blue-500/30'
  };
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'primary'> = {
    CREATED: 'default',
    COMMITTED: 'primary',
    RUNNING: 'warning',
    EVALUATED: 'primary',
    CLOSED: 'success',
    VERIFIED: 'success'
  };
  return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No data available',
  rowAction
}: {
  columns: Array<{ key: string; header: string; render?: (item: T) => ReactNode }>;
  data: T[];
  keyExtractor: (item: T) => string;
  emptyMessage?: string;
  rowAction?: (item: T) => ReactNode;
}) {
  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-bayora-text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-bayora-border text-left text-bayora-text-muted">
            {columns.map((col) => (
              <th key={col.key} className="pb-3 px-4 font-medium">{col.header}</th>
            ))}
            {rowAction && <th className="pb-3 px-4 font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-bayora-border/50">
          {data.map((item) => (
            <tr key={keyExtractor(item)} className="hover:bg-bayora-border/30 transition-colors">
              {columns.map((col) => (
                <td key={col.key} className="py-3 px-4">
                  {col.render ? col.render(item) : String((item as any)[col.key])}
                </td>
              ))}
              {rowAction && <td className="py-3 px-4">{rowAction(item)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
  return (
    <div role="status" aria-label="Loading" className={clsx('animate-spin rounded-full border-2 border-bayora-border border-t-bayora-primary', sizes[size])} />
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="text-center py-16">
      <Icon className="w-16 h-16 mx-auto text-bayora-border mb-4" />
      <h3 className="text-lg font-medium text-bayora-text mb-2">{title}</h3>
      <p className="text-bayora-text-muted mb-6 max-w-md mx-auto">{description}</p>
      {action}
    </div>
  );
}