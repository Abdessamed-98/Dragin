import { setRequestLocale } from "next-intl/server";
import { ShelfHero } from "@/components/ShelfHero";
import { HowItWorks } from "@/components/HowItWorks";
import { ShelfFeatures } from "@/components/ShelfFeatures";
import { CtaSection } from "@/components/CtaSection";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = (await import(`../../../../messages/${locale}.json`)).default;
  return {
    title: `${messages.shelfPage.hero.title} — Dragin`,
    description: messages.shelfPage.hero.subtitle,
  };
}

export default async function ShelfPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="pt-16">
      <ShelfHero />
      <HowItWorks />
      <ShelfFeatures />
      <CtaSection />
    </main>
  );
}
