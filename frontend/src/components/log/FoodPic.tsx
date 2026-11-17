// A food's photo when it has one, else its emoji — the same in search, the log and the detail sheet
export default function FoodPic({ icon, imageUrl, size = "size-10" }: { icon: string; imageUrl?: string | null; size?: string }) {
  return imageUrl ? (
    <img src={imageUrl} alt="" aria-hidden="true" className={`${size} shrink-0 rounded-lg object-cover`} />
  ) : (
    <span aria-hidden="true" className={`flex ${size} shrink-0 items-center justify-center text-2xl`}>
      {icon}
    </span>
  );
}
