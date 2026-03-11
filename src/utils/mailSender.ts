/**
 * SMTP e-mail sender — ported from the blastoise project.
 * Uses nodemailer with retry logic for transient failures.
 */
import * as nodemailer from 'nodemailer';

/* SMTP transport configured once at module load */
const mailTransporter = nodemailer.createTransport({
  host: 'smtpout.secureserver.net',
  port: 465,
  secure: true,
  auth: {
    user: 'support@optigrit.com',
    pass: 'optigrit123',
  },
});

/** Simple async delay helper */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send an e-mail with automatic retries.
 *
 * @param email   - recipient address
 * @param subject - e-mail subject line
 * @param html    - HTML body content
 * @param retries - max number of attempts (default 3)
 * @param delay   - milliseconds between retries (default 2 000)
 */
export const sendMail = async (
  email: string,
  subject: string,
  html: string,
  retries = 3,
  delay = 2000,
): Promise<void> => {
  const data = {
    from: 'support@optigrit.com',
    to: email,
    subject,
    html,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mailTransporter.sendMail(data);
      return;
    } catch (err: any) {
      if (attempt === retries) {
        throw new Error(
          `Failed to send mail after ${retries} attempts: ${err.message}`,
        );
      }
      console.log(`[mailSender] attempt ${attempt} failed — retrying in ${delay}ms …`);
      await sleep(delay);
    }
  }
};
