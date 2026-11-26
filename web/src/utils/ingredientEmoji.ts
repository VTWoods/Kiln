/**
 * Lightweight, zero-dependency mapping from cooking/grocery ingredient names
 * to food emojis.
 *
 * Strategy:
 * 1. Normalize input (strip diacritics, parentheticals, punctuation; lowercase;
 *    singularize tokens).
 * 2. Check prioritized multi-word phrase rules (on whole-word boundaries) first
 *    so specific phrases and exclusions win before generic single-word tokens
 *    (e.g. "peanut butter" -> 🥜 not 🧈, "coconut milk" -> 🥥 not 🥛,
 *    "fish sauce" -> null not 🐟, "cherry tomato" -> 🍅 not 🍒).
 * 3. Scan single-word tokens right-to-left (English head-noun order) against
 *    the ingredient token map.
 * 4. Return `null` when there is no clear emoji match.
 */

const NO_SINGULARIZE = new Set([
  "asparagus",
  "bass",
  "brussels",
  "citrus",
  "couscous",
  "floss",
  "glass",
  "grass",
  "greens",
  "grits",
  "hibiscus",
  "hummus",
  "lemongrass",
  "molasses",
  "moss",
  "oats",
  "octopus",
  "swiss",
  "watercress",
]);

const IRREGULAR_SINGULARS: Record<string, string> = {
  anchovies: "anchovy",
  berries: "berry",
  blackberries: "blackberry",
  blueberries: "blueberry",
  calves: "calf",
  cherries: "cherry",
  cranberries: "cranberry",
  halves: "half",
  leaves: "leaf",
  loaves: "loaf",
  mangoes: "mango",
  peaches: "peach",
  potatoes: "potato",
  radishes: "radish",
  raspberries: "raspberry",
  strawberries: "strawberry",
  tomatoes: "tomato",
};

