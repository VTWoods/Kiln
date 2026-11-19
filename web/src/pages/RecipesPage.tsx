export default function RecipesPage() {
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Recipes
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Store, organize, and browse your personal recipe collection.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
        <p className="text-base font-medium text-stone-800">No recipes yet</p>
        <p className="mt-1 text-sm text-stone-500">
          This is the starter placeholder view. Next up: wire recipe API
          endpoints in Go and add recipe creation &amp; browsing here.
        </p>
      </div>
    </section>
  );
}
