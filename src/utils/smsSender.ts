/**
 * SMS sender via Twilio REST API (hardcoded for testing — no env).
 * 401 = Auth Token invalid or rotated. Get current token from Twilio Console → Account → API keys & tokens.
 */

const TWILIO_ACCOUNT_SID = "ACbd885ef22e91e37199add8c2a870af4b";
const TWILIO_AUTH_TOKEN = "668dd66a6f4cd2efb2e31f38e47e72fc";
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
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const body = new URLSearchParams({
    To: phoneNumber,
    From: TWILIO_FROM_NUMBER,
    Body: message,
  }).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString(
          "base64",
        ),
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio SMS failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  console.log(`[smsSender] SMS sent to ${phoneNumber} — SID: ${data.sid}`);
};
