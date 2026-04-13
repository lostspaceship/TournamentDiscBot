import { z } from "zod";

const componentSchema = z.object({
  namespace: z.string().min(1).max(20),
  action: z.string().min(1).max(20),
  entityId: z.string().min(1).max(120)
});

export const parseCustomId = (customId: string) => {
  const [namespace, action, entityId] = customId.split(":");
  return componentSchema.parse({ namespace, action, entityId });
};
