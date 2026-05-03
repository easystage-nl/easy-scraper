import type { Listing } from "./types";
import { listingUrl } from "./stagemarkt";

// Discord allows up to 10 embeds per webhook message.
export const MAX_EMBEDS_PER_MSG = 10;

// Per-webhook rate limit is ~5 requests / 2 s. 500 ms between batches stays
// well under that and means a backlog of 100 listings (10 batches) takes ~5 s.
const INTER_BATCH_DELAY_MS = 500;

const MAX_RETRY_429 = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function postBatch(
  webhookUrl: string,
  batch: Listing[],
  color: number,
): Promise<void> {
  const body = {
    content:
      batch.length === 1
        ? "New stage gevonden:"
        : `${batch.length} nieuwe stages gevonden:`,
    embeds: batch.map((l) => buildEmbed(l, color)),
  };
  const payload = JSON.stringify(body);

  for (let attempt = 0; attempt <= MAX_RETRY_429; attempt++) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });

    if (res.ok) return;

    if (res.status === 429 && attempt < MAX_RETRY_429) {
      // Prefer Discord's structured retry_after (seconds, fractional) over the
      // header — they agree, but the body is the canonical source.
      const text = await res.text();
      let waitMs = INTER_BATCH_DELAY_MS;
      try {
        const j = JSON.parse(text) as { retry_after?: number };
        if (typeof j.retry_after === "number") {
          waitMs = Math.ceil(j.retry_after * 1000) + 100;
        }
      } catch {
        // fall through
      }
      console.warn(`discord 429, retrying in ${waitMs}ms (attempt ${attempt + 1})`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`discord webhook ${res.status}: ${await res.text()}`);
  }
}

export async function delayBetweenBatches(): Promise<void> {
  await sleep(INTER_BATCH_DELAY_MS);
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
    url: listingUrl(l.leerplaatsId, l.titel),
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
