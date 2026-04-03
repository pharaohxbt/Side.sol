export default async function handler(req, res) {
  const { url } = req.query;
  if (!url || !url.includes("luma")) {
    return res.status(400).json({ error: "Invalid Luma URL" });
  }

  try {
    // Normalize URL to lu.ma domain
    const lumaUrl = url.replace("luma.com", "lu.ma");
    const response = await fetch(lumaUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!response.ok) {
      return res.status(404).json({ error: "Could not fetch Luma page" });
    }

    const html = await response.text();

    // Look for evt- pattern in the HTML
    const match = html.match(/evt-[A-Za-z0-9_-]{10,}/);
    if (match) {
      return res.json({ eventId: match[0] });
    }

    return res.status(404).json({ error: "Could not find event ID in page" });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch" });
  }
}
