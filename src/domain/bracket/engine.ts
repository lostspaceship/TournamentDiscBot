import { DomainValidationError } from "../errors.js";
import { DoubleEliminationEngine } from "./double-elimination.js";
import { SingleEliminationEngine } from "./single-elimination.js";
import type { BracketEngine, BracketFormat } from "./types.js";

export class BracketEngineFactory {
  public static create(format: BracketFormat): BracketEngine {
    switch (format) {
      case "SINGLE_ELIMINATION":
        return new SingleEliminationEngine();
      case "DOUBLE_ELIMINATION":
        return new DoubleEliminationEngine();
      default:
        throw new DomainValidationError(`Unsupported bracket format: ${String(format)}`);
    }
  }
}
