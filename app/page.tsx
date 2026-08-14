import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { Nav } from "@/components/landing/nav";
import {
  CallToAction,
  Faq,
  Features,
  HowItWorks,
  Security,
} from "@/components/landing/sections";
import { InstallBanner } from "@/components/pwa/install-prompt";

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Security />
        <Features />
        <Faq />
        <CallToAction />
      </main>
      <Footer />
      <InstallBanner />
    </>
  );
}
