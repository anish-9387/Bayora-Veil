import { ReactNode } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Shield, Activity, Search, FileText, AlertTriangle, Settings } from 'lucide-react';
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

  return (
    <div className="min-h-screen flex bg-bayora-dark">
      <aside className="w-64 bg-bayora-surface border-r border-bayora-border flex flex-col">
        <div className="p-6 border-b border-bayora-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">BAYORA VEIL</h1>
              <p className="text-xs text-bayora-text-muted">Verifiable Evaluation Isolation Layer</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                  isActive
                    ? 'bg-bayora-primary/20 text-bayora-primary border border-bayora-primary/30'
                    : 'text-bayora-text-muted hover:text-white hover:bg-bayora-border'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-bayora-border">
          <div className="text-xs text-bayora-text-muted space-y-1">
            <p>Status: <span className="text-bayora-success">Operational</span></p>
            <p>Isolation: <span className="text-bayora-primary">Active</span></p>
            <p>Audit: <span className="text-bayora-warning">Verified</span></p>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {description && <p className="text-bayora-text-muted mt-1">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-bayora-surface border border-bayora-border rounded-xl p-6', className)}>
      {title && <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>}
      {children}
    </div>
  );
}

export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'primary' }) {
  const variants = {
    default: 'bg-bayora-border text-bayora-text',
    success: 'bg-green-500/20 text-green-400 border border-green-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    danger: 'bg-red-500/20 text-red-400 border border-red-500/30',
    primary: 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
  };
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant])}>
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
    <div className={clsx('animate-spin rounded-full border-2 border-bayora-border border-t-bayora-primary', sizes[size])} />
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="text-center py-16">
      <Icon className="w-16 h-16 mx-auto text-bayora-border mb-4" />
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-bayora-text-muted mb-6 max-w-md mx-auto">{description}</p>
      {action}
    </div>
  );
}