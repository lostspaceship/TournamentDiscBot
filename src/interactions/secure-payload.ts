import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { env } from "../config/env.js";

const securedPayloadSchema = z.object({
  namespace: z.string().min(1).max(20),
  action: z.string().min(1).max(32),
  entityId: z.string().min(1).max(120),
  issuedAt: z.coerce.number().int().positive(),
  nonce: z.string().min(6).max(32),
  signature: z.string().length(16)
});

const secret = () => env.DISCORD_TOKEN;

const sign = (value: string): string =>
  createHmac("sha256", secret()).update(value).digest("hex").slice(0, 16);

export const buildSignedCustomId = (
  namespace: string,
  action: string,
  entityId: string,
  nonce: string
): string => {
  const issuedAt = Date.now();
  const payload = `${namespace}:${action}:${entityId}:${issuedAt}:${nonce}`;
  return `${payload}:${sign(payload)}`;
};

export const parseSignedCustomId = (
  customId: string,
  options?: {
    maxAgeMs?: number;
  }
) => {
  const parts = customId.split(":");
  const [namespace, action, entityId, issuedAtRaw, nonce, signature] =
    parts.length === 6
      ? parts
      : [parts[0], parts[1], parts[2], Date.now().toString(), parts[3], parts[4]];
  const parsed = securedPayloadSchema.parse({
    namespace,
    action,
    entityId,
    issuedAt: issuedAtRaw,
    nonce,
    signature
  });

  const payload = `${parsed.namespace}:${parsed.action}:${parsed.entityId}:${parsed.issuedAt}:${parsed.nonce}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parsed.signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid customId signature.");
  }

  if (options?.maxAgeMs != null && Date.now() - parsed.issuedAt > options.maxAgeMs) {
    throw new Error("This interaction has expired.");
  }

  return parsed;
};

const modalSchema = z.object({
  namespace: z.string().min(1).max(20),
  action: z.string().min(1).max(32),
  entityId: z.string().min(1).max(120),
  actorUserId: z.string().min(1).max(32),
  issuedAt: z.coerce.number().int().positive(),
  nonce: z.string().min(6).max(32),
  signature: z.string().length(16)
});

export const buildSignedModalId = (
  namespace: string,
  action: string,
  entityId: string,
  actorUserId: string,
  nonce: string
): string => {
  const issuedAt = Date.now();
  const payload = `${namespace}:${action}:${entityId}:${actorUserId}:${issuedAt}:${nonce}`;
  return `${payload}:${sign(payload)}`;
};

export const parseSignedModalId = (
  customId: string,
  actorUserId: string,
  options?: {
    maxAgeMs?: number;
  }
) => {
  const parts = customId.split(":");
  const [namespace, action, entityId, encodedActorUserId, issuedAtRaw, nonce, signature] =
    parts.length === 7
      ? parts
      : [parts[0], parts[1], parts[2], parts[3], Date.now().toString(), parts[4], parts[5]];
  const parsed = modalSchema.parse({
    namespace,
    action,
    entityId,
    actorUserId: encodedActorUserId,
    issuedAt: issuedAtRaw,
    nonce,
    signature
  });

  if (parsed.actorUserId !== actorUserId) {
    throw new Error("Modal submission actor mismatch.");
  }

  const payload = `${parsed.namespace}:${parsed.action}:${parsed.entityId}:${parsed.actorUserId}:${parsed.issuedAt}:${parsed.nonce}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parsed.signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid modal signature.");
  }

  if (options?.maxAgeMs != null && Date.now() - parsed.issuedAt > options.maxAgeMs) {
    throw new Error("This modal submission has expired.");
  }

  return parsed;
};
