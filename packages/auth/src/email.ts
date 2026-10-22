import nodemailer from "nodemailer";
import type { EmailKind, EmailSenderPort, OutgoingEmail } from "@rr/core";

const SUBJECT: Record<EmailKind, string> = {
  signup_code: "Your sign-up code",
  reset_code: "Your password reset code",
  identity_code: "Confirm your extra email"
};

/** Plain text only, and always about one code. The policy is: the site sends no other email. */
export function renderEmail(m: OutgoingEmail): { subject: string; text: string } {
  return {
    subject: SUBJECT[m.kind],
    text: [`Your verification code is ${m.code}`, "", `It expires in ${m.expiresInMinutes} minutes. If you did not ask for it, you can ignore this email.`].join("\n")
  };
}

/** How long the site waits on the mail server before telling the person to try again (nodemailer's defaults are minutes). */
export const SMTP_TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 } as const;

/** Sends through any SMTP server (smtps://user:pass@host:465). */
export function createSmtpSender(smtpUrl: string, from: string, timeouts: { connectionTimeout: number; greetingTimeout: number; socketTimeout: number } = SMTP_TIMEOUTS): EmailSenderPort {
  const transport = nodemailer.createTransport({ url: smtpUrl, ...timeouts } as Parameters<typeof nodemailer.createTransport>[0]);
  return {
    async send(m) {
      const { subject, text } = renderEmail(m);
      await transport.sendMail({ from, to: m.to, subject, text });
    }
  };
}

/** Development only: prints the code where the developer can see it. Never use this where real people sign in. */
export function createConsoleSender(log: (line: string) => void = (l) => console.info(l)): EmailSenderPort {
  return { async send(m) { log(`[email to ${m.to}] ${SUBJECT[m.kind]}: ${m.code}`); } };
}
