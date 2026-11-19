export default function ShoppingListsPage() {
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Shopping Lists
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Plan grocery trips and pull ingredients directly from your recipes.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
        <p className="text-base font-medium text-stone-800">
          No shopping lists yet
        </p>
        <p className="mt-1 text-sm text-stone-500">
          This is the starter placeholder view. Next up: add shopping list API
          endpoints and check-off items here.
        </p>
      </div>
    </section>
  );
}
