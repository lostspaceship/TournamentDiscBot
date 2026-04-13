import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { env } from "../config/env.js";

const securedPayloadSchema = z.object({
  namespace: z.string().min(1).max(20),
  action: z.string().min(1).max(32),
  entityId: z.string().min(1).max(120),
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
  const payload = `${namespace}:${action}:${entityId}:${nonce}`;
  return `${payload}:${sign(payload)}`;
};

export const parseSignedCustomId = (customId: string) => {
  const [namespace, action, entityId, nonce, signature] = customId.split(":");
  const parsed = securedPayloadSchema.parse({
    namespace,
    action,
    entityId,
    nonce,
    signature
  });

  const payload = `${parsed.namespace}:${parsed.action}:${parsed.entityId}:${parsed.nonce}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parsed.signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid customId signature.");
  }

  return parsed;
};

const modalSchema = z.object({
  namespace: z.string().min(1).max(20),
  action: z.string().min(1).max(32),
  entityId: z.string().min(1).max(120),
  actorUserId: z.string().min(1).max(32),
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
  const payload = `${namespace}:${action}:${entityId}:${actorUserId}:${nonce}`;
  return `${payload}:${sign(payload)}`;
};

export const parseSignedModalId = (customId: string, actorUserId: string) => {
  const [namespace, action, entityId, encodedActorUserId, nonce, signature] = customId.split(":");
  const parsed = modalSchema.parse({
    namespace,
    action,
    entityId,
    actorUserId: encodedActorUserId,
    nonce,
    signature
  });

  if (parsed.actorUserId !== actorUserId) {
    throw new Error("Modal submission actor mismatch.");
  }

  const payload = `${parsed.namespace}:${parsed.action}:${parsed.entityId}:${parsed.actorUserId}:${parsed.nonce}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parsed.signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid modal signature.");
  }

  return parsed;
};
