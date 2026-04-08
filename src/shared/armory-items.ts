// ============================================================
// CSInventoryPorter - Armory Items Catalog
//
// To update this list when Valve adds or removes items:
//   1. Find the new item's armoryId and star price
//   2. Add/remove/edit entries below
//   3. Run `npm run build`
//
// Last updated: 2026-03-28
// ============================================================

export interface ArmoryItemDef {
  name: string;
  price: number;     // cost in stars
  armoryId: number;  // GC personal-store item ID
  imageUrl?: string; // Steam CDN image URL (market-listed or representative)
  category: 'charm' | 'case' | 'sticker' | 'collection' | 'weapon';
}

// Verified hashes are from Steam Market search/listing pages.
// Some Armory bundle entries are not market-listed; those use a representative
// Steam image from the same content family as a visual fallback.
const ARMORY_IMAGE = {
  CHARM_DR_BOOM_REP: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_kc_drboom_png.png',
  CHARM_MISSING_COMMUNITY_LINK: 'https://cdn.steamstatic.com/apps/730/icons/econ/set_icons/set_kc_ml_community_01.6575c6767ec10b0720cc8833c67a2bb98698422c.png',
  CHARM_MISSING_LINK: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_kc_missinglink_png.png',
  CHARM_SMALL_ARMS: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_kc_weapon_01_png.png',
  COLLECTION_TRAIN_2025_REP: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_train_2025_png.png',
  COLLECTION_OVERPASS_2024_REP: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_overpass_2024_png.png',
  COLLECTION_SPORT_AND_FIELD: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_realism_camo_png.png',
  CASE_FEVER: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frncVtqv7MPE8JaHHCj_Dl-wk4-NtFirikURy4jiGwo2udHqVaAEjDZp3EflK7EeSMnMs4w',
  STICKER_COMMUNITY_REP: 'https://cdn.steamstatic.com/apps/730/icons/econ/set_icons/set_community_2025.280d945244b90804541bf84784796793fd3bad00.png',
  STICKER_SUGARFACE_2: 'https://cdn.steamstatic.com/apps/730/icons/econ/set_icons/set_sugarface2.2cb2d789be9fd3a0784335cf2453438a3c0f5ee7.png',
  STICKER_ELEMENTAL_CRAFT: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_stkr_craft_01_png.png',
  WEAPON_AK47_APHRODITE: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiVI7PqRaa9SJPqaB2mvzedxuPUnGCi3wktzt2rRn92pdXuXbA4iDcdxQOIMsBK4k9S2Zeiw4lTdjdhNyTK-0H1wmrL4zA',
} as const;

export const ARMORY_ITEMS: ArmoryItemDef[] = [
  // ---- Charms ----
  { name: 'Dr. Boom Charms', price: 3, armoryId: 1986856372, imageUrl: ARMORY_IMAGE.CHARM_DR_BOOM_REP, category: 'charm' },
  { name: 'Missing Link Community Charms', price: 3, armoryId: 4187462448, imageUrl: ARMORY_IMAGE.CHARM_MISSING_COMMUNITY_LINK, category: 'charm' },
  { name: 'Missing Link Charms', price: 3, armoryId: 4076345151, imageUrl: ARMORY_IMAGE.CHARM_MISSING_LINK, category: 'charm' },
  { name: 'Small Arms Charms', price: 3, armoryId: 2218434721, imageUrl: ARMORY_IMAGE.CHARM_SMALL_ARMS, category: 'charm' },

  // ---- Collections ----
  { name: 'The Train 2025', price: 4, armoryId: 1629075955, imageUrl: ARMORY_IMAGE.COLLECTION_TRAIN_2025_REP, category: 'collection' },
  { name: 'The Overpass 2024', price: 4, armoryId: 2917110498, imageUrl: ARMORY_IMAGE.COLLECTION_OVERPASS_2024_REP, category: 'collection' },
  { name: 'The Sport & Field', price: 4, armoryId: 531266704, imageUrl: ARMORY_IMAGE.COLLECTION_SPORT_AND_FIELD, category: 'collection' },

  // ---- Cases ----
  { name: 'Fever Case', price: 2, armoryId: 1025083006, imageUrl: ARMORY_IMAGE.CASE_FEVER, category: 'case' },

  // ---- Stickers ----
  { name: '2025 Community Sticker', price: 1, armoryId: 2332851919, imageUrl: ARMORY_IMAGE.STICKER_COMMUNITY_REP, category: 'sticker' },
  { name: 'Sugarface 2 Sticker', price: 1, armoryId: 1531224355, imageUrl: ARMORY_IMAGE.STICKER_SUGARFACE_2, category: 'sticker' },
  { name: 'Elemental Craft Stickers', price: 1, armoryId: 594200331, imageUrl: ARMORY_IMAGE.STICKER_ELEMENTAL_CRAFT, category: 'sticker' },

  // ---- Weapons ----
  { name: 'AK-47 | Aphrodite', price: 125, armoryId: 508216210, imageUrl: ARMORY_IMAGE.WEAPON_AK47_APHRODITE, category: 'weapon' },
];
