// Row shapes for the tables the web app reads/writes. Column names match
// Supabase exactly; only the fields the web app uses are listed.

export interface Profile {
  id: string;
  user_name: string | null;
  business_name: string | null;
  business_slogan: string | null;
  email: string | null;
  profile_slug: string | null;
  country: string | null;
  pickup_address: string | null;
  delivery_enabled: boolean | null;
  stripe_connect_onboarding_complete: boolean | null;
  vendor_setup_completed_at: string | null;
  terms_accepted_at: string | null;
  storefront_listing_id: string | null;
}

export type OrderStatus =
  | 'Confirmed' | 'Baked' | 'Decorated' | 'Packaged' | 'Delivered' | 'Completed' | 'Cancelled';

export type MarketplaceStatus =
  | 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'pending_quote' | 'quote_provided'
  | 'ready_for_pickup' | 'out_for_delivery' | 'completed' | 'awaiting_shipment' | 'preparing'
  | 'shipped' | 'delivered' | 'refunded' | 'expired';

export interface Order {
  id: string;
  user_id: string;
  order_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  due_date: string;
  start_date: string | null;
  status: OrderStatus;
  notes: string;
  is_paid: boolean;
  paid_at: string | null;
  payment_note: string;
  deposit_amount: number;
  deposit_paid_at: string | null;
  deposit_note: string;
  fulfillment_type: string;
  delivery_details: string;
  color_name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  order_source: string;
  buyer_profile_id: string | null;
  marketplace_status: MarketplaceStatus | null;
  buyer_display_name: string;
  scheduled_pickup_date: string | null;
  payment_intent_id: string | null;
  payment_status: string | null;
  payment_flow: string;
  quoted_price: number | null;
  quote_expires_at: string | null;
  quote_note: string | null;
  decline_message: string | null;
  deposit_amount_cents: number | null;
  is_delivery: boolean;
  delivery_address: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  form_responses: any;
  invoice_code: string | null;
  invoice_type: string;
  completed_at: string | null;
  shipping_address: any;
  tracking_number: string | null;
  shipping_carrier: string | null;
  tax_amount_cents: number;
  platform_fee_cents: number | null;
  baker_payout_cents: number | null;
  lead_channel: string | null;
  order_items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  user_id: string;
  order_id: string;
  recipe_id: string | null;
  menu_item_id: string | null;
  custom_name: string;
  quantity: number;
  unit: string;
  price_per_unit: number;
  notes: string;
  updated_at: string;
  deleted_at: string | null;
  variant_label: string | null;
  tier_label: string | null;
  variant_breakdown: any;
  form_responses: any;
  preorder_date: string | null;
}

export type ListingKind = 'ready_now' | 'preorder' | 'custom' | 'digital' | 'physical';
export type PreorderMode = 'fixed_dates' | 'weekday' | 'lead_time';

export interface MenuItem {
  id: string;
  user_id: string;
  recipe_id: string | null;
  recipe_ids: string[];
  name: string;
  item_description: string;
  category: string;
  default_quantity: number;
  unit: string;
  default_price: number;
  is_active: boolean;
  sort_order: number;
  linked_recipe_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  has_image: boolean;
  is_listed_in_marketplace: boolean;
  listing_kind: ListingKind;
  lead_days: number;
  available_qty_today: number;
  marketplace_price_from: number;
  use_drop_date: boolean;
  preorder_drop_date: string | null;
  max_preorder_quantity: number;
  is_delivery_available: boolean;
  delivery_fee: number;
  accepts_buyer_note: boolean;
  tax_category: string;
  intake_form_id: string | null;
  allergens: string;
  lead_time_note: string;
  digital_file_path: string | null;
  is_assorted_box: boolean;
  preorder_schedule_mode: PreorderMode;
  preorder_dates: string[] | null;
  preorder_weekday: number | null;
  preorder_order_cutoff_date: string | null;
  shipping_fee: number;
  shipping_always_full_price: boolean;
  has_variants: boolean;
  storefront_intro_title: string | null;
  storefront_intro_body: string | null;
  unit_weight_grams: number | null;
  is_storefront_form: boolean;
  is_lead_magnet: boolean;
}

export interface SizeTier {
  id: string; user_id: string; menu_item_id: string; label: string; unit_count: number;
  price: number; sort_order: number; updated_at: string; deleted_at: string | null;
}

export interface BoxVariant {
  id: string; user_id: string; menu_item_id: string; name: string; sort_order: number;
  has_image: boolean; updated_at: string; deleted_at: string | null;
}

export interface ListingVariant {
  id: string; user_id: string; menu_item_id: string; label: string; price: number;
  stock_qty: number; sort_order: number; has_image: boolean; updated_at: string; deleted_at: string | null;
}

export interface Contact {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  phone: string | null;
  source: string;
  first_order_id: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  user_id: string;
  subject: string;
  body_text: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  cta_listing_id: string | null;
  status: string;
  recipient_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BakingTask {
  id: string;
  user_id: string;
  order_id: string | null;
  order_ids: string[];
  recipe_id: string | null;
  title: string;
  due_date: string;
  is_completed: boolean;
  notes: string;
  color_name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface UnavailableDate {
  id: string;
  user_id: string;
  date: string;
}

export interface Recipe {
  id: string;
  user_id: string;
  name: string;
  yield_quantity: number;
  yield_unit: string;
  prep_time_minutes: number;
  bake_time_minutes: number;
  instructions: string;
  notes: string;
  tags: string[];
  is_favorite: boolean;
  has_image: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RecipeIngredient {
  id: string;
  user_id: string;
  recipe_id: string;
  name: string;
  volume_amount: number;
  volume_unit: string;
  grams_per_cup: number;
  notes: string;
  sort_order: number;
  has_image: boolean;
  updated_at: string;
  deleted_at: string | null;
}

export interface IntakeForm {
  id: string;
  title: string;
}
