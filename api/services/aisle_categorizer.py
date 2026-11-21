"""Grocery store aisle categorization with a swappable interface.

Uses a 3-tier hybrid local strategy:
1. State & fresh-unit rules (e.g. "frozen ..." -> Frozen, "canned ..."/broth -> Canned & Broths,
   fresh herbs by sprig/bunch -> Produce).
2. Curated US grocery-aisle lexicon matched longest-phrase-first on word boundaries.
3. Offline NLTK WordNet hypernym fallback for unseen foods.

User overrides stored in IngredientAisleOverride take precedence over all tiers.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Iterable

import inflect

logger = logging.getLogger(__name__)

AISLES: tuple[str, ...] = (
    "Produce",
    "Meat & Seafood",
    "Dairy & Eggs",
    "Bakery",
    "Frozen",
    "Canned & Broths",
    "Condiments & Oils",
    "Spices & Seasonings",
    "Pantry & Baking",
    "Beverages",
    "Other",
)
VALID_AISLES: frozenset[str] = frozenset(AISLES)
DEFAULT_AISLE = "Other"

_INFLECT = inflect.engine()

# Units that strongly indicate fresh produce when paired with an herb or vegetable
_FRESH_PRODUCE_UNITS = frozenset({"sprig", "bunch", "head", "stalk", "bulb", "ear", "rib"})

# Herbs that are Produce when fresh (or measured in sprigs/bunches) vs Spices when dried
_CULINARY_HERBS = frozenset(
    {
        "basil",
        "chervil",
        "chive",
        "chives",
        "cilantro",
        "coriander leaves",
        "dill",
        "fennel fronds",
        "lemongrass",
        "marjoram",
        "mint",
        "oregano",
        "parsley",
        "rosemary",
        "sage",
        "savory",
        "tarragon",
        "thyme",
        "thyme spring",
        "thyme springs",
    }
)

# Multi-word & single-word grocery lexicon grouped by aisle.
# Longest phrases are matched first (with word boundaries) so specific phrases like
# "olive oil", "peanut butter", "chicken stock", "bell pepper", and "butternut squash"
# always beat generic single-word substrings.
_AISLE_LEXICON: dict[str, tuple[str, ...]] = {
    "Produce": (
        # Vegetables & aromatics
        "acorn squash",
        "alfalfa sprouts",
        "arugula",
        "artichoke",
        "asparagus",
        "avocado",
        "baby carrots",
        "baby spinach",
        "bean sprouts",
        "beet",
        "bell pepper",
        "bok choy",
        "broccoli",
        "broccoli rabe",
        "broccolini",
        "brussels sprout",
        "butternut squash",
        "button mushroom",
        "cabbage",
        "carrot",
        "cauliflower",
        "celeriac",
        "celery",
        "chard",
        "cherry tomato",
        "chili pepper",
        "chive",
        "cilantro",
        "collard green",
        "corn on the cob",
        "cremini mushroom",
        "cucumber",
        "daikon",
        "delicata squash",
        "dill",
        "edamame",
        "eggplant",
        "endive",
        "escarole",
        "fennel",
        "fennel bulb",
        "garlic",
        "garlic clove",
        "ginger",
        "ginger root",
        "grape tomato",
        "green bean",
        "green cabbage",
        "green onion",
        "green pepper",
        "habanero",
        "heirloom tomato",
        "jalapeno",
        "jicama",
        "kale",
        "kohlrabi",
        "leek",
        "lettuce",
        "mixed greens",
        "mushroom",
        "mustard greens",
        "napa cabbage",
        "okra",
        "onion",
        "parsley",
        "parsnip",
        "pearl onion",
        "persimmon",
        "plum tomato",
        "poblano",
        "portobello",
        "potato",
        "pumpkin",
        "radicchio",
        "radish",
        "red cabbage",
        "red onion",
        "red pepper",
        "rhubarb",
        "roma tomato",
        "romaine",
        "rutabaga",
        "scallion",
        "serrano",
        "shallot",
        "shiitake",
        "snap pea",
        "snow pea",
        "spaghetti squash",
        "spinach",
        "spring mix",
        "squash",
        "sweet onion",
        "sweet potato",
        "swiss chard",
        "tomatillo",
        "tomato",
        "turnip",
        "watercress",
        "white button mushroom",
        "white onion",
        "yam",
        "yellow onion",
        "yellow squash",
        "yukon gold potato",
        "zucchini",
        # Fruits
        "apple",
        "apricot",
        "banana",
        "blackberry",
        "blueberry",
        "cantaloupe",
        "cherry",
        "clementine",
        "cranberry",
        "fig",
        "grapefruit",
        "grape",
        "honeydew",
        "kiwi",
        "kumquat",
        "lemon",
        "lemon juice",
        "lemon zest",
        "lime",
        "lime juice",
        "lime zest",
        "mandarin",
        "mango",
        "melon",
        "nectarine",
        "orange",
        "orange zest",
        "papaya",
        "peach",
        "pear",
        "pineapple",
        "plantain",
        "plum",
        "pomegranate",
        "raspberry",
        "strawberry",
        "tangerine",
        "watermelon",
    ),
    "Meat & Seafood": (
        "andouille",
        "bacon",
        "beef",
        "beef brisket",
        "beef chuck",
        "beef chuck roast",
        "beef tenderloin",
        "bison",
        "brisket",
        "calamari",
        "catfish",
        "chicken",
        "chicken breast",
        "chicken drumstick",
        "chicken thigh",
        "chicken wing",
        "chorizo",
        "chuck roast",
        "clam",
        "cod",
        "corned beef",
        "crab",
        "duck",
        "filet mignon",
        "flank steak",
        "ground beef",
        "ground chicken",
        "ground lamb",
        "ground pork",
        "ground turkey",
        "haddock",
        "halibut",
        "ham",
        "italian sausage",
        "kielbasa",
        "lamb",
        "lamb chop",
        "lobster",
        "mackerel",
        "mahi mahi",
        "meatball",
        "mussel",
        "oyster",
        "pancetta",
        "pork",
        "pork belly",
        "pork butt",
        "pork chop",
        "pork loin",
        "pork shoulder",
        "pork tenderloin",
        "pot roast",
        "prawn",
        "prosciutto",
        "ribeye",
        "roast beef",
        "rotisserie chicken",
        "salami",
        "salmon",
        "sausage",
        "scallop",
        "sea bass",
        "short rib",
        "shrimp",
        "sirloin",
        "skirt steak",
        "snapper",
        "sole",
        "spare rib",
        "squid",
        "steak",
        "stew beef",
        "stew meat",
        "swordfish",
        "tilapia",
        "trout",
        "tuna",
        "turkey",
        "veal",
        "venison",
        "whole chicken",
    ),
    "Dairy & Eggs": (
        "almond milk",
        "american cheese",
        "blue cheese",
        "brie",
        "burrata",
        "butter",
        "buttermilk",
        "cheddar",
        "cheese",
        "coconut cream",
        "colby",
        "condensed milk",
        "cottage cheese",
        "cream",
        "cream cheese",
        "creme fraiche",
        "egg",
        "egg white",
        "egg yolk",
        "feta",
        "fontina",
        "ghee",
        "goat cheese",
        "gorgonzola",
        "gouda",
        "greek yogurt",
        "gruyere",
        "half and half",
        "half-and-half",
        "havarti",
        "heavy cream",
        "heavy whipping cream",
        "kefir",
        "manchego",
        "margarine",
        "mascarpone",
        "milk",
        "monterey jack",
        "mozzarella",
        "muenster",
        "oat milk",
        "paneer",
        "parmesan",
        "parmigiano",
        "pecorino",
        "pepper jack",
        "provolone",
        "queso fresco",
        "ricotta",
        "romano",
        "salted butter",
        "skim milk",
        "sour cream",
        "soy milk",
        "swiss cheese",
        "tempeh",
        "tofu",
        "unsalted butter",
        "whipping cream",
        "whole milk",
        "yogurt",
    ),
    "Bakery": (
        "bagel",
        "baguette",
        "bread",
        "brioche",
        "bun",
        "ciabatta",
        "corn tortilla",
        "croissant",
        "dinner roll",
        "english muffin",
        "flatbread",
        "flour tortilla",
        "focaccia",
        "french bread",
        "hamburger bun",
        "hoagie roll",
        "hot dog bun",
        "italian bread",
        "naan",
        "pita",
        "pizza dough",
        "rye bread",
        "sourdough",
        "tortilla",
        "white bread",
        "whole wheat bread",
    ),
    "Frozen": (
        "edamame",
        "frozen",
        "ice cream",
        "phyllo",
        "pie crust",
        "puff pastry",
        "sorbet",
        "tater tots",
        "waffle",
    ),
    "Canned & Broths": (
        "anchovy",
        "anchovy fillet",
        "artichoke heart",
        "baked beans",
        "beef broth",
        "beef stock",
        "black bean",
        "bone broth",
        "bouillon",
        "broth",
        "cannellini bean",
        "caper",
        "chicken broth",
        "chicken stock",
        "chickpea",
        "chipotle in adobo",
        "coconut milk",
        "crushed tomato",
        "diced tomato",
        "enchilada sauce",
        "evaporated milk",
        "fire-roasted tomato",
        "garbanzo bean",
        "green chile",
        "kidney bean",
        "marinara",
        "marinara sauce",
        "navy bean",
        "olive",
        "pasta sauce",
        "pinto bean",
        "pizza sauce",
        "pumpkin puree",
        "refried beans",
        "roasted red pepper",
        "salsa",
        "san marzano",
        "sardine",
        "stock",
        "sun-dried tomato",
        "sweetened condensed milk",
        "tomato paste",
        "tomato puree",
        "tomato sauce",
        "vegetable broth",
        "vegetable stock",
        "water chestnut",
        "white bean",
    ),
    "Condiments & Oils": (
        "agave",
        "aioli",
        "apple cider vinegar",
        "avocado oil",
        "balsamic glaze",
        "balsamic vinegar",
        "barbecue sauce",
        "bbq sauce",
        "buffalo sauce",
        "canola oil",
        "chili crisp",
        "chili oil",
        "chili paste",
        "chili sauce",
        "chutney",
        "coconut aminos",
        "coconut oil",
        "cooking oil",
        "cooking spray",
        "corn oil",
        "curry paste",
        "dijon",
        "dijon mustard",
        "extra-virgin olive oil",
        "fish sauce",
        "gochujang",
        "grapeseed oil",
        "harissa",
        "hoisin",
        "hoisin sauce",
        "honey",
        "horseradish",
        "hot sauce",
        "hummus",
        "jam",
        "jelly",
        "ketchup",
        "maple syrup",
        "marmalade",
        "mayo",
        "mayonnaise",
        "mirin",
        "miso",
        "miso paste",
        "molasses",
        "mustard",
        "neutral oil",
        "olive oil",
        "oyster sauce",
        "peanut butter",
        "peanut oil",
        "pesto",
        "pickle",
        "ponzu",
        "red wine vinegar",
        "relish",
        "rice vinegar",
        "rice wine vinegar",
        "salad dressing",
        "sambal",
        "sesame oil",
        "sherry vinegar",
        "soy sauce",
        "sriracha",
        "steak sauce",
        "sweet chili sauce",
        "tabasco",
        "tahini",
        "tamari",
        "teriyaki sauce",
        "vegetable oil",
        "vinaigrette",
        "vinegar",
        "white vinegar",
        "white wine vinegar",
        "worcestershire",
        "worcestershire sauce",
    ),
    "Spices & Seasonings": (
        "allspice",
        "anise",
        "bay leaf",
        "bay leaves",
        "black pepper",
        "black peppercorn",
        "cajun seasoning",
        "caraway",
        "cardamom",
        "cayenne",
        "cayenne pepper",
        "celery salt",
        "celery seed",
        "chili flakes",
        "chili powder",
        "chinese five spice",
        "cinnamon",
        "cinnamon stick",
        "clove",
        "coriander",
        "crushed red pepper",
        "cumin",
        "curry powder",
        "dill weed",
        "fennel seed",
        "fenugreek",
        "flaky salt",
        "garam masala",
        "garlic powder",
        "garlic salt",
        "ground ginger",
        "herbes de provence",
        "italian seasoning",
        "kosher salt",
        "mace",
        "mustard powder",
        "mustard seed",
        "nutmeg",
        "old bay",
        "onion powder",
        "paprika",
        "pepper",
        "peppercorn",
        "poppy seed",
        "poultry seasoning",
        "red pepper flakes",
        "saffron",
        "salt",
        "sea salt",
        "seasoned salt",
        "seasoning",
        "sesame seed",
        "smoked paprika",
        "star anise",
        "sumac",
        "table salt",
        "taco seasoning",
        "turmeric",
        "white pepper",
        "za'atar",
    ),
    "Pantry & Baking": (
        "all-purpose flour",
        "almond",
        "almond extract",
        "almond flour",
        "arborio rice",
        "arrowroot",
        "baking powder",
        "baking soda",
        "barley",
        "basmati rice",
        "bread crumbs",
        "bread flour",
        "breadcrumb",
        "brown rice",
        "brown sugar",
        "bulgur",
        "cake flour",
        "cashew",
        "cereal",
        "chia seed",
        "chocolate",
        "chocolate chip",
        "cocoa",
        "cocoa powder",
        "coconut flake",
        "confectioners' sugar",
        "cornmeal",
        "cornstarch",
        "couscous",
        "cracker",
        "cream of tartar",
        "crouton",
        "date",
        "dried apricot",
        "dried cranberry",
        "egg noodle",
        "espresso powder",
        "farro",
        "fettuccine",
        "flaxseed",
        "flour",
        "gelatin",
        "graham cracker",
        "granola",
        "granulated sugar",
        "grits",
        "hazelnut",
        "jasmine rice",
        "lasagna noodle",
        "lentil",
        "linguine",
        "macaroni",
        "marshmallow",
        "noodle",
        "nut",
        "oat",
        "oatmeal",
        "orzo",
        "panko",
        "pasta",
        "peanut",
        "pecan",
        "penne",
        "pine nut",
        "pistachio",
        "polenta",
        "powdered gelatin",
        "powdered sugar",
        "powdered unflavored gelatin",
        "pretzel",
        "pumpkin seed",
        "quinoa",
        "raisin",
        "ramen",
        "rice",
        "rice noodle",
        "rigatoni",
        "rolled oats",
        "semolina",
        "shortening",
        "shredded coconut",
        "spaghetti",
        "split pea",
        "starch",
        "sugar",
        "sunflower seed",
        "tapioca",
        "tortilla chip",
        "udon",
        "unflavored gelatin",
        "vanilla",
        "vanilla bean",
        "vanilla extract",
        "walnut",
        "white rice",
        "white sugar",
        "whole wheat flour",
        "wild rice",
        "yeast",
    ),
    "Beverages": (
        "ale",
        "apple cider",
        "apple juice",
        "beer",
        "bourbon",
        "brandy",
        "champagne",
        "cider",
        "club soda",
        "coffee",
        "cognac",
        "cola",
        "cranberry juice",
        "dry vermouth",
        "dry white wine",
        "espresso",
        "ginger ale",
        "ginger beer",
        "grape juice",
        "green tea",
        "lager",
        "lemonade",
        "marsala",
        "orange juice",
        "pineapple juice",
        "port",
        "prosecco",
        "red wine",
        "rum",
        "sake",
        "seltzer",
        "sherry",
        "soda",
        "sparkling water",
        "stout",
        "tea",
        "tequila",
        "tonic water",
        "vermouth",
        "vodka",
        "water",
        "whiskey",
        "white wine",
        "wine",
    ),
}

# Build a deterministic longest-phrase-first lookup list with compiled word-boundary regexes
def _build_lexicon_rules() -> list[tuple[re.Pattern[str], str]]:
    entries: list[tuple[str, str]] = []
    for aisle, terms in _AISLE_LEXICON.items():
        for term in terms:
            entries.append((term.lower().strip(), aisle))
    # Sort longest phrases first so specific phrases always win over substrings
    entries.sort(key=lambda pair: len(pair[0]), reverse=True)
    return [
        (re.compile(rf"(?<!\w){re.escape(term)}(?!\w)"), aisle)
        for term, aisle in entries
    ]


_LEXICON_RULES: list[tuple[re.Pattern[str], str]] = _build_lexicon_rules()

# WordNet hypernym synset names -> Kiln aisle (checked in specificity order)
_WORDNET_HYPERNYM_MAP: tuple[tuple[str, str], ...] = (
    ("spice.n.02", "Spices & Seasonings"),
    ("seasoning.n.01", "Spices & Seasonings"),
    ("flavorer.n.01", "Spices & Seasonings"),
    ("condiment.n.01", "Condiments & Oils"),
    ("sauce.n.01", "Condiments & Oils"),
    ("salad_dressing.n.01", "Condiments & Oils"),
    ("cooking_oil.n.01", "Condiments & Oils"),
    ("vegetable_oil.n.01", "Condiments & Oils"),
    ("cheese.n.01", "Dairy & Eggs"),
    ("dairy_product.n.01", "Dairy & Eggs"),
    ("milk.n.01", "Dairy & Eggs"),
    ("egg.n.02", "Dairy & Eggs"),
    ("seafood.n.01", "Meat & Seafood"),
    ("shellfish.n.01", "Meat & Seafood"),
    ("fish.n.02", "Meat & Seafood"),
    ("poultry.n.02", "Meat & Seafood"),
    ("cut_of_meat.n.01", "Meat & Seafood"),
    ("meat.n.01", "Meat & Seafood"),
    ("bread.n.01", "Bakery"),
    ("baked_goods.n.01", "Bakery"),
    ("pastry.n.01", "Bakery"),
    ("edible_nut.n.01", "Pantry & Baking"),
    ("pasta.n.02", "Pantry & Baking"),
    ("flour.n.01", "Pantry & Baking"),
    ("grain.n.02", "Pantry & Baking"),
    ("cereal.n.03", "Pantry & Baking"),
    ("sugar.n.01", "Pantry & Baking"),
    ("vegetable.n.01", "Produce"),
    ("root_vegetable.n.01", "Produce"),
    ("edible_fruit.n.01", "Produce"),
    ("produce.n.01", "Produce"),
    ("mushroom.n.01", "Produce"),
    ("fungus.n.01", "Produce"),
    ("herb.n.01", "Produce"),
    ("beverage.n.01", "Beverages"),
    ("wine.n.01", "Beverages"),
    ("liquor.n.01", "Beverages"),
    ("fruit_juice.n.01", "Beverages"),
)

_FROZEN_RE = re.compile(r"\bfrozen\b")
_CANNED_RE = re.compile(r"\b(?:canned|tinned|jarred|oil-packed|salt-packed|packed in oil)\b")
_DRIED_RE = re.compile(r"\b(?:dried|ground|powdered|dehydrated|crushed|flaked)\b")
_FRESH_RE = re.compile(r"\bfresh\b")


def _singularize_tokens(text: str) -> str:
    """Singularize words gently so plural lexicon lookups ('carrots', 'tomatoes') hit singular keys."""
    tokens = re.findall(r"[a-z0-9'-]+", text.lower())
    out: list[str] = []
    for tok in tokens:
        if len(tok) > 2 and tok.endswith("s") and not tok.endswith("ss"):
            sing = _INFLECT.singular_noun(tok)
            out.append(sing if sing else tok)
        else:
            out.append(tok)
    return " ".join(out)


@lru_cache(maxsize=512)
def _wordnet_classify(cleaned_name: str) -> str | None:
    """Attempt offline WordNet hypernym lookup for uncommon food items."""
    try:
        from nltk.corpus import wordnet as wn
    except Exception:
        return None

    tokens = [t for t in re.findall(r"[a-z]+", cleaned_name.lower()) if len(t) > 1]
    if not tokens:
        return None

    # Candidate lemmas: full phrase with underscores, last 2 words, and head noun (last word)
    candidates: list[str] = []
    if len(tokens) >= 2:
        candidates.append("_".join(tokens))
        candidates.append("_".join(tokens[-2:]))
    candidates.append(tokens[-1])
    sing_last = _INFLECT.singular_noun(tokens[-1])
    if sing_last and sing_last not in candidates:
        candidates.append(sing_last)

    try:
        for cand in candidates:
            synsets = wn.synsets(cand, pos=wn.NOUN)[:3]
            if not synsets:
                continue
            ancestor_names: set[str] = set()
            for syn in synsets:
                for path in syn.hypernym_paths():
                    for node in path:
                        ancestor_names.add(node.name())
            for hypernym, aisle in _WORDNET_HYPERNYM_MAP:
                if hypernym in ancestor_names:
                    return aisle
    except LookupError:
        # WordNet corpus not installed; degrade cleanly without crashing
        return None
    except Exception as exc:
        logger.debug("wordnet lookup error for %r: %s", cleaned_name, exc)
        return None

    return None


class AisleCategorizer(ABC):
    """Swappable interface for mapping ingredient names to grocery store aisles."""

    @abstractmethod
    def categorize(self, name: str, unit: str = "") -> str:
        raise NotImplementedError


class HybridAisleCategorizer(AisleCategorizer):
    """State-first rules + curated US grocery lexicon + WordNet hypernym fallback."""

    def categorize(self, name: str, unit: str = "") -> str:
        raw = " ".join((name or "").strip().lower().split())
        if not raw:
            return DEFAULT_AISLE

        norm_unit = (unit or "").strip().lower()
        singular = _singularize_tokens(raw)

        # Tier 1: State rules (frozen / canned / jarred / oil-packed take precedence)
        if _FROZEN_RE.search(raw):
            return "Frozen"
        if _CANNED_RE.search(raw):
            return "Canned & Broths"

        # Tier 1b: Culinary herbs — fresh (or measured by sprig/bunch) -> Produce, else Spices
        for herb in _CULINARY_HERBS:
            if re.search(rf"(?<!\w){re.escape(herb)}(?!\w)", raw) or re.search(
                rf"(?<!\w){re.escape(herb)}(?!\w)", singular
            ):
                if _DRIED_RE.search(raw):
                    return "Spices & Seasonings"
                if _FRESH_RE.search(raw) or norm_unit in _FRESH_PRODUCE_UNITS:
                    return "Produce"
                # Default fresh-leaning herbs (cilantro, parsley, basil, mint, chives, dill) -> Produce
                if herb in {
                    "basil",
                    "chive",
                    "chives",
                    "cilantro",
                    "dill",
                    "lemongrass",
                    "mint",
                    "parsley",
                }:
                    return "Produce"
                return "Spices & Seasonings"

        # Tier 2: Curated longest-phrase-first US grocery lexicon
        for pattern, aisle in _LEXICON_RULES:
            if pattern.search(raw) or pattern.search(singular):
                return aisle

        # Tier 3: Offline NLTK WordNet hypernym fallback
        wn_aisle = _wordnet_classify(raw)
        if wn_aisle is not None:
            return wn_aisle

        return DEFAULT_AISLE


_DEFAULT_CATEGORIZER: AisleCategorizer = HybridAisleCategorizer()


def categorize_ingredient(name: str, unit: str = "") -> str:
    """Categorize an ingredient name (+ optional unit) into a canonical grocery store aisle."""
    return _DEFAULT_CATEGORIZER.categorize(name, unit=unit)


def normalize_aisle(raw_aisle: str) -> str | None:
    """Validate and canonicalize an aisle name (case-insensitive), or return None if invalid."""
    cleaned = " ".join((raw_aisle or "").strip().lower().split())
    for aisle in AISLES:
        if aisle.lower() == cleaned:
            return aisle
    return None


def aisle_sort_index(aisle: str) -> int:
    try:
        return AISLES.index(aisle)
    except ValueError:
        return len(AISLES)
