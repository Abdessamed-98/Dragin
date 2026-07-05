import { redirect } from "next/navigation";

// Flow-only phase: Flow lives on the homepage. Restore the original page here
// when the suite showcase returns to / (see the note in ../page.tsx).

export default async function FlowPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}`);
}
