import { MaintenanceService, TASKS } from "@/modules/maintenance/maintenance.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { InjectQueue, Process, Processor } from "@nestjs/bull";
import { Logger, OnModuleInit } from "@nestjs/common";
import { Job, Queue } from "bull";

/**
 * The scheduler. On startup it registers every task in TASKS as a repeating
 * Bull job; Bull keeps the timetable in Redis, so with two API servers a task
 * still runs once, not twice.
 */
@Processor(QUEUE.MAINTENANCE)
export class MaintenanceProcessor implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    @InjectQueue(QUEUE.MAINTENANCE) private readonly queue: Queue,
    private readonly maintenance: MaintenanceService,
  ) {}

  async onModuleInit() {
    for (const [task, when] of Object.entries(TASKS)) {
      const repeat = "every" in when ? { every: when.every } : { cron: when.cron };
      await this.queue.add("run", { task }, { repeat, jobId: `task:${task}`, removeOnComplete: true, removeOnFail: 20 });
    }
    this.logger.log(`scheduled ${Object.keys(TASKS).length} background tasks`);
  }

  @Process("run")
  async run(job: Job<{ task: string }>) {
    const result = await this.maintenance.run(job.data.task);
    // the frequent tasks would fill the log; only say something when something happened
    const quiet = ["flush-metrics", "camera-sweep", "site-resume"].includes(job.data.task);
    if (!quiet || Object.values(result as object).some((v) => typeof v === "number" && v > 0 && v !== (result as any).checked))
      this.logger.log(`${job.data.task}: ${JSON.stringify(result)}`);
  }
}
