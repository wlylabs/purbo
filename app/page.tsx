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

export default function LandingPage() {
  // Read once on the server: the marketing page must render even when the
  // deployment has no Privy credentials yet.
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  return (
    <>
      <Nav configured={configured} />
      <main id="main">
        <Hero configured={configured} />
        <HowItWorks />
        <Security />
        <Features />
        <Faq />
        <CallToAction configured={configured} />
      </main>
      <Footer />
    </>
  );
}
