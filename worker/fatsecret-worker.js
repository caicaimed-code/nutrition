// FatSecret middle server for the nutrition app (Cloudflare Worker, free plan).
//
// Why it exists: FatSecret needs a Client Secret. The app is a public web page, so the secret
// can't live in it. This small server keeps the secret, asks FatSecret, and passes the answer back.
//
// Setup (Cloudflare dashboard → this Worker → Settings → Variables and Secrets):
//   FS_ID     = your FatSecret Client ID      (type: Secret)
//   FS_SECRET = your FatSecret Client Secret  (type: Secret)
//
// Use from the app:  GET https://<worker>.workers.dev/barcode?code=0690819408243
//   → FatSecret's food (with servings) as JSON, or { "notFound": true }.

const ALLOWED = ["https://caicaimed-code.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const BARCODE_URL = "https://platform.fatsecret.com/rest/food/barcode/find-by-id/v2";

let token = null, tokenUntil = 0; // reused while the Worker stays warm (tokens last about a day)

async function getToken(env) {
  if (token && Date.now() < tokenUntil) return token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(env.FS_ID + ":" + env.FS_SECRET)
    },
    body: "grant_type=client_credentials&scope=premier barcode"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error("token: " + res.status + " " + JSON.stringify(data));
  token = data.access_token;
  tokenUntil = Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000;
  return token;
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin"
  };
}

function reply(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors(origin))
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    const url = new URL(request.url);

    if (url.pathname === "/barcode") {
      const code = (url.searchParams.get("code") || "").replace(/\D/g, "");
      if (code.length < 8 || code.length > 14) return reply({ error: "bad barcode" }, 400, origin);
      const gtin13 = code.replace(/^0+(?=\d{13})/, "").padStart(13, "0"); // FatSecret wants 13 digits
      try {
        const t = await getToken(env);
        const q = new URLSearchParams({ barcode: gtin13, format: "json", region: "US", flag_default_serving: "true" });
        const res = await fetch(BARCODE_URL + "?" + q, { headers: { Authorization: "Bearer " + t } });
        const data = await res.json().catch(() => ({}));
        if (data.error) {
          if (+data.error.code === 211) return reply({ notFound: true }, 200, origin); // not in FatSecret
          if (+data.error.code === 13) token = null; // expired token: get a new one next time
          return reply({ error: data.error }, 502, origin);
        }
        if (!data.food) return reply({ notFound: true }, 200, origin);
        return reply(data, 200, origin);
      } catch (e) {
        return reply({ error: String(e && e.message || e) }, 502, origin);
      }
    }

    if (url.pathname === "/") return reply({ ok: true, service: "nutrition app fatsecret proxy" }, 200, origin);
    return reply({ error: "not found" }, 404, origin);
  }
};
