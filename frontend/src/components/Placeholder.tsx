// A page that isn't built yet (Today, Food log and My foods arrive in the next milestone)
export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-4 rounded-2xl border border-line bg-container p-6 text-subtle">Coming in the next update</p>
    </div>
  );
}
