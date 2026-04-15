import type { BracketRenderMatch, BracketRenderModel, BracketRenderRound } from "./types.js";

const CARD_WIDTH = 300;
const CARD_HEIGHT = 92;
const COLUMN_GAP = 84;
const ROW_GAP = 28;
const PLACEHOLDER_ROW_GAP = 34;
const LEFT_PAD = 56;
const TOP_PAD = 56;
const RIGHT_PAD = 56;
const BOTTOM_PAD = 56;
const EMPTY_HEIGHT = 760;

const COLORS = {
  background: "#0b1220",
  panel: "#131d30",
  panelAlt: "#172338",
  border: "#2a3b57",
  text: "#f3f7ff",
  muted: "#9cafc7",
  accent: "#f2c94c",
  success: "#4ade80",
  pending: "#60a5fa",
  warning: "#f59e0b"
};

const FONT_STACK = "Arial, Helvetica, sans-serif";

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const pretty = (value: string): string =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const statusColor = (status: string): string => {
  if (status === "COMPLETED") return COLORS.success;
  if (status === "READY") return COLORS.pending;
  return COLORS.warning;
};

const sideLabel = (side: BracketRenderRound["side"]): string => {
  if (side === "WINNERS") return "Winners Bracket";
  if (side === "LOSERS") return "Losers Bracket";
  return "Grand Finals";
};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;

const connectorPath = (fromX: number, fromY: number, toX: number, toY: number): string => {
  const elbowX = fromX + COLUMN_GAP / 2;
  return `M ${fromX} ${fromY} L ${elbowX} ${fromY} L ${elbowX} ${toY} L ${toX} ${toY}`;
};

const projectedMatchNumber = (roundNumber: number, matchIndex: number): number =>
  2 ** (roundNumber - 1) + matchIndex;

const projectedSlotLabel = (
  roundNumber: number,
  slotIndex: number,
  entrantNames: string[]
): string => {
  if (roundNumber === 1) {
    return entrantNames[slotIndex] ?? "TBD";
  }

  const sourceMatch = 2 ** (roundNumber - 2) + Math.floor(slotIndex / 2);
  return `Winner M${sourceMatch}`;
};

export class BracketSvgRenderer {
  public render(model: BracketRenderModel): string {
    if (model.rounds.length === 0) {
      return this.renderEmpty(model);
    }

    const width =
      LEFT_PAD +
      model.rounds.length * CARD_WIDTH +
      Math.max(0, model.rounds.length - 1) * COLUMN_GAP +
      RIGHT_PAD;

    const maxMatches = Math.max(...model.rounds.map((round) => round.matches.length));
    const contentHeight = maxMatches * CARD_HEIGHT + Math.max(0, maxMatches - 1) * ROW_GAP;
    const height = TOP_PAD + contentHeight + BOTTOM_PAD;

    const cards: string[] = [];
    const connectors: string[] = [];
    const centers = new Map<string, { left: number; right: number; centerY: number }>();

    model.rounds.forEach((round, roundIndex) => {
      const x = LEFT_PAD + roundIndex * (CARD_WIDTH + COLUMN_GAP);
      cards.push(
        `<text x="${x}" y="${TOP_PAD - 18}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="22" font-weight="700">${escapeXml(round.name)}</text>`
      );

      round.matches.forEach((match, matchIndex) => {
        const y = TOP_PAD + matchIndex * (CARD_HEIGHT + ROW_GAP);
        const winnerLabel =
          match.winnerName != null ? `Winner: ${truncate(match.winnerName, 24)}` : pretty(match.status);

        cards.push(this.renderMatchCard(x, y, match, winnerLabel));
        centers.set(match.id, {
          left: x,
          right: x + CARD_WIDTH,
          centerY: y + CARD_HEIGHT / 2
        });
      });
    });

    model.rounds.forEach((round) => {
      round.matches.forEach((match) => {
        if (!match.nextMatchId) {
          return;
        }

        const from = centers.get(match.id);
        const to = centers.get(match.nextMatchId);
        if (!from || !to) {
          return;
        }

        connectors.push(
          `<path d="${connectorPath(from.right, from.centerY, to.left, to.centerY)}" fill="none" stroke="${COLORS.border}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`
        );
      });
    });

    return this.wrapSvg(model, width, height, `${connectors.join("")}${cards.join("")}`);
  }

