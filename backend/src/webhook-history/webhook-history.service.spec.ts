import { WebhookHistoryService } from './webhook-history.service';
import { CreateWebhookDeliveryProvider } from './providers/create-webhook-delivery.provider';
import { FindWebhookDeliveriesProvider } from './providers/find-webhook-deliveries.provider';
import { WebhookDeliveryStatus } from './enums/webhook-delivery-status.enum';

describe('WebhookHistoryService', () => {
  let service: WebhookHistoryService;
  let createProvider: jest.Mocked<CreateWebhookDeliveryProvider>;
  let findProvider: jest.Mocked<FindWebhookDeliveriesProvider>;

  beforeEach(() => {
    createProvider = {
      create: jest.fn(),
      updateResult: jest.fn(),
      incrementRetry: jest.fn(),
    } as unknown as jest.Mocked<CreateWebhookDeliveryProvider>;

    findProvider = {
      findAll: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<FindWebhookDeliveriesProvider>;

    service = new WebhookHistoryService(createProvider, findProvider);
  });

  it('delegates create to CreateWebhookDeliveryProvider', async () => {
    const input = {
      webhookUrl: 'https://example.com/hook',
      payload: { event: 'booking.confirmed' },
    };
    const expected = {
      id: 'uuid-1',
      ...input,
      status: WebhookDeliveryStatus.PENDING,
    };
    createProvider.create.mockResolvedValue(expected as never);

    const result = await service.create(input);
    expect(createProvider.create).toHaveBeenCalledWith(input);
    expect(result).toEqual(expected);
  });

  it('delegates findAll to FindWebhookDeliveriesProvider', async () => {
    const query = { page: 1, limit: 10 };
    const expected = { data: [], total: 0, page: 1, limit: 10 };
    findProvider.findAll.mockResolvedValue(expected);

    const result = await service.findAll(query);
    expect(findProvider.findAll).toHaveBeenCalledWith(query);
    expect(result).toEqual(expected);
  });

  it('delegates findById to FindWebhookDeliveriesProvider', async () => {
    const expected = { id: 'uuid-1', webhookUrl: 'https://example.com' };
    findProvider.findById.mockResolvedValue(expected as never);

    const result = await service.findById('uuid-1');
    expect(findProvider.findById).toHaveBeenCalledWith('uuid-1');
    expect(result).toEqual(expected);
  });

  it('delegates updateResult to CreateWebhookDeliveryProvider', async () => {
    const result = {
      statusCode: 200,
      response: 'OK',
      status: WebhookDeliveryStatus.SUCCESS,
    };
    createProvider.updateResult.mockResolvedValue(undefined);

    await service.updateResult('uuid-1', result);
    expect(createProvider.updateResult).toHaveBeenCalledWith('uuid-1', result);
  });

  it('delegates incrementRetry to CreateWebhookDeliveryProvider', async () => {
    createProvider.incrementRetry.mockResolvedValue(undefined);

    await service.incrementRetry('uuid-1');
    expect(createProvider.incrementRetry).toHaveBeenCalledWith('uuid-1');
  });
});
