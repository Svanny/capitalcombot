import type {
  CapitalAccountPreferences,
  OpenMarketOrderInput,
  OpenPosition,
  ScheduledOrderJob,
} from "../../shared/types";
import { aggregateSignedPosition, planTargetTransition } from "../../shared/target-position";
import { createAppError } from "./capital/client";
import type { ScheduledExecutionResult } from "./scheduler";

export interface TargetPositionExecutionClient {
  getAccountPreferences(): Promise<CapitalAccountPreferences>;
  listPositions(): Promise<OpenPosition[]>;
  openMarketPosition(input: OpenMarketOrderInput): Promise<OpenPosition | null>;
}

export async function executeTargetPositionJob(
  client: TargetPositionExecutionClient,
  job: ScheduledOrderJob,
  executionTime = new Date(),
): Promise<ScheduledExecutionResult> {
  const target = job.targetPosition;
  if (!target) {
    throw createAppError("INVALID_TARGET_POSITION_JOB", "Target-position metadata is missing.");
  }

  const preferences = await client.getAccountPreferences();
  if (preferences.hedgingMode !== false) {
    throw createAppError(
      "HEDGING_MODE_ENABLED",
      "Target-position execution is blocked while Capital.com hedging mode is enabled.",
      true,
    );
  }

  const positions = await client.listPositions();
  const currentPosition = aggregateSignedPosition(positions, job.epic);
  const plan = planTargetTransition({
    currentPosition,
    targetDirection: target.direction,
    targetSize: target.size,
    leg: target.leg,
    executionTime,
  });

  if (plan.kind === "noop") {
    return {
      position: null,
      resolvedProtection: null,
      reason: plan.reason,
      noOrderNeeded: true,
    };
  }

  const position = await client.openMarketPosition({
    epic: job.epic,
    direction: plan.direction,
    size: plan.size,
    protection: null,
  });

  return {
    position,
    resolvedProtection: null,
    reason: `${plan.reason} Submitted ${plan.direction} ${plan.size}.`,
  };
}
