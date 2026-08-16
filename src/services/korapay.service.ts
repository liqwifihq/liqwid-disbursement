import axios from 'axios';
import * as crypto from 'crypto';
import { getKoraConfig } from '../config';

export type KoraPayout = {
  reference: string;
  destination: {
    type: 'bank_account';
    amount: number;
    currency: string;
    narration: string;
    bank_account: { bank: string; account: string };
    customer: { name: string; email: string };
  };
};

export class KorapayService {
  private readonly baseUrl: string;
  private readonly secret: string;
  readonly mode: 'simulation' | 'live';

  constructor() {
    const config = getKoraConfig();
    this.mode = config.mode;
    this.baseUrl = config.baseUrl;
    this.secret = config.secret;
  }

  async payout(payload: KoraPayout) {
    if (this.mode === 'simulation') {
      return {
        status: true,
        message: 'Payment simulated; no funds were transferred.',
        data: { reference: payload.reference, status: 'simulated', provider_id: `sim-${Date.now()}` },
      };
    }
    const response = await axios.post(
      `${this.baseUrl}/merchant/api/v1/transactions/disburse`,
      payload,
      { headers: { Authorization: `Bearer ${this.secret}` }, timeout: 30_000 },
    );
    return response.data;
  }

  verifyWebhookSignature(data: unknown, signatureHeader?: string) {
    if (this.mode !== 'live') return false;
    if (!signatureHeader || !/^[a-f\d]{64}$/i.test(signatureHeader)) return false;

    const digest = crypto
      .createHmac('sha256', this.secret)
      .update(JSON.stringify(data))
      .digest();
    const supplied = Buffer.from(signatureHeader, 'hex');
    return supplied.length === digest.length && crypto.timingSafeEqual(digest, supplied);
  }

  async getPayoutStatus(reference: string) {
    if (this.mode === 'simulation') {
      return { status: true, data: { reference, status: 'simulated', simulated: true } };
    }
    const response = await axios.get(
      `${this.baseUrl}/merchant/api/v1/transactions/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.secret}` }, timeout: 30_000 },
    );
    return response.data;
  }

}
