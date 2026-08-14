import { Wordmark } from "@/components/logo";

export function Footer() {
  const columns = [
    {
      title: "Product",
      links: [
        { label: "How it works", href: "#how" },
        { label: "Security", href: "#security" },
        { label: "Features", href: "#features" },
        { label: "FAQ", href: "#faq" },
      ],
    },
    {
      title: "Built with",
      links: [
        { label: "Next.js", href: "https://nextjs.org", external: true },
        { label: "noble cryptography", href: "https://paulmillr.com/noble/", external: true },
        { label: "Vercel", href: "https://vercel.com", external: true },
      ],
    },
  ];

  return (
    <footer className="bg-canvas">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Wordmark />
            <p className="mt-4 max-w-xs text-[0.8125rem] leading-relaxed text-ink-muted">
              A password vault only you can open. Encrypted in the browser, sealed with a
              recovery phrase you own.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-label">{column.title}</p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...("external" in link && link.external
                        ? { target: "_blank", rel: "noreferrer noopener" }
                        : {})}
                      className="text-[0.8125rem] text-ink-muted transition-colors hover:text-ink"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-9 flex flex-col gap-3 border-t border-line pt-6 sm:mt-12 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-subtle">
            © {new Date().getFullYear()} Purbo. Released under the MIT licence.
          </p>
          <p className="font-mono text-[0.6875rem] text-ink-subtle">
            AES-256-GCM · Argon2id · HKDF-SHA-256 · BIP39
          </p>
        </div>
      </div>
    </footer>
  );
}
