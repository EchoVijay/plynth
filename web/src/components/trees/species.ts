// Species catalogue. Keys are stored in focus_sessions.tree_species — never rename them.
// `unlock` = completed focus sessions needed. Ordered by unlock.

export const TREE_SPECIES = [
  { key: 'cedar', name: 'Cedar', unlock: 0, emoji: '🌲', blurb: 'Tier by tier, steady and evergreen.' },
  { key: 'bush', name: 'Berry Bush', unlock: 0, emoji: '🌳', blurb: 'Round, cheerful and full of berries.' },
  { key: 'tulip', name: 'Tulip Patch', unlock: 5, emoji: '🌷', blurb: 'Three little cups of colour.' },
  { key: 'cherry', name: 'Cherry Blossom', unlock: 10, emoji: '🌸', blurb: 'Showers petals over your progress.' },
  { key: 'bamboo', name: 'Bamboo', unlock: 15, emoji: '🎋', blurb: 'Shoots up fast and bends, never breaks.' },
  { key: 'bonsai', name: 'Bonsai', unlock: 20, emoji: '🪴', blurb: 'Patient, shaped, perfectly small.' },
  { key: 'sunflower', name: 'Sunflower', unlock: 25, emoji: '🌻', blurb: 'Faces the light, bees drop by.' },
  { key: 'cactus', name: 'Cactus', unlock: 35, emoji: '🌵', blurb: 'Tough, spiky, blooms when it is ready.' },
  { key: 'maple', name: 'Maple', unlock: 50, emoji: '🍁', blurb: 'Fiery leaves drifting down.' },
  { key: 'lotus', name: 'Lotus Pond', unlock: 70, emoji: '🪷', blurb: 'Calm water, one perfect bloom.' },
  { key: 'palm', name: 'Palm', unlock: 85, emoji: '🌴', blurb: 'Sunny fronds and a few coconuts.' },
  { key: 'baobab', name: 'Baobab', unlock: 100, emoji: '🏝️', blurb: 'Ancient, wide and wise.' },
  { key: 'crystal', name: 'Crystal Tree', unlock: 150, emoji: '💎', blurb: 'Glowing shards that hum softly.' },
  { key: 'starry', name: 'Starry Tree', unlock: 200, emoji: '✨', blurb: 'A night sky grown from a seed.' },
] as const;

export type TreeSpeciesKey = typeof TREE_SPECIES[number]['key'];

export const speciesName = (key: string) => TREE_SPECIES.find(s => s.key === key)?.name ?? 'Plant';
