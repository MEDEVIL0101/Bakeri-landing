import { useLoad } from '../../components/ui';
import { buildProfiles, listCampaignSends, productCatalog } from '../../lib/crm';
import { listContacts } from '../../lib/data';
import { listMenuItems } from '../../lib/menu';
import { listOrders } from '../../lib/orders';
import { supabase } from '../../lib/supabase';
import type { Contact } from '../../lib/types';

/** Everything the Customers and Campaigns pages work from, loaded together. */
export function useCrm(userId: string) {
  return useLoad(async () => {
    const [contacts, orders, sends, menu, enrollments] = await Promise.all([
      listContacts(userId),
      listOrders(userId),
      listCampaignSends(),
      listMenuItems(userId).catch(() => []),
      // Course / club members with access now (RLS: the vendor's own).
      supabase.from('course_enrollments').select('email, menu_item_id').is('revoked_at', null)
        .then((r) => (r.data ?? []) as { email: string; menu_item_id: string }[], () => []),
    ]);
    const names = new Map(menu.map((m) => [m.id, m.name]));
    const memberCounts = new Map<string, number>();
    for (const e of enrollments) memberCounts.set(e.menu_item_id, (memberCounts.get(e.menu_item_id) ?? 0) + 1);
    return {
      contacts, orders, sends, names,
      profiles: buildProfiles(contacts, orders, sends, enrollments),
      // Courses and clubs, for the "Member of" audience filter.
      spaces: menu.filter((m) => m.is_course).map((m) => ({ id: m.id, name: m.name, club: !!m.is_club, members: memberCounts.get(m.id) ?? 0 })),
      catalog: productCatalog(orders, names),
      tags: allTags(contacts),
    };
  }, [userId]);
}

export function allTags(contacts: Contact[]): string[] {
  return [...new Set(contacts.flatMap((c) => c.tags ?? []))].sort((a, b) => a.localeCompare(b));
}
