import { setRequestLocale } from "next-intl/server";
import { FlowHero } from "@/components/FlowHero";
import { ToolGrid } from "@/components/ToolGrid";
import { FlowFeatures } from "@/components/FlowFeatures";
import { CtaSection } from "@/components/CtaSection";

// Flow-only phase: the homepage presents Dragin Flow directly (it's the only
// shipped app). When more apps launch, restore the suite showcase here
// (HeroSection / ValueProp / AppShowcase) and move this content back to /flow.

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  return {
    title: `${messages.flowPage.hero.title} — Dragin Tools`,
    description: messages.flowPage.hero.subtitle,
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="pt-16">
      <FlowHero />
      <ToolGrid />
      <FlowFeatures />
      <CtaSection />
    </main>
  );
}
