import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { isBasic } from '../lib/plans';
import { Card, EmptyState, PageHeader } from './ui';

// Basic plan (Harvey 2026-11-15): custom orders + web links only. Pages for
// everything else show this upgrade card instead. The storefront and
// create-payment-intent enforce the same rule for customers.
export function BasicLock({ title, feature, children }: { title: string; feature: string; children: React.ReactNode }) {
  const { plan } = useAuth();
  if (!isBasic(plan)) return <>{children}</>;
  return (
    <div className="page">
      <PageHeader title={title} />
      <Card>
        <EmptyState title={`${feature} aren't part of Basic`} body="Basic is for custom orders. Upgrade to Creator or Creator Pro to sell from a menu, take pre-orders, sell digital products, courses and clubs, and grow your list." />
        <div className="btn-row" style={{ justifyContent: 'center' }}><Link to="/plan" className="btn btn-primary">See plans</Link></div>
      </Card>
    </div>
  );
}
