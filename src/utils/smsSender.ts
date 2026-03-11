/**
 * SMS sender via Twilio REST API.
 * Uses the Messages resource directly with fetch — no SDK needed.
 */

const TWILIO_ACCOUNT_SID = "ACbd885ef22e91e37199add8c2a870af4b";
const TWILIO_AUTH_TOKEN = "4cfdeb0062186eacf114949679e3452d";
const TWILIO_FROM_NUMBER = "+19893680678";

/**
 * Send an SMS message via Twilio.
 *
 * @param phoneNumber - E.164 formatted number (e.g. "+919390616131")
 * @param message     - text content to send
 */
export const sendSms = async (
  phoneNumber: string,
  message: string,
): Promise<void> => {
  const url = `https://api.twilio.com/2010-04-01/Accounts/ACbd885ef22e91e37199add8c2a870af4b/Messages.json`;

  const params = new URLSearchParams({
    To: phoneNumber,
    From: TWILIO_FROM_NUMBER,
    Body: message,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`ACbd885ef22e91e37199add8c2a870af4b:4cfdeb0062186eacf114949679e3452d`).toString(
          "base64",
        ),
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio SMS failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  console.log(`[smsSender] SMS sent to ${phoneNumber} — SID: ${data.sid}`);
};
