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

/** Sends through any SMTP server (smtps://user:pass@host:465). */
export function createSmtpSender(smtpUrl: string, from: string): EmailSenderPort {
  const transport = nodemailer.createTransport(smtpUrl);
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
