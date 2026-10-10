import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { EmptyState, ErrorBanner, Input, PageHeader, Spinner, useLoad } from '../../components/ui';
import { isClosed, isStorefrontOrder, isUnacceptedQuote, listOrders, needsAction } from '../../lib/orders';
import { OrderRow } from '../Dashboard';
import type { Order } from '../../lib/types';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'action', label: 'Needs response' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'storefront', label: 'Storefront' },
  { key: 'closed', label: 'Past orders' },
  { key: 'all', label: 'All' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

function matches(o: Order, f: FilterKey): boolean {
  switch (f) {
    case 'open': return !isClosed(o);
    case 'action': return needsAction(o);
    case 'unpaid': return !o.is_paid && !isClosed(o) && !isUnacceptedQuote(o) && o.marketplace_status !== 'pending';
    case 'storefront': return isStorefrontOrder(o) && !isClosed(o);
    case 'closed': return isClosed(o);
    default: return true;
  }
}

export function OrdersPage() {
  const userId = useUserId();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as FilterKey) || 'open';
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => listOrders(userId), [userId]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (data ?? []).filter((o) => matches(o, filter)).filter((o) => {
      if (!term) return true;
      return [o.order_name, o.customer_name, o.customer_email, o.buyer_display_name, o.customer_phone, o.notes]
        .some((v) => v?.toLowerCase().includes(term));
    });
    // Closed orders read newest first; everything else by due date.
    return filter === 'closed' || filter === 'all'
      ? list.sort((a, b) => b.due_date.localeCompare(a.due_date))
      : list.sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [data, filter, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.key] = (data ?? []).filter((o) => matches(o, f.key)).length;
    return c;
  }, [data]);

  return (
    <div className="page">
      <PageHeader title="Orders" actions={<Link to="/orders/new" className="btn btn-primary">New order</Link>} />
      <div className="toolbar">
        <div className="pills" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`pill ${filter === f.key ? 'active' : ''}`}
              onClick={() => setParams(f.key === 'open' ? {} : { filter: f.key })}
            >
              {f.label}{data ? ` · ${counts[f.key]}` : ''}
            </button>
          ))}
        </div>
        <Input type="search" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} className="search" />
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="card">
        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState
            title={q ? 'No orders match your search' : 'No orders here'}
            body={filter === 'open' && !q ? 'Orders from your storefront and ones you add yourself appear here.' : undefined}
          />
        ) : (
          <ul className="list">{rows.map((o) => <OrderRow key={o.id} o={o} />)}</ul>
        )}
      </div>
    </div>
  );
}
