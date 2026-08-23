"use client";

import { EyeOff } from "lucide-react";
import { useEffect, useRef } from "react";

import { Logo } from "@/components/logo";
import { isPasskeyPromptOpen } from "@/lib/auth/passkey";
import { useVault } from "@/lib/vault/provider";

/**
 * Blurs the page under the veil, and everything else in the top layer with it.
 *
 * `filter` on the page rather than `backdrop-filter` on the veil, which is the
 * obvious way round and the wrong one: a backdrop filter samples the viewport
 * and clamps at its edges, so text within a blur radius of the left edge comes
 * out half-legible — precisely the column an entry list puts its names in.
 * Blurring the content itself has no edge to clamp against.
 *
 * Open dialogs are blurred one at a time because a dialog in the top layer is
 * out of reach of any ancestor's filter. That is the same rule the veil itself
 * relies on to stay sharp while sitting inside what it blurs.
 */
function blurPage(except: HTMLElement) {
  document.body.style.filter = "blur(16px)";
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    if (dialog !== except) (dialog as HTMLElement).style.filter = "blur(16px)";
  }
}

function unblurPage() {
  document.body.style.removeProperty("filter");
  for (const dialog of document.querySelectorAll("dialog")) {
    (dialog as HTMLElement).style.removeProperty("filter");
  }
}

/**
 * A veil that drops over the vault the moment this tab stops being what the
 * user is looking at.
 *
 * The thing being defended against is the app switcher: Android and iOS both
 * keep a thumbnail of every backgrounded app, and on a shared or borrowed
 * phone that thumbnail is a picture of a decrypted password list that anyone
 * holding the device can scroll past. Native apps opt out of it with one flag
 * — `FLAG_SECURE` on Android, a cover view on iOS. The web has no equivalent:
 * nothing here can tell the system not to snapshot the window. So the only
 * move left is to change what there is to snapshot, by blurring the page out
 * before the picture is taken.
 *
 * That makes this best-effort against the OS thumbnail and exact everywhere
 * else — another browser tab, a second monitor, a screen share, and the glance
 * at the screen before you pick the phone back up are all covered for certain,
 * because the page is still being composited when they happen.
 *
 * What it paints is the page itself, blurred, rather than a blank card: the
 * thumbnail stays recognisably Purbo — the shape of the app you are looking
 * for in a stack of them — while nothing on it can be read. A blank rectangle
 * would protect exactly as well and cost you the ability to find the app.
 *
 * It is not a lock and does not pretend to be one: coming back reveals the
 * vault with no passphrase. Locking on the same signal is the separate setting
 * next to it, because that one costs an unlock and this one costs nothing.
 */
export function PrivacyScreen() {
  const { status, privacyScreen } = useVault();
  const coverRef = useRef<HTMLDialogElement>(null);
  const active = privacyScreen && status === "unlocked";

  useEffect(() => {
    if (!active) return;

    /*
     * Shown and hidden by writing to the node directly rather than through
     * state.
     *
     * The whole value of this screen is that it is painted in the same frame
     * as the event that asked for it; a cover that arrives a render later
     * arrives after the system has already taken its picture. A React state
     * update is scheduled, an inline style is not, which is as close to a
     * guarantee as the platform gets. Inline rather than a class because it
     * has to win against the layout utilities on the cover itself.
     */
    const cover = (visible: boolean) => {
      const node = coverRef.current;
      if (visible) {
        if (!node) return;
        node.style.display = "grid";
        // A modal dialog — an open entry, the command palette — is drawn in
        // the top layer, which no z-index can climb over, and it makes the
        // rest of the page inert while it is open. So the veil has to be a
        // modal too: shown last it paints over the dialog, and being the
        // innermost modal it takes the taps that would otherwise land on the
        // buttons of a dialog the user can no longer see.
        try {
          node.showModal();
        } catch {
          // Already open: two of these events firing in a row is normal.
        }

        // Translucent only once the veil is genuinely in the top layer, where
        // the blur cannot reach it. If `showModal` did not take, it stays the
        // opaque card it renders as by default — the safe way to fail.
        node.dataset.veil = node.open ? "on" : "off";
        if (node.open) blurPage(node);
      } else {
        if (node) {
          node.close();
          node.style.display = "none";
        }
        // Not conditional on the node: by the time this runs on unmount the
        // veil is gone from the tree, and a page left blurred with nothing on
        // top of it is the one failure with no way out of it.
        unblurPage();
      }
    };

    const hide = () => cover(false);

    const show = () => {
      // An authenticator sheet takes focus off the page while the user is
      // mid-gesture. Covering then would hide the vault behind a prompt they
      // are answering about the vault, and the sheet is drawn over the page
      // by the OS anyway.
      if (!isPasskeyPromptOpen()) cover(true);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") show();
      else if (document.hasFocus()) hide();
    };

    // `blur` fires first on a phone — while the window is still on screen and
    // still being painted — which is the only moment a repaint can still reach
    // the thumbnail. `visibilitychange` and `pagehide` are the backstop for the
    // paths that skip it, such as another tab taking over.
    window.addEventListener("blur", show);
    window.addEventListener("pagehide", show);
    window.addEventListener("focus", hide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("blur", show);
      window.removeEventListener("pagehide", show);
      window.removeEventListener("focus", hide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      hide();
    };
  }, [active]);

  if (!active) return null;

  return (
    <dialog
      ref={coverRef}
      // Starts down and stays down until the effect above lifts it, so the
      // first paint after an unlock can never be an uncovered one.
      style={{ display: "none" }}
      /*
       * Any touch lifts it. Returning focus is the normal way back, but a
       * browser that never fires `focus` — or fires it before the cover goes
       * up — would leave the vault behind a screen with no way past, and a
       * password manager that can strand itself is worse than one that leaves
       * a thumbnail.
       */
      onPointerDown={() => {
        const node = coverRef.current;
        if (!node) return;
        node.close();
        node.style.display = "none";
        unblurPage();
      }}
      aria-hidden
      // Every box property is spelled out because a dialog's UA styles size it
      // to its content and cap it short of the viewport, and a cover that fits
      // its content is a cover with the vault around the edges of it.
      className="fixed inset-0 z-50 m-0 size-full max-h-none max-w-none place-items-center border-0 bg-canvas px-6 outline-none data-[veil=on]:bg-canvas/55"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="size-7 text-ink-subtle" />
        <EyeOff className="mt-3 size-6 text-ink-subtle" aria-hidden />
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          App content protected
        </p>
      </div>
    </dialog>
  );
}
