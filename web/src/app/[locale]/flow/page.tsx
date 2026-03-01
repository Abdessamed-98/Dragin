import { setRequestLocale } from "next-intl/server";
import { FlowHero } from "@/components/FlowHero";
import { ToolGrid } from "@/components/ToolGrid";
import { FlowFeatures } from "@/components/FlowFeatures";
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
    title: `${messages.flowPage.hero.title} — Dragin`,
    description: messages.flowPage.hero.subtitle,
  };
}

export default async function FlowPage({ params }: Props) {
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
