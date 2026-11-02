import { useLoad } from '../../components/ui';
import { buildProfiles, listCampaignSends, productCatalog } from '../../lib/crm';
import { listContacts } from '../../lib/data';
import { listMenuItems } from '../../lib/menu';
import { listOrders } from '../../lib/orders';
import type { Contact } from '../../lib/types';

/** Everything the Customers and Campaigns pages work from, loaded together. */
export function useCrm(userId: string) {
  return useLoad(async () => {
    const [contacts, orders, sends, menu] = await Promise.all([
      listContacts(userId),
      listOrders(userId),
      listCampaignSends(),
      listMenuItems(userId).catch(() => []),
    ]);
    const names = new Map(menu.map((m) => [m.id, m.name]));
    return {
      contacts, orders, sends, names,
      profiles: buildProfiles(contacts, orders, sends),
      catalog: productCatalog(orders, names),
      tags: allTags(contacts),
    };
  }, [userId]);
}

export function allTags(contacts: Contact[]): string[] {
  return [...new Set(contacts.flatMap((c) => c.tags ?? []))].sort((a, b) => a.localeCompare(b));
}
