import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How WhatsApp Sales CRM collects, uses and protects personal data.",
};

// Set these two on the deployment so the page names the right company and gives a real contact.
const COMPANY = process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || "Vici";
const EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
const UPDATED = "7 October 2026";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="font-heading text-xl font-semibold">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const contact = EMAIL ? (
    <a href={`mailto:${EMAIL}`} className="underline underline-offset-2 hover:text-foreground">
      {EMAIL}
    </a>
  ) : (
    "the support contact in your account"
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <Link href="/login" className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
        Back to sign in
      </Link>
      <h1 className="mt-6 font-heading text-3xl leading-tight font-bold">Privacy policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>

      <p className="mt-6 leading-relaxed text-muted-foreground">
        WhatsApp Sales CRM is run by {COMPANY}. It helps small businesses keep their WhatsApp conversations, leads and
        follow-ups in one place. This policy explains what personal data we handle, why, and what choices you have.
      </p>

      <Section title="Who is responsible for the data">
        <p>
          There are two groups of people in the data. <strong>Business users</strong> are the people who sign up for an
          account. <strong>Customers</strong> are the people who message a business on WhatsApp.
        </p>
        <p>
          For a business user&apos;s own account details, {COMPANY} decides how the data is used. For the messages and
          details of a business&apos;s customers, the business decides what is collected and why, and {COMPANY}
          handles that data on the business&apos;s behalf to run the service.
        </p>
      </Section>

      <Section title="What we collect">
        <p>
          <strong>From business users:</strong> email address, password (stored hashed by our login provider), business
          name, and the settings and facts you enter, such as opening hours, prices and answers the assistant may use.
        </p>
        <p>
          <strong>When you connect WhatsApp:</strong> your WhatsApp Business Account ID, phone number ID, and an access
          token that lets us send and receive messages for your number. Access tokens are stored encrypted. We
          receive these from Meta when you finish the WhatsApp sign-in. We do not see your Facebook password.
        </p>
        <p>
          <strong>From your customers, through WhatsApp:</strong> their phone number, WhatsApp profile name, the
          messages they send and receive (including any images or files), message times and delivery status, and
          any lead, order or follow-up notes the business adds.
        </p>
        <p>
          <strong>Billing:</strong> your subscription status and plan. Card details are handled by our payment
          provider, Stripe, and are not stored by us.
        </p>
        <p>
          <strong>Technical data:</strong> basic logs such as error reports and request times, used to keep the service
          running.
        </p>
      </Section>

      <Section title="How we use it">
        <ul className="list-disc pl-5">
          <li>To show a business its conversations and let it reply, track leads and schedule follow-ups.</li>
          <li>To draft replies with an AI assistant, when the business turns that on. The text of the conversation and the facts the business entered are sent to an AI service provider to produce a draft.</li>
          <li>To sign you in, keep your account secure and send account emails such as password resets.</li>
          <li>To take payment and manage your subscription.</li>
          <li>To find and fix faults, and to prevent abuse.</li>
        </ul>
        <p>We do not sell personal data, and we do not use customers&apos; messages to advertise to them.</p>
      </Section>

      <Section title="Who we share it with">
        <p>We use these providers to run the service, and they only receive the data they need:</p>
        <ul className="list-disc pl-5">
          <li><strong>Meta (WhatsApp):</strong> delivers messages between a business and its customers.</li>
          <li><strong>Supabase:</strong> database and sign-in.</li>
          <li><strong>Vercel:</strong> hosting.</li>
          <li><strong>Stripe:</strong> payments.</li>
          <li><strong>AI model provider:</strong> drafts replies, when the assistant is used.</li>
        </ul>
        <p>We may also disclose data where the law requires it.</p>
      </Section>

      <Section title="Where data is stored and how we protect it">
        <p>
          Data is stored with the providers above, which may process it outside Malaysia. WhatsApp access tokens are
          encrypted, connections use HTTPS, and each business can only see its own data. No system is perfectly
          secure, so we cannot promise absolute security.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep a business&apos;s data while its account is active. When an account is deleted, we delete its data,
          except what we must keep for legal or accounting reasons.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can ask to see, correct or delete the personal data we hold about you. Customers of a business can make
          the same request to that business, or to us, and we will pass it on. Contact us at {contact}.
        </p>
        <p>
          We aim to handle personal data in line with Malaysia&apos;s Personal Data Protection Act 2010 and other
          laws that apply to the people we serve.
        </p>
      </Section>

      <Section id="data-deletion" title="Delete your data">
        <p>
          To delete your account and the data in it, email {contact} from the address you signed up with and ask for
          deletion. We will confirm by reply and complete the deletion promptly.
        </p>
        <p>
          To stop us accessing your WhatsApp number without deleting your account, remove this app from your business
          integrations in your Meta Business settings. After that, we can no longer send or receive messages for
          that number.
        </p>
      </Section>

      <Section title="Children">
        <p>The service is for businesses and is not meant for anyone under 18.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we make a significant change, we will update the date above and, where it matters, tell account holders
          by email.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy or your data: {contact}.
        </p>
      </Section>
    </main>
  );
}
