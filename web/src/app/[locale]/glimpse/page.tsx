import { setRequestLocale } from "next-intl/server";
import { GlimpseHero } from "@/components/GlimpseHero";
import { GlimpseFeatures } from "@/components/GlimpseFeatures";
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
        title: `${messages.glimpsePage.hero.title} — Dragin`,
        description: messages.glimpsePage.hero.subtitle,
    };
}

export default async function GlimpsePage({ params }: Props) {
    const { locale } = await params;
    setRequestLocale(locale);

    return (
        <main className="pt-16">
            <GlimpseHero />
            <GlimpseFeatures />
            <CtaSection />
        </main>
    );
}
