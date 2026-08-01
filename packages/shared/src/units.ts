export function convertRecipeQuantity(
  quantityRequired: number,
  recipeUnit?: string | null,
  baseUnit?: string | null,
): number {
  if (!recipeUnit || !baseUnit) return quantityRequired;

  const rUnit = recipeUnit.toLowerCase().trim();
  const bUnit = baseUnit.toLowerCase().trim();

  // Base unit = kg, recipe unit = g -> 100g = 0.1kg
  if (['kg', 'kilogram', 'kilograms'].includes(bUnit) && ['g', 'gram', 'grams'].includes(rUnit)) {
    return quantityRequired / 1000;
  }
  // Base unit = g, recipe unit = kg -> 1kg = 1000g
  if (['g', 'gram', 'grams'].includes(bUnit) && ['kg', 'kilogram', 'kilograms'].includes(rUnit)) {
    return quantityRequired * 1000;
  }

  // Base unit = l, recipe unit = ml -> 200ml = 0.2l
  if (['l', 'liter', 'liters'].includes(bUnit) && ['ml', 'milliliter', 'milliliters'].includes(rUnit)) {
    return quantityRequired / 1000;
  }
  // Base unit = ml, recipe unit = l -> 1l = 1000ml
  if (['ml', 'milliliter', 'milliliters'].includes(bUnit) && ['l', 'liter', 'liters'].includes(rUnit)) {
    return quantityRequired * 1000;
  }

  return quantityRequired;
}
