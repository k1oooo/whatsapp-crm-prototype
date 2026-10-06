"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { connectWhatsAppEmbedded } from "@/app/dashboard/actions/settings";
import { Button } from "@/components/ui/button";
import { isFacebookOrigin, parseSessionEvent } from "@/lib/embedded-signup-client";

// The part of Meta's JavaScript SDK this button uses.
type LoginResponse = { authResponse?: { code?: string } | null };
interface FacebookSdk {
  init(options: { appId: string; version: string; xfbml: boolean; autoLogAppEvents: boolean }): void;
  login(callback: (response: LoginResponse) => void, options: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let sdk: Promise<FacebookSdk> | null = null;

/** Load Meta's SDK once per page load. */
function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (sdk) return sdk;
  sdk = new Promise<FacebookSdk>((resolve, reject) => {
    const ready = () => {
      const fb = window.FB;
      if (!fb) return reject(new Error("Meta SDK missing"));
      fb.init({ appId, version, xfbml: false, autoLogAppEvents: false });
      resolve(fb);
    };
    if (window.FB) return ready();
    window.fbAsyncInit = ready;
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdk = null;
      reject(new Error("Meta SDK blocked"));
    };
    document.body.appendChild(script);
  });
  return sdk;
}

// Meta gives the page two separate things when the popup finishes: a message with the account IDs
// and a callback with the one-time code. They can arrive in either order, and the code is only good
// for 30 seconds, so the server call goes out the moment both are here.
interface Attempt {
  code?: string;
  session?: { wabaId: string; phoneNumberId: string };
  done: boolean;
}

export function EmbeddedSignupButton({
  appId,
  configId,
  version,
  reconnect = false,
}: {
  appId: string;
  configId: string;
  version: string;
  reconnect?: boolean;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<Attempt>({ done: true });
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  function finish(message?: { kind: "success" | "error" | "info"; text: string }) {
    attempt.current.done = true;
    if (watchdog.current) clearTimeout(watchdog.current);
    setBusy(false);
    if (message) toast[message.kind](message.text);
  }

  async function submitIfComplete() {
    const a = attempt.current;
    if (a.done || !a.code || !a.session) return;
    a.done = true;
    if (watchdog.current) clearTimeout(watchdog.current);
    try {
      const res = await connectWhatsAppEmbedded({ code: a.code, ...a.session });
      if (res.error) toast.error(res.error);
      else {
        toast.success(res.notice ?? "WhatsApp is connected.");
        router.refresh();
      }
    } catch {
      toast.error("Could not finish connecting WhatsApp. Try again.");
    } finally {
      setBusy(false);
    }
  }
  // The message listener below lives for the whole page, so it reads the latest function from here.
  const submitRef = useRef(submitIfComplete);
  useEffect(() => {
    submitRef.current = submitIfComplete;
  });
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    let alive = true;
    loadSdk(appId, version).then(
      () => alive && setReady(true),
      () => alive && setReady(false),
    );
    return () => {
      alive = false;
    };
  }, [appId, version]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin) || attempt.current.done) return;
      const msg = parseSessionEvent(event.data);
      if (!msg) return;
      if (msg.kind === "finish") {
        attempt.current.session = { wabaId: msg.wabaId, phoneNumberId: msg.phoneNumberId };
        void submitRef.current();
      } else if (msg.kind === "cancel") {
        finishRef.current(
          msg.errorMessage
            ? { kind: "error", text: msg.errorMessage }
            : { kind: "info", text: "WhatsApp sign-in was cancelled." },
        );
      } else {
        finishRef.current({
          kind: "error",
          text: "This kind of WhatsApp sign-in is not supported yet. Use a number that is not on the WhatsApp Business app.",
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => () => {
    if (watchdog.current) clearTimeout(watchdog.current);
  }, []);

  // FB.login opens a popup, so it has to run straight from the click. Browsers block popups that
  // open after an await, which is why the SDK is loaded ahead of time rather than here.
  function start() {
    const fb = window.FB;
    if (!fb || busy) return;
    attempt.current = { done: false };
    setBusy(true);
    watchdog.current = setTimeout(
      () => finish({ kind: "error", text: "WhatsApp did not finish signing in. Try again." }),
      120_000,
    );
    fb.login(
      (response) => {
        if (attempt.current.done) return;
        const code = response.authResponse?.code;
        if (!code) return finish({ kind: "info", text: "WhatsApp sign-in was cancelled." });
        attempt.current.code = code;
        void submitIfComplete();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  return (
    <Button type="button" onClick={start} disabled={!ready || busy} className="w-full sm:w-auto">
      {busy ? <Loader2 className="animate-spin" /> : <MessageCircle />}
      {busy ? "Connecting..." : reconnect ? "Reconnect WhatsApp" : "Connect WhatsApp"}
    </Button>
  );
}
