// Nutrition app: ideas and feedback → email.
// Paste this into a new Apps Script project (script.google.com), then
// Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
// The email goes to the Google account that deployed it, so no address is in the app's public code.

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out("bad"); }
  if (!d || d.app !== "nutrition") return out("ignored");
  var text = String(d.text || "").trim().slice(0, 4000);
  if (!text) return out("empty");

  // Light protection against spam: at most 40 emails a day
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
  var count = props.getProperty("day") === today ? Number(props.getProperty("count") || 0) : 0;
  if (count >= 40) return out("limit");
  props.setProperties({ day: today, count: String(count + 1) });

  var type = String(d.type || "Feedback").slice(0, 20);
  var email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email || "")) ? String(d.email) : "";
  var body = text + "\n\n---\n" +
    "Type: " + type + "\n" +
    "Reply to: " + (email || "not shared") + "\n" +
    "App: " + String(d.version || "") + "\n" +
    "Phone: " + String(d.device || "") + "\n" +
    "Written: " + String(d.sent || "");
  var msg = { to: Session.getEffectiveUser().getEmail(), subject: "Nutrition app " + type.toLowerCase() + ": " + text.slice(0, 60), body: body };
  if (email) msg.replyTo = email;
  MailApp.sendEmail(msg);
  return out("ok");
}

function out(s) { return ContentService.createTextOutput(s); }

// Run this once from the editor (select testEmail, press Run) to allow sending email and check it arrives.
function testEmail() {
  doPost({ postData: { contents: JSON.stringify({ app: "nutrition", type: "Idea", text: "Test from the script editor", version: "test" }) } });
}
