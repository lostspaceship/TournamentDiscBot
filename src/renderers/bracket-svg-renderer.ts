import type { BracketRenderModel, BracketRenderRound } from "./types.js";

const CARD_WIDTH = 240;
const CARD_HEIGHT = 76;
const COLUMN_GAP = 96;
const MATCH_GAP = 32;
const SECTION_GAP = 80;
const LEFT_PAD = 48;
const TOP_PAD = 110;
const RIGHT_PAD = 48;
const BOTTOM_PAD = 48;

const COLORS = {
  background: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  accent: "#58a6ff",
  success: "#2ea043",
  pending: "#8957e5",
  warning: "#d29922"
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const statusColor = (status: string): string => {
  if (status === "COMPLETED") return COLORS.success;
  if (status === "READY") return COLORS.accent;
  if (status === "PENDING") return COLORS.pending;
  return COLORS.warning;
};

const pretty = (value: string): string =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const sideLabel = (side: BracketRenderRound["side"]): string => {
  if (side === "WINNERS") return "Winners Bracket";
  if (side === "LOSERS") return "Losers Bracket";
  return "Grand Finals";
};

export class BracketSvgRenderer {
  public render(model: BracketRenderModel): string {
    const groupedRounds = ["WINNERS", "LOSERS", "GRAND_FINALS"].map((side) =>
      model.rounds.filter((round) => round.side === side)
    );
    const width =
      LEFT_PAD +
      Math.max(
        ...groupedRounds.map((rounds) =>
          Math.max(1, rounds.length) * CARD_WIDTH + Math.max(0, rounds.length - 1) * COLUMN_GAP
        )
      ) +
      RIGHT_PAD;

    let currentY = TOP_PAD;
    const sectionLayouts = groupedRounds
      .filter((rounds) => rounds.length > 0)
      .map((rounds) => {
        const maxMatches = Math.max(...rounds.map((round) => round.matches.length));
        const height = 50 + maxMatches * CARD_HEIGHT + Math.max(0, maxMatches - 1) * MATCH_GAP;
        const layout = { rounds, top: currentY, height };
        currentY += height + SECTION_GAP;
        return layout;
      });

    const height = currentY - SECTION_GAP + BOTTOM_PAD;
    const connectors: string[] = [];
    const cards: string[] = [];

    for (const section of sectionLayouts) {
      const firstSide = section.rounds[0]!.side;
      cards.push(
        `<text x="${LEFT_PAD}" y="${section.top - 18}" fill="${COLORS.text}" font-size="24" font-weight="700">${escapeXml(sideLabel(firstSide))}</text>`
      );

      const centers = new Map<string, { x: number; y: number }>();

      for (const [roundIndex, round] of section.rounds.entries()) {
        const x = LEFT_PAD + roundIndex * (CARD_WIDTH + COLUMN_GAP);
        cards.push(
          `<text x="${x}" y="${section.top + 16}" fill="${COLORS.muted}" font-size="16" font-weight="600">${escapeXml(round.name)}</text>`
        );

        for (const [matchIndex, match] of round.matches.entries()) {
          const y = section.top + 34 + matchIndex * (CARD_HEIGHT + MATCH_GAP);
          centers.set(match.id, { x: x + CARD_WIDTH / 2, y: y + CARD_HEIGHT / 2 });

          const winnerName = match.winnerName ? `Winner: ${match.winnerName}` : pretty(match.status);
          cards.push(
            [
              `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="12" fill="${COLORS.panel}" stroke="${statusColor(match.status)}" stroke-width="2" />`,
              `<text x="${x + 14}" y="${y + 20}" fill="${COLORS.muted}" font-size="12" font-weight="600">M${match.sequence} • ${escapeXml(pretty(match.status))}</text>`,
              `<text x="${x + 14}" y="${y + 42}" fill="${COLORS.text}" font-size="15" font-weight="600">${escapeXml(match.player1Name)}</text>`,
              `<text x="${x + 14}" y="${y + 62}" fill="${COLORS.text}" font-size="15" font-weight="600">${escapeXml(match.player2Name)}</text>`,
              `<text x="${x + CARD_WIDTH - 14}" y="${y + 20}" fill="${COLORS.accent}" font-size="12" font-weight="600" text-anchor="end">${escapeXml(winnerName)}</text>`
            ].join("")
          );
        }
      }

      for (const round of section.rounds) {
        for (const match of round.matches) {
          if (!match.nextMatchId) {
            continue;
          }
          const from = centers.get(match.id);
          const to = centers.get(match.nextMatchId);
          if (!from || !to) {
            continue;
          }

          const elbowX = from.x + COLUMN_GAP / 2;
          connectors.push(
            `<path d="M ${from.x + CARD_WIDTH / 2 - 4} ${from.y} L ${elbowX} ${from.y} L ${elbowX} ${to.y} L ${to.x - CARD_WIDTH / 2 + 4} ${to.y}" fill="none" stroke="${COLORS.border}" stroke-width="2" />`
          );
        }
      }
    }

    const modeLabel =
      model.mode === "OFFICIAL"
        ? "Official bracket"
        : model.mode === "PREVIEW"
          ? "Live preview. Final bracket locks at start."
          : "Waiting for at least two eligible entrants.";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${COLORS.background}" />
  <text x="${LEFT_PAD}" y="48" fill="${COLORS.text}" font-size="34" font-weight="700">${escapeXml(model.tournamentName)}</text>
  <text x="${LEFT_PAD}" y="76" fill="${COLORS.muted}" font-size="16">${escapeXml(pretty(model.status))} • ${model.registrationCount} entrants • ${escapeXml(modeLabel)}</text>
  <text x="${width - RIGHT_PAD}" y="76" fill="${COLORS.muted}" font-size="14" text-anchor="end">${escapeXml(model.updatedLabel)}</text>
  ${connectors.join("")}
  ${cards.join("")}
</svg>`;
  }
}
