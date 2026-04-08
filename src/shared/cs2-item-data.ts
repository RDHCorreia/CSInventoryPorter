// ============================================================
// CSInventoryPorter — Static CS2 item data
// Weapon definitions, quality names, rarity info
// Used as offline fallback when community API data is unavailable
// ============================================================

/** Weapon definition: defindex → name, className (for CDN lookup), type */
export const WEAPON_DEFS: Record<number, { name: string; className: string; type: string }> = {
  // ---- Pistols ----
  1:  { name: 'Desert Eagle',  className: 'weapon_deagle',         type: 'Pistol' },
  2:  { name: 'Dual Berettas', className: 'weapon_elite',          type: 'Pistol' },
  3:  { name: 'Five-SeveN',    className: 'weapon_fiveseven',      type: 'Pistol' },
  4:  { name: 'Glock-18',      className: 'weapon_glock',          type: 'Pistol' },
  30: { name: 'Tec-9',         className: 'weapon_tec9',           type: 'Pistol' },
  32: { name: 'P2000',         className: 'weapon_hkp2000',        type: 'Pistol' },
  36: { name: 'P250',          className: 'weapon_p250',           type: 'Pistol' },
  61: { name: 'USP-S',         className: 'weapon_usp_silencer',   type: 'Pistol' },
  63: { name: 'CZ75-Auto',     className: 'weapon_cz75a',          type: 'Pistol' },
  64: { name: 'R8 Revolver',   className: 'weapon_revolver',       type: 'Pistol' },

  // ---- SMGs ----
  17: { name: 'MAC-10',  className: 'weapon_mac10',  type: 'SMG' },
  19: { name: 'P90',     className: 'weapon_p90',    type: 'SMG' },
  23: { name: 'MP5-SD',  className: 'weapon_mp5sd',  type: 'SMG' },
  24: { name: 'UMP-45',  className: 'weapon_ump45',  type: 'SMG' },
  26: { name: 'PP-Bizon',className: 'weapon_bizon',  type: 'SMG' },
  33: { name: 'MP7',     className: 'weapon_mp7',    type: 'SMG' },
  34: { name: 'MP9',     className: 'weapon_mp9',    type: 'SMG' },

  // ---- Rifles ----
  7:  { name: 'AK-47',   className: 'weapon_ak47',           type: 'Rifle' },
  8:  { name: 'AUG',     className: 'weapon_aug',            type: 'Rifle' },
  10: { name: 'FAMAS',   className: 'weapon_famas',          type: 'Rifle' },
  13: { name: 'Galil AR',className: 'weapon_galilar',        type: 'Rifle' },
  16: { name: 'M4A4',    className: 'weapon_m4a1',           type: 'Rifle' },
  39: { name: 'SG 553',  className: 'weapon_sg556',          type: 'Rifle' },
  60: { name: 'M4A1-S',  className: 'weapon_m4a1_silencer',  type: 'Rifle' },

  // ---- Sniper Rifles ----
  9:  { name: 'AWP',     className: 'weapon_awp',     type: 'Sniper Rifle' },
  11: { name: 'G3SG1',   className: 'weapon_g3sg1',   type: 'Sniper Rifle' },
  38: { name: 'SCAR-20', className: 'weapon_scar20',  type: 'Sniper Rifle' },
  40: { name: 'SSG 08',  className: 'weapon_ssg08',   type: 'Sniper Rifle' },

  // ---- Heavy ----
  14: { name: 'M249',     className: 'weapon_m249',    type: 'Machine Gun' },
  25: { name: 'XM1014',   className: 'weapon_xm1014',  type: 'Shotgun' },
  27: { name: 'MAG-7',    className: 'weapon_mag7',     type: 'Shotgun' },
  28: { name: 'Negev',    className: 'weapon_negev',    type: 'Machine Gun' },
  29: { name: 'Sawed-Off',className: 'weapon_sawedoff', type: 'Shotgun' },
  35: { name: 'Nova',     className: 'weapon_nova',     type: 'Shotgun' },

  // ---- Equipment ----
  31: { name: 'Zeus x27',  className: 'weapon_taser',  type: 'Equipment' },
  43: { name: 'Flashbang',  className: 'weapon_flashbang',     type: 'Equipment' },
  44: { name: 'HE Grenade', className: 'weapon_hegrenade',     type: 'Equipment' },
  45: { name: 'Smoke Grenade', className: 'weapon_smokegrenade', type: 'Equipment' },
  46: { name: 'Molotov',    className: 'weapon_molotov',       type: 'Equipment' },
  47: { name: 'Decoy Grenade', className: 'weapon_decoy',      type: 'Equipment' },
  48: { name: 'Incendiary Grenade', className: 'weapon_incgrenade', type: 'Equipment' },
  49: { name: 'C4 Explosive', className: 'weapon_c4',          type: 'Equipment' },

  // ---- Knives ----
  42:  { name: 'Default CT Knife', className: 'weapon_knife',                  type: 'Knife' },
  59:  { name: 'Default T Knife',  className: 'weapon_knife_t',                type: 'Knife' },
  500: { name: 'Bayonet',          className: 'weapon_bayonet',                type: 'Knife' },
  503: { name: 'Classic Knife',    className: 'weapon_knife_css',              type: 'Knife' },
  505: { name: 'Flip Knife',       className: 'weapon_knife_flip',             type: 'Knife' },
  506: { name: 'Gut Knife',        className: 'weapon_knife_gut',              type: 'Knife' },
  507: { name: 'Karambit',         className: 'weapon_knife_karambit',         type: 'Knife' },
  508: { name: 'M9 Bayonet',       className: 'weapon_knife_m9_bayonet',       type: 'Knife' },
  509: { name: 'Huntsman Knife',   className: 'weapon_knife_tactical',         type: 'Knife' },
  512: { name: 'Falchion Knife',   className: 'weapon_knife_falchion',         type: 'Knife' },
  514: { name: 'Bowie Knife',      className: 'weapon_knife_survival_bowie',   type: 'Knife' },
  515: { name: 'Butterfly Knife',  className: 'weapon_knife_butterfly',        type: 'Knife' },
  516: { name: 'Shadow Daggers',   className: 'weapon_knife_push',             type: 'Knife' },
  517: { name: 'Paracord Knife',   className: 'weapon_knife_cord',             type: 'Knife' },
  518: { name: 'Survival Knife',   className: 'weapon_knife_canis',            type: 'Knife' },
  519: { name: 'Ursus Knife',      className: 'weapon_knife_ursus',            type: 'Knife' },
  520: { name: 'Navaja Knife',     className: 'weapon_knife_gypsy_jackknife',  type: 'Knife' },
  521: { name: 'Nomad Knife',      className: 'weapon_knife_outdoor',          type: 'Knife' },
  522: { name: 'Stiletto Knife',   className: 'weapon_knife_stiletto',         type: 'Knife' },
  523: { name: 'Talon Knife',      className: 'weapon_knife_widowmaker',       type: 'Knife' },
  525: { name: 'Skeleton Knife',   className: 'weapon_knife_skeleton',         type: 'Knife' },
  526: { name: 'Kukri Knife',      className: 'weapon_knife_kukri',            type: 'Knife' },

  // ---- Gloves ----
  5027: { name: 'Sport Gloves',       className: 'studded_bloodhound_gloves',   type: 'Gloves' },
  5028: { name: 'Driver Gloves',      className: 'leather_handwraps_leathery',  type: 'Gloves' },
  5029: { name: 'Hand Wraps',         className: 'leather_handwraps',           type: 'Gloves' },
  5030: { name: 'Moto Gloves',        className: 'motorcycle_gloves',           type: 'Gloves' },
  5031: { name: 'Specialist Gloves',  className: 'studded_hydra_gloves',        type: 'Gloves' },
  5032: { name: 'Hydra Gloves',       className: 'bloodhound_hydra_gloves',     type: 'Gloves' },
  5033: { name: 'Broken Fang Gloves', className: 'studded_brokenfang_gloves',   type: 'Gloves' },

  // ---- Special / Tools ----
  1200: { name: 'Crate Key',           className: 'key',        type: 'Tool' },
  1201: { name: 'Storage Unit',        className: 'casket',     type: 'Tool' },
  1202: { name: 'Name Tag',            className: 'nametag',    type: 'Tool' },
  1203: { name: 'StatTrak™ Swap Tool', className: 'stattrak_swap', type: 'Tool' },
  1204: { name: 'Key',                 className: 'key',        type: 'Tool' },
  1324: { name: 'StatTrak™ Swap Tool', className: 'stattrak_swap', type: 'Tool' },
  1209: { name: 'Sticker',             className: 'sticker',    type: 'Sticker' },
  1314: { name: 'Music Kit',           className: 'musickit',   type: 'Music Kit' },
  1348: { name: 'Sealed Graffiti',     className: 'spray',      type: 'Graffiti' },
  1349: { name: 'Graffiti',            className: 'spray_paint',type: 'Graffiti' },
  4950: { name: 'Charm Detachments',   className: 'keychain_remove_tool', type: 'Tool' },
  4607: { name: 'Charm',               className: 'keychain',   type: 'Charm' },
  4609: { name: 'Patch',               className: 'patch',      type: 'Patch' },
};



/** Rarity ID → name + hex color */
export const RARITY_INFO: Record<number, { name: string; color: string }> = {
  0: { name: 'Stock',            color: '#b0c3d9' },
  1: { name: 'Consumer Grade',   color: '#b0c3d9' },
  2: { name: 'Industrial Grade', color: '#5e98d9' },
  3: { name: 'Mil-Spec',         color: '#4b69ff' },
  4: { name: 'Restricted',       color: '#8847ff' },
  5: { name: 'Classified',       color: '#d32ce6' },
  6: { name: 'Covert',           color: '#eb4b4b' },
  7: { name: 'Contraband',       color: '#e4ae39' },
};

/**
 * Build a reverse lookup: className → defindex
 */
export function buildClassToDefindex(): Map<string, number> {
  const map = new Map<string, number>();
  for (const [defStr, info] of Object.entries(WEAPON_DEFS)) {
    map.set(info.className, Number(defStr));
  }
  return map;
}

