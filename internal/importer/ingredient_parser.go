package importer

import (
	"html"
	"regexp"
	"strings"
)

var unicodeFractions = map[rune]string{
	'¼': "1/4",
	'½': "1/2",
	'¾': "3/4",
	'⅓': "1/3",
	'⅔': "2/3",
	'⅕': "1/5",
	'⅖': "2/5",
	'⅗': "3/5",
	'⅘': "4/5",
	'⅙': "1/6",
	'⅚': "5/6",
	'⅛': "1/8",
	'⅜': "3/8",
	'⅝': "5/8",
	'⅞': "7/8",
}

// Matches leading quantity expressions such as:
// "2", "2.5", "1/2", "1 1/2", "2-3", "2–3", "1 to 2", "1 1/2 - 2"
var quantityPrefixRe = regexp.MustCompile(`^(\d+(?:\s+\d+/\d+|\.\d+|/\d+)?(?:\s*(?:[-–—]|to)\s*\d+(?:\s+\d+/\d+|\.\d+|/\d+)?)?)\s+(.*)$`)

var whitespaceRe = regexp.MustCompile(`\s+`)

var knownUnits = map[string]bool{
	"cup": true, "cups": true, "c": true,
	"tbsp": true, "tbs": true, "tablespoon": true, "tablespoons": true,
	"tsp": true, "teaspoon": true, "teaspoons": true,
	"oz": true, "ounce": true, "ounces": true,
	"fl": true,
	"lb": true, "lbs": true, "pound": true, "pounds": true,
	"g": true, "gram": true, "grams": true,
	"kg": true, "kilogram": true, "kilograms": true,
	"ml": true, "milliliter": true, "milliliters": true, "millilitre": true, "millilitres": true,
	"l": true, "liter": true, "liters": true, "litre": true, "litres": true,
	"pt": true, "pint": true, "pints": true,
	"qt": true, "quart": true, "quarts": true,
	"gal": true, "gallon": true, "gallons": true,
	"clove": true, "cloves": true,
	"can": true, "cans": true,
	"pinch": true, "pinches": true,
	"dash": true, "dashes": true,
	"slice": true, "slices": true,
	"piece": true, "pieces": true,
	"bunch": true, "bunches": true,
	"sprig": true, "sprigs": true,
	"stalk": true, "stalks": true,
	"head": true, "heads": true,
	"stick": true, "sticks": true,
	"package": true, "packages": true, "pkg": true, "pkgs": true,
	"packet": true, "packets": true,
	"bag": true, "bags": true,
	"jar": true, "jars": true,
	"box": true, "boxes": true,
	"bottle": true, "bottles": true,
	"drop": true, "drops": true,
	"handful": true, "handfuls": true,
	"inch": true, "inches": true,
	"leaf": true, "leaves": true,
}

// ParseIngredient performs a best-effort split of a raw ingredient line into
// quantity, unit, and ingredient name.
func ParseIngredient(raw string) ImportedIngredient {
	cleaned := cleanWhitespace(html.UnescapeString(raw))
	if cleaned == "" {
		return ImportedIngredient{}
	}

	normalized := replaceUnicodeFractions(cleaned)
	matches := quantityPrefixRe.FindStringSubmatch(normalized)
	if len(matches) != 3 {
		return ImportedIngredient{
			Raw:  cleaned,
			Name: cleaned,
		}
	}

	qty := strings.TrimSpace(matches[1])
	rest := strings.TrimSpace(matches[2])
	if rest == "" {
		return ImportedIngredient{
			Raw:  cleaned,
			Name: cleaned,
		}
	}

	unit, name := splitUnitAndName(rest)
	if name == "" {
		// Don't leave the ingredient name empty if the entire remainder looked like a unit.
		return ImportedIngredient{
			Raw:      cleaned,
			Quantity: qty,
			Name:     rest,
		}
	}

	return ImportedIngredient{
		Raw:      cleaned,
		Quantity: qty,
		Unit:     unit,
		Name:     name,
	}
}

func splitUnitAndName(rest string) (string, string) {
	fields := strings.Fields(rest)
	if len(fields) < 2 {
		return "", rest
	}

	firstRaw := fields[0]
	firstNorm := strings.ToLower(strings.TrimRight(firstRaw, ".,"))

	// Handle two-word "fl oz" / "fluid ounces"
	if (firstNorm == "fl" || firstNorm == "fluid") && len(fields) >= 3 {
		secondNorm := strings.ToLower(strings.TrimRight(fields[1], ".,"))
		if secondNorm == "oz" || secondNorm == "ounce" || secondNorm == "ounces" {
			unit := firstRaw + " " + strings.TrimRight(fields[1], ",")
			name := stripLeadingOf(strings.Join(fields[2:], " "))
			return unit, name
		}
	}

	if knownUnits[firstNorm] {
		unit := strings.TrimRight(firstRaw, ",")
		name := stripLeadingOf(strings.Join(fields[1:], " "))
		return unit, name
	}

	return "", rest
}

func stripLeadingOf(s string) string {
	trimmed := strings.TrimSpace(s)
	if len(trimmed) > 3 && strings.EqualFold(trimmed[:3], "of ") {
		return strings.TrimSpace(trimmed[3:])
	}
	return trimmed
}

func replaceUnicodeFractions(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 8)
	prevDigit := false
	for _, r := range s {
		if frac, ok := unicodeFractions[r]; ok {
			if prevDigit {
				b.WriteByte(' ')
			}
			b.WriteString(frac)
			prevDigit = false
			continue
		}
		b.WriteRune(r)
		prevDigit = r >= '0' && r <= '9'
	}
	return cleanWhitespace(b.String())
}

func cleanWhitespace(s string) string {
	return strings.TrimSpace(whitespaceRe.ReplaceAllString(s, " "))
}
