import { supabase, STORAGE_PUBLIC_URL } from './supabase';
import { check } from './api';
import { newId, up } from './format';
import { compressImage } from './menu';

/**
 * Editorial product pages — menu_items.content_blocks (migration
 * 20261105000005). The storefront draws these on the product page in place of
 * the plain description; iOS reads and writes the same JSON
 * (ContentBlock.swift), so keep the two in step.
 */
export type ContentBlockType = 'text' | 'heading' | 'list' | 'image' | 'gallery' | 'video' | 'file' | 'callout' | 'note' | 'divider';

export interface ContentBlock {
  /** Stable id for editing (React keys, SwiftUI lists); ignored by the storefront. */
  id: string;
  type: ContentBlockType;
  text?: string;
  title?: string;
  style?: 'bullet' | 'check';
  items?: string[];
  url?: string;
  urls?: string[];
  caption?: string;
}

export const BLOCK_KINDS: { type: ContentBlockType; label: string; style?: 'bullet' | 'check' }[] = [
  { type: 'text', label: 'Text' },
  { type: 'heading', label: 'Heading' },
  { type: 'list', label: 'Bullet list', style: 'bullet' },
  { type: 'list', label: 'Checklist', style: 'check' },
  { type: 'image', label: 'Photo' },
  { type: 'gallery', label: 'Gallery' },
  { type: 'video', label: 'Video' },
  { type: 'callout', label: 'Callout' },
  { type: 'note', label: 'Small print' },
  { type: 'divider', label: 'Divider' },
];

/** Course lessons can also carry a downloadable file (a recipe PDF, a template). */
export const COURSE_BLOCK_KINDS: typeof BLOCK_KINDS = [
  ...BLOCK_KINDS.slice(0, 7),
  { type: 'file', label: 'File' },
  ...BLOCK_KINDS.slice(7),
];

export function blockLabel(b: ContentBlock): string {
  if (b.type === 'list') return b.style === 'check' ? 'Checklist' : 'Bullet list';
  return COURSE_BLOCK_KINDS.find((k) => k.type === b.type)?.label ?? b.type;
}

export function newBlock(type: ContentBlockType, style?: 'bullet' | 'check'): ContentBlock {
  const b: ContentBlock = { id: newId(), type };
  if (type === 'list') { b.style = style ?? 'bullet'; b.items = []; }
  if (type === 'gallery') b.urls = [];
  return b;
}

/** Blocks as saved: an id on each, empty ones dropped; null when there are none. */
export function blocksForSave(blocks: ContentBlock[]): ContentBlock[] | null {
  const kept = blocks
    .map((b) => ({
      ...b,
      text: b.text?.trim() || undefined,
      title: b.title?.trim() || undefined,
      caption: b.caption?.trim() || undefined,
      url: b.url?.trim() || undefined,
      items: b.items?.map((i) => i.trim()).filter(Boolean),
      urls: b.urls?.filter(Boolean),
    }))
    .filter((b) => {
      switch (b.type) {
        case 'text': case 'heading': case 'note': return !!b.text;
        case 'callout': return !!(b.text || b.title);
        case 'list': return !!b.items?.length;
        case 'image': case 'video': case 'file': return !!b.url;
        case 'gallery': return !!b.urls?.length;
        default: return true;
      }
    });
  return kept.length ? kept : null;
}

/** Blocks loaded from the database, each given an id if it lacks one. */
export function blocksFromRow(raw: unknown): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b) => b && typeof b === 'object' && typeof (b as ContentBlock).type === 'string')
    .map((b) => ({ ...(b as ContentBlock), id: (b as ContentBlock).id || newId() }));
}

/** A photo for a content block — uploaded right away (before the product is
 *  first saved) to the vendor's own folder, returned as its public URL. */
export async function uploadContentImage(userId: string, file: File): Promise<string> {
  const blob = await compressImage(file);
  const path = `${up(userId)}/content/${up(newId())}.jpg`;
  check(await supabase.storage.from('menu-item-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }));
  return `${STORAGE_PUBLIC_URL}/menu-item-images/${path}`;
}

/** A YouTube or Vimeo link as an embed URL; null for a direct video file. */
export function videoEmbedURL(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}
