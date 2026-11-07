import { useAuth } from '../../auth/AuthProvider';
import { planFeeRate } from '../../lib/plans';
// Mirrors iOS HelpCenterView. The sales-tax section is left out until the
// Stripe Tax work ships.
const FEE_BODY = '5% of each storefront sale, before tax, on Starter — none on Pro. Stripe’s card processing fee is also deducted by Stripe.';

const SECTIONS: { heading: string; rows: { title: string; body: string }[] }[] = [
  {
    heading: 'When customers are charged',
    rows: [
      { title: 'Ready Now orders', body: 'The customer’s card is authorized at checkout and charged when you accept the order. If you don’t accept within 15 minutes, it’s declined automatically and the customer isn’t charged.' },
      { title: 'Pre-orders', body: 'Charged at checkout, like any sale — the pickup date is just later. If you decline a pre-order, or don’t accept it within 24 hours, the customer is refunded automatically.' },
      { title: 'Custom orders', body: 'When a customer sends a request, you reply with a quote and choose how much they pay up front: nothing, any deposit you like, or the full price. They pay that amount when they accept the quote, and you send the balance as a final invoice whenever you’re ready.' },
      { title: 'Digital downloads and shipped products', body: 'Charged right away at checkout. Downloads are emailed to the customer automatically.' },
    ],
  },
  {
    heading: 'Fees',
    rows: [
      { title: 'Bakeri service fee', body: FEE_BODY },
      { title: 'Tips', body: 'Tips are 100% yours. Bakeri takes nothing from tips.' },
    ],
  },
  {
    heading: 'Getting paid',
    rows: [
      { title: 'Payouts', body: 'Money goes straight into your own Stripe account as soon as an order is charged. Stripe then pays it out to your bank on your payout schedule, usually within a few business days. Change your schedule or bank details from Direct Deposit → Open Stripe Dashboard.' },
    ],
  },
  {
    heading: 'Refunds and cancellations',
    rows: [
      { title: 'Declining or cancelling', body: 'When you decline or cancel an order, the customer is refunded automatically, or the hold on their card is released if they hadn’t been charged yet. They get an email either way.' },
    ],
  },
];

export function HelpContent() {
  const { plan } = useAuth();
  const feeBody = planFeeRate(plan) === 0
    ? 'None — your Pro plan has no Bakeri service fee. Stripe’s card processing fee is still deducted by Stripe.'
    : FEE_BODY;
  return (
    <div className="help">
      {SECTIONS.map((s) => (
        <section key={s.heading} className="help-section">
          <h3 className="h3">{s.heading}</h3>
          {s.rows.map((r) => (
            <div key={r.title} className="help-row">
              <div className="row-title">{r.title}</div>
              <p className="muted small">{r.body === FEE_BODY ? feeBody : r.body}</p>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