  private renderEmpty(model: BracketRenderModel): string {
    const placeholder = model.placeholder ?? {
      bracketSize: 8,
      startRound: 1,
      endRound: 3,
      totalRounds: 3,
      entrantNames: []
    };
    const visibleRoundCount = placeholder.endRound - placeholder.startRound + 1;
    const width =
      LEFT_PAD +
      visibleRoundCount * CARD_WIDTH +
      Math.max(0, visibleRoundCount - 1) * COLUMN_GAP +
      RIGHT_PAD;

    const matchCounts = Array.from({ length: visibleRoundCount }, (_, index) => {
      const absoluteRound = placeholder.startRound + index;
      return Math.max(1, placeholder.bracketSize / 2 ** absoluteRound);
    });
    const maxMatches = Math.max(...matchCounts);
    const contentHeight =
      maxMatches * CARD_HEIGHT + Math.max(0, maxMatches - 1) * PLACEHOLDER_ROW_GAP;
    const panelHeight = Math.max(EMPTY_HEIGHT, contentHeight + 180);
    const height = TOP_PAD + panelHeight + BOTTOM_PAD;
    const bracketTop = TOP_PAD + 38;
    const panelWidth = width - LEFT_PAD - RIGHT_PAD;

    const cards: string[] = [
      `<rect x="${LEFT_PAD}" y="${TOP_PAD}" width="${panelWidth}" height="${panelHeight}" rx="20" fill="${COLORS.panel}" stroke="${COLORS.border}" stroke-width="2" />`
    ];
    const connectors: string[] = [];
    const centers = new Map<number, Array<{ left: number; right: number; centerY: number }>>();

    for (let index = 0; index < visibleRoundCount; index += 1) {
      const absoluteRound = placeholder.startRound + index;
      const x = LEFT_PAD + index * (CARD_WIDTH + COLUMN_GAP);
      const matchCount = matchCounts[index] ?? 1;
      const roundHeight =
        matchCount * CARD_HEIGHT + Math.max(0, matchCount - 1) * PLACEHOLDER_ROW_GAP;
      const offsetY = bracketTop + Math.max(0, (contentHeight - roundHeight) / 2);
      const columnCenters: Array<{ left: number; right: number; centerY: number }> = [];

      cards.push(
        `<text x="${x}" y="${bracketTop - 26}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="15" font-weight="700">ROUND ${absoluteRound}</text>`
      );

      for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
        const y = offsetY + matchIndex * (CARD_HEIGHT + PLACEHOLDER_ROW_GAP);
        const matchNumber = projectedMatchNumber(absoluteRound, matchIndex);
        const player1Label = projectedSlotLabel(
          absoluteRound,
          matchIndex * 2,
          placeholder.entrantNames
        );
        const player2Label = projectedSlotLabel(
          absoluteRound,
          matchIndex * 2 + 1,
          placeholder.entrantNames
        );
        cards.push(
          this.renderPlaceholderCard(x, y, `MATCH ${matchNumber}`, player1Label, player2Label)
        );
        columnCenters.push({
          left: x,
          right: x + CARD_WIDTH,
          centerY: y + CARD_HEIGHT / 2
        });
      }

      centers.set(index, columnCenters);
    }

    for (let index = 0; index < visibleRoundCount - 1; index += 1) {
      const fromRound = centers.get(index) ?? [];
      const toRound = centers.get(index + 1) ?? [];
      for (let matchIndex = 0; matchIndex < fromRound.length; matchIndex += 2) {
        const target = toRound[Math.floor(matchIndex / 2)];
        if (!target) {
          continue;
        }

        const fromA = fromRound[matchIndex];
        const fromB = fromRound[matchIndex + 1];
        if (fromA) {
          connectors.push(
            `<path d="${connectorPath(fromA.right, fromA.centerY, target.left, target.centerY)}" fill="none" stroke="${COLORS.border}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`
          );
        }
        if (fromB) {
          connectors.push(
            `<path d="${connectorPath(fromB.right, fromB.centerY, target.left, target.centerY)}" fill="none" stroke="${COLORS.border}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`
          );
        }
      }
    }

    return this.wrapSvg(model, width, height, `${connectors.join("")}${cards.join("")}`);
  }

  private renderMatchCard(x: number, y: number, match: BracketRenderMatch, winnerLabel: string): string {
    const player1 = truncate(match.player1Name, 28);
    const player2 = truncate(match.player2Name, 28);

    return [
      `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="18" fill="${COLORS.panel}" stroke="${statusColor(match.status)}" stroke-width="3" />`,
      `<rect x="${x + 14}" y="${y + 14}" width="${CARD_WIDTH - 28}" height="24" rx="12" fill="${COLORS.panelAlt}" />`,
      `<text x="${x + 26}" y="${y + 31}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12" font-weight="700">MATCH ${match.sequence}</text>`,
      `<text x="${x + CARD_WIDTH - 22}" y="${y + 31}" fill="${statusColor(match.status)}" font-family="${FONT_STACK}" font-size="12" font-weight="700" text-anchor="end">${escapeXml(pretty(match.status))}</text>`,
      `<text x="${x + 22}" y="${y + 58}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="18" font-weight="700">${escapeXml(player1)}</text>`,
      `<text x="${x + 22}" y="${y + 82}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="18" font-weight="700">${escapeXml(player2)}</text>`,
      `<text x="${x + CARD_WIDTH - 22}" y="${y + CARD_HEIGHT - 16}" fill="${COLORS.accent}" font-family="${FONT_STACK}" font-size="12" font-weight="700" text-anchor="end">${escapeXml(winnerLabel)}</text>`
    ].join("");
  }

  private renderPlaceholderCard(
    x: number,
    y: number,
    title: string,
    player1Label: string,
    player2Label: string
  ): string {
    return [
      `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="18" fill="${COLORS.panelAlt}" stroke="${COLORS.border}" stroke-width="3" />`,
      `<text x="${x + 22}" y="${y + 28}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12" font-weight="700">${escapeXml(title)}</text>`,
      `<text x="${x + 22}" y="${y + 56}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="18" font-weight="700">${escapeXml(truncate(player1Label, 26))}</text>`,
      `<text x="${x + 22}" y="${y + 80}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="18" font-weight="700">${escapeXml(truncate(player2Label, 26))}</text>`
    ].join("");
  }

  private wrapSvg(model: BracketRenderModel, width: number, height: number, body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${COLORS.background}" />
  ${body}
</svg>`;
  }
}