function singularizeToken(token: string): string {
  if (token.length <= 3 || NO_SINGULARIZE.has(token)) {
    return token;
  }
  const irregular = IRREGULAR_SINGULARS[token];
  if (irregular) {
    return irregular;
  }
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (
    /(?:ch|sh|x|z|ss)es$/.test(token) ||
    (token.endsWith("oes") && token.length > 4)
  ) {
    return token.slice(0, -2);
  }
  if (
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenizeIngredient(name: string): string[] {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!cleaned) {
    return [];
  }

  return cleaned.split(/\s+/).map(singularizeToken);
}

/**
 * Ordered multi-word phrase rules (matched on whole-word boundaries).
 * A `null` value explicitly suppresses misleading single-word fallbacks
 * (e.g. "fish sauce" should not match "fish", "apple cider vinegar" should
 * not match "apple").
 */
const PHRASE_RULES: ReadonlyArray<readonly [string, string | null]> = [
  // Clean exclusions (condiments, vinegars, extracts, starches, oils without a clear emoji)
  ["apple cider vinegar", null],
  ["red wine vinegar", null],
  ["white wine vinegar", null],
  ["rice wine vinegar", null],
  ["champagne vinegar", null],
  ["balsamic vinegar", null],
  ["sherry vinegar", null],
  ["rice vinegar", null],
  ["wine vinegar", null],
  ["malt vinegar", null],
  ["distilled vinegar", null],
  ["soy sauce", null],
  ["fish sauce", null],
  ["oyster sauce", null],
  ["hoisin sauce", null],
  ["teriyaki sauce", null],
  ["worcestershire sauce", null],
  ["cream of tartar", null],
  ["baking powder", null],
  ["baking soda", null],
  ["vanilla extract", null],
  ["almond extract", null],
  ["lemon extract", null],
  ["orange extract", null],
  ["peppermint extract", null],
  ["mint extract", null],
  ["coconut extract", null],
  ["corn starch", null],
  ["potato starch", null],
  ["tapioca starch", null],
  ["cooking spray", null],
  ["vegetable oil", null],
  ["canola oil", null],
  ["corn oil", null],
  ["sunflower oil", null],
  ["grapeseed oil", null],
  ["safflower oil", null],
  ["sesame oil", null],
  ["cooking oil", null],
  ["neutral oil", null],
  ["palm oil", null],
  ["rice bran oil", null],
  ["star anise", null],
  ["dragon fruit", null],

  // Chili & bell peppers (must precede generic color/pepper terms)
  ["red pepper flake", "🌶️"],
  ["crushed red pepper", "🌶️"],
  ["chili pepper", "🌶️"],
  ["chile pepper", "🌶️"],
  ["cayenne pepper", "🌶️"],
  ["jalapeno pepper", "🌶️"],
  ["serrano pepper", "🌶️"],
  ["habanero pepper", "🌶️"],
  ["thai pepper", "🌶️"],
  ["hot pepper", "🌶️"],
  ["chili powder", "🌶️"],
  ["chili flake", "🌶️"],
  ["chili paste", "🌶️"],
  ["chili oil", "🌶️"],
  ["chili crisp", "🌶️"],
  ["hot sauce", "🌶️"],
  ["curry paste", "🌶️"],
  ["bell pepper", "🫑"],
  ["red pepper", "🫑"],
  ["green pepper", "🫑"],
  ["yellow pepper", "🫑"],
  ["orange pepper", "🫑"],
  ["sweet pepper", "🫑"],
  ["poblano pepper", "🫑"],
  ["cubanelle pepper", "🫑"],
  ["lemon pepper", "🍋"],

  // Nut / seed / fruit butters (must precede "butter")
  ["peanut butter", "🥜"],
  ["almond butter", "🥜"],
  ["cashew butter", "🥜"],
  ["sunflower seed butter", "🥜"],
  ["sunflower butter", "🥜"],
  ["nut butter", "🥜"],
  ["cocoa butter", "🍫"],
  ["apple butter", "🍎"],
  ["butter bean", "🫘"],
  ["butter lettuce", "🥬"],

  // Coconut products (must precede "milk", "cream", "oil", "water")
  ["coconut milk", "🥥"],
  ["coconut cream", "🥥"],
  ["coconut oil", "🥥"],
  ["coconut water", "🥥"],
  ["coconut flake", "🥥"],
  ["coconut flour", "🥥"],
  ["coconut sugar", "🥥"],
  ["shredded coconut", "🥥"],

  // Broths, stocks & soups (must precede "chicken", "beef", "fish", "vegetable")
  ["chicken broth", "🍲"],
  ["chicken stock", "🍲"],
  ["chicken bouillon", "🍲"],
  ["beef broth", "🍲"],
  ["beef stock", "🍲"],
  ["beef bouillon", "🍲"],
  ["vegetable broth", "🍲"],
  ["vegetable stock", "🍲"],
  ["veggie broth", "🍲"],
  ["bone broth", "🍲"],
  ["fish stock", "🍲"],
  ["seafood stock", "🍲"],
  ["cream of mushroom", "🍲"],
  ["cream of chicken", "🍲"],

  // Specific produce & herbs (must precede ambiguous words)
  ["sweet potato", "🍠"],
  ["green onion", "🧅"],
  ["spring onion", "🧅"],
  ["onion powder", "🧅"],
  ["garlic powder", "🧄"],
  ["garlic clove", "🧄"],
  ["olive oil", "🫒"],
  ["avocado oil", "🥑"],
  ["peanut oil", "🥜"],
  ["truffle oil", "🍄"],
  ["oyster mushroom", "🍄"],
  ["button mushroom", "🍄"],
  ["cremini mushroom", "🍄"],
  ["portobello mushroom", "🍄"],
  ["shiitake mushroom", "🍄"],
  ["cherry tomato", "🍅"],
  ["grape tomato", "🍅"],
  ["roma tomato", "🍅"],
  ["plum tomato", "🍅"],
  ["heirloom tomato", "🍅"],
  ["sun dried tomato", "🍅"],
  ["tomato paste", "🍅"],
  ["tomato sauce", "🍅"],
  ["green apple", "🍏"],
  ["granny smith", "🍏"],
  ["green bean", "🫛"],
  ["string bean", "🫛"],
  ["snap pea", "🫛"],
  ["snow pea", "🫛"],
  ["sugar snap", "🫛"],
  ["sweet pea", "🫛"],
  ["english pea", "🫛"],
  ["black bean", "🫘"],
  ["kidney bean", "🫘"],
  ["pinto bean", "🫘"],
  ["navy bean", "🫘"],
  ["cannellini bean", "🫘"],
  ["white bean", "🫘"],
  ["garbanzo bean", "🫘"],
  ["fava bean", "🫘"],
  ["lima bean", "🫘"],
  ["great northern bean", "🫘"],
  ["black eyed pea", "🫘"],
  ["split pea", "🫘"],
  ["refried bean", "🫘"],
  ["pine nut", "🥜"],
  ["water chestnut", "🌰"],
  ["brussels sprout", "🥬"],
  ["bok choy", "🥬"],
  ["napa cabbage", "🥬"],
  ["collard green", "🥬"],
  ["mustard green", "🥬"],
  ["turnip green", "🥬"],
  ["swiss chard", "🥬"],
  ["baby spinach", "🥬"],
  ["mixed green", "🥬"],
  ["salad green", "🥬"],
  ["romaine lettuce", "🥬"],
  ["iceberg lettuce", "🥬"],
  ["bay leaf", "🌿"],
  ["curry leaf", "🌿"],
  ["lime leaf", "🌿"],
  ["butternut squash", "🎃"],
  ["acorn squash", "🎃"],
  ["spaghetti squash", "🎃"],
  ["kabocha squash", "🎃"],
  ["delicata squash", "🎃"],
  ["pumpkin puree", "🎃"],
  ["yellow squash", "🥒"],
  ["summer squash", "🥒"],

  // Dairy & desserts
  ["ice cream", "🍨"],
  ["cream cheese", "🧀"],
  ["cottage cheese", "🧀"],
  ["goat cheese", "🧀"],
  ["blue cheese", "🧀"],
  ["swiss cheese", "🧀"],
  ["cheddar cheese", "🧀"],
  ["parmesan cheese", "🧀"],
  ["mozzarella cheese", "🧀"],
  ["feta cheese", "🧀"],
  ["ricotta cheese", "🧀"],
  ["sour cream", "🥛"],
  ["heavy cream", "🥛"],
  ["whipping cream", "🥛"],
  ["half and half", "🥛"],
  ["condensed milk", "🥛"],
  ["evaporated milk", "🥛"],
  ["almond milk", "🥛"],
  ["oat milk", "🥛"],
  ["soy milk", "🥛"],
  ["cashew milk", "🥛"],
  ["rice milk", "🥛"],
  ["whole milk", "🥛"],
  ["skim milk", "🥛"],

  // Grains, pasta & bread
  ["egg noodle", "🍝"],
  ["rice noodle", "🍜"],
  ["ramen noodle", "🍜"],
  ["udon noodle", "🍜"],
  ["soba noodle", "🍜"],
  ["french bread", "🥖"],
  ["garlic bread", "🍞"],
  ["bread crumb", "🍞"],
  ["pie crust", "🥧"],

  // Meat & poultry
  ["hot dog", "🌭"],
  ["ground beef", "🥩"],
  ["ground pork", "🥩"],
  ["ground lamb", "🥩"],
  ["pork chop", "🥩"],
  ["pork loin", "🥩"],
  ["pork tenderloin", "🥩"],
  ["pork belly", "🥩"],
  ["short rib", "🥩"],
  ["baby back rib", "🥩"],
  ["pork rib", "🥩"],
  ["ground chicken", "🍗"],
  ["chicken breast", "🍗"],
  ["chicken thigh", "🍗"],
  ["chicken wing", "🍗"],
  ["chicken drumstick", "🍗"],
  ["rotisserie chicken", "🍗"],
  ["ground turkey", "🦃"],
  ["turkey breast", "🦃"],

  // Sweeteners, chocolate & beverages
  ["maple syrup", "🍁"],
  ["chocolate chip", "🍫"],
  ["dark chocolate", "🍫"],
  ["milk chocolate", "🍫"],
  ["white chocolate", "🍫"],
  ["cocoa powder", "🍫"],
  ["sparkling wine", "🥂"],
  ["red wine", "🍷"],
  ["white wine", "🍷"],
  ["dry wine", "🍷"],
  ["cooking wine", "🍷"],
  ["rose wine", "🍷"],
  ["port wine", "🍷"],
  ["green tea", "🍵"],
  ["black tea", "🍵"],
  ["cold brew", "☕"],
  ["ice cube", "🧊"],
  ["lemon juice", "🍋"],
  ["lemon zest", "🍋"],
  ["lime juice", "🍋"],
  ["lime zest", "🍋"],
  ["orange juice", "🍊"],
  ["orange zest", "🍊"],
  ["apple juice", "🍎"],
  ["apple cider", "🍎"],

  // Seasonings
  ["salt and pepper", "🧂"],
  ["kosher salt", "🧂"],
  ["sea salt", "🧂"],
  ["flaky salt", "🧂"],
  ["table salt", "🧂"],
  ["garlic salt", "🧂"],
];

/**
 * Single-word singularized token -> emoji map.
 * Ambiguous words (like "pepper", "oil", "sauce", "powder", "sugar") are
 * intentionally omitted so they don't produce misleading icons.
 */
const TOKEN_MAP: Readonly<Record<string, string>> = {
  // Vegetables & produce
  eggplant: "🍆",
  aubergine: "🍆",
  avocado: "🥑",
  guacamole: "🥑",
  tomato: "🍅",
  marinara: "🍅",
  ketchup: "🍅",
  salsa: "🍅",
  potato: "🥔",
  russet: "🥔",
  fingerling: "🥔",
  yam: "🍠",
  carrot: "🥕",
  corn: "🌽",
  cornmeal: "🌽",
  polenta: "🌽",
  grits: "🌽",
  broccoli: "🥦",
  broccolini: "🥦",
  garlic: "🧄",
  onion: "🧅",
  scallion: "🧅",
  shallot: "🧅",
  leek: "🧅",
  chive: "🧅",
  mushroom: "🍄",
  cremini: "🍄",
  portobello: "🍄",
  shiitake: "🍄",
  chanterelle: "🍄",
  porcini: "🍄",
  enoki: "🍄",
  cucumber: "🥒",
  pickle: "🥒",
  cornichon: "🥒",
  gherkin: "🥒",
  zucchini: "🥒",
  courgette: "🥒",
  lettuce: "🥬",
  romaine: "🥬",
  spinach: "🥬",
  kale: "🥬",
  arugula: "🥬",
  chard: "🥬",
  collard: "🥬",
  cabbage: "🥬",
  escarole: "🥬",
  endive: "🥬",
  radicchio: "🥬",
  watercress: "🥬",
  greens: "🥬",
  artichoke: "🥬",
  celery: "🥬",
  asparagus: "🥬",
  fennel: "🥬",
  cauliflower: "🥦",
  jalapeno: "🌶️",
  serrano: "🌶️",
  habanero: "🌶️",
  cayenne: "🌶️",
  chipotle: "🌶️",
  sriracha: "🌶️",
  tabasco: "🌶️",
  gochujang: "🌶️",
  harissa: "🌶️",
  sambal: "🌶️",
  paprika: "🌶️",
  poblano: "🫑",
  ginger: "🫚",
  pumpkin: "🎃",
  squash: "🎃",
  kabocha: "🎃",
  olive: "🫒",
  kalamata: "🫒",
  pea: "🫛",
  edamame: "🫛",
  okra: "🫛",

  // Herbs & aromatics
  basil: "🌿",
  cilantro: "🌿",
  coriander: "🌿",
  parsley: "🌿",
  mint: "🌿",
  rosemary: "🌿",
  thyme: "🌿",
  oregano: "🌿",
  sage: "🌿",
  dill: "🌿",
  tarragon: "🌿",
  marjoram: "🌿",
  lemongrass: "🌿",
  herb: "🌿",
  pesto: "🌿",

  // Fruits
  apple: "🍎",
  applesauce: "🍎",
  banana: "🍌",
  plantain: "🍌",
  lemon: "🍋",
  lime: "🍋",
  orange: "🍊",
  mandarin: "🍊",
  tangerine: "🍊",
  clementine: "🍊",
  satsuma: "🍊",
  grapefruit: "🍊",
  kumquat: "🍊",
  strawberry: "🍓",
  raspberry: "🍓",
  berry: "🍓",
  blueberry: "🫐",
  blackberry: "🫐",
  cherry: "🍒",
  cranberry: "🍒",
  peach: "🍑",
  nectarine: "🍑",
  apricot: "🍑",
  pear: "🍐",
  grape: "🍇",
  raisin: "🍇",
  sultana: "🍇",
  currant: "🍇",
  watermelon: "🍉",
  melon: "🍈",
  cantaloupe: "🍈",
  honeydew: "🍈",
  pineapple: "🍍",
  mango: "🥭",
  kiwi: "🥝",
  coconut: "🥥",

  // Meat & poultry
  bacon: "🥓",
  pancetta: "🥓",
  prosciutto: "🥓",
  guanciale: "🥓",
  chicken: "🍗",
  poultry: "🍗",
  turkey: "🦃",
  duck: "🦆",
  beef: "🥩",
  steak: "🥩",
  sirloin: "🥩",
  ribeye: "🥩",
  brisket: "🥩",
  chuck: "🥩",
  flank: "🥩",
  tenderloin: "🥩",
  pork: "🥩",
  ham: "🥩",
  lamb: "🥩",
  veal: "🥩",
  venison: "🥩",
  sausage: "🥩",
  chorizo: "🥩",
  salami: "🥩",
  pepperoni: "🥩",
  kielbasa: "🥩",
  andouille: "🥩",
  bratwurst: "🥩",
  meatball: "🥩",

  // Seafood
  shrimp: "🦐",
  prawn: "🦐",
  langoustine: "🦐",
  crab: "🦀",
  lobster: "🦞",
  oyster: "🦪",
  clam: "🦪",
  mussel: "🦪",
  scallop: "🦪",
  squid: "🦑",
  calamari: "🦑",
  octopus: "🐙",
  salmon: "🐟",
  tuna: "🐟",
  cod: "🐟",
  tilapia: "🐟",
  halibut: "🐟",
  trout: "🐟",
  mackerel: "🐟",
  sardine: "🐟",
  anchovy: "🐟",
  snapper: "🐟",
  bass: "🐟",
  catfish: "🐟",
  haddock: "🐟",
  swordfish: "🐟",
  flounder: "🐟",
  fish: "🐟",

  // Dairy & eggs
  egg: "🥚",
  yolk: "🥚",
  butter: "🧈",
  ghee: "🧈",
  margarine: "🧈",
  milk: "🥛",
  buttermilk: "🥛",
  cream: "🥛",
  yogurt: "🥛",
  yoghurt: "🥛",
  kefir: "🥛",
  cheese: "🧀",
  parmesan: "🧀",
  parmigiano: "🧀",
  cheddar: "🧀",
  mozzarella: "🧀",
  feta: "🧀",
  ricotta: "🧀",
  brie: "🧀",
  gruyere: "🧀",
  provolone: "🧀",
  gouda: "🧀",
  pecorino: "🧀",
  mascarpone: "🧀",
  gorgonzola: "🧀",
  queso: "🧀",
  paneer: "🧀",
  halloumi: "🧀",
  gelato: "🍨",
  sorbet: "🍨",

  // Grains, pasta, bread & baking
  flour: "🌾",
  wheat: "🌾",
  oats: "🌾",
  oatmeal: "🌾",
  barley: "🌾",
  farro: "🌾",
  quinoa: "🌾",
  couscous: "🌾",
  bulgur: "🌾",
  rice: "🍚",
  basmati: "🍚",
  jasmine: "🍚",
  arborio: "🍚",
  risotto: "🍚",
  pasta: "🍝",
  spaghetti: "🍝",
  penne: "🍝",
  rigatoni: "🍝",
  fettuccine: "🍝",
  linguine: "🍝",
  macaroni: "🍝",
  fusilli: "🍝",
  farfalle: "🍝",
  orzo: "🍝",
  lasagna: "🍝",
  ravioli: "🍝",
  tortellini: "🍝",
  gnocchi: "🍝",
  noodle: "🍜",
  ramen: "🍜",
  udon: "🍜",
  soba: "🍜",
  vermicelli: "🍜",
  bread: "🍞",
  sourdough: "🍞",
  brioche: "🍞",
  ciabatta: "🍞",
  focaccia: "🍞",
  toast: "🍞",
  bun: "🍞",
  breadcrumb: "🍞",
  panko: "🍞",
  crouton: "🍞",
  baguette: "🥖",
  croissant: "🥐",
  bagel: "🥯",
  pretzel: "🥨",
  tortilla: "🫓",
  pita: "🫓",
  naan: "🫓",
  flatbread: "🫓",
  lavash: "🫓",
  pancake: "🥞",
  waffle: "🧇",

  // Legumes, nuts & seeds
  bean: "🫘",
  chickpea: "🫘",
  garbanzo: "🫘",
  lentil: "🫘",
  cannellini: "🫘",
  hummus: "🫘",
  peanut: "🥜",
  almond: "🥜",
  walnut: "🥜",
  pecan: "🥜",
  cashew: "🥜",
  pistachio: "🥜",
  hazelnut: "🥜",
  macadamia: "🥜",
  chestnut: "🌰",

  // Sweeteners, chocolate & seasonings
  honey: "🍯",
  chocolate: "🍫",
  cocoa: "🍫",
  cacao: "🍫",
  salt: "🧂",

  // Beverages, stocks & broths
  broth: "🍲",
  stock: "🍲",
  bouillon: "🍲",
  dashi: "🍲",
  soup: "🍲",
  coffee: "☕",
  espresso: "☕",
  tea: "🍵",
  matcha: "🍵",
  chai: "🍵",
  wine: "🍷",
  sherry: "🍷",
  marsala: "🍷",
  vermouth: "🍷",
  champagne: "🥂",
  prosecco: "🥂",
  beer: "🍺",
  ale: "🍺",
  stout: "🍺",
  lager: "🍺",
  water: "💧",
  ice: "🧊",
};

/**
 * Returns an emoji icon representing the given cooking/grocery ingredient name,
 * or `null` when no clear match exists.
 */
export function getIngredientEmoji(name: string): string | null {
  const tokens = tokenizeIngredient(name);
  if (tokens.length === 0) {
    return null;
  }

  const padded = ` ${tokens.join(" ")} `;

  for (const [phrase, emoji] of PHRASE_RULES) {
    if (padded.includes(` ${phrase} `)) {
      return emoji;
    }
  }

  // Scan right-to-left so English head nouns take precedence over modifiers
  // (e.g. "garlic butter" -> 🧈, "lemon chicken" -> 🍗).
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const match = TOKEN_MAP[tokens[i]];
    if (match) {
      return match;
    }
  }

  return null;
}
