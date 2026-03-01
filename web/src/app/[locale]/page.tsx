import { setRequestLocale } from "next-intl/server";
import { HeroSection } from "@/components/HeroSection";
import { ValueProp } from "@/components/ValueProp";
import { AppShowcase } from "@/components/AppShowcase";
import { CtaSection } from "@/components/CtaSection";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="pt-16">
      <HeroSection />
      <ValueProp />
      <AppShowcase />
      <CtaSection />
    </main>
  );
}
