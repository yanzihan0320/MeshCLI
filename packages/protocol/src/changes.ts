import { z } from 'zod';

export const ChangedFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'binary']),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
});

export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const ChangeSetSchema = z.object({
  changeSetId: z.string().min(1),
  runId: z.string().min(1),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  files: z.array(ChangedFileSchema),
  diff: z.string(),
  truncated: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
});

export type ChangeSet = z.infer<typeof ChangeSetSchema>;
