import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export const BehaviorV2Schema = z.object({
  version: z.string(),
  name: z.string(),
  businessTruthPriority: z.array(z.string()),
  response: z.object({
    defaultSentences: z.number().int().positive(),
    maximumSentences: z.number().int().positive(),
    onePrimaryQuestionPerMessage: z.boolean(),
    defaultEmoji: z.boolean(),
    addressCustomerAs: z.string(),
    avoidRepeatedGreeting: z.boolean(),
    avoidRoboticPhrases: z.boolean(),
  }).strict(),
  language: z.object({
    supported: z.array(z.string()),
    replyInCustomerScript: z.boolean(),
    preserveProductTokens: z.boolean(),
    mixedRussianJargonDoesNotSwitchUzbekToRussian: z.boolean(),
    correctCustomerSpellingPublicly: z.boolean(),
  }).strict(),
  qualificationOrder: z.array(z.string()),
  facts: z.object({
    neverInfer: z.array(z.string()),
    historicalConversationValuesAllowed: z.boolean(),
    unknownInventoryCanBePresentedAsAvailable: z.boolean(),
    sourceConflictAction: z.string(),
  }).strict(),
  actionHonesty: z.object({
    actionPhrasesRequireSuccessfulAction: z.boolean(),
    protectedPhrases: z.array(z.string()),
  }).strict(),
  lead: z.object({
    coldRange: z.tuple([z.number(), z.number()]),
    warmRange: z.tuple([z.number(), z.number()]),
    hotRange: z.tuple([z.number(), z.number()]),
    hotSignals: z.array(z.string()),
  }).strict(),
  handoff: z.object({
    highPriority: z.array(z.string()),
    onSuccessConversationState: z.string(),
    suppressAutomaticSalesReplyAfterHandoff: z.boolean(),
  }).strict(),
  complaint: z.object({
    apologizeBriefly: z.boolean(),
    requestEvidence: z.array(z.string()),
    createManagerOrTechnologistHandoff: z.boolean(),
    promiseCompensation: z.boolean(),
  }).strict(),
  identity: z.object({
    claimToBeHuman: z.boolean(),
    hideAutomationWhenDirectlyAsked: z.boolean(),
  }).strict(),
  privacy: z.object({
    neverDisclose: z.array(z.string()),
  }).strict(),
  followUp: z.object({
    enabledByThisConfig: z.boolean(),
    requiresSchedulerQueueAndApprovedPolicy: z.boolean(),
  }).strict(),
}).strict();

export type BehaviorV2Config = z.infer<typeof BehaviorV2Schema>;

/**
 * Loads and strictly validates the behavior V2 configuration.
 * Throws explicit error on invalid or missing configuration (NO silent fallback).
 */
export function loadBehaviorV2Config(filePath?: string): BehaviorV2Config {
  let targetPath = filePath || path.join(process.cwd(), 'config', 'conversation', 'behavior.v2.json');

  if (!filePath && !fs.existsSync(targetPath)) {
    // Try resolving relative to workspace root when running from an app directory
    const candidates = [
      path.join(process.cwd(), '..', '..', 'config', 'conversation', 'behavior.v2.json'),
      path.join(process.cwd(), '..', 'config', 'conversation', 'behavior.v2.json'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        targetPath = cand;
        break;
      }
    }
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`[BEHAVIOR V2 CONFIG FATAL] Behavior V2 configuration file not found at ${targetPath}`);
  }

  const rawContent = fs.readFileSync(targetPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`[BEHAVIOR V2 CONFIG FATAL] Failed to parse JSON at ${targetPath}: ${err.message}`);
  }

  const result = BehaviorV2Schema.safeParse(parsed);
  if (!result.success) {
    const errorDetails = JSON.stringify(result.error.format(), null, 2);
    throw new Error(`[BEHAVIOR V2 CONFIG FATAL] Invalid Behavior V2 configuration schema at ${targetPath}:\n${errorDetails}`);
  }

  return result.data;
}
