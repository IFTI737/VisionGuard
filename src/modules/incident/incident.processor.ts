import { IncidentService } from "@/modules/incident/incident.service";
import { RuleTransitionJob } from "@/modules/ingestion/ingestion.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { Process, Processor } from "@nestjs/bull";
import { Job } from "bull";

/**
 * Worker of the "incident" queue. The ingestion service puts a job here when a
 * rule fires or clears; this worker writes the incident. Because it is a queue,
 * a slow database never delays the next camera reading, and a failed job is
 * retried (3 attempts) instead of being lost.
 */
@Processor(QUEUE.INCIDENT)
export class IncidentProcessor {
  constructor(private readonly incidentService: IncidentService) {}

  @Process("transition")
  async transition(job: Job<RuleTransitionJob>) {
    await this.incidentService.handleTransition(job.data);
  }
}
