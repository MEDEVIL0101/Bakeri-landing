import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, ConfirmModal, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useLoad, useToast } from '../../components/ui';
import { deleteTask, listTasks, listUnavailableDates, saveTask, setTaskDone, toggleUnavailable } from '../../lib/data';
import { isClosed, listOrders, statusLabel } from '../../lib/orders';
import { EVENT_COLORS, fromLocalInput, sameDay, toDateInput, toDateTimeInput } from '../../lib/format';
import type { BakingTask, Order } from '../../lib/types';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function SchedulePage() {
  const userId = useUserId();
  const toast = useToast();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(() => new Date());
  const [editing, setEditing] = useState<Partial<BakingTask> | null>(null);
  const [deleting, setDeleting] = useState<BakingTask | null>(null);
  const orders = useLoad(() => listOrders(userId), [userId]);
  const tasks = useLoad(() => listTasks(userId), [userId]);
  const off = useLoad(() => listUnavailableDates(userId), [userId]);

  const days = useMemo(() => monthGrid(month), [month]);
  const activeOrders = useMemo(() => (orders.data ?? []).filter((o) => o.status !== 'Cancelled' && !['declined', 'cancelled', 'refunded', 'expired'].includes(o.marketplace_status ?? '')), [orders.data]);
  const ordersOn = (d: Date) => activeOrders.filter((o) => sameDay(new Date(o.due_date), d));
  const tasksOn = (d: Date) => (tasks.data ?? []).filter((t) => sameDay(new Date(t.due_date), d));
  const offOn = (d: Date) => (off.data ?? []).find((u) => u.date === toDateInput(d.toISOString()));

  const today = new Date();
  const selOrders = ordersOn(selected);
  const selTasks = tasksOn(selected);
  const selOff = offOn(selected);

  async function toggleOff() {
    try {
      await toggleUnavailable(userId, toDateInput(selected.toISOString()), selOff);
      toast(selOff ? 'Day reopened for orders' : 'Marked unavailable — customers can’t pick this day');
      off.reload();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function toggleTask(t: BakingTask) {
    try { await setTaskDone(t, !t.is_completed); tasks.reload(); } catch (e: any) { toast(e.message, 'error'); }
  }

  return (
    <div className="page">
      <PageHeader
        title="Schedule"
        actions={<Button onClick={() => setEditing({ due_date: atNine(selected) })}>Add task</Button>}
      />
      {(orders.error || tasks.error) && <ErrorBanner message={(orders.error || tasks.error)!} onRetry={() => { orders.reload(); tasks.reload(); }} />}
      <div className="schedule">
        <div className="card calendar">
          <div className="cal-head">
            <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
            <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
            <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
            <Button variant="ghost" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(d); }}>Today</Button>
          </div>
          <div className="cal-grid">
            {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {days.map((d) => {
              const os = ordersOn(d);
              const ts = tasksOn(d);
              const isOff = !!offOn(d);
              return (
                <button
                  key={d.toISOString()}
                  className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''} ${sameDay(d, selected) ? 'selected' : ''} ${isOff ? 'off' : ''}`}
                  onClick={() => setSelected(d)}
                >
                  <span className="cal-num">{d.getDate()}</span>
                  <span className="cal-events">
                    {os.slice(0, 3).map((o) => <span key={o.id} className="cal-pill" style={{ background: EVENT_COLORS[o.color_name] ?? EVENT_COLORS.red }}>{o.order_name || o.customer_name || o.buyer_display_name}</span>)}
                    {ts.slice(0, 2).map((t) => <span key={t.id} className={`cal-pill task ${t.is_completed ? 'done' : ''}`} style={{ borderColor: EVENT_COLORS[t.color_name] ?? EVENT_COLORS.gold }}>{t.title}</span>)}
                    {os.length + ts.length > 5 && <span className="cal-more">+{os.length + ts.length - 5}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="stack-lg">
          <Card title={selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            actions={<Button variant="ghost" onClick={toggleOff}>{selOff ? 'Reopen day' : 'Mark unavailable'}</Button>}>
            {selOff && <p className="small banner banner-info">You’re unavailable — customers can’t choose this day.</p>}
            {(orders.loading || tasks.loading) ? <Spinner /> : (
              <>
                <h3 className="h3">Orders due</h3>
                {selOrders.length === 0 ? <p className="muted small">None</p> : (
                  <ul className="list">
                    {selOrders.map((o) => <DayOrder key={o.id} o={o} />)}
                  </ul>
                )}
                <h3 className="h3">Tasks</h3>
                {selTasks.length === 0 ? <p className="muted small">None</p> : (
                  <ul className="list">
                    {selTasks.map((t) => (
                      <li key={t.id} className="list-row">
                        <input type="checkbox" checked={t.is_completed} onChange={() => toggleTask(t)} aria-label="Done" />
                        <button className="grow link-btn left" onClick={() => setEditing(t)}>
                          <span className={`row-title ${t.is_completed ? 'strike' : ''}`}>{t.title}</span>
                          <span className="row-sub">{new Date(t.due_date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{t.notes ? ` · ${t.notes}` : ''}</span>
                        </button>
                        <span className="dot" style={{ background: EVENT_COLORS[t.color_name] }} />
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="secondary" onClick={() => setEditing({ due_date: atNine(selected) })}>Add task for this day</Button>
              </>
            )}
          </Card>
        </div>
      </div>

      {editing && (
        <TaskModal userId={userId} task={editing} orders={(orders.data ?? []).filter((o) => !isClosed(o))}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? () => { setDeleting(editing as BakingTask); setEditing(null); } : undefined}
          onSaved={() => { toast('Task saved'); tasks.reload(); }} />
      )}
      {deleting && (
        <ConfirmModal title="Delete this task?" confirmLabel="Delete" danger onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteTask(deleting); tasks.reload(); }} />
      )}
    </div>
  );
}

function atNine(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9).toISOString();
}

function DayOrder({ o }: { o: Order }) {
  return (
    <li>
      <Link to={`/orders/${o.id}`} className="list-row link-row">
        <span className="dot" style={{ background: EVENT_COLORS[o.color_name] ?? EVENT_COLORS.red }} />
        <span className="grow">
          <span className="row-title">{o.order_name || o.customer_name || o.buyer_display_name}</span>
          <span className="row-sub">{new Date(o.due_date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {statusLabel(o)}</span>
        </span>
      </Link>
    </li>
  );
}

function TaskModal({ userId, task, orders, onClose, onSaved, onDelete }: {
  userId: string; task: Partial<BakingTask>; orders: Order[]; onClose: () => void; onSaved: () => void; onDelete?: () => void;
}) {
  const [title, setTitle] = useState(task.title ?? '');
  const [due, setDue] = useState(toDateTimeInput(task.due_date ?? new Date().toISOString()));
  const [notes, setNotes] = useState(task.notes ?? '');
  const [color, setColor] = useState(task.color_name ?? 'gold');
  const [orderId, setOrderId] = useState(task.order_ids?.[0] ?? task.order_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={task.id ? 'Edit task' : 'New task'} onClose={onClose}
      footer={<>
        {onDelete && <Button variant="ghost" onClick={onDelete} className="mr-auto">Delete</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={async () => {
          if (!title.trim()) { setErr('Give the task a name.'); return; }
          setBusy(true); setErr(null);
          try {
            await saveTask(userId, { ...task, title: title.trim(), due_date: fromLocalInput(due), notes, color_name: color, order_ids: orderId ? [orderId] : [] });
            onSaved(); onClose();
          } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Save</Button>
      </>}
    >
      <Field label="Task"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bake vanilla layers" /></Field>
      <Field label="When"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Field label="For order (optional)">
        <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">None</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.order_name || o.customer_name || o.buyer_display_name}</option>)}
        </Select>
      </Field>
      <Field label="Colour">
        <div className="swatches">
          {Object.entries(EVENT_COLORS).map(([name, hex]) => (
            <button type="button" key={name} aria-label={name} className={`swatch ${color === name ? 'selected' : ''}`} style={{ background: hex }} onClick={() => setColor(name)} />
          ))}
        </div>
      </Field>
      <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}
