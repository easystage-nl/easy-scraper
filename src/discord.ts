import type { Listing } from "./types";
import { listingUrl } from "./stagemarkt";

// Discord allows up to 10 embeds per webhook message. Batch new listings.
const MAX_EMBEDS_PER_MSG = 10;

export async function notifyNewListings(
  webhookUrl: string,
  listings: Listing[],
  color: number,
): Promise<void> {
  for (let i = 0; i < listings.length; i += MAX_EMBEDS_PER_MSG) {
    const batch = listings.slice(i, i + MAX_EMBEDS_PER_MSG);
    const body = {
      content:
        batch.length === 1
          ? "New stage gevonden:"
          : `${batch.length} nieuwe stages gevonden:`,
      embeds: batch.map((l) => buildEmbed(l, color)),
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`discord webhook ${res.status}: ${await res.text()}`);
    }
  }
}

function buildEmbed(l: Listing, color: number) {
  const title = l.wervendeTitel?.trim() || l.titel || "(geen titel)";
  const orgNaam = l.organisatie?.naam ?? "onbekend";
  const plaats = l.adres?.plaats ?? "onbekend";
  const start = l.startdatum ? l.startdatum.slice(0, 10) : "—";

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "Organisatie", value: orgNaam, inline: true },
    { name: "Plaats", value: plaats, inline: true },
    { name: "Leerweg", value: l.leerweg || "—", inline: true },
    { name: "Startdatum", value: start, inline: true },
    { name: "Niveau", value: l.kwalificatie?.niveaunaam ?? "—", inline: true },
    { name: "Crebo", value: l.kwalificatie?.crebocode ?? "—", inline: true },
  ];

  const embed: Record<string, unknown> = {
    title: title.length > 256 ? `${title.slice(0, 253)}...` : title,
    url: listingUrl(l.leerplaatsId),
    color,
    fields,
    footer: { text: `leerplaatsId ${l.leerplaatsId}` },
    timestamp: new Date().toISOString(),
  };

  if (l.organisatie?.logoUrl) {
    embed.thumbnail = { url: l.organisatie.logoUrl };
  }
  const photo = l.afbeeldingen?.[0]?.url;
  if (photo) {
    embed.image = { url: photo };
  }

  return embed;
}
