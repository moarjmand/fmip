import { Controller, Get, Module } from '@nestjs/common';
import type { DeliveryHealth } from '@fmip/contracts';
import { OUTBOUND_DELIVERY, type OutboundDelivery, deliveryFromEnv } from './delivery.port';
import { DeliveryService } from './delivery.service';
import { PostgresPushSubscriptionStore } from './internal/push-subscriptions';

/**
 * `GET /health/delivery` (T-330): which channels this deployment can carry a
 * notification on. `in_product_only: true` is the normal state of a new
 * deployment and is reported as a fact, not hidden behind `status: ok`.
 */
@Controller()
export class DeliveryHealthController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('health/delivery')
  health(): DeliveryHealth {
    return this.delivery.describe();
  }
}

/**
 * The delivery boundary (T-330, blueprint 12.2): one port, providers behind
 * it, chosen at deployment. Imports nothing, so the notifications module can
 * import it without a cycle; the provider is read from the environment once,
 * and a name this build cannot drive stops the process at boot.
 */
@Module({
  controllers: [DeliveryHealthController],
  providers: [
    DeliveryService,
    PostgresPushSubscriptionStore,
    {
      provide: OUTBOUND_DELIVERY,
      useFactory: (subscriptions: PostgresPushSubscriptionStore): OutboundDelivery =>
        deliveryFromEnv(process.env, subscriptions),
      inject: [PostgresPushSubscriptionStore],
    },
  ],
  exports: [DeliveryService],
})
export class DeliveryModule {}
