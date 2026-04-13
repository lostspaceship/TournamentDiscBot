import { DomainValidationError } from "../errors.js";
import type { Entrant, SeededEntrant, SeedingMethod } from "./types.js";

export interface SeedParticipantsOptions {
  method: SeedingMethod;
  randomSeed?: string;
}

const nextRandom = (seed: string) => {
  let state = BigInt(`0x${seed.padEnd(16, "0").slice(0, 16)}`);
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    return Number(state & 0xffffffffn);
  };
};

const deterministicShuffle = <T>(values: T[], seed: string): T[] => {
  const random = nextRandom(seed);
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.abs(random()) % (index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }
  return copy;
};

export const nextPowerOfTwo = (value: number): number => {
  let current = 1;
  while (current < value) {
    current *= 2;
  }
  return current;
};

export const createSeedOrder = (size: number): number[] => {
  if (size < 1 || size & (size - 1)) {
    throw new DomainValidationError("Bracket size must be a power of two.");
  }

  if (size === 1) {
    return [1];
  }

  const previous = createSeedOrder(size / 2);
  const result: number[] = [];
  for (const seed of previous) {
    result.push(seed, size + 1 - seed);
  }
  return result;
};

export const seedEntrants = (
  entrants: Entrant[],
  options: SeedParticipantsOptions
): SeededEntrant[] => {
  if (entrants.length < 2) {
    throw new DomainValidationError("At least two entrants are required.");
  }

  let ordered: Entrant[];

  switch (options.method) {
    case "MANUAL":
      ordered = [...entrants].sort((left, right) => {
        if (left.seed == null || right.seed == null) {
          throw new DomainValidationError("Manual seeding requires explicit entrant.seed values.");
        }
        return left.seed - right.seed;
      });
      break;
    case "RATING_BASED":
      ordered = [...entrants].sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0));
      break;
    case "RANDOM":
      ordered = deterministicShuffle([...entrants], options.randomSeed ?? "default-seed");
      break;
    default:
      throw new DomainValidationError(`Unsupported seeding method: ${String(options.method)}`);
  }

  return ordered.map((entrant, index) => ({
    ...entrant,
    seed: index + 1
  }));
};

export const padSeededEntrants = (entrants: SeededEntrant[]): Array<SeededEntrant | null> => {
  const size = nextPowerOfTwo(Math.max(2, entrants.length));
  const layout = createSeedOrder(size);
  const bySeed = new Map(entrants.map((entrant) => [entrant.seed, entrant]));
  return layout.map((seed) => bySeed.get(seed) ?? null);
};
